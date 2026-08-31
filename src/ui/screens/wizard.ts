// View wizard setup pertama — murni presentasi: picker gateway, isian URL,
// input API key, spinner. Penyimpanan provider dilakukan lewat callback
// `onSubmit` yang di-inject controller (cli/wizard.ts).
import { createInterface } from "node:readline"
import { formatError } from "../assistant/simple.ts"
import { askSecret } from "../input/input.ts"
import { c, glyphs } from "../render/theme.ts"
import { displayWidth } from "../render/width.ts"
import { runPicker } from "./picker.ts"

export interface WizardPreset {
  label: string
  baseUrl: string
}

export interface SetupWizardViewOptions {
  presets: readonly WizardPreset[]
  /** Simpan provider; kembalikan pesan sukses, atau lempar untuk gagal. */
  onSubmit(baseUrl: string, apiKey: string): Promise<string>
}

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
export async function runSetupWizardView(opts: SetupWizardViewOptions): Promise<boolean> {
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
    ...opts.presets.map((p) => ({ name: p.label, provider: "", value: p.baseUrl })),
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

  const { createSpinner } = await import("../runtime/spinner.ts")
  const spin = createSpinner("Detecting models…")
  try {
    const message = await opts.onSubmit(targetUrl, apiKey)
    spin.success(message)
    process.stdout.write(`Setup complete.\n\n`)
    return true
  } catch (e) {
    spin.error(`Model detection failed: ${formatError(e)}`)
    return false
  }
}
