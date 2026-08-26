import { resolve as resolvePath } from "node:path"
import { loadConfig, refreshProviderModels } from "../src/config.ts"
import type { Usage } from "../src/policy/usage.ts"
import { listSessions, loadSession } from "../src/session/persistence.ts"
import type { Skill } from "../src/skills/loader.ts"

// SEMUA output = PLAIN TEXT tanpa ANSI.
// Readline + ANSI di Windows = karakter escape bocor jadi teks literal.

export interface CommandContext {
  cwd?: string
  sessionId: string
  currentModel?: string
  usage: {
    get: (model?: string) => Usage
    reset: () => void
    modelUsed: () => { effective?: string; provider?: string }
  }
  skills: Skill[]
  toolsCount: number
  providerHint?: string
  setModelOverride: (model: string) => void
}

export const BUILTIN_COMMANDS = [
  { name: "help", desc: "Show available slash commands" },
  { name: "provider", desc: "Manage LLM providers (add/edit/delete)" },
  { name: "model", args: "[search]", desc: "Browse & switch model (searchable)" },
  { name: "sync", desc: "Auto-refresh model list from all providers" },
  { name: "undo", desc: "Rollback file edits from last turn" },
  { name: "redo", desc: "Reapply undone file edits" },
  { name: "cost", desc: "Show token usage & session cost" },
  { name: "sessions", desc: "List recent sessions" },
  { name: "resume", args: "[id]", desc: "Resume a session (pick from list)" },
  { name: "status", desc: "Show runtime status" },
  { name: "thinking", args: "[on|off]", desc: "Toggle reasoning display" },
  { name: "init", desc: "Generate AGENTS.md for this project" },
  { name: "theme", args: "[name]", desc: "Switch UI theme (dark/dim/light/mono)" },
]

