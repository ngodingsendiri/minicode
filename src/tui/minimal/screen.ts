// Minimal screen — alternate-screen + size + cursor
const ALT_ENTER = "\x1b[?1049h\x1b[2J\x1b[H"
const ALT_EXIT = "\x1b[?1049l"
const HIDE = "\x1b[?25l"
const SHOW = "\x1b[?25h"
const CLEAR = "\x1b[2J\x1b[H"

export function enterAlternate(): void {
  process.stdout.write(ALT_ENTER)
}
export function exitAlternate(): void {
  process.stdout.write(ALT_EXIT)
}
export function hideCursor(): void {
  process.stdout.write(HIDE)
}
export function showCursor(): void {
  process.stdout.write(SHOW)
}
export function clearScreen(): void {
  process.stdout.write(CLEAR)
}
export function getSize(): { width: number; height: number } {
  return { width: process.stdout.columns || 80, height: process.stdout.rows || 24 }
}
export function onResize(cb: () => void): () => void {
  process.stdout.on("resize", cb)
  return () => process.stdout.off("resize", cb)
}
export function enableMouse(): void {
  process.stdout.write("\x1b[?1000h")
}
export function disableMouse(): void {
  process.stdout.write("\x1b[?1000l")
}
export function enableBracketedPaste(): void {
  process.stdout.write("\x1b[?2004h")
}
export function disableBracketedPaste(): void {
  process.stdout.write("\x1b[?2004l")
}
