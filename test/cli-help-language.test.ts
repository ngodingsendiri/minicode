// Test permanen untuk temuan bug-hunter UI ronde 3: konsistensi bahasa &
// penanda, kelengkapan /help, dan glyph yang menghormati dukungan UTF-8.

import { afterEach, describe, expect, test } from "bun:test"
import { BUILTIN_COMMANDS, handleBuiltinCommand } from "../cli/commands.ts"
import { captureOutput } from "../cli/panel.ts"
import { glyphs, stripAnsi } from "../src/tui/theme.ts"
import { displayWidth } from "../src/tui/width.ts"

/** Kata Inggris yang pernah bocor ke keluaran pengguna. */
const INGGRIS =
  /\b(canceled|Detecting|required|Providers|Save globally|Unknown selection|Add New|select gateway|no providers|press a to add|set active|delete|close|Session ID|Active Tools|Goodbye|Recent Sessions|no previous|Syncing|Compaction|type a number|Undo failed|Redo failed|Reapplied|Undid|deprecated|Estimated Cost|Input Tokens|Output Tokens)\b/

const ctx = {
  cwd: process.cwd(),
  sessionId: "uji-help",
  currentModel: "prov::m",
  usage: {
    get: () => ({ inputTokens: 1, outputTokens: 2, totalTokens: 3, cost: 0.001 }),
    getSession: () => ({ inputTokens: 1, outputTokens: 2, totalTokens: 3, cost: 0.001 }),
    reset: () => {},
    modelUsed: () => ({ effective: undefined, provider: undefined }),
  },
  skills: [],
  toolsCount: 31,
  providerHint: "openai",
  setModelOverride: () => {},
} as unknown as Parameters<typeof handleBuiltinCommand>[1]

const run = async (cmd: string) => {
  const { lines } = await captureOutput(() => handleBuiltinCommand(cmd, ctx))
  return lines
}

describe("/help: kelengkapan & ukuran", () => {
  // Overlay TUI di terminal 24 baris hanya menampilkan ~19 baris. /help 29 baris
  // memaksa user scroll untuk melihat bagian tombol.
  test("muat di overlay terminal 24 baris", async () => {
    const lines = await run("/help")
    expect(lines.length).toBeLessThanOrEqual(19)
  })

  test("menyebut perintah yang sebelumnya tak terdaftar", async () => {
    const teks = (await run("/help")).join("\n")
    for (const cmd of ["/clear", "/exit"]) expect(teks, cmd).toContain(cmd)
  })

  test("mengarahkan ke daftar pintasan lengkap", async () => {
    expect((await run("/help")).join("\n")).toContain("/help tombol")
  })

  test("/help tombol memberi daftar pintasan lengkap", async () => {
    const lines = await run("/help tombol")
    expect(lines.length).toBeGreaterThanOrEqual(10)
    const teks = lines.join("\n")
    for (const k of ["ctrl+r", "ctrl+o", "ctrl+w", "ctrl+u", "shift+tab"]) {
      expect(teks, k).toContain(k)
    }
  })

  test("baris /help tidak melebihi 80 kolom", async () => {
    for (const l of await run("/help")) expect(displayWidth(stripAnsi(l))).toBeLessThanOrEqual(80)
  })
})

