// Prompt engine - PURE functions untuk logika input interaktif.
// Sama sekali tidak menyentuh stdin/stdout - hanya data -> data.
// Dipakai askLine (cli/input.ts), TUI fullscreen, + unit test.

import { displayWidth } from "../src/tui/width.ts"

export interface PromptState {
  line: string
  /**
   * Posisi kursor dalam satuan CODE POINT (bukan UTF-16 unit), 0..len.
   * Tanpa ini tidak ada editing di tengah baris: user harus menghapus seluruh
   * sisa prompt untuk memperbaiki satu kata.
   */
  cursor: number
  sel: number // index seleksi dropdown, -1 = tidak ada
  menuOpen: boolean
}

export const MAX_VISIBLE = 10

// Hasil render satu frame - pure spec, renderer (input.ts) yang menulis ke stdout.
export interface RenderSpec {
  inputLine: string // prompt + line (baris 1)
  /** Kolom kursor (0-based) relatif awal inputLine — untuk ESC[<n>G. */
  cursorCol: number
  rows: { kind: "header" | "item"; text: string; picked: boolean }[] // baris dropdown
  moreCount: number // jumlah item tersembunyi (0 = tidak ada)
  totalRows: number // jumlah baris dropdown termasuk baris "more"
}

export function createState(): PromptState {
  return { line: "", cursor: 0, sel: -1, menuOpen: false }
}

// Keypress ter-normalisasi (hasil decode binari stdin).
export type PromptKey =
  | { type: "char"; ch: string }
  | { type: "backspace" }
  | { type: "delete" } // hapus karakter DI kursor (Del)
  | { type: "left" }
  | { type: "right" }
  | { type: "home" }
  | { type: "end" }
  | { type: "up" }
  | { type: "down" }
  | { type: "tab" }
  | { type: "enter" }
  | { type: "esc" }
  | { type: "ctrl-c" }
  | { type: "ctrl-d" }
  | { type: "ctrl-u" } // clear line
  | { type: "ctrl-w" } // delete previous word
  | { type: "ctrl-o" } // expand detail (TUI)
  | { type: "ctrl-r" } // reverse history search (TUI)
  | { type: "ctrl-t" } // toggle reasoning visibility
  | { type: "shift-tab" } // cycle mode (TUI) — caller maps raw \x1b[Z
  | { type: "ignore" } // sekuens yang sengaja dibuang (mis. byte mouse)

// Terapkan satu keypress -> state baru + render spec + action (submit/cancel).
export type PromptAction = "none" | "render" | "submit" | "cancel"

// ── Helper code-point ──
// String JS diindeks per UTF-16 unit; emoji memakai dua. Semua operasi kursor
// bekerja pada array code point supaya emoji tidak pernah terbelah.
function toPoints(s: string): string[] {
  return Array.from(s)
}

export function pointLength(s: string): number {
  return toPoints(s).length
}

/** Konversi indeks code-point -> indeks UTF-16, untuk slice(). */
function unitIndex(s: string, point: number): number {
  const pts = toPoints(s)
  let units = 0
  for (let i = 0; i < point && i < pts.length; i++) units += pts[i]!.length
  return units
}

function clampCursor(line: string, cursor: number): number {
  const max = pointLength(line)
  return cursor < 0 ? 0 : cursor > max ? max : cursor
}

