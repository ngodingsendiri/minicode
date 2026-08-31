// REPL linier — MiniCode sebagai agentic Unix shell.
//
// Loop `askLine` + printer linier (src/ui/assistant/simple.ts, dipasang di
// cli/setup.ts) + spinner turn-status. Output append-only di scrollback:
// tanpa alternate screen, tanpa redraw penuh, tanpa overlay modal. Saat agen
// bekerja terminal "dipakai" sampai selesai atau dibatalkan Ctrl+C — persis
// seperti menjalankan perintah shell.
//
// Semantik interupsi:
// - busy:  stdin tidak raw, jadi Ctrl+C menjadi SIGINT → abort turn.
//          Listener byte \x03 dipasang sebagai cadangan untuk konsol yang
//          tidak mengirim SIGINT (conhost legacy).
// - idle:  askLine menangkap Ctrl+C/Ctrl+D → null → cetak ^C; null dua kali
//          beruntun → keluar. `/exit` tetap cara utama.

import { resolve as resolvePath } from "node:path"
import { expandMentions } from "../src/app/mentions.ts"
import { listSessions, loadSession } from "../src/session/persistence.ts"
import { renderSkill } from "../src/skills/loader.ts"
import { formatError } from "../src/ui/assistant/simple.ts"
import { appendHistory, askLine } from "../src/ui/input/input.ts"
import type { PromptKey } from "../src/ui/input/prompt-engine.ts"
import { setCompactMode } from "../src/ui/render/detail.ts"
import { formatUsd } from "../src/ui/render/money.ts"
import { setReasoningVisible } from "../src/ui/render/reasoning.ts"
import { c, glyphs } from "../src/ui/render/theme.ts"
import { BUILTIN_COMMANDS, type CommandContext, handleBuiltinCommand } from "./commands.ts"
import type { CliSession } from "./setup.ts"

const MODES = ["auto", "ask", "plan", "allowlist"] as const

// Perintah REPL yang ditangani driver sendiri (bukan builtin commands.ts).
// Ikut ditawarkan di dropdown supaya bisa ditemukan.
const DRIVER_COMMANDS = ["/mode", "/compact", "/thinking"]

