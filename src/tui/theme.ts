// Semantic color system - Ubuntu Server style.
// Warna by function, bukan appearance. Auto-detect: NO_COLOR > truecolor > 256 > 16 > mono.

const isWindows = process.platform === "win32"
const supportsUtf8 =
  !isWindows ||
  process.env.WT_SESSION != null ||
  process.env.TERM_PROGRAM != null ||
  process.env.LANG?.includes("UTF-8") ||
  process.env.LC_ALL?.includes("UTF-8")

// ── Color support detection ──
const noColor =
  (process.env.NO_COLOR != null && process.env.NO_COLOR !== "0") ||
  process.env.MINICODE_THEME === "minimal"
const hasTruecolor = process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit"
const has256 = process.env.TERM?.includes("256color") ?? false
// Level: 0=mono, 1=16-color, 2=256-color, 3=truecolor
const colorLevel: number = noColor
  ? 0
  : hasTruecolor
    ? 3
    : has256
      ? 2
      : process.stdout.isTTY
        ? 1
        : 0

function wrap(open: number | string, close: number | string): (s: string) => string {
  if (noColor || colorLevel === 0) return (s: string) => s
  const o = typeof open === "number" ? `\x1b[${open}m` : `\x1b[${open}m`
  const cl =
    typeof close === "number"
      ? `\x1b[${close}m`
      : String(close).startsWith("\x1b[")
        ? String(close)
        : `\x1b[${close}m`
  return (s: string) => `${o}${s}${cl}`
}

function trueWrap(fg: string): (s: string) => string {
  if (noColor || colorLevel === 0) return (s: string) => s
  if (hasTruecolor) return (s: string) => `\x1b[${fg}m${s}\x1b[39m`
  // 256 fallback already via 38;5;N in fg, else 16
  return (s: string) => `\x1b[${fg}m${s}\x1b[39m`
}

// ── Semantic color slots - VS Code Dark+ Professional (single default) ──
export const c = {
  // Text hierarchy
  text: (s: string) => s,
  muted: wrap(2, 22), // dim - secondary info, borders
  bold: wrap(1, 22),
  italic: wrap(3, 23),

  // Status - VS Code muted tones
  success: trueWrap("38;2;137;209;133"), // #89D185 green (was 32)
  error: trueWrap("38;2;244;135;113"), // #F48771 salmon (was 31)
  warning: trueWrap("38;2;204;167;0"), // #CCA700 warm yellow (was 33)
  info: trueWrap("38;2;117;190;255"), // #75BEFF cyan (was 36)

  // Accent - VS Code blue #007ACC for headers/selected
  accent: hasTruecolor ? wrap("38;2;0;122;204", 39) : wrap(94, 39), // #007ACC
  accentAlt: hasTruecolor ? wrap("38;2;86;156;214", 39) : wrap(95, 39), // #569CD6
  accentBold: hasTruecolor ? wrap("1;38;2;0;122;204", 39) : wrap(94, 39),

  // Muted variants
  gray: wrap(90, 39), // #858585 via 90

  // Legacy compat (dipakai renderer lama) - mapped to muted tones
  red: trueWrap("38;2;244;135;113"),
  green: trueWrap("38;2;137;209;133"),
  yellow: trueWrap("38;2;204;167;0"),
  cyan: trueWrap("38;2;117;190;255"),
  blue: hasTruecolor ? wrap("38;2;0;122;204", 39) : wrap(34, 39),
  magenta: wrap(35, 39),
  white: wrap(37, 39),
  dim: wrap(2, 22),
  // Syntax highlight - VS Code Dark+
  brightYellow: hasTruecolor ? wrap("38;2;215;186;125", 39) : wrap(93, 39), // #D7BA7D numbers
  brightMagenta: hasTruecolor ? wrap("38;2;197;134;192", 39) : wrap(95, 39), // #C586C0 keywords
  brightCyan: hasTruecolor ? wrap("38;2;78;201;176", 39) : wrap(96, 39), // #4EC9B0 types
}

// ── Glyphs - minimal, Ubuntu Server style ──
export const glyphs = {
  check: supportsUtf8 ? "✓" : "[OK]",
  cross: supportsUtf8 ? "✗" : "[FAIL]",
  arrow: supportsUtf8 ? "›" : ">",
  prompt: supportsUtf8 ? "❯" : ">",
  dot: supportsUtf8 ? "·" : ".",
  bullet: supportsUtf8 ? "●" : "*",
  ellipsis: supportsUtf8 ? "…" : "...",
  sparkle: supportsUtf8 ? "✦" : "*",
  spinnerFrames: ["·", "..", "..."], // simple dots, bukan braille
}

// ── Section separator ──
export function section(title: string): string {
  const width = getTerminalWidth()
  const label = ` ${title} `
  const dashes = Math.max(4, width - label.length)
  return c.dim(label + "─".repeat(dashes))
}

export function getTerminalWidth(): number {
  return process.stdout.columns || 80
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
}
