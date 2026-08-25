import type { EventBus } from "minicore/core/index.ts"

// Turn status line — satu baris di stderr: `· bai/deepseek-v4-flash · 12 steps …`
// Selalu single-line (systemd-style). Tidak pernah merusak output streaming.
// Dibatasi: non-TTY / legacy console → no-op.
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

  let label = opts.initialModel ?? "…"
  let reasoning = false
  let spinner: ReturnType<typeof setInterval> | undefined
  let fi = 0
  const F = ["·", "··", "···"] // dots cycling — reasoning indicator

  const paint = () => {
    const status = reasoning ? "reasoning" : "working"
    process.stderr.write(`\r\x1b[2K${F[fi % F.length]} ${label} · ${status}`)
    fi++
  }

  const stopPainting = () => {
    if (!spinner) return
    clearInterval(spinner)
    spinner = undefined
    process.stderr.write("\r\x1b[2K")
  }

  const onStarted = () => {
    stopPainting()
    reasoning = false
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
    } else if (e.kind === "reasoning") {
      // Collapsed indicator: teks reasoning tidak dicetak, cukup dots animasi.
      if (!reasoning) {
        reasoning = true
        paint()
      }
    } else if (e.kind === "effective-model") {
      const d = e.data as { effective?: string; provider?: string }
      if (d.effective) {
        label = d.provider ? `${d.provider}/${d.effective}` : d.effective
        paint()
      }
    }
  }

  const onDone = () => {
    reasoning = false
    stopPainting()
  }
  const onText = () => {
    reasoning = false
    stopPainting()
  }

  // event bus: on() returns the unsubscribe
  const detach = [
    bus.on("turn:started", onStarted),
    bus.on("provider:extension", onExt),
    bus.on("provider:text", onText),
    bus.on("turn:completed", onDone),
  ]

  return () => {
    stopPainting()
    for (const d of detach) d()
  }
}
