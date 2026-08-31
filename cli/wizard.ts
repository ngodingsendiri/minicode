import { createInterface } from "node:readline"
import { detectAndSave } from "../src/config.ts"
import { GATEWAY_PRESETS } from "../src/providers/presets.ts"
import { formatError } from "../src/tui/minimal/simple.ts"
import { askSecret } from "../src/ui/input/input.ts"
import { c, glyphs } from "../src/ui/render/theme.ts"
import { displayWidth } from "../src/ui/render/width.ts"
import { runPicker } from "../src/ui/screens/picker.ts"

/**
 * Wizard setup pertama — hal PERTAMA yang dilihat pengguna baru.
 *
 * Memakai `runPicker` (panah + filter), bukan "Choice [1-15]" lewat readline.
 * Dua alasan: (1) REPL sudah punya picker untuk tugas yang sama — memilih dari
 * daftar — jadi dua UX berbeda untuk satu konsep membingungkan; (2) nomor manual
 * membuat pilihan di luar rentang diam-diam jatuh ke item pertama, sehingga user
 * mengira memilih sesuatu yang lain.
 *
 * Fallback readline tetap ada untuk terminal tanpa raw mode.
 */
export async function runSetupWizard(): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  // Sapaan: pada terminal sempit, petunjuk batal pindah ke baris sendiri
  // supaya tidak membungkus.
  const cols = process.stdout.columns || 80
  const sapaan = "Connect your first provider."
  const petunjuk = "(Ctrl+C to cancel)"
  process.stdout.write(`\n${c.bold("Minicode setup")}\n`)
  process.stdout.write(
    displayWidth(`${sapaan} ${petunjuk}`) <= cols
      ? `${sapaan} ${c.dim(petunjuk)}\n`
      : `${sapaan}\n${c.dim(petunjuk)}\n`,
  )

  const CUSTOM = "\u0000custom"
  const items = [
    ...GATEWAY_PRESETS.map((p) => ({ name: p.label, provider: "", value: p.baseUrl })),
    { name: "Custom URL", provider: "", value: CUSTOM },
  ]

  let picked: string | null = null
  await runPicker({
    title: "Select gateway",
    items,
    filterable: true,
    placeholder: "Filter",
    onPick: (v) => {
      picked = v
    },
    onCancel: () => {
      picked = null
    },
  })
  if (picked === null) {
    process.stdout.write("Setup canceled.\n")
    return false
  }

  // readline dipakai HANYA untuk isian teks bebas (URL), bukan untuk memilih.
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, (a) => res(a.trim())))

  let targetUrl: string
  try {
    if (picked === CUSTOM) {
      targetUrl = await ask("Base URL: ")
    } else {
      const custom = await ask(`Base URL [${picked}]: `)
      targetUrl = custom || (picked as string)
    }
  } finally {
    rl.close()
  }

  if (!targetUrl) {
    process.stdout.write("Setup canceled.\n")
    return false
  }
  // Validasi URL — umpan balik langsung, bukan gagal saat detect.
  try {
    const u = new URL(targetUrl)
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("protocol")
  } catch {
    process.stdout.write(`${c.red(glyphs.cross)} Invalid URL: ${targetUrl}\n`)
    return false
  }

  // Endpoint lokal (Ollama/LM Studio) tidak butuh API key; kirim placeholder
  // agar header Authorization tetap terbentuk.
  const lokal = /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(targetUrl)
  const apiKey = lokal ? "ollama" : await askSecret("API key: ")

  if (!apiKey) {
    process.stdout.write(`Setup canceled. Set OPENAI_API_KEY later to continue.\n`)
    return false
  }

  const { createSpinner } = await import("../src/ui/runtime/spinner.ts")
  const spin = createSpinner("Detecting models…")
  try {
    const preset = GATEWAY_PRESETS.find(
      (p) => p.baseUrl.replace(/\/+$/, "") === targetUrl.replace(/\/+$/, ""),
    )
    const fallbackModels =
      preset?.fallbackModels ??
      (targetUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"])
    const entry = await detectAndSave(targetUrl, apiKey, undefined, { fallbackModels })
    spin.success(`Provider "${entry.id}" saved — ${entry.models.length} models`)
    process.stdout.write(`Setup complete.\n\n`)
    return true
  } catch (e) {
    spin.error(`Model detection failed: ${formatError(e)}`)
    return false
  }
}
