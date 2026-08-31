import type { EventBus } from "#minicore/core/index.ts"
import { registerStatusLine } from "../ui/runtime/statusline.ts"

// Turn status line — satu baris di stderr: `·· model` (dots + label saja).
// Kata status ("reasoning"/"working") sengaja tidak ditampilkan — indikator
// cukup dari animasi dots. Selalu single-line, tidak merusak streaming:
// output lain memakai runWithoutStatus() yang menahan repaint sesaat.
export function attachTurnStatus(
  bus: EventBus,
  opts: { initialModel?: string; getModel?: () => string | undefined } = {},
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

  let label = opts.initialModel ?? "..."
  let spinner: ReturnType<typeof setInterval> | undefined
  let fi = 0
  const F = ["·", "··", "···"]

  const paint = () => {
    process.stderr.write(`\r\x1b[2K${F[fi % F.length]} ${label}`)
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
    if (opts.getModel) {
      const cur = opts.getModel()
      if (cur) label = cur
    }
    paint()
    spinner = setInterval(paint, 150)
  }

  const onExt = (e: { kind: string; data: unknown }) => {
    if (e.kind === "error") {
      stopPainting()
    } else if (e.kind === "effective-model") {
      const d = e.data as { effective?: string; provider?: string }
      if (d.effective) {
        label = d.provider ? `${d.provider}/${d.effective}` : d.effective
        if (!spinner) paint()
      }
    }
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