/** Sisipkan `ins` pada posisi kursor; kursor maju sepanjang teks yang disisipkan. */
function insertAt(line: string, cursor: number, ins: string): { line: string; cursor: number } {
  const at = unitIndex(line, cursor)
  return {
    line: line.slice(0, at) + ins + line.slice(at),
    cursor: cursor + pointLength(ins),
  }
}

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
  // Setiap perubahan baris memakai aturan menu yang sama: menu terbuka bila
  // baris dimulai "/", dan seleksi dijepit ke jumlah hint yang baru.
  const withLine = (line: string, cursor: number): PromptState => {
    const menuOpen = line.startsWith("/")
    return {
      line,
      cursor: clampCursor(line, cursor),
      sel: menuOpen ? Math.min(Math.max(state.sel, -1), countOf(line) - 1) : -1,
      menuOpen,
    }
  }
  // Melengkapi baris dari dropdown: kursor selalu ke ujung teks hasil.
  const completeTo = (text: string): PromptState => ({
    line: text,
    cursor: pointLength(text),
    sel: -1,
    menuOpen: false,
  })

  switch (key.type) {
    case "char": {
      // Paste bisa memuat newline/tab/kontrol. Baris input adalah SATU baris;
      // menyimpan "\n" di dalamnya membuat renderer menulis lebih banyak baris
      // daripada yang dihitung, sehingga frame TUI melebihi tinggi terminal
      // (terverifikasi: paste 3 baris pada terminal 24 baris menghasilkan 26).
      // Newline & tab jadi spasi; byte kontrol lain dibuang.
      const ins = key.ch
        .replace(/\r\n|\r|\n|\t/g, " ")
        // biome-ignore lint/suspicious/noControlCharactersInRegex: membuang byte kontrol dari paste
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      if (!ins) return { state, action: "none" }
      const { line, cursor } = insertAt(state.line, state.cursor, ins)
      return { state: withLine(line, cursor), action: "render" }
    }
    case "backspace": {
      if (state.cursor === 0) return { state, action: "none" }
      const pts = toPoints(state.line)
      pts.splice(state.cursor - 1, 1)
      return { state: withLine(pts.join(""), state.cursor - 1), action: "render" }
    }
    case "delete": {
      const pts = toPoints(state.line)
      if (state.cursor >= pts.length) return { state, action: "none" }
      pts.splice(state.cursor, 1)
      return { state: withLine(pts.join(""), state.cursor), action: "render" }
    }
    case "left": {
      if (state.cursor === 0) return { state, action: "none" }
      return { state: { ...state, cursor: state.cursor - 1 }, action: "render" }
    }
    case "right": {
      if (state.cursor >= pointLength(state.line)) return { state, action: "none" }
      return { state: { ...state, cursor: state.cursor + 1 }, action: "render" }
    }
    case "home": {
      if (state.cursor === 0) return { state, action: "none" }
      return { state: { ...state, cursor: 0 }, action: "render" }
    }
    case "end": {
      const max = pointLength(state.line)
      if (state.cursor === max) return { state, action: "none" }
      return { state: { ...state, cursor: max }, action: "render" }
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
      // Hormati seleksi: setelah user menekan panah bawah, Tab harus melengkapi
      // item yang disorot, bukan selalu item pertama.
      const pick = pickSelected(state.line) ?? pickFirst(state.line)
      if (!pick) return { state, action: "none" }
      return { state: completeTo(pick), action: "render" }
    }
    case "enter": {
      const pick = pickSelected(state.line)
      const finalLine = pick ?? state.line
      return { state: completeTo(finalLine), action: "submit" }
    }
    case "esc": {
      if (!state.menuOpen) return { state, action: "none" }
      return { state: { ...state, sel: -1, menuOpen: false }, action: "render" }
    }
    case "ctrl-c":
    case "ctrl-d":
      return { state, action: "cancel" }
    case "ctrl-o": // expand/collapse transcript — handled oleh renderer TUI
    case "ctrl-r": // history search — handled oleh renderer TUI
    case "ctrl-t": // toggle reasoning — handled oleh renderer TUI
    case "shift-tab": // cycle mode — handled oleh renderer TUI
    case "ignore": // byte mouse dsb: dibuang, tidak boleh jadi teks
      return { state, action: "none" }
    case "ctrl-u": {
      if (!state.line.length) return { state, action: "none" }
      return { state: createState(), action: "render" }
    }
    case "ctrl-w": {
      if (state.cursor === 0) return { state, action: "none" }
      const at = unitIndex(state.line, state.cursor)
      const before = state.line.slice(0, at)
      const trimmed = before.replace(/\S+\s*$/, "")
      const line = trimmed + state.line.slice(at)
      return { state: withLine(line, pointLength(trimmed)), action: "render" }
    }
  }
}

// Pure render - spec yang digambar renderer.
// `groupOf` opsional: menandai item sebagai command/skill -> header grup dinamis.
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
  // Kolom kursor diukur dalam KOLOM terminal: sekuens ANSI pada prompt tidak
  // menempati kolom, dan CJK/emoji menempati dua. Menghitung panjang string
  // mentah membuat kursor terminal salah posisi begitu prompt diwarnai.
  const cursorPoints = Array.from(state.line).slice(0, clampCursor(state.line, state.cursor))
  return {
    inputLine,
    cursorCol: displayWidth(prompt) + displayWidth(cursorPoints.join("")),
    rows,
    moreCount,
    totalRows: rows.length + (moreCount > 0 ? 1 : 0),
  }
}

