import type { EventBus } from "../../../minicore/src/core/index.ts";

// Turn status line — satu baris di stderr: `· bai/deepseek-v4-flash · 12 steps …`
// Selalu single-line (systemd-style). Tidak pernah merusak output streaming.
// Dibatasi: non-TTY / legacy console → no-op.
export function attachTurnStatus(bus: EventBus, opts: { initialModel?: string } = {}): () => void {
  if (!process.stderr.isTTY) return () => {};
  const isWinLegacy = process.platform === "win32"
    && !(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.ANSICON || process.env.ConEmuANSI);
  if (isWinLegacy) return () => {};

  let label = opts.initialModel ?? "…";
  let spinner: ReturnType<typeof setInterval> | undefined;
  let fi = 0;
  const F = ["·", "‥", "…"]; // dots — tidak blinking

  const paint = () => {
    process.stderr.write(`\r\x1b[2K${F[fi % F.length]} ${label} · working…`);
    fi++;
  };

  const stopPainting = () => {
    if (!spinner) return;
    clearInterval(spinner);
    spinner = undefined;
    process.stderr.write("\r\x1b[2K");
  };

  const onStarted = () => {
    stopPainting();
    paint();
    spinner = setInterval(paint, 150);
  };

  const onExt = (e: { kind: string; data: unknown }) => {
    if (e.kind === "error") {
      stopPainting();
    } else if (e.kind === "effective-model") {
      // Router menyubstitusi model — label berubah agar transparan.
      const d = e.data as { effective?: string; provider?: string };
      if (d.effective) {
        label = d.provider ? `${d.provider}/${d.effective}` : d.effective;
        paint();
      }
    }
  };

  const onDone = () => stopPainting();

  // event bus: on() returns the unsubscribe
  const detach = [
    bus.on("turn:started", onStarted),
    bus.on("provider:extension", onExt),
    bus.on("turn:completed", onDone),
  ];

  return () => {
    stopPainting();
    for (const d of detach) d();
  };
}
