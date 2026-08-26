// Driver fullscreen REPL — menjembatani CliSession dengan shell Ink.
// Slash command: semua builtin di-capture jadi overlay; selain itu
// skill-render lalu dikirim ke LLM (alur sama dengan classic repl).
import { handleBuiltinCommand, BUILTIN_COMMANDS, type CommandContext } from "./commands.ts"
import { renderSkill } from "../src/skills/loader.ts"
import { loadHistory } from "./input.ts"
import { captureOutput } from "./panel.ts"
import type { CliSession } from "./setup.ts"
import { attachFullscreenShell } from "../src/tui/fullscreen.tsx"

const MODES = ["auto", "ask", "plan", "allowlist"] as const
const PICKER_HINTS = new Set(["provider", "model", "resume"])

export async function runFullscreen(ctx: CliSession): Promise<void> {
  const {
    session,
    cfg,
    cwd,
    sessionId,
    modelRef,
    effectiveTimeoutMs,
    permissionMode,
    sessionTools,
    allLoadedSkills,
    usage,
    budget,
    persistCurrent,
    runPromptWithVerify,
    close,
  } = ctx

  const perms = (
    session as unknown as {
      config?: { permissions?: { __setMode?(m: string): void; __getMode?(): string } }
    }
  ).config?.permissions
  let mode: string =
    perms?.__getMode?.() ?? permissionMode ?? "auto"

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
    return all.filter((t) => t.startsWith(line)).map((text) => ({
      text,
      group: BUILTIN_COMMANDS.some((b) => `/${b.name}` === text) ? "commands" : "skills",
    }))
  }

  const history = await loadHistory()

  const onOverlay = async (
    q: string,
  ): Promise<{ title: string; lines: string[] } | null> => {
    const cmdName = q.slice(1).split(" ")[0]!.toLowerCase()
    if (PICKER_HINTS.has(cmdName)) {
      return {
        title: cmdName,
        lines: [
          "Picker interaktif butuh mode classic.",
          "Keluar dulu (ctrl+c 2x) lalu jalankan: minicode --ui classic",
        ],
      }
    }
    try {
      const { lines } = await captureOutput(() => handleBuiltinCommand(q, commandCtx))
      return { title: cmdName, lines }
    } catch {
      return null // bukan builtin -> lanjut sebagai skill/prompt
    }
  }

  const onLine = async (
    q: string,
    signal: AbortSignal,
  ): Promise<"handled" | "prompt"> => {
    let finalPrompt = q
    if (q.startsWith("/")) {
      const spaceIdx = q.indexOf(" ")
      const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx)
      const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1)
      const isBuiltin = BUILTIN_COMMANDS.some((b) => b.name === skillName)
      const skill = allLoadedSkills.find((s) => s.name === skillName)
      if (!skill) {
        if (isBuiltin) return "handled" // sudah lewat overlay path
        return { note: `perintah tidak dikenal: ${skillName} - ketik /help` }
      }
      finalPrompt = await renderSkill(skill, skillArgs)
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
    perms?.__setMode?.(mode)
    return mode
  }

  const shell = attachFullscreenShell({
    bus: session.events,
    model: () => modelRef.current ?? cfg.providers[0]?.models[0],
    cwdName: cwd ?? process.cwd(),
    budget,
    initialMode: mode,
    onCycleMode,
    suggestions,
    history: () => history,
    onLine,
    onOverlay,
    onExit: async () => {
      await close()
      process.exit(0)
    },
  })
  void sessionId
  void effectiveTimeoutMs
  void budget
  return new Promise(() => {}) // app hidup sampai onExit
}