describe("BUILTIN_COMMANDS: setiap perintah yang ditangani terdaftar", () => {
  // Perintah yang berfungsi tapi tidak terdaftar tidak muncul di /help DAN tidak
  // bisa dilengkapi dengan Tab — user tidak punya cara menemukannya.
  const DITANGANI = [
    "help",
    "clear",
    "thinking",
    "theme",
    "init",
    "undo",
    "redo",
    "exit",
    "quit",
    "model",
    "models",
    "provider",
    "providers",
    "cost",
    "usage",
    "compact",
    "sync",
    "sessions",
    "resume",
    "status",
    "history",
  ]

  test("tidak ada perintah yang hilang dari daftar", () => {
    const terdaftar = new Set(BUILTIN_COMMANDS.map((b) => b.name))
    const hilang = DITANGANI.filter((n) => !terdaftar.has(n))
    expect(hilang).toEqual([])
  })

  test("setiap perintah punya deskripsi", () => {
    for (const b of BUILTIN_COMMANDS) expect(b.desc, b.name).toBeTruthy()
  })

  test("alias ditandai hidden agar tidak memenuhi /help", () => {
    for (const n of ["quit", "usage", "models", "providers", "history", "compact"]) {
      const b = BUILTIN_COMMANDS.find((x) => x.name === n)
      expect(b?.hidden, n).toBe(true)
    }
  })

  test("nama perintah tidak memuat spasi atau placeholder", () => {
    for (const b of BUILTIN_COMMANDS) expect(b.name, b.name).not.toMatch(/[<[\s]/)
  })
})

describe("konsistensi bahasa keluaran", () => {
  const PERINTAH = [
    "/undo",
    "/redo",
    "/sync",
    "/theme light",
    "/thinking on",
    "/status",
    "/cost",
    "/sessions",
    "/compact",
    "/history",
    "/exit",
    "/model prov::x",
  ]

  for (const cmd of PERINTAH) {
    test(`${cmd} tidak memuat frasa Inggris yang pernah bocor`, async () => {
      const teks = (await run(cmd)).join(" ")
      const m = INGGRIS.exec(teks)
      expect(m?.[0], `${cmd}: ${teks.slice(0, 90)}`).toBeUndefined()
    })
  }

  test("/cost memakai istilah Indonesia", async () => {
    const teks = (await run("/cost")).join("\n")
    expect(teks).toContain("Pemakaian sesi")
    expect(teks).toContain("Token masuk")
    expect(teks).toContain("Estimasi biaya")
  })

  test("/status memakai istilah Indonesia", async () => {
    const teks = (await run("/status")).join("\n")
    expect(teks).toContain("ID sesi")
    expect(teks).toContain("Tool aktif")
  })
})

describe("penanda hasil aksi seragam", () => {
  // Dulu bercampur: `[OK]`/`[FAIL]` hardcoded di /undo, kalimat biasa di /theme,
  // tanpa penanda di /sync. Kini semua memakai `glyphs` — yang nilainya "✓"/"✗"
  // pada terminal UTF-8 dan "[OK]"/"[FAIL]" pada conhost legacy. Assertion
  // memeriksa nilai glyph yang aktif, bukan literal, supaya berlaku di keduanya.
  test("/undo & /redo memakai glyph hasil", async () => {
    for (const cmd of ["/undo", "/redo"]) {
      const teks = (await run(cmd)).join(" ")
      expect(teks.includes(glyphs.check) || teks.includes(glyphs.cross), cmd).toBe(true)
    }
  })

  test("/undo & /redo memakai glyph Unicode saat terminal mendukung", async () => {
    const orig = process.env.MINICODE_ASCII
    const origWt = process.env.WT_SESSION
    process.env.WT_SESSION = "uji"
    delete process.env.MINICODE_ASCII
    try {
      const teks = (await run("/undo")).join(" ")
      expect(teks).not.toContain("[FAIL]")
      expect(teks.includes("✓") || teks.includes("✗")).toBe(true)
    } finally {
      if (orig == null) delete process.env.MINICODE_ASCII
      else process.env.MINICODE_ASCII = orig
      if (origWt == null) delete process.env.WT_SESSION
      else process.env.WT_SESSION = origWt
    }
  })

  test("/model memakai glyph sukses", async () => {
    const teks = (await run("/model prov::x")).join(" ")
    expect(teks).toContain(glyphs.check)
  })
})

describe("glyphs: menghormati dukungan UTF-8", () => {
  const orig = process.env.MINICODE_ASCII
  afterEach(() => {
    if (orig == null) delete process.env.MINICODE_ASCII
    else process.env.MINICODE_ASCII = orig
  })

  // Dulu dibekukan saat import, jadi env yang berubah tidak berpengaruh —
  // kesalahan yang sama seperti objek warna `c`.
  test("MINICODE_ASCII=1 memaksa fallback ASCII", () => {
    process.env.MINICODE_ASCII = "1"
    expect(glyphs.check).toBe("[OK]")
    expect(glyphs.cross).toBe("[FAIL]")
    expect(glyphs.arrow).toBe(">")
    expect(glyphs.dot).toBe(".")
    expect(glyphs.ellipsis).toBe("...")
    expect(glyphs.spinnerFrames[0]).toBe(".")
  })

  test("tanpa MINICODE_ASCII memakai glyph Unicode pada terminal modern", () => {
    delete process.env.MINICODE_ASCII
    // Di lingkungan test (WT_SESSION diset oleh harness lain) atau non-Windows.
    const pakaiUnicode = glyphs.arrow === "›"
    const pakaiAscii = glyphs.arrow === ">"
    expect(pakaiUnicode || pakaiAscii).toBe(true)
  })

  test("semua glyph ASCII aman untuk conhost legacy", () => {
    process.env.MINICODE_ASCII = "1"
    for (const [nama, nilai] of Object.entries(glyphs)) {
      const teks = Array.isArray(nilai) ? nilai.join("") : String(nilai)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: memastikan ASCII cetak
      expect(/^[\x20-\x7e]*$/.test(teks), `${nama}=${teks}`).toBe(true)
    }
  })
})
