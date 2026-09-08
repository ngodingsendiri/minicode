import type { UiBus } from "../contract.ts"
import { c } from "../render/theme.ts"
import { registerStatusLine } from "../runtime/statusline.ts"

// Turn status line — satu baris di stderr: `Thinking` berdenyut redup-terang
// (bukan nama model). Selalu single-line, tidak merusak streaming: output lain
// memakai runWithoutStatus() yang menahan repaint sesaat.
export function attachTurnStatus(
  bus: UiBus,
  opts: {
    initialModel?: string
    getModel?: () => string | undefined
    /**
     * Teks statistik tambahan (mis. token/biaya sesi) — DI dari composition
     * root agar UI tak perlu impor lapisan policy/usage. Undefined = mati
     * (default hemat: shell tetap bersih).
     */
    getStats?: () => string | undefined
  } = {},
): () => void {
  if (!process.stderr.isTTY) return () => {}
  const isWinLegacy =
    process.platform === "win32" &&
    !(
      process.env.WT_SESSION ||
      process.env.TERM_PROGRAM ||
      process.env.ANSICON ||
      process.env.ConEmuANSI
    )
  if (isWinLegacy) return () => {}

  let spinner: ReturnType<typeof setInterval> | undefined
  let fi = 0
  // Satu sumber frames dengan spinner wizard (MINICODE_ASCII konsisten).

  const paint = () => {
    let extra = ""
    try {
      const s = opts.getStats?.()
      if (s) extra = ` · ${s}`
    } catch {}
    // Hanya teks "Thinking" berdenyut: setengah periode redup, setengah
    // terang (siklus ~1,2 dtk @150ms). Tanpa dots/prefix lain.
    // Getter c.* dibaca tiap frame (jangan dibekukan — lihat P0.1). Di NO_COLOR
    // keduanya polos: denyut menjadi statis.
    const thinking = fi % 8 < 4 ? c.muted("Thinking") : "Thinking"
    process.stderr.write(`\r\x1b[2K${thinking}${extra}`)
    fi++
  }

  const stopPainting = () => {
    if (!spinner) return
    clearInterval(spinner)
    spinner = undefined
    process.stderr.write("\r\x1b[2K")
  }

  // Dipakai renderer via runWithoutStatus: hentikan repaint sebentar,
  // lalu gambar ulang agar garis status tetap hidup di bawah output.
  let wasRunning = false
  const handle = {
    suspend() {
      wasRunning = !!spinner
      if (spinner) {
        clearInterval(spinner)
        spinner = undefined
        process.stderr.write("\r\x1b[2K")
      }
    },
    resume() {
      if (wasRunning && !spinner) {
        paint()
        spinner = setInterval(paint, 150)
      }
    },
  }
  registerStatusLine(handle)

  const onStarted = () => {
    stopPainting()
    paint()
    spinner = setInterval(paint, 150)
  }

  const onExt = (e: { kind: string; data: unknown }) => {
    if (e.kind === "error") stopPainting()
  }

  const onDone = () => stopPainting()
  const onText = () => stopPainting()

  const detach = [
    bus.on("turn:started", onStarted),
    bus.on("provider:extension", onExt),
    bus.on("provider:text", onText),
    bus.on("turn:completed", onDone),
  ]

  return () => {
    stopPainting()
    registerStatusLine(null)
    for (const d of detach) d()
  }
}
