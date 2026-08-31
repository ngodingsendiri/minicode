// Driver fullscreen REPL — minimal pure ANSI (tanpa Ink)
// Slash builtin → overlay; skill → renderSkill → LLM

import { resolve as resolvePath } from "node:path"
import { detectAndSave, loadConfig, removeProvider, saveProvider } from "../src/config.ts"
import { listSessions } from "../src/session/persistence.ts"
import { renderSkill } from "../src/skills/loader.ts"
import { expandMentions } from "../src/tui/file-mention.ts"
import { attachFullscreenMinimal } from "../src/tui/minimal/fullscreen.ts"
import { BUILTIN_COMMANDS, type CommandContext, handleBuiltinCommand } from "./commands.ts"
import { appendHistory, loadHistory } from "./input.ts"
import { captureOutput } from "./panel.ts"
import type { CliSession } from "./setup.ts"

const MODES = ["auto", "ask", "plan", "allowlist"] as const

export async function runFullscreen(ctx: CliSession): Promise<void> {
  const {
    session,
    cfg,
    cwd,
    sessionId,
    modelRef,
    effectiveTimeoutMs,
    permissionMode,
    permissions,
    sessionTools,
    allLoadedSkills,
    usage,
    budget,
    persistCurrent,
    runPromptWithVerify,
    close,
  } = ctx

  // Kernel tidak mengekspos `config`, jadi handle permission datang dari
  // createMinicodeSession lewat CliSession. Tanpa ini Shift+Tab hanya mengubah
  // label header sementara mode sebenarnya tidak berubah.
  let mode: string = permissions?.getMode() ?? permissionMode ?? "auto"

  const commandCtx: CommandContext = {
    cwd,
    sessionId,
    get currentModel() {
      return modelRef.current ?? cfg.providers[0]?.models[0]
    },
    set currentModel(v) {
      modelRef.current = v
    },
    usage,
    skills: allLoadedSkills,
    toolsCount: sessionTools.length,
    providerHint: cfg.providers[0]?.providerHint,
    setModelOverride: (m) => {
      modelRef.current = m
    },
  }

  const suggestions = (line: string) => {
    if (!line.startsWith("/")) return []
    const all = [
      ...BUILTIN_COMMANDS.map((b) => `/${b.name}`),
      ...allLoadedSkills.map((s) => `/${s.name}`),
    ]
    return all
      .filter((t) => t.startsWith(line))
      .map((text) => ({
        text,
        group: BUILTIN_COMMANDS.some((b) => `/${b.name}` === text) ? "commands" : "skills",
      }))
  }

  const history = await loadHistory()

  const onPicker = async (
    q: string,
  ): Promise<{
    title: string
    items: { label: string; value: string }[]
    onPick(v: string): string | void
    onKey?(
      key: string,
      selectedValue?: string,
      openForm?: (label: string, submit: (value: string) => Promise<string | void>) => void,
    ): Promise<string | void> | string | void
  } | null> => {
    const cmd = q.slice(1).split(" ")[0]!.toLowerCase()
    if (cmd === "model") {
      const items = cfg.providers.flatMap((p) =>
        p.models.map((m) => ({ label: `${p.id}::${m}`, value: `${p.id}::${m}` })),
      )
      return {
        title: "Models",
        items,
        onPick: (value) => {
          modelRef.current = value
          return `Selected ${value}`
        },
        onKey: async (key, _selectedValue, openForm) => {
          if (key.toLowerCase() === "a" && openForm) {
            openForm("Model name:", async (value) => {
              const [providerId] = (modelRef.current ?? "").split("::")
              const provider = cfg.providers.find((p) => p.id === providerId) ?? cfg.providers[0]
              if (!provider || !value.trim()) return "Model name is required"
              if (!provider.models.includes(value.trim())) {
                provider.models = [...provider.models, value.trim()]
                await saveProvider(provider, { global: !cwd, cwd })
              }
              return `Added ${provider.id}::${value.trim()}`
            })
            return
          }
          if (key.toLowerCase() !== "d") return
          const current = items.find((item) => item.value === modelRef.current) ?? items[0]
          if (!current) return "No models configured"
          const [providerId, ...modelParts] = current.value.split("::")
          const model = modelParts.join("::")
          const provider = cfg.providers.find((p) => p.id === providerId)
          if (!provider) return "Provider not found"
          provider.models = provider.models.filter((m) => m !== model)
          await saveProvider(provider, { global: !cwd, cwd })
          return `Deleted ${current.value}`
        },
      }
    }
    if (cmd === "provider") {
      return {
        title: "Providers",
        items: cfg.providers.map((p) => ({
          label: `${p.id}  ${p.models.length} models`,
          value: p.id,
        })),
        onPick: (id) => {
          const provider = cfg.providers.find((p) => p.id === id)
          const model = provider?.models[0]
          if (model) modelRef.current = `${id}::${model}`
          return model ? `Selected ${id}::${model}` : `Selected ${id}`
        },
        onKey: async (key: string, selectedValue: string | undefined, openForm) => {
          if (key.toLowerCase() === "a" && openForm) {
            openForm("Provider id:", async (value) => {
              if (!value.trim()) return "Provider id is required"
              if (cfg.providers.some((p) => p.id === value.trim())) return "Provider already exists"
              openForm("Base URL:", async (baseUrl) => {
                if (!baseUrl.trim()) return "Base URL is required"
                openForm("API key:", async (apiKey) => {
                  if (!apiKey.trim()) return "API key is required"
                  const entry = await detectAndSave(baseUrl.trim(), apiKey.trim(), value.trim(), {
                    global: !cwd,
                    cwd,
                    fallbackModels: ["gpt-4o-mini"],
                  })
                  return `Added ${entry.id}`
                })
              })
              return
            })
            return
          }
          if (key.toLowerCase() === "e" && openForm) {
            const provider = cfg.providers.find((p) => p.id === selectedValue)
            if (!provider) return "Provider not found"
            openForm(`Base URL [${provider.baseUrl}]:`, async (baseUrl) => {
              openForm("API key [unchanged]:", async (apiKey) => {
                const nextUrl = baseUrl.trim() || provider.baseUrl
                const nextKey = apiKey.trim() || provider.apiKey
                await saveProvider(
                  { ...provider, baseUrl: nextUrl, apiKey: nextKey },
                  { global: !cwd, cwd },
                )
                return `Updated ${provider.id}`
              })
            })
            return
          }
          if (key.toLowerCase() !== "d") return
          const provider = cfg.providers.find((p) => p.id === selectedValue)
          if (!provider) return "No providers configured"
          await removeProvider(provider.id, { global: !cwd, cwd })
          const next = (await loadConfig(cwd)).providers[0]
          if (modelRef.current?.startsWith(`${provider.id}::`))
            modelRef.current = next?.models[0] ? `${next.id}::${next.models[0]}` : undefined
          return `Deleted ${provider.id}`
        },
      }
    }
    if (cmd === "sessions") {
      const sessions = listSessions(cwd)
      return {
        title: "Sessions",
        items: sessions.slice(0, 20).map((s) => ({
          label: `${s.id}  ${new Date(s.updated_at ?? s.created_at).toISOString()}`,
          value: s.id,
        })),
        onPick: (id) => {
          void respawnWithResume(id)
          return `Resuming ${id}`
        },
      }
    }
    return null
  }

  async function respawnWithResume(id: string): Promise<void> {
    await close()
    const { spawn } = await import("node:child_process")
    const entry = resolvePath(import.meta.dir, "index.ts")
    const child = spawn(
      process.execPath,
      [entry, `--resume=${id}`, ...(cwd ? [`--cwd=${cwd}`] : [])],
      { stdio: "inherit", env: { ...process.env, MINICODE_RESUME_NEW: "1" } },
    )
    child.on("exit", (code) => process.exit(code ?? 0))
  }

  const onOverlay = async (q: string): Promise<{ title: string; lines: string[] } | null> => {
    const cmdName = q.slice(1).split(" ")[0]?.toLowerCase() ?? ""
    // Builtin dicek lewat nilai kembalian `handled`, bukan lewat exception.
    // Sebelumnya `catch { return null }` menelan ReferenceError sehingga SEMUA
    // slash builtin gagal senyap dan jatuh ke "perintah tidak dikenal".
    try {
      const { lines, value } = await captureOutput(() => handleBuiltinCommand(q, commandCtx))
      if (!value.handled) return null // bukan builtin -> lanjut sebagai skill/prompt
      if (value.shouldExit) {
        await close()
        process.exit(0)
      }
      return { title: cmdName, lines }
    } catch (e) {
      // Builtin ada tapi meledak: tampilkan errornya, jangan sembunyikan.
      return { title: cmdName, lines: [`error: ${(e as Error).message}`] }
    }
  }

  const onLine = async (
    q: string,
    signal: AbortSignal,
  ): Promise<"handled" | "prompt" | { note: string }> => {
    let finalPrompt = q
    if (q.startsWith("/")) {
      const spaceIdx = q.indexOf(" ")
      const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx)
      const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1)
      const isBuiltin = BUILTIN_COMMANDS.some((b) => b.name === skillName)
      const skill = allLoadedSkills.find((s) => s.name === skillName)
      if (!skill) {
        if (isBuiltin) return "handled" // sudah lewat overlay path
        return { note: `Unknown command: ${skillName}. Use /help.` }
      }
      finalPrompt = await renderSkill(skill, skillArgs)
    }
    await appendHistory(q)
    const cwdPath = cwd ?? process.cwd()
    if (q.includes("@")) {
      const { prompt: expanded, notes } = await expandMentions(q, cwdPath)
      finalPrompt = expanded
      for (const n of notes) process.stderr.write(`  [@mention] ${n}\n`)
    }
    await runPromptWithVerify(finalPrompt, signal)
    const u = usage.get(modelRef.current)
    await persistCurrent(u)
    usage.reset()
    return "prompt"
  }

  const onCycleMode = (): string => {
    const idx = MODES.indexOf(mode as (typeof MODES)[number])
    mode = MODES[(idx + 1) % MODES.length]!
    if (permissions) permissions.setMode(mode as (typeof MODES)[number])
    else mode = permissionMode ?? mode // tak ada handle: jangan tampilkan label palsu
    return mode
  }

  const shell = attachFullscreenMinimal({
    bus: session.events,
    model: () => modelRef.current ?? cfg.providers[0]?.models[0],
    cwdName: cwd ?? process.cwd(),
    ...(budget != null ? { budget } : {}),
    initialMode: mode,
    // Biaya dihitung di usage collector dari tabel harga — TIDAK dikirim
    // provider lewat event. Pakai total SESI, bukan turn: turn di-reset setiap
    // kali hasil disimpan, jadi header akan kembali $0.0000 dan --budget tidak
    // pernah terpicu.
    usage: () => usage.getSession(modelRef.current),
    onCycleMode,
    suggestions,
    history: () => history,
    onLine,
    onPicker,
    onOverlay,
    onExit: async () => {
      await close()
      process.exit(0)
    },
  })
  void sessionId
  void effectiveTimeoutMs
  // keep handle alive — attachFullscreenMinimal menulis langsung ke stdout
  void shell
  return new Promise(() => {}) // app hidup sampai onExit
}
