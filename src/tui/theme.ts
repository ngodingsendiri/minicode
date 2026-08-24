// Minimalist, modern ANSI styling and theme primitives for Minicode.

const isWindows = process.platform === "win32";
const supportsUtf8 = !isWindows || (process.env.WT_SESSION != null || process.env.TERM_PROGRAM != null || process.env.LANG?.includes("UTF-8") || process.env.LC_ALL?.includes("UTF-8"));

// Check NO_COLOR env standard (https://no-color.org)
const noColor = process.env.NO_COLOR != null && process.env.NO_COLOR !== "0";

function wrap(code: number, close: number = 39): (s: string) => string {
  if (noColor) return (s: string) => s;
  return (s: string) => `\x1b[${code}m${s}\x1b[${close}m`;
}

export const c = {
  reset: (s: string) => noColor ? s : `\x1b[0m${s}`,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  strikethrough: wrap(9, 29),

  // Colors
  black: wrap(30),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  white: wrap(37),
  gray: wrap(90),

  // Bright / Soft Pastel Accents
  brightCyan: wrap(96),
  brightGreen: wrap(92),
  brightYellow: wrap(93),
  brightBlue: wrap(94),
  brightMagenta: wrap(95),

  // Backgrounds
  bgDark: (s: string) => noColor ? s : `\x1b[48;5;236m${s}\x1b[49m`,
  bgHighlight: (s: string) => noColor ? s : `\x1b[48;5;238m${s}\x1b[49m`,
  bgDiffAdd: (s: string) => noColor ? s : `\x1b[48;5;22m${s}\x1b[49m`,
  bgDiffRemove: (s: string) => noColor ? s : `\x1b[48;5;52m${s}\x1b[49m`,
};

export const glyphs = {
  bullet: supportsUtf8 ? "●" : "*",
  circle: supportsUtf8 ? "○" : "o",
  check: supportsUtf8 ? "✔" : "[OK]",
  cross: supportsUtf8 ? "✘" : "[X]",
  arrow: supportsUtf8 ? "›" : ">",
  arrowRight: supportsUtf8 ? "→" : "->",
  sparkle: supportsUtf8 ? "✦" : "*",
  branch: supportsUtf8 ? "⌥" : "#",
  gear: supportsUtf8 ? "⚙" : "*",
  lock: supportsUtf8 ? "🔒" : "[L]",
  dot: supportsUtf8 ? "·" : ".",
  ellipsis: supportsUtf8 ? "…" : "...",
  spinnerFrames: supportsUtf8
    ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    : ["-", "\\", "|", "/"],
};

export const box = {
  topLeft: supportsUtf8 ? "╭" : "+",
  topRight: supportsUtf8 ? "╮" : "+",
  bottomLeft: supportsUtf8 ? "╰" : "+",
  bottomRight: supportsUtf8 ? "╯" : "+",
  horizontal: supportsUtf8 ? "─" : "-",
  vertical: supportsUtf8 ? "│" : "|",
  cross: supportsUtf8 ? "┼" : "+",
  tDown: supportsUtf8 ? "┬" : "+",
  tUp: supportsUtf8 ? "┴" : "+",
  tRight: supportsUtf8 ? "├" : "+",
  tLeft: supportsUtf8 ? "┤" : "+",
};

export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
