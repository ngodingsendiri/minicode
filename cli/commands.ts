import { resolve as resolvePath } from "node:path"
import type { Usage } from "../src/policy/usage.ts"
import { refreshProviderModels } from "../src/providers/provision.ts"
import { listSessions, loadSession } from "../src/session/persistence.ts"
import type { Skill } from "../src/skills/loader.ts"
import { formatUsd } from "../src/ui/render/money.ts"
import { glyphs } from "../src/ui/render/theme.ts"
import { padToWidth } from "../src/ui/render/width.ts"

// SEMUA output = PLAIN TEXT tanpa ANSI.
// Readline + ANSI di Windows = karakter escape bocor jadi teks literal.

export interface CommandContext {
  cwd?: string
  sessionId: string
  currentModel?: string
  usage: {
    /** Pemakaian turn terakhir. */
    get: (model?: string) => Usage
    /** Pemakaian kumulatif seluruh sesi — yang dilaporkan `/cost`. */
    getSession: (model?: string) => Usage
    reset: () => void
    modelUsed: () => { effective?: string; provider?: string }
  }
  skills: Skill[]
  toolsCount: number
  providerHint?: string
  setModelOverride: (model: string) => void
}

/**
 * Slash commands exposed by the interactive CLI.
 * Keep this list intentionally small: every entry is a command users can
 * discover and use, not an alias for another command.
 */
export interface BuiltinCommand {
  name: string
  args?: string
  desc: string
  hidden?: boolean
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { name: "help", desc: "Show commands" },
  { name: "provider", desc: "Manage providers" },
  { name: "model", desc: "Manage and select models" },
  { name: "sync", desc: "Refresh provider models" },
  { name: "status", desc: "Show session status and usage" },
  { name: "sessions", desc: "List, inspect, and resume sessions" },
  { name: "init", desc: "Create AGENTS.md" },
  { name: "exit", desc: "Exit" },
]

/** Pintasan papan tombol — didokumentasikan di /help, bukan hanya di kode. */
const KEYBOARD_HELP: [string, string][] = [
  ["enter", "submit"],
  ["shift+tab", "cycle permission mode"],
  ["tab", "complete command"],
  ["up / down", "history or picker navigation"],
  ["ctrl+o", "toggle compact/expanded tool output"],
  ["ctrl+t", "toggle reasoning"],
  ["esc", "close dropdown or picker"],
  ["ctrl+c", "stop turn when busy; twice to exit"],
]

function pad(text: string, width: number): string {
  return padToWidth(text, width)
}

/**
 * Penanda hasil aksi yang seragam.
 *
 * Sebelumnya bercampur: `[OK]`/`[FAIL]` ASCII di /undo dan /model, kalimat biasa
 * di /theme dan /thinking, tanpa penanda di /sync. `glyphs` sudah punya fallback
 * ASCII untuk konsol legacy Windows, jadi memakainya aman di semua terminal.
 */
// FUNGSI, bukan konstanta: `glyphs` adalah getter yang memeriksa dukungan UTF-8
// saat dipakai. Menyimpannya ke `const` di module scope membekukan nilai pada
// saat import — kesalahan yang sama seperti objek warna `c` dan glyph di TUI.
/** Petunjuk ke daftar pintasan lengkap, dipakai di /help. */

