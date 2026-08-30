// Sanitasi sekuens kontrol dari sumber tidak terpercaya.
//
// Ditemukan bug-hunter UI ronde 2: teks model diteruskan utuh ke terminal, jadi
// `aman\x1b[2J\x1b[H\x1b[?1049hJAHAT\x1b]0;bajak\x07` benar-benar membersihkan
// layar, keluar dari alternate screen, dan mengubah judul jendela.

import { describe, expect, test } from "bun:test"
import { sanitizeAnsi, sanitizeAnsiLine } from "../src/tui/sanitize.ts"

describe("sanitizeAnsi: yang DIPERTAHANKAN", () => {
  test("SGR warna sederhana", () => {
    expect(sanitizeAnsi("\x1b[32mhijau\x1b[39m")).toBe("\x1b[32mhijau\x1b[39m")
  })

  test("SGR truecolor & gabungan atribut", () => {
    const s = "\x1b[1;38;2;137;209;133mteks\x1b[0m"
    expect(sanitizeAnsi(s)).toBe(s)
  })

  test("SGR dengan pemisah titik dua (colon) tetap lewat", () => {
    const s = "\x1b[38:2:1:2:3mX\x1b[0m"
    expect(sanitizeAnsi(s)).toBe(s)
  })

  test("teks biasa, tab, dan newline tidak berubah", () => {
    expect(sanitizeAnsi("a\tb\nc")).toBe("a\tb\nc")
  })

  test("teks CJK/emoji utuh", () => {
    expect(sanitizeAnsi("这是中文 😀")).toBe("这是中文 😀")
  })
})

describe("sanitizeAnsi: yang DIBUANG", () => {
  test("clear screen & cursor home", () => {
    expect(sanitizeAnsi("a\x1b[2Jb\x1b[Hc")).toBe("abc")
  })

  test("alternate screen (merusak TUI)", () => {
    expect(sanitizeAnsi("a\x1b[?1049hb\x1b[?1049lc")).toBe("abc")
  })

  test("sembunyikan/tampilkan kursor", () => {
    expect(sanitizeAnsi("a\x1b[?25lb\x1b[?25hc")).toBe("abc")
  })

  test("gerakan kursor absolut & relatif", () => {
    expect(sanitizeAnsi("a\x1b[999Bb\x1b[10;20Hc\x1b[5Ad")).toBe("abcd")
  })

  test("OSC judul jendela (BEL maupun ST)", () => {
    expect(sanitizeAnsi("a\x1b]0;bajak\x07b")).toBe("ab")
    expect(sanitizeAnsi("a\x1b]0;bajak\x1b\\b")).toBe("ab")
  })

  test("synchronized output & scroll region", () => {
    expect(sanitizeAnsi("\x1b[?2026ha\x1b[?2026l")).toBe("a")
    expect(sanitizeAnsi("\x1b[1;10ra")).toBe("a")
  })

  test("erase line (menimpa apa yang sudah digambar)", () => {
    expect(sanitizeAnsi("a\x1b[2Kb\x1b[1Mc")).toBe("abc")
  })

  test("BEL, CR, dan backspace dibuang", () => {
    expect(sanitizeAnsi("a\u0007b")).toBe("ab")
    expect(sanitizeAnsi("baris\rtimpa")).toBe("baristimpa")
    expect(sanitizeAnsi("a\bb")).toBe("ab")
  })

  test("ESC + byte final (sekuens Fe/Fs) dibuang seluruhnya", () => {
    // Menurut ECMA-48, ESC diikuti 0x30–0x7E adalah sekuens dua byte
    // (ESC 7 simpan kursor, ESC c reset penuh, ESC M scroll balik).
    // Semuanya dibuang: ESC c bahkan me-reset terminal.
    expect(sanitizeAnsi("a\x1bcb")).toBe("ab")
    expect(sanitizeAnsi("a\x1b7b\x1b8c")).toBe("abc")
  })

  test("ESC di ujung string dibuang tanpa memakan teks", () => {
    expect(sanitizeAnsi("teks\x1b")).toBe("teks")
  })

  test("ESC + byte non-final hanya membuang ESC", () => {
    expect(sanitizeAnsi("a\x1b b")).toBe("a b")
  })

  test("charset switch (ESC ( B) dibuang", () => {
    expect(sanitizeAnsi("a\x1b(Bb")).toBe("ab")
  })

  test("DEL dibuang", () => {
    expect(sanitizeAnsi("a\u007fb")).toBe("ab")
  })
})

describe("sanitizeAnsi: serangan gabungan", () => {
  // Persis payload yang diverifikasi sampai ke terminal.
  test("payload nyata dari uji: clear + home + altscreen + OSC", () => {
    const jahat = "aman\x1b[2J\x1b[H\x1b[?1049hJAHAT\x1b]0;bajak\x07"
    const bersih = sanitizeAnsi(jahat)
    expect(bersih).toBe("amanJAHAT")
    expect(bersih).not.toContain("\x1b[2J")
    expect(bersih).not.toContain("\x1b[?1049h")
    expect(bersih).not.toContain("\x1b]0;")
  })

  test("warna tetap lewat di antara sekuens jahat", () => {
    const s = "\x1b[31mmerah\x1b[2J\x1b[39m"
    expect(sanitizeAnsi(s)).toBe("\x1b[31mmerah\x1b[39m")
  })

  test("sekuens terpotong di ujung tidak melempar & tidak bocor", () => {
    for (const s of ["a\x1b[", "a\x1b[3", "a\x1b]0;tanpa-penutup", "a\x1b"]) {
      const out = sanitizeAnsi(s)
      expect(out).not.toContain("\x1b")
      expect(out.startsWith("a")).toBe(true)
    }
  })

  test("banyak sekuens berturut-turut", () => {
    const s = `${"\x1b[2J".repeat(50)}teks${"\x1b[?25l".repeat(50)}`
    expect(sanitizeAnsi(s)).toBe("teks")
  })

  test("string kosong & tanpa escape", () => {
    expect(sanitizeAnsi("")).toBe("")
    expect(sanitizeAnsi("biasa saja")).toBe("biasa saja")
  })
})

describe("sanitizeAnsiLine", () => {
  test("newline jadi spasi", () => {
    expect(sanitizeAnsiLine("a\nb\nc")).toBe("a b c")
  })

  test("tetap membuang sekuens berbahaya", () => {
    expect(sanitizeAnsiLine("a\x1b[2J\nb")).toBe("a b")
  })

  test("warna tetap lewat", () => {
    expect(sanitizeAnsiLine("\x1b[32ma\x1b[39m")).toBe("\x1b[32ma\x1b[39m")
  })
})
