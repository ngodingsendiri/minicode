// SIMULASI MANUSIA — driver: buka REPL, ketik prompt ke minicode, pantau streaming.
// Meniru persis alur manusia: tulis prompt → minicode❯ → AI streaming → summary.
// Semua output masuk ke window (stdout) + mirror ke .tmp-demo/demo.log agar
// bisa dipantau dari luar (realtime).
import { appendFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { createMinicodeSession } from "../src/app/session.ts"
import { loadConfig } from "../src/config.ts"
import { createUsageCollector } from "../src/policy/usage.ts"
import { buildProviderList } from "../src/providers/build.ts"
import { createRouterProvider } from "../src/providers/router.ts"
import { allTools } from "../src/tools/index.ts"
import { stripAnsi } from "../src/ui/render/theme.ts"

const LOG = resolve(".tmp-demo", "demo.log")
mkdirSync(".tmp-demo", { recursive: true })
function log(msg: string) {
  console.log(msg)
  try {
    appendFileSync(LOG, stripAnsi(msg) + "\n")
  } catch {}
}

const mask = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : "••••")
const BAI = "bai::deepseek-v4-flash"
// Tools memakai process.cwd() sebagai workspace (kernel ToolContext tak punya
// cwd) — manusia memakai `--cwd` untuk mengarah — di sini chdir manual.
// PENTING: config local di `.minicode/config.json` repo — loadConfig DULU
// (setelah chdir loadConfig mencari di cwd baru yang kosong).
const repoRoot = resolve(import.meta.dir, "..")
const cfg = await loadConfig(repoRoot)
const WORKDIR = resolve(".tmp-demo", "app")
mkdirSync(WORKDIR, { recursive: true })
process.chdir(WORKDIR)

// ── STEP 1: "koneksikan provider" (API key dari config-mu, di-mask) ──
log("【STEP 1】 Menyambungkan provider dengan API key…")
const bai = cfg.providers.find((p) => p.id === "bai")
log(
  `  [config] bai: ${mask(bai?.apiKey ?? "")} @ ${bai?.baseUrl}  (${bai?.models.length} models)\n  [ok] provider siap.`,
)
await sleep(600)

// ── STEP 2: siapkan session (sama seperti REPL) ──
log("【STEP 2】 Memulai sesi minicode…")
const providers = buildProviderList(cfg)
const router = createRouterProvider({ providers })
const session = await createMinicodeSession({
  provider: router,
  tools: allTools,
  cwd: WORKDIR,
  permissionMode: "auto",
  timeoutMs: 240_000,
})
const usage = createUsageCollector(session.events)
log("  [ok] sesi aktif — ketik prompt seperti REPL:\n")

// helper: ketik prompt → AI streaming → summary. Mirip prompt manusia.
// Retry sekali saat error transien (rate limit / server / network) —
// seperti manusia "jalankan lagi" — dan tampilkan pesan ramah bukan dump JSON.
async function prompt(p: string, label: string) {
  log(`\n${"=".repeat(60)}\n📝 PROMPT ${label}: ${p}\n${"=".repeat(60)}`)
  const t0 = Date.now()
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await session.run(p, { model: BAI })
      const u = usage.get(BAI)
      log(
        `\n  ✅ Selesai — ${u.totalTokens.toLocaleString()} tokens · ${u.cost != null ? `$${u.cost.toFixed(4)}` : "?"} · ${res.usage.steps} steps · ${Math.round((Date.now() - t0) / 1000)}s`,
      )
      return
    } catch (e) {
      const msg = (e as Error).message ?? String(e)
      const isTransient = /rate.?limit|429|server error|network|timeout|ECONN/i.test(msg)
      if (attempt === 1 && isTransient) {
        log(`  ⚠ Coba lagi (transient: ${msg.slice(0, 90)}…)`)
        await sleep(3000)
        continue
      }
      log(`\n  ❌ ${friendly(msg)}`)
      return
    }
  }
}

function friendly(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes("auth") && /401|403/.test(raw))
    return "Authentication rejected (401/403) — periksa API key."
  if (lower.includes("rate") || /429/.test(raw))
    return "Rate limited oleh provider (429) — tunggu sebentar lalu coba lagi."
  if (lower.includes("no endpoints available"))
    return "Provider menolak model ini (guardrail/data policy) — coba model/produsen lain."
  if (lower.includes("context length") || lower.includes("context_length"))
    return "Konteks penuh (context window) — sesi baru / model lebih besar."
  if (lower.includes("no provider configured"))
    return "Tidak ada provider terpasang — jalankan `minicode config add` atau wizard."
  const m = raw.match(/"message"\s*:\s*"([^"]+)"/)
  if (m) return m[1]!.slice(0, 140)
  return raw.slice(0, 140)
}

// ── STEP 3: buat aplikasi sederhana ──
await prompt(
  "Buat aplikasi sederhana: buat file calculator.ts dengan fungsi tambah(a,b) dan kurang(a,b), lalu buat juga calculator.test.ts yang menguji keduanya dengan bun:test",
  "A",
)
await sleep(1500)

// ── STEP 4: review/jalankan ──
await prompt(
  "Sekarang jalankan bun test untuk file test tadi. Kalau ada error, perbaiki sampai lulus.",
  "B",
)
await sleep(1500)

// ── STEP 5: jelaskan hasil ──
await prompt("Apa saja file yang kamu buat? Jelaskan isi calculator.ts sejelasnya.", "C")

// ── STEP 6: pantau (cost/status ala /cost /status) ──
const u = usage.get(BAI)
log(`\n${"=".repeat(60)}\n📊 LAPORAN SESSION (ala /cost /status)\n${"=".repeat(60)}`)
log(`  Total:   ${u.totalTokens.toLocaleString()} tokens`)
log(`  Input:   ${u.inputTokens.toLocaleString()} · Output: ${u.outputTokens.toLocaleString()}`)
log(`  Estimasi: ${u.cost != null ? `$${u.cost.toFixed(4)}` : "N/A"}`)
log(`  Steps:   ${session.state.stepCount} · Turns: ${session.state.turnCount}`)

log(
  `\n${"=".repeat(60)}\nDEMO MANUSIA SELESAI ✅ — lihat file di .tmp-demo/app/\n${"=".repeat(60)}`,
)
process.exit(0)
