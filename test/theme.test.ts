import { afterAll, beforeEach, expect, test } from "bun:test"
import { applyTheme, c, ESC, stripAnsi } from "../src/ui/render/theme.ts"
import { THEMES } from "../src/ui/render/themes.ts"

// Deteksi warna dievaluasi lazy, jadi test bisa memaksa level warna lewat env.
// Tanpa ini hasilnya bergantung apakah stdout runner tersambung ke TTY.
const origColorterm = process.env.COLORTERM
const origNoColor = process.env.NO_COLOR

beforeEach(() => {
  process.env.COLORTERM = "truecolor"
  delete process.env.NO_COLOR
})

afterAll(() => {
  applyTheme("dark")
  if (origColorterm == null) delete process.env.COLORTERM
  else process.env.COLORTERM = origColorterm
  if (origNoColor == null) delete process.env.NO_COLOR
  else process.env.NO_COLOR = origNoColor
})

test("themes: 4 presets with all tokens", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    expect(t.success).toBeTruthy()
    expect(t.error).toBeTruthy()
    expect(t.warning).toBeTruthy()
    expect(t.info).toBeTruthy()
    expect(t.accent).toBeTruthy()
    expect(t.muted).toBeTruthy()
    expect(name).toBeTypeOf("string")
  }
})

test("theme: applyTheme switches live", () => {
  expect(applyTheme("mono")).toBe("mono")
  expect(applyTheme("light")).toBe("light")
  expect(applyTheme("bogus")).toBe("dark") // fallback
})

// Regresi: `c` dulu membekukan token tema saat import (closure di module scope),
// jadi applyTheme() mengubah state tapi TIDAK mengubah warna yang dihasilkan.
// `/theme light` melapor sukses sambil tetap mencetak warna dark.
test("theme: applyTheme benar-benar mengubah keluaran warna", () => {
  const slots = ["success", "error", "warning", "info", "accent"] as const
  applyTheme("dark")
  const dark = slots.map((s) => c[s]("X"))
  applyTheme("light")
  const light = slots.map((s) => c[s]("X"))
  for (let i = 0; i < slots.length; i++) {
    expect(light[i]).not.toBe(dark[i])
  }
})

test("theme: alias legacy (red/green/yellow/cyan) juga mengikuti tema", () => {
  const slots = ["red", "green", "yellow", "cyan"] as const
  applyTheme("dark")
  const dark = slots.map((s) => c[s]("X"))
  applyTheme("light")
  const light = slots.map((s) => c[s]("X"))
  for (let i = 0; i < slots.length; i++) {
    expect(light[i]).not.toBe(dark[i])
  }
})

test("theme: mono tidak menghasilkan warna, hanya teks/atribut", () => {
  applyTheme("mono")
  // Pola dibangun dari ESC (String.fromCharCode) alih-alih literal \x1b supaya
  // tidak menyisipkan control character mentah ke source.
  const colorSgr = new RegExp(`${ESC}\\[(?:3[0-7]|9[0-7]|38;)`)
  const colorSlots = [
    "success",
    "warning",
    "info",
    "accent",
    "red",
    "green",
    "yellow",
    "cyan",
    // `gray` dulu selalu SGR 90 (bright-black) — itu warna, jadi tema mono tak
    // pernah benar-benar monokrom. Terlihat lewat highlightCode: komentar tetap
    // berwarna di tema mono. Sekarang jatuh ke dim (SGR 2).
    "gray",
    "brightYellow",
    "brightMagenta",
    "brightCyan",
  ] as const
  for (const slot of colorSlots) {
    const out = c[slot]("X")
    expect(out).not.toMatch(colorSgr)
    expect(stripAnsi(out)).toBe("X")
  }
})

test("theme: teks tetap utuh setelah strip untuk semua tema", () => {
  for (const name of ["dark", "dim", "light", "mono"]) {
    applyTheme(name)
    expect(stripAnsi(c.success("halo"))).toBe("halo")
    expect(stripAnsi(c.accent(c.bold("halo")))).toBe("halo")
  }
})

test("stripAnsi: menangkap sekuens private-mode dan OSC", () => {
  expect(stripAnsi("\x1b[?25lteks\x1b[?25h")).toBe("teks")
  expect(stripAnsi("\x1b[?2026hsync\x1b[?2026l")).toBe("sync")
  expect(stripAnsi("\x1b[?1049halt\x1b[?1049l")).toBe("alt")
  expect(stripAnsi("\x1b[1Mhapus")).toBe("hapus")
  expect(stripAnsi("\x1b[38;2;1;2;3mwarna\x1b[39m")).toBe("warna")
})

test("theme: NO_COLOR mematikan semua warna, mengalahkan tema", () => {
  process.env.NO_COLOR = "1"
  applyTheme("dark")
  for (const slot of ["success", "error", "accent", "red", "bold", "muted"] as const) {
    expect(c[slot]("X")).toBe("X")
  }
  delete process.env.NO_COLOR
})