export async function runRepl(ctx: CliSession): Promise<void> {
  const {
    cfg,
    cwd,
    sessionId,
    modelRef,
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
  // label prompt sementara mode sebenarnya tidak berubah.
  let mode: string = permissions?.getMode() ?? permissionMode ?? "auto"
  let nullStreak = 0
  let warned80 = false
  // Non-null selama turn berjalan — target abort SIGINT/Ctrl+C.
  let abort: AbortController | null = null

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

  const suggestions = (line: string): string[] => {
    if (!line.startsWith("/")) return []
    const all = [
      ...BUILTIN_COMMANDS.map((b) => `/${b.name}`),
      ...DRIVER_COMMANDS,
      ...allLoadedSkills.map((s) => `/${s.name}`),
    ]
    return all.filter((t) => t.startsWith(line))
  }
  const groupOf = (text: string): string =>
    BUILTIN_COMMANDS.some((b) => `/${b.name}` === text) || DRIVER_COMMANDS.includes(text)
      ? "commands"
      : "skills"

  // Prefiks prompt memuat mode berwarna — Shift+Tab mengubahnya live karena
  // prompt berbentuk fungsi yang diselesaikan tiap render.
  const promptPrefix = (): string => {
    const paintMode = mode === "plan" ? c.warning : mode === "ask" ? c.info : c.success
    return `${c.dim("minicode")} ${paintMode(mode)} › `
  }

  // Notifikasi satu baris saat prompt masih aktif: bersihkan baris berjalan,
  // cetak, lalu askLine menggambar ulang prompt di baris bawahnya.
  const notify = (msg: string) => process.stdout.write(`\r\x1b[2K${msg}\n`)

  const cycleMode = () => {
    const idx = MODES.indexOf(mode as (typeof MODES)[number])
    mode = MODES[(idx + 1) % MODES.length]!
    if (permissions) permissions.setMode(mode as (typeof MODES)[number])
    else mode = permissionMode ?? mode // tak ada handle: jangan tampilkan label palsu
  }

  const onKey = (key: PromptKey): boolean => {
    if (key.type === "shift-tab") {
      cycleMode()
      notify(c.muted(`mode: ${mode}`))
      return true
    }
    if (key.type === "ctrl-o") {
      const compact = setCompactMode()
      notify(c.muted(`tool call: ${compact ? "compact" : "expanded"}`))
      return true
    }
    if (key.type === "ctrl-t") {
      const visible = setReasoningVisible()
      notify(c.muted(`reasoning: ${visible ? "on" : "off"}`))
      return true
    }
    return false
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

  // `/sessions` tanpa argumen: builtin mencetak daftar bernomor, lalu satu
  // askLine linier meminta pilihan — pengganti picker modal lama.
  async function pickSession(): Promise<void> {
    await handleBuiltinCommand("/sessions", commandCtx)
    const rows = listSessions(cwd).slice(0, 25)
    if (rows.length === 0) return
    const choice = await askLine({ prompt: "resume (nomor/id, kosong = batal) › " })
    const pick = choice?.trim()
    if (!pick) return
    const asNum = Number(pick)
    const id =
      Number.isInteger(asNum) && asNum >= 0 && asNum < rows.length
        ? (rows[asNum]?.id ?? pick)
        : pick
    const sess = loadSession(id, cwd)
    if (!sess?.messages.length) {
      console.log(`Session "${id}" not found or empty.`)
      return
    }
    await respawnWithResume(id)
  }

  // Jalankan satu prompt user sebagai turn agen. Budget diperiksa di sini
  // (dipindah dari UI ke driver): prompt baru ditolak setelah batas terlampaui,
  // peringatan 80% dicetak sekali.
  async function runTurn(finalPrompt: string, original: string): Promise<void> {
    const spent = usage.getSession(modelRef.current)
    if (budget != null && spent.cost != null && spent.cost > budget) {
      console.log(
        c.red(
          `[budget] ${formatUsd(spent.cost)} > ${formatUsd(budget)} — lewat batas, prompt baru ditolak. /exit untuk keluar.`,
        ),
      )
      return
    }
    await appendHistory(original)
    let prompt = finalPrompt
    if (finalPrompt.includes("@")) {
      const expanded = await expandMentions(finalPrompt, cwd ?? process.cwd())
      prompt = expanded.prompt
      for (const n of expanded.notes) process.stderr.write(`  [@mention] ${n}\n`)
    }

    const ctrl = new AbortController()
    abort = ctrl
    // Cadangan Ctrl+C untuk konsol tanpa SIGINT: tangkap byte mentah saat
    // stdin tidak raw. Sekaligus menelan input yang diketik selama turn —
    // seperti perintah shell yang tidak membaca stdin.
    const onRawCtrlC = (chunk: Buffer) => {
      if (chunk.includes(0x03)) ctrl.abort()
    }
    process.stdin.resume()
    process.stdin.on("data", onRawCtrlC)
    try {
      await runPromptWithVerify(prompt, ctrl.signal)
      if (ctrl.signal.aborted) console.log(c.yellow("\n(dihentikan)"))
    } catch (e) {
      if (ctrl.signal.aborted) console.log(c.yellow("\n(dihentikan)"))
      else throw e
    } finally {
      process.stdin.removeListener("data", onRawCtrlC)
      process.stdin.pause()
      abort = null
    }

    const u = usage.get(modelRef.current)
    await persistCurrent(u)
    usage.reset()
    const session = usage.getSession(modelRef.current)
    if (
      budget != null &&
      session.cost != null &&
      session.cost > budget * 0.8 &&
      session.cost <= budget &&
      !warned80
    ) {
      warned80 = true
      console.log(
        c.yellow(`[budget] ${formatUsd(session.cost)} / ${formatUsd(budget)} (80% terpakai)`),
      )
    }
  }

  // true = minta keluar (loop berhenti, lalu close + exit).
  async function dispatchLine(q: string): Promise<boolean> {
    if (q.startsWith("/")) {
      const spaceIdx = q.indexOf(" ")
      const name = (spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx)).toLowerCase()
      const args = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1).trim()

      if (name === "mode") {
        if (args) {
          if (!(MODES as readonly string[]).includes(args)) {
            console.log(c.yellow(`mode tak dikenal: ${args} — pilihan: ${MODES.join(", ")}`))
            return false
          }
          mode = args
          permissions?.setMode(args as (typeof MODES)[number])
        } else {
          cycleMode()
        }
        console.log(c.muted(`mode: ${mode}`))
        return false
      }
      if (name === "compact") {
        const next = args === "" ? undefined : args === "on" || args === "1"
        const compact = setCompactMode(next)
        console.log(c.muted(`tool call: ${compact ? "compact" : "expanded"}`))
        return false
      }
      if (name === "thinking") {
        const visible = setReasoningVisible()
        console.log(c.muted(`reasoning: ${visible ? "on" : "off"}`))
        return false
      }
      if (name === "sessions" && !args) {
        await pickSession()
        return false
      }

      // Builtin mengalir langsung ke scrollback (console.log) — TANPA
      // captureOutput/overlay. Manajer /model & /provider transient:
      // menghapus diri sendiri dan tidak menyentuh scrollback.
      const builtin = await handleBuiltinCommand(q, commandCtx)
      if (builtin.handled) return !!builtin.shouldExit

      const skill = allLoadedSkills.find((s) => s.name === name)
      if (!skill) {
        console.log(c.yellow(`Unknown command: ${name}. Try /help.`))
        return false
      }
      await runTurn(await renderSkill(skill, args), q)
      return false
    }
    await runTurn(q, q)
    return false
  }

  const onSigint = () => abort?.abort()
  process.on("SIGINT", onSigint)
  console.log(c.dim("minicode — /help daftar perintah · Ctrl+C 2x keluar"))

  let shouldExit = false
  try {
    for (;;) {
      let line: string | null
      try {
        line = await askLine({ prompt: promptPrefix, hints: suggestions, groupOf, onKey })
      } catch (e) {
        console.log(`${c.red(glyphs.cross)} ${formatError(e)}`)
        continue
      }
      if (line == null) {
        // Ctrl+C/Ctrl+D saat idle: cetak ^C seperti shell; dua kali beruntun = keluar.
        nullStreak++
        console.log("^C")
        if (nullStreak >= 2) shouldExit = true
        if (shouldExit) break
        continue
      }
      nullStreak = 0
      const q = line.trim()
      if (!q) continue
      try {
        shouldExit = await dispatchLine(q)
      } catch (e) {
        console.log(`${c.red(glyphs.cross)} ${formatError(e)}`)
      }
      if (shouldExit) break
    }
  } finally {
    process.off("SIGINT", onSigint)
  }
  await close()
  process.exit(0)
}
