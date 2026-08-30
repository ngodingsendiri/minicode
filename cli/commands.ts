import { resolve as resolvePath } from "node:path"
import { loadConfig, refreshProviderModels } from "../src/config.ts"
import type { Usage } from "../src/policy/usage.ts"
import { listSessions, loadSession } from "../src/session/persistence.ts"
import type { Skill } from "../src/skills/loader.ts"
import { formatUsd } from "../src/tui/money.ts"
import { glyphs } from "../src/tui/theme.ts"
import { padToWidth } from "../src/tui/width.ts"

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
 * Perintah bawaan yang muncul di `/help` DAN di dropdown saran.
 *
 * Setiap perintah yang ditangani `handleBuiltinCommand` harus ada di sini —
 * `/clear`, `/exit`, `/quit`, `/compact`, dan `/history` dulu berfungsi tapi
 * tidak terdaftar, jadi tidak muncul di `/help` dan tidak bisa dilengkapi
 * dengan Tab. User tidak punya cara menemukannya dari dalam aplikasi.
 *
 * `hidden: true` = tetap bisa dilengkapi Tab, tapi tidak memenuhi `/help`
 * (alias dan perintah usang).
 */
export interface BuiltinCommand {
  name: string
  args?: string
  desc: string
  hidden?: boolean
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { name: "help", desc: "Tampilkan daftar perintah & pintasan" },
  { name: "provider", desc: "Kelola provider LLM (tambah/ubah/hapus)" },
  { name: "model", args: "[cari]", desc: "Pilih & ganti model (bisa dicari)" },
  { name: "sync", desc: "Segarkan daftar model dari semua provider" },
  { name: "undo", desc: "Batalkan perubahan berkas dari turn terakhir" },
  { name: "redo", desc: "Terapkan ulang perubahan yang dibatalkan" },
  { name: "cost", desc: "Pemakaian token & biaya sesi" },
  { name: "sessions", desc: "Daftar sesi terbaru" },
  { name: "resume", args: "[id]", desc: "Lanjutkan sesi (pilih dari daftar)" },
  { name: "status", desc: "Status runtime" },
  { name: "thinking", args: "[on|off]", desc: "Tampilkan/sembunyikan reasoning" },
  { name: "init", desc: "Buat AGENTS.md untuk proyek ini" },
  { name: "theme", args: "[nama]", desc: "Ganti tema (dark/dim/light/mono)" },
  { name: "clear", desc: "Bersihkan transkrip di layar" },
  { name: "exit", desc: "Keluar dari minicode" },
  // Alias & perintah usang: bisa dilengkapi Tab, tidak memenuhi /help.
  { name: "quit", desc: "Alias /exit", hidden: true },
  { name: "usage", desc: "Alias /cost", hidden: true },
  { name: "models", desc: "Alias /model", hidden: true },
  { name: "providers", desc: "Alias /provider", hidden: true },
  { name: "compact", desc: "Info kompaksi konteks", hidden: true },
  { name: "history", desc: "Usang - pakai panah atas", hidden: true },
]