// ── Binari dari chunk stdin -> keystroke stream ──
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
    // Bracketed paste: ESC[200~ … ESC[201~ — emit satu char "paste" per segmen
    if (
      s[i + 1] === "[" &&
      s[i + 2] === "2" &&
      s[i + 3] === "0" &&
      s[i + 4] === "0" &&
      s[i + 5] === "~"
    ) {
      const endIdx = s.indexOf("\x1b[201~", i + 6)
      if (endIdx !== -1) {
        return { key: { type: "char", ch: s.slice(i + 6, endIdx) }, width: endIdx + 6 - i }
      }
    }
    // Laporan mouse. X10: ESC [ M + 3 byte mentah (yang BUKAN huruf final, jadi
    // scanCsi tidak bisa mengukurnya). SGR: ESC [ < … M/m. Keduanya dibuang —
    // tanpa ini byte koordinat masuk sebagai teks ("teks" jadi "teks 00").
    if (s[i + 1] === "[" && s[i + 2] === "M") return { key: { type: "ignore" }, width: 6 }
    if (s[i + 1] === "[" && s[i + 2] === "<") {
      let j = i + 3
      while (j < s.length && s[j] !== "M" && s[j] !== "m") j++
      return { key: { type: "ignore" }, width: j - i + 1 }
    }
    if (s[i + 1] === "[" || s[i + 1] === "O") {
      const kind = s[i + 2]
      if (kind === "A") return { key: { type: "up" }, width: 3 }
      if (kind === "B") return { key: { type: "down" }, width: 3 }
      if (kind === "C") return { key: { type: "right" }, width: 3 }
      if (kind === "D") return { key: { type: "left" }, width: 3 }
      if (kind === "H") return { key: { type: "home" }, width: 3 }
      if (kind === "F") return { key: { type: "end" }, width: 3 }
      // Varian VT: ESC[1~ Home, ESC[4~ End, ESC[3~ Delete, ESC[7~/[8~ Home/End
      if (kind === "1" && s[i + 3] === "~") return { key: { type: "home" }, width: 4 }
      if (kind === "7" && s[i + 3] === "~") return { key: { type: "home" }, width: 4 }
      if (kind === "4" && s[i + 3] === "~") return { key: { type: "end" }, width: 4 }
      if (kind === "8" && s[i + 3] === "~") return { key: { type: "end" }, width: 4 }
      if (kind === "3" && s[i + 3] === "~") return { key: { type: "delete" }, width: 4 }
      // ESC [ … lainnya -> konsumsi saja
      return { key: { type: "esc" }, width: Math.max(3, scanCsi(s, i)) }
    }
    return { key: { type: "esc" }, width: 1 }
  }
  if (code === 0x01) return { key: { type: "home" }, width: 1 } // Ctrl+A
  if (code === 0x05) return { key: { type: "end" }, width: 1 } // Ctrl+E
  // Ctrl+O (15) & Ctrl+R (18) sebagai key types sendiri
  if (code === 0x0f) return { key: { type: "ctrl-o" }, width: 1 }
  if (code === 0x12) return { key: { type: "ctrl-r" }, width: 1 }
  if (code === 0x14) return { key: { type: "ctrl-t" }, width: 1 }
  if (code === 0x7f || code === 0x08) return { key: { type: "backspace" }, width: 1 }
  if (c === "\n" || c === "\r") return { key: { type: "enter" }, width: 1 }
  if (c === "\t") return { key: { type: "tab" }, width: 1 }
  if (code === 0x03) return { key: { type: "ctrl-c" }, width: 1 }
  if (code === 0x04) return { key: { type: "ctrl-d" }, width: 1 }
  if (code === 0x15) return { key: { type: "ctrl-u" }, width: 1 }
  if (code === 0x17) return { key: { type: "ctrl-w" }, width: 1 }
  // Kontrol C0 lain yang tidak punya arti di sini (Ctrl+L, Ctrl+K, Ctrl+T,
  // Ctrl+Z, dst.) DIBUANG, bukan diteruskan sebagai karakter.
  //
  // Sebelumnya semuanya jatuh ke cabang "char" di bawah dan masuk ke baris
  // input sebagai byte tak tampak — Ctrl+L+Ctrl+K+Ctrl+T pada "teks"
  // mengirimkan "teks\f\u000b\u0014" ke model. Tidak terlihat di layar, tapi
  // ikut terkirim dan bisa membingungkan model atau merusak render.
  if (code < 0x20 || code === 0x7f) return { key: { type: "ignore" }, width: 1 }
  // Multi-byte: s sudah decoded UTF-16 - ukur unit per code point.
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