export async function handleBuiltinCommand(
  rawInput: string,
  ctx: CommandContext,
): Promise<{ handled: boolean; shouldExit?: boolean }> {
  const line = rawInput.trim()
  if (!line.startsWith("/")) return { handled: false }

  const spaceIdx = line.indexOf(" ")
  const cmd = spaceIdx === -1 ? line.slice(1).toLowerCase() : line.slice(1, spaceIdx).toLowerCase()
  const args = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim()

  switch (cmd) {
    case "help": {
      // Ringkas: perintah utama + skill + pintasan yang paling sering dipakai.
      // /help penuh 29 baris tidak muat di overlay terminal 24 baris, jadi
      // pintasan lengkap dipindah ke `/help tombol`.
      const wantKeys = /^(tombol|keys?|keyboard)$/i.test(args)
      if (wantKeys) {
        console.log("\nPapan tombol:")
        for (const [key, desc] of KEYBOARD_HELP) {
          console.log(`  ${pad(key, 22)}${desc}`)
        }
        console.log("")
        return { handled: true }
      }
      console.log("\nCommands:")
      for (const b of BUILTIN_COMMANDS) {
        if (b.hidden) continue
        const withArgs = b.args ? `${b.name} ${b.args}` : b.name
        console.log(`  /${pad(withArgs, 22)}${b.desc}`)
      }
      console.log("\nEnter submit · Tab complete · Shift+Tab mode · Ctrl+O compact · Ctrl+C exit\n")
      return { handled: true }
    }

    case "init": {
      const target = `${ctx.cwd ?? process.cwd()}\\AGENTS.md`
      if (require("node:fs").existsSync(target)) {
        console.log(`\nAGENTS.md sudah ada - tidak ditimpa.\n`)
        return { handled: true }
      }
      const { loadRepoMap } = await import("../src/repo/repomap.ts")
      const map = await loadRepoMap(ctx.cwd ?? process.cwd())
      const body = [
        "# AGENTS.md",
        "",
        "Petunjuk untuk agent yang bekerja di repo ini.",
        "",
        "## Struktur (repo-map)",
        "```",
        map ?? "(repo-map kosong)",
        "```",
        "",
        "## Konvensi",
        "- Ikuti gaya kode existing.",
        "- Jalankan typecheck/test sebelum menyatakan selesai.",
        "",
      ].join("\n")
      const { atomicWriteText } = await import("../src/lib/atomic-write.ts")
      await atomicWriteText(target, body)
      console.log(`\nAGENTS.md dibuat: ${target}\n`)
      return { handled: true }
    }

    case "exit":
      console.log("Sampai jumpa.")
      return { handled: true, shouldExit: true }

    case "model": {
      const { runModelManager } = await import("./model-manager.ts")
      await runModelManager({
        cwd: ctx.cwd,
        currentModel: ctx.currentModel,
        setModelOverride: ctx.setModelOverride,
      })
      return { handled: true }
    }

    case "provider": {
      const { runProviderManager } = await import("./provider-manager.ts")
      await runProviderManager({
        cwd: ctx.cwd,
        currentModel: ctx.currentModel,
        setModelOverride: ctx.setModelOverride,
      })
      return { handled: true }
    }
    case "status": {
      // Kumulatif sesi, bukan turn terakhir — judulnya menjanjikan "biaya sesi".
      const u = ctx.usage.getSession(ctx.currentModel)
      console.log(`\nSession ${ctx.sessionId}`)
      console.log(`  Model:    ${ctx.currentModel ?? "default"}`)
      console.log(`  Provider: ${ctx.providerHint ?? "-"}`)
      console.log(`  Tools:    ${ctx.toolsCount}`)
      console.log(`  Input:    ${u.inputTokens.toLocaleString()}`)
      console.log(`  Output:   ${u.outputTokens.toLocaleString()}`)
      console.log(`  Total:    ${u.totalTokens.toLocaleString()}`)
      console.log(`  Cost:     ${u.cost != null ? formatUsd(u.cost) : "N/A"}`)
      console.log("")
      return { handled: true }
    }

    case "sync": {
      // Re-detect model dari semua provider -> config diperbarui otomatis
      console.log("\nSyncing models…")
      const results = await refreshProviderModels({ cwd: ctx.cwd })
      if (results.length === 0) {
        console.log("  No providers configured.")
      } else {
        for (const r of results) {
          console.log(`  ${glyphs.check} ${r.id}: ${r.from} -> ${r.to} models`)
        }
      }
      console.log("  Restart to use updated models.\n")
      return { handled: true }
    }

    case "sessions": {
      const rows = listSessions(ctx.cwd).slice(0, 25)
      if (rows.length === 0) {
        console.log("\nNo sessions.")
      } else if (!args) {
        console.log("\nSessions")
        rows.forEach((r, i) => {
          console.log(
            `  [${i}] ${r.id.padEnd(14)} ${new Date(r.created_at).toLocaleString().padEnd(24)} ${r.cwd || "(cwd)"}`,
          )
        })
        console.log("  Select a session to resume.")
      }
      if (rows.length > 0 && args) {
        const target = args
        const sess = loadSession(target, ctx.cwd)
        if (!sess?.messages.length) {
          console.log(`Session "${target}" not found or empty.`)
          return { handled: true }
        }
        const { spawn } = await import("node:child_process")
        const entryPath = resolvePath(import.meta.dir, "index.ts")
        const child = spawn(
          process.execPath,
          [entryPath, `--resume=${target}`, ...(ctx.cwd ? [`--cwd=${ctx.cwd}`] : [])],
          { stdio: "inherit", env: { ...process.env, MINICODE_RESUME_NEW: "1" } },
        )
        child.on("exit", (code) => process.exit(code ?? 0))
        process.stdin.pause()
      }
      console.log("")
      return { handled: true }
    }

    default:
      return { handled: false }
  }
}