function pad(text: string, width: number): string {
  const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
  const diff = width - clean.length
  return diff > 0 ? text + " ".repeat(diff) : text
}

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
      console.log("\nCommands:")
      for (const b of BUILTIN_COMMANDS) {
        const withArgs = b.args ? `${b.name} ${b.args}` : b.name
        console.log(`  /${pad(withArgs, 22)}${b.desc}`)
      }
      if (ctx.skills.length > 0) {
        console.log("\nSkills:")
        for (const s of ctx.skills) {
          console.log(`  /${pad(s.name, 20)}${s.description || ""}`)
        }
      }
      console.log("")
      return { handled: true }
    }

    case "clear": {
      process.stdout.write("\x1b[2J\x1b[H")
      return { handled: true }
    }

    case "thinking": {
      // display-only toggle; state disimpan di env proses (sederhana, no-state UI)
      const arg = args.toLowerCase()
      const cur = process.env.MINICODE_SHOW_THINKING === "1"
      const next = arg === "on" ? true : arg === "off" ? false : !cur
      process.env.MINICODE_SHOW_THINKING = next ? "1" : "0"
      console.log(`\nReasoning display: ${next ? "on" : "off"}\n`)
      return { handled: true }
    }

    case "theme": {
      const { THEMES } = await import("../src/tui/themes.ts")
      const { applyTheme } = await import("../src/tui/theme.ts")
      const names = Object.keys(THEMES) as string[]
      const want = args || "next"
      const cur = process.env.MINICODE_THEME ?? ""
      const next =
        want === "next"
          ? names[(names.indexOf(cur) + 1) % names.length] ?? "dark"
          : names.includes(want)
            ? want
            : (console.log(`\ntheme: ${names.join(" / ")}\n`), "dark")
      process.env.MINICODE_THEME = next
      applyTheme(next)
      console.log(`\nTheme: ${next}\n`)
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

    case "undo": {
      const { undoLastCheckpoint } = await import("../src/session/checkpoint.ts")
      const res = await undoLastCheckpoint(ctx.sessionId, ctx.cwd)
      if (res.success) {
        console.log("[OK] Undid file changes:")
        for (const f of res.restoredFiles) console.log(`  -> ${f}`)
      } else {
        console.log(`[FAIL] Undo failed: ${res.message}`)
      }
      return { handled: true }
    }

    case "redo": {
      const { redoLastCheckpoint } = await import("../src/session/checkpoint.ts")
      const res = await redoLastCheckpoint(ctx.sessionId, ctx.cwd)
      if (res.success) {
        console.log("[OK] Reapplied file changes:")
        for (const f of res.reappliedFiles) console.log(`  -> ${f}`)
      } else {
        console.log(`[FAIL] Redo failed: ${res.message}`)
      }
      return { handled: true }
    }

    case "exit":
    case "quit":
      console.log("Goodbye!")
      return { handled: true, shouldExit: true }

    case "model":
    case "models": {
      // Unified model picker with searchable window (substring filter in header)
      const filterPrefill = args && !args.includes("::") ? args : ""
      if (args && args.includes("::")) {
        ctx.setModelOverride(args)
        console.log(`[OK] Model: ${args}`)
        return { handled: true }
      }
      // If args is single model name without ::, try direct switch; else open picker
      if (args && !filterPrefill) {
        // unreachable due to above, keep for completeness
      }
      // Open searchable picker window
      const cfg = await loadConfig()
      const items = cfg.providers.flatMap((p) =>
        p.models.map((m) => ({ name: m, provider: p.id, value: `${p.id}::${m}` })),
      )
      if (items.length === 0) {
        console.log("(no models - use /provider)")
        return { handled: true }
      }
      // If args provided as simple model name, try exact match without picker
      if (filterPrefill) {
        const owners = cfg.providers.filter((p) => p.models.includes(filterPrefill))
        if (owners.length === 1) {
          ctx.setModelOverride(`${owners[0]!.id}::${filterPrefill}`)
          console.log(`[OK] ${filterPrefill} (${owners[0]!.id})`)
          return { handled: true }
        }
        // otherwise fall through to picker with filter prefill
      }
      const { runPicker } = await import("./picker.ts")
      // inject initial filter by simulating typing after open? Instead set title with hint and let user type
      await runPicker({
        title: filterPrefill
          ? `Select Model - filter: ${filterPrefill}`
          : "Select Model - type to filter",
        items: (() => {
          if (!filterPrefill) return items
          const q = filterPrefill.toLowerCase()
          const filtered = items.filter(
            (it) => it.name.toLowerCase().includes(q) || it.provider.toLowerCase().includes(q),
          )
          return filtered.length ? filtered : items
        })(),
        filterable: true,
        placeholder: "type to filter",
        onPick: (value) => {
          ctx.setModelOverride(value)
          console.log(`[OK] Model: ${value}`)
        },
        onCancel: () => console.log("canceled"),
      })
      return { handled: true }
    }

    case "provider":
    case "providers":
    case "provider-add":
    case "provider-remove": {
      const { runProviderManager } = await import("./provider-manager.ts")
      await runProviderManager({
        cwd: ctx.cwd,
        currentModel: ctx.currentModel,
        setModelOverride: ctx.setModelOverride,
      })
      return { handled: true }
    }
    case "cost":
    case "usage": {
      const u = ctx.usage.get(ctx.currentModel)
      const mUsed = ctx.usage.modelUsed()
      console.log(`\nSession Usage`)
      console.log(`  Input Tokens:  ${u.inputTokens.toLocaleString()}`)
      console.log(`  Output Tokens: ${u.outputTokens.toLocaleString()}`)
      console.log(`  Total Tokens:  ${u.totalTokens.toLocaleString()}`)
      if (u.cacheReadTokens) console.log(`  Cache Read:    ${u.cacheReadTokens.toLocaleString()}`)
      if (u.cacheWriteTokens) console.log(`  Cache Write:   ${u.cacheWriteTokens.toLocaleString()}`)
      console.log(`  Estimated Cost: ${u.cost != null ? `$${u.cost.toFixed(4)}` : "N/A"}`)
      if (mUsed.effective && mUsed.effective !== ctx.currentModel) {
        console.log(`  Model Used:    ${mUsed.effective} (${mUsed.provider ?? "?"} via fallback)`)
      }
      console.log("")
      return { handled: true }
    }

    case "compact": {
      console.log("Compaction is automatic (kernel budget policy).")
      return { handled: true }
    }

    case "sync": {
      // Re-detect model dari semua provider -> config diperbarui otomatis
      console.log("\nSyncing models from providers...")
      const results = await refreshProviderModels({ cwd: ctx.cwd })
      if (results.length === 0) {
        console.log("  (no provider found - use /provider-add first)")
      } else {
        for (const r of results) {
          console.log(`  [OK] ${r.id}: ${r.from} -> ${r.to} models`)
        }
      }
      console.log("  Restart minicode for the router to pick up new models.\n")
      return { handled: true }
    }

    case "sessions": {
      const rows = listSessions(ctx.cwd).slice(0, 25)
      if (rows.length === 0) {
        console.log("\n(no previous sessions)")
      } else {
        console.log("\nRecent Sessions:")
        rows.forEach((r, i) => {
          console.log(
            `  [${i}] ${r.id.padEnd(14)} ${new Date(r.created_at).toLocaleString().padEnd(24)} ${r.cwd || "(cwd)"}`,
          )
        })
        console.log("  (type a number to resume, or /resume <id>)")
      }
      console.log("")
      return { handled: true }
    }

    case "resume": {
      const rows = listSessions(ctx.cwd)
      if (rows.length === 0) {
        console.log("(no previous sessions to resume)")
        return { handled: true }
      }
      let target = args
      if (!target) {
        rows.slice(0, 15).forEach((r, i) => {
          console.log(
            `  [${i}] ${r.id.padEnd(14)} ${new Date(r.created_at).toLocaleString().padEnd(24)} ${r.cwd || "(cwd)"}`,
          )
        })
        const { askLine } = await import("./input.ts")
        const n = await askLine({ prompt: "resume # or id > " })
        if (n == null) {
          console.log("canceled")
          return { handled: true }
        }
        const pick = n.trim()
        const idx = Number(pick)
        if (Number.isInteger(idx) && Number.isFinite(idx) && idx >= 0 && idx < rows.length)
          target = rows[idx]!.id
        else target = pick
      }
      if (!target) {
        console.log("canceled")
        return { handled: true }
      }
      const sess = loadSession(target, ctx.cwd)
      if (!sess || !sess.messages.length) {
        console.log(`[FAIL] session "${target}" not found or empty`)
        return { handled: true }
      }
      // Respawn with --resume: kernel supports full initialMessages (seed context store).
      const { spawn } = await import("node:child_process")
      const entryPath = resolvePath(import.meta.dir, "index.ts")
      const child = spawn(
        process.execPath,
        [entryPath, `--resume=${target}`, ...(ctx.cwd ? [`--cwd=${ctx.cwd}`] : [])],
        {
          stdio: "inherit",
          env: { ...process.env, MINICODE_RESUME_NEW: "1" },
        },
      )
      child.on("exit", (code) => process.exit(code ?? 0))
      process.stdin.pause()
      return { handled: true }
    }

    case "status": {
      const mUsed = ctx.usage.modelUsed()
      console.log(`\nMinicode Status`)
      console.log(`  Session ID:   ${ctx.sessionId}`)
      console.log(`  Model:        ${ctx.currentModel ?? "default"}`)
      if (mUsed.effective && mUsed.effective !== ctx.currentModel) {
        console.log(`  Model Used:   ${mUsed.effective} (${mUsed.provider ?? "?"} via fallback)`)
      }
      console.log(`  Provider:     ${ctx.providerHint ?? "unknown"}`)
      console.log(`  Active Tools: ${ctx.toolsCount}`)
      console.log(`  Skills:       ${ctx.skills.length}\n`)
      return { handled: true }
    }

    case "history": {
      console.log("[deprecated] /history removed - use ↑ arrow to browse history")
      return { handled: true }
    }

    default:
      return { handled: false }
  }
}