/** Pintasan papan tombol — didokumentasikan di /help, bukan hanya di kode. */
const KEYBOARD_HELP: [string, string][] = [
  ["enter", "kirim prompt"],
  ["shift+tab", "putar mode permission (auto/ask/plan/allowlist)"],
  ["tab", "lengkapi perintah dari dropdown"],
  ["up / down", "jelajahi history (atau pilih item dropdown)"],
  ["ctrl+r", "cari history"],
  ["ctrl+o", "buka/tutup tampilan detail"],
  ["ctrl+a / ctrl+e", "ke awal / akhir baris"],
  ["left / right", "geser kursor"],
  ["ctrl+w", "hapus satu kata sebelum kursor"],
  ["ctrl+u", "kosongkan baris"],
  ["esc", "hentikan proses berjalan / tutup panel"],
  ["ctrl+c 2x", "keluar"],
  ["\\ di akhir baris", "sambung ke baris berikutnya"],
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
const OK = () => glyphs.check
const GAGAL = () => glyphs.cross
/** Petunjuk ke daftar pintasan lengkap, dipakai di /help. */
const OK_HINT = "/help tombol"

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
      console.log("\nPerintah:")
      for (const b of BUILTIN_COMMANDS) {
        if (b.hidden) continue
        const withArgs = b.args ? `${b.name} ${b.args}` : b.name
        console.log(`  /${pad(withArgs, 22)}${b.desc}`)
      }
      if (ctx.skills.length > 0) {
        console.log("\nSkill:")
        for (const s of ctx.skills) {
          console.log(`  /${pad(s.name, 22)}${s.description || ""}`)
        }
      }
      // Satu baris, bukan daftar: /help harus muat di overlay terminal 24 baris
      // (kapasitas ~19). Daftar pintasan lengkap ada di `/help tombol`.
      const sep = ` ${glyphs.dot} `
      console.log(`\nTombol: enter kirim${sep}shift+tab mode${sep}tab lengkapi${sep}esc hentikan`)
      console.log(`Pintasan lengkap: ${OK_HINT}\n`)
      return { handled: true }
    }

    case "clear": {
      process.stdout.write("\x1b[2J\x1b[H")
      return { handled: true }
    }

    case "thinking": {
      const { setReasoningVisible } = await import("../src/tui/reasoning.ts")
      const arg = args.toLowerCase()
      const next = setReasoningVisible(arg === "on" ? true : arg === "off" ? false : undefined)
      console.log(`\nTampilan reasoning: ${next ? "aktif" : "nonaktif"}\n`)
      return { handled: true }
    }

    case "theme": {
      const { THEMES } = await import("../src/tui/themes.ts")
      const { applyTheme, themeState } = await import("../src/tui/theme.ts")
      const names = Object.keys(THEMES)
      const want = args.trim().toLowerCase() || "next"
      if (want !== "next" && !names.includes(want)) {
        console.log(`\ntema tersedia: ${names.join(" / ")}\n`)
        return { handled: true }
      }
      const next =
        want === "next"
          ? (names[(names.indexOf(themeState.name) + 1) % names.length] ?? "dark")
          : want
      process.env.MINICODE_THEME = next
      applyTheme(next)
      console.log(`\nTema: ${next}\n`)
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
        console.log(`${OK()} Perubahan berkas dibatalkan:`)
        for (const f of res.restoredFiles) console.log(`  -> ${f}`)
      } else {
        console.log(`${GAGAL()} Gagal membatalkan: ${res.message}`)
      }
      return { handled: true }
    }

    case "redo": {
      const { redoLastCheckpoint } = await import("../src/session/checkpoint.ts")
      const res = await redoLastCheckpoint(ctx.sessionId, ctx.cwd)
      if (res.success) {
        console.log(`${OK()} Perubahan berkas diterapkan ulang:`)
        for (const f of res.reappliedFiles) console.log(`  -> ${f}`)
      } else {
        console.log(`${GAGAL()} Gagal menerapkan ulang: ${res.message}`)
      }
      return { handled: true }
    }

    case "exit":
    case "quit":
      console.log("Sampai jumpa.")
      return { handled: true, shouldExit: true }

    case "model":
    case "models": {
      // Unified model picker with searchable window (substring filter in header)
      const filterPrefill = args && !args.includes("::") ? args : ""
      if (args && args.includes("::")) {
        ctx.setModelOverride(args)
        console.log(`${OK()} Model aktif: ${args}`)
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
        console.log("(belum ada model - pakai /provider untuk menambah)")
        return { handled: true }
      }
      // If args provided as simple model name, try exact match without picker
      if (filterPrefill) {
        const owners = cfg.providers.filter((p) => p.models.includes(filterPrefill))
        if (owners.length === 1) {
          ctx.setModelOverride(`${owners[0]!.id}::${filterPrefill}`)
          console.log(`${OK()} Model aktif: ${filterPrefill} (${owners[0]!.id})`)
          return { handled: true }
        }
        // otherwise fall through to picker with filter prefill
      }
      const { runPicker } = await import("./picker.ts")
      await runPicker({
        title: filterPrefill ? `Pilih model - filter: ${filterPrefill}` : "Pilih model",
        items: (() => {
          if (!filterPrefill) return items
          const q = filterPrefill.toLowerCase()
          const filtered = items.filter(
            (it) => it.name.toLowerCase().includes(q) || it.provider.toLowerCase().includes(q),
          )
          return filtered.length ? filtered : items
        })(),
        filterable: true,
        placeholder: "ketik untuk memfilter",
        onPick: (value) => {
          ctx.setModelOverride(value)
          console.log(`${OK()} Model aktif: ${value}`)
        },
        onCancel: () => console.log("dibatalkan"),
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
      // Kumulatif sesi, bukan turn terakhir — judulnya menjanjikan "biaya sesi".
      const u = ctx.usage.getSession(ctx.currentModel)
      const mUsed = ctx.usage.modelUsed()
      console.log(`\nPemakaian sesi`)
      console.log(`  Token masuk:   ${u.inputTokens.toLocaleString()}`)
      console.log(`  Token keluar:  ${u.outputTokens.toLocaleString()}`)
      console.log(`  Total token:   ${u.totalTokens.toLocaleString()}`)
      if (u.cacheReadTokens) console.log(`  Cache baca:    ${u.cacheReadTokens.toLocaleString()}`)
      if (u.cacheWriteTokens) console.log(`  Cache tulis:   ${u.cacheWriteTokens.toLocaleString()}`)
      console.log(`  Estimasi biaya: ${u.cost != null ? formatUsd(u.cost) : "N/A"}`)
      if (mUsed.effective && mUsed.effective !== ctx.currentModel) {
        console.log(`  Model dipakai: ${mUsed.effective} (${mUsed.provider ?? "?"} via fallback)`)
      }
      console.log("")
      return { handled: true }
    }

    case "compact": {
      console.log("Kompaksi konteks berjalan otomatis (kebijakan budget kernel).")
      return { handled: true }
    }

    case "sync": {
      // Re-detect model dari semua provider -> config diperbarui otomatis
      console.log("\nMenyinkronkan daftar model dari provider…")
      const results = await refreshProviderModels({ cwd: ctx.cwd })
      if (results.length === 0) {
        console.log("  (belum ada provider - pakai /provider untuk menambah)")
      } else {
        for (const r of results) {
          console.log(`  ${OK()} ${r.id}: ${r.from} -> ${r.to} model`)
        }
      }
      console.log("  Jalankan ulang minicode agar router memakai daftar baru.\n")
      return { handled: true }
    }

    case "sessions": {
      const rows = listSessions(ctx.cwd).slice(0, 25)
      if (rows.length === 0) {
        console.log("\n(belum ada sesi sebelumnya)")
      } else {
        console.log("\nSesi terbaru:")
        rows.forEach((r, i) => {
          console.log(
            `  [${i}] ${r.id.padEnd(14)} ${new Date(r.created_at).toLocaleString().padEnd(24)} ${r.cwd || "(cwd)"}`,
          )
        })
        console.log("  (ketik angkanya untuk melanjutkan, atau /resume <id>)")
      }
      console.log("")
      return { handled: true }
    }

    case "resume": {
      const rows = listSessions(ctx.cwd)
      if (rows.length === 0) {
        console.log("(belum ada sesi untuk dilanjutkan)")
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
        const n = await askLine({ prompt: "nomor atau id sesi > " })
        if (n == null) {
          console.log("dibatalkan")
          return { handled: true }
        }
        const pick = n.trim()
        const idx = Number(pick)
        if (Number.isInteger(idx) && Number.isFinite(idx) && idx >= 0 && idx < rows.length)
          target = rows[idx]!.id
        else target = pick
      }
      if (!target) {
        console.log("dibatalkan")
        return { handled: true }
      }
      const sess = loadSession(target, ctx.cwd)
      if (!sess || !sess.messages.length) {
        console.log(`${GAGAL()} sesi "${target}" tidak ditemukan atau kosong`)
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
      console.log("\nStatus minicode")
      console.log(`  ID sesi:       ${ctx.sessionId}`)
      console.log(`  Model:         ${ctx.currentModel ?? "bawaan"}`)
      if (mUsed.effective && mUsed.effective !== ctx.currentModel) {
        console.log(`  Model dipakai: ${mUsed.effective} (${mUsed.provider ?? "?"} via fallback)`)
      }
      console.log(`  Provider:      ${ctx.providerHint ?? "tidak diketahui"}`)
      console.log(`  Tool aktif:    ${ctx.toolsCount}`)
      console.log(`  Skill:         ${ctx.skills.length}\n`)
      return { handled: true }
    }

    case "history": {
      console.log("/history sudah tidak ada - pakai panah atas untuk menjelajahi history")
      return { handled: true }
    }

    default:
      return { handled: false }
  }
}
