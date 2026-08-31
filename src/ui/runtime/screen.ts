// Minimal screen — alternate-screen + size + cursor
//
// Semua penulisan sekuens dijaga oleh `supportsVt()`: terminal tanpa dukungan VT
// (TERM=dumb, TERM kosong di pipe, conhost Windows lama tanpa VT) akan MENAMPILKAN
// sekuens sebagai teks sampah alih-alih menafsirkannya. Renderer fullscreen sudah
// memeriksa isTTY, tapi isTTY saja tidak menjamin dukungan VT.
const ALT_ENTER = "\x1b[?1049h\x1b[2J\x1b[H"
const ALT_EXIT = "\x1b[?1049l"
const HIDE = "\x1b[?25l"
const SHOW = "\x1b[?25h"
const CLEAR = "\x1b[2J\x1b[H"

/**
 * Apakah terminal menafsirkan sekuens VT?
 *
 * - `TERM=dumb` / `TERM=` : eksplisit tanpa kemampuan kursor (Emacs shell, CI log).
 * - `NO_COLOR` TIDAK dipakai di sini: itu soal warna, bukan kemampuan kursor.
 * - Windows: conhost modern (Windows 10+) mendukung VT, tapi konsol lama tidak.
 *   Indikator yang tersedia: WT_SESSION (Windows Terminal), TERM_PROGRAM,
 *   ANSICON, ConEmuANSI. Sama seperti heuristik di src/ui/assistant/turn-status.ts.
 * - `MINICODE_NO_ALT=1` : jalan keluar manual bila heuristik salah.
 */
export function supportsVt(): boolean {
  if (process.env.MINICODE_NO_ALT === "1") return false
  if (!process.stdout.isTTY) return false
  const term = (process.env.TERM ?? "").toLowerCase()
  if (term === "dumb" || term === "unknown") return false
  if (process.platform !== "win32") return true
  // Di Windows, TERM biasanya tidak diset sama sekali; andalkan penanda emulator.
  return !!(
    process.env.WT_SESSION ||
    process.env.TERM_PROGRAM ||
    process.env.ANSICON ||
    process.env.ConEmuANSI ||
    term.length > 0
  )
}

const write = (s: string) => {
  if (supportsVt()) process.stdout.write(s)
}

export function enterAlternate(): void {
  write(ALT_ENTER)
}
export function exitAlternate(): void {
  write(ALT_EXIT)
}
export function hideCursor(): void {
  write(HIDE)
}
export function showCursor(): void {
  write(SHOW)
}
export function clearScreen(): void {
  write(CLEAR)
}
export function getSize(): { width: number; height: number } {
  return { width: process.stdout.columns || 80, height: process.stdout.rows || 24 }
}
export function onResize(cb: () => void): () => void {
  process.stdout.on("resize", cb)
  return () => process.stdout.off("resize", cb)
}
export function enableBracketedPaste(): void {
  write("\x1b[?2004h")
}
export function disableBracketedPaste(): void {
  write("\x1b[?2004l")
}
