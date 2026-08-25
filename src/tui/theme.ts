// Semantic color system — Ubuntu Server style.
// Warna by function, bukan appearance. Auto-detect: NO_COLOR > truecolor > 256 > 16 > mono.

const isWindows = process.platform === "win32";
const supportsUtf8 = !isWindows || (process.env.WT_SESSION != null || process.env.TERM_PROGRAM != null || process.env.LANG?.includes("UTF-8") || process.env.LC_ALL?.includes("UTF-8"));

// ── Color support detection ──
const noColor = (process.env.NO_COLOR != null && process.env.NO_COLOR !== "0") || process.env.MINICODE_THEME === "minimal";
const hasTruecolor = process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit";
const has256 = process.env.TERM?.includes("256color") ?? false;
// Level: 0=mono, 1=16-color, 2=256-color, 3=truecolor
const colorLevel: number = noColor ? 0 : hasTruecolor ? 3 : has256 ? 2 : process.stdout.isTTY ? 1 : 0;

function wrap(open: number | string, close: number | string): (s: string) => string {
  if (noColor || colorLevel === 0) return (s: string) => s;
  return (s: string) => `${open}${s}${close}`;
}

// ── Semantic color slots ──
export const c = {
  // Text hierarchy
  text: (s: string) => s,
  muted: wrap(2, 22),           // dim/gray — secondary info
  bold: wrap(1, 22),
  italic: wrap(3, 23),

  // Status
  success: wrap(32, 39),        // green
  error: wrap(31, 39),          // red
  warning: wrap(33, 39),        // yellow
  info: wrap(36, 39),           // cyan

  // Accent (untuk prompt & highlight)
  accent: wrap(94, 49),         // bright blue
  accentAlt: wrap(95, 49),      // bright magenta

  // Muted variants
  gray: wrap(90, 49),

  // Legacy compat (dipakai renderer lama)
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  white: wrap(37, 39),
  dim: wrap(2, 22),
  brightYellow: hasTruecolor ? wrap("38;5;220", "\x1b[39m") : wrap(93, 49),
  brightMagenta: hasTruecolor ? wrap("38;5;213", "\x1b[39m") : wrap(35, 49),
  brightCyan: hasTruecolor ? wrap("38;5;87", "\x1b[39m") : wrap(96, 49),
};

// ── Glyphs — minimal, Ubuntu Server style ──
export const glyphs = {
  check: supportsUtf8 ? "✓" : "[OK]",
  cross: supportsUtf8 ? "✗" : "[FAIL]",
  arrow: supportsUtf8 ? "›" : ">",
  dot: supportsUtf8 ? "·" : ".",
  bullet: supportsUtf8 ? "●" : "*",
  ellipsis: supportsUtf8 ? "…" : "...",
  spinnerFrames: ["·", "..", "..."],  // simple dots, bukan braille
};

// ── Section separator ──
export function section(title: string): string {
  const width = getTerminalWidth();
  const label = ` ${title} `;
  const dashes = Math.max(4, width - label.length);
  return c.dim(label + "─".repeat(dashes));
}

export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
