// Prompt engine — PURE functions untuk logika input interaktif.
// Sama sekali tidak menyentuh stdin/stdout — hanya data → data.
// Dipakai askLine (cli/input.ts) + unit test (test/prompt-engine.test.ts).

export interface PromptState {
  line: string
  sel: number // index seleksi dropdown, -1 = tidak ada
  menuOpen: boolean
}

export const MAX_VISIBLE = 10

// Hasil render satu frame — pure spec, renderer (input.ts) yang menulis ke stdout.
export interface RenderSpec {
  inputLine: string // prompt + line (baris 1)
  rows: { kind: "header" | "item"; text: string; picked: boolean }[] // baris dropdown
  moreCount: number // jumlah item tersembunyi (0 = tidak ada)
  totalRows: number // jumlah baris dropdown termasuk baris "more"
}

export function createState(): PromptState {
  return { line: "", sel: -1, menuOpen: false }
}

// Keypress ter-normalisasi (hasil decode binari stdin).
export type PromptKey =
  | { type: "char"; ch: string }
  | { type: "backspace" }
  | { type: "left" }
  | { type: "right" }
  | { type: "up" }
  | { type: "down" }
  | { type: "tab" }
  | { type: "enter" }
  | { type: "esc" }
  | { type: "ctrl-c" }
  | { type: "ctrl-d" }

// Terapkan satu keypress → state baru + render spec + action (submit/cancel).
export type PromptAction = "none" | "render" | "submit" | "cancel"

export function applyKey(
  state: PromptState,
  key: PromptKey,
  hints: (line: string) => string[],
): { state: PromptState; action: PromptAction } {
  const countOf = (line: string): number => hints(line).length
  const pickSelected = (line: string) => {
    const rows = hints(line)
    if (!rows.length) return null
    return state.sel >= 0 && state.sel < rows.length ? rows[state.sel]! : null
  }
  const pickFirst = (line: string) => {
    const rows = hints(line)
    if (!rows.length) return null
    return rows[0]!
  }

  switch (key.type) {
    case "char": {
      const line = state.line + key.ch
      const menuOpen = line.startsWith("/")
      return {
        state: {
          line,
          sel: menuOpen ? Math.min(Math.max(state.sel, -1), countOf(line) - 1) : -1,
          menuOpen,
        },
        action: "render",
      }
    }
    case "backspace": {
      if (!state.line.length) return { state, action: "none" }
      // code-point aware: jangan potong surrogate pair (emoji dsb.)
      const lastCode = state.line.charCodeAt(state.line.length - 1)
      const sliceW = lastCode >= 0xdc00 && lastCode <= 0xdfff && state.line.length > 1 ? 2 : 1
      const line = state.line.slice(0, state.line.length - sliceW)
      const menuOpen = line.startsWith("/")
      return {
        state: {
          line,
          sel: menuOpen ? Math.min(Math.max(state.sel, -1), countOf(line) - 1) : -1,
          menuOpen,
        },
        action: "render",
      }
    }
    case "up": {
      if (!state.menuOpen) return { state, action: "none" }
      const n = countOf(state.line)
      if (!n) return { state, action: "none" }
      return {
        state: { ...state, sel: state.sel <= 0 ? n - 1 : (((state.sel - 1) % n) + n) % n },
        action: "render",
      }
    }
    case "down": {
      if (!state.menuOpen) return { state, action: "none" }
      const n = countOf(state.line)
      if (!n) return { state, action: "none" }
      return { state: { ...state, sel: (state.sel + 1) % n }, action: "render" }
    }
    case "tab": {
      const pick = pickFirst(state.line)
      if (!pick) return { state, action: "none" }
      return { state: { line: pick, sel: -1, menuOpen: false }, action: "render" }
    }
    case "enter": {
      const pick = pickSelected(state.line)
      const finalLine = pick ?? state.line
      return { state: { line: finalLine, sel: -1, menuOpen: false }, action: "submit" }
    }
    case "esc": {
      if (!state.menuOpen) return { state, action: "none" }
      return { state: { ...state, sel: -1, menuOpen: false }, action: "render" }
    }
    case "ctrl-c":
    case "ctrl-d":
      return { state, action: "cancel" }
    case "left":
    case "right":
      return { state, action: "none" }
  }
}

// Pure render — spec yang digambar renderer.
// `groupOf` opsional: menandai item sebagai command/skill → header grup dinamis.
export function buildRenderSpec(
  state: PromptState,
  prompt: string,
  hints: string[],
  groupOf?: (text: string) => string,
): RenderSpec {
  const inputLine = `${prompt}${state.line}`
  const visible = hints.slice(0, MAX_VISIBLE)
  const moreCount = Math.max(0, hints.length - MAX_VISIBLE)
  const rows: RenderSpec["rows"] = []
  let lastGroup: string | undefined
  for (const text of visible) {
    const group = groupOf?.(text)
    if (group !== undefined && group !== lastGroup) {
      lastGroup = group
      rows.push({ kind: "header", text: group.toUpperCase(), picked: false })
    }
    rows.push({ kind: "item", text, picked: text === visible[state.sel] })
  }
  return {
    inputLine,
    rows,
    moreCount,
    totalRows: rows.length + (moreCount > 0 ? 1 : 0),
  }
}

// ── Binari dari chunk stdin → keystroke stream ──
// Rust-style manual parsing: ESC [ A/B/C/D = arrows, ESC = esc, dsb.
export function decodeKeys(buf: Uint8Array): DecodedKey[] {
  const out: DecodedKey[] = []
  const s = new TextDecoder("utf-8").decode(buf)
  let i = 0
  while (i < s.length) {
    const d = decodeKey(s, i)
    d && out.push(d)
    i += d?.width ?? 1
  }
  return out
}

export interface DecodedKey {
  key: PromptKey
  width: number
}

export function decodeKey(s: string, i: number): DecodedKey | null {
  const c = s[i]!
  const code = c.charCodeAt(0)
  if (code === 0x1b) {
    if (s[i + 1] === "[" || s[i + 1] === "O") {
      const kind = s[i + 2]
      if (kind === "A") return { key: { type: "up" }, width: 3 }
      if (kind === "B") return { key: { type: "down" }, width: 3 }
      if (kind === "C") return { key: { type: "right" }, width: 3 }
      if (kind === "D") return { key: { type: "left" }, width: 3 }
      // ESC [ … lainnya → konsumsi saja
      return { key: { type: "esc" }, width: Math.max(3, scanCsi(s, i)) }
    }
    return { key: { type: "esc" }, width: 1 }
  }
  if (code === 0x7f || code === 0x08) return { key: { type: "backspace" }, width: 1 }
  if (c === "\n" || c === "\r") return { key: { type: "enter" }, width: 1 }
  if (c === "\t") return { key: { type: "tab" }, width: 1 }
  if (code === 0x03) return { key: { type: "ctrl-c" }, width: 1 }
  if (code === 0x04) return { key: { type: "ctrl-d" }, width: 1 }
  // Multi-byte: s sudah decoded UTF-16 — ukur unit per code point.
  // 0xE6..0xE0 = leading surrogates (4-byte UTF-8 → 2 unit), else 1.
  const width = code >= 0xd800 && code <= 0xdbff ? 2 : 1
  const ch = s.slice(i, i + width)
  return { key: { type: "char", ch }, width }
}

function scanCsi(s: string, i: number): number {
  // konsumsi sampai huruf final (mis. ESC [ 1 ; 5 A)
  let j = i + 2
  while (j < s.length && !/[a-zA-Z]/.test(s[j]!)) j++
  return j - i + 1
}
