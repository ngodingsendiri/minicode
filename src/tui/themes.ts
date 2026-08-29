// Theme presets — token map (VS Code Dark+ inspired base). Pilih via /theme
// atau --theme. Auto light/dark bila COLORFGBG ada; default dark.
export type ThemeName = "dark" | "dim" | "light" | "mono"

export interface Theme {
  success: string
  error: string
  warning: string
  info: string
  accent: string
  muted: string
  text: string
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    success: "38;2;137;209;133",
    error: "38;2;244;135;113",
    warning: "38;2;204;167;0",
    info: "38;2;117;190;255",
    accent: "38;2;0;122;204",
    muted: "2",
    text: "39",
  },
  dim: {
    success: "38;2;120;180;120",
    error: "38;2;200;120;100",
    warning: "38;2;170;150;80",
    info: "38;2;100;160;210",
    accent: "38;2;90;130;190",
    muted: "2",
    text: "39",
  },
  light: {
    success: "38;2;0;120;60",
    error: "38;2;200;40;40",
    warning: "38;2;150;110;0",
    info: "38;2;0;90;180",
    accent: "38;2;0;80;160",
    muted: "2",
    text: "30",
  },
  mono: {
    success: "39",
    error: "1;39",
    warning: "39",
    info: "39",
    accent: "39",
    muted: "2",
    text: "39",
  },
}

const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

export function resolveThemeName(name?: string): ThemeName {
  if (name && (THEME_NAMES as string[]).includes(name)) return name as ThemeName
  // auto: terminal terang (light bg) -> theme light
  const fgbg = process.env.COLORFGBG ?? ""
  if (/;0$/.test(fgbg) && fgbg !== "") return "light"
  return "dark"
}
