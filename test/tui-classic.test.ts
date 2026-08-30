// Test lapisan interaktif klasik: askLine (input + dropdown), runPicker,
// runPanel, runProviderManager. Semuanya sebelumnya nol cakupan.
//
// Berbeda dari fullscreen, komponen ini menggambar overlay relatif terhadap
// posisi kursor (bukan alternate screen), jadi assertion dilakukan pada seluruh
// output yang terkumpul, bukan pada "frame" tunggal.
//
// Selalu `await tty.ready()` setelah memanggil komponen: semuanya melakukan
// await (dynamic import / loadHistory / loadConfig) sebelum memasang listener
// stdin, dan keystroke yang dikirim sebelum itu hilang tanpa jejak.

import { afterEach, describe, expect, test } from "bun:test"
import { askLine } from "../cli/input.ts"
import { captureOutput, runPanel } from "../cli/panel.ts"
import { runPicker } from "../cli/picker.ts"
import { runProviderManager } from "../cli/provider-manager.ts"
import { stripAnsi } from "../src/tui/theme.ts"
import { type FakeTty, installFakeTty, KEY } from "./helpers/tui-harness.ts"

let tty: FakeTty | undefined

afterEach(() => {
  tty?.restore()
  tty = undefined
})

const CMDS = ["/help", "/model", "/models", "/sessions", "/status", "/sync"]
const hints = (line: string) => (line.startsWith("/") ? CMDS.filter((c) => c.startsWith(line)) : [])

const visible = (t: FakeTty): string => stripAnsi(t.all())
const SELECTED = /\u203a\s+/ // glyph "›" penanda baris terpilih

describe("askLine: dropdown & seleksi", () => {
  test("mengetik '/s' menampilkan hanya yang cocok", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> ", hints })
    await tty.ready()
    tty.clear()
    await tty.send("/s")
    const out = visible(tty)
    expect(out).toContain("/sync")
    expect(out).toContain("/status")
    expect(out).toContain("/sessions")
    expect(out).not.toContain("/help")
    await tty.send(KEY.ctrlC, 20)
    await p
  })

  test("panah bawah menandai baris terpilih", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> ", hints })
    await tty.ready()
    await tty.send("/s")
    tty.clear()
    await tty.send(KEY.down)
    expect(visible(tty)).toMatch(SELECTED)
    await tty.send(KEY.ctrlC, 20)
    await p
  })

  test("Enter dengan seleksi mengembalikan item terpilih", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> ", hints })
    await tty.ready()
    await tty.send("/s")
    await tty.send(KEY.down) // item pertama yang cocok: /sessions
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("/sessions")
  })

  test("Enter tanpa seleksi mengembalikan teks apa adanya", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("halo dunia")
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("halo dunia")
  })

  test("Ctrl+C mengembalikan null (batal), bukan string kosong", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("apa saja")
    await tty.send(KEY.ctrlC, 30)
    expect(await p).toBeNull()
  })

  test("Enter pada baris kosong mengembalikan string kosong, bukan null", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("")
  })

  test("header grup muncul saat groupOf diberikan", async () => {
    tty = installFakeTty()
    const p = askLine({
      prompt: "> ",
      hints,
      groupOf: (t) => (t === "/model" || t === "/models" ? "models" : "commands"),
    })
    await tty.ready()
    tty.clear()
    await tty.send("/m")
    expect(visible(tty)).toContain("MODELS")
    await tty.send(KEY.ctrlC, 20)
    await p
  })

  test("Tab melengkapi item yang dipilih, bukan selalu yang pertama", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> ", hints })
    await tty.ready()
    await tty.send("/s")
    await tty.send(KEY.down) // /sessions
    await tty.send(KEY.down) // /status
    await tty.send(KEY.tab)
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("/status")
  })

  test("Esc menutup dropdown tanpa mengubah baris", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> ", hints })
    await tty.ready()
    await tty.send("/s")
    await tty.send(KEY.esc)
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("/s")
  })
})

describe("askLine: editing baris", () => {
  test("panah kiri lalu mengetik menyisipkan di tengah", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("abcdef")
    await tty.send(KEY.left)
    await tty.send(KEY.left)
    await tty.send(KEY.left)
    await tty.send("X")
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("abcXdef")
  })

  test("Ctrl+A ke awal, Ctrl+E ke akhir", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("dunia")
    await tty.send(KEY.ctrlA)
    await tty.send("halo ")
    await tty.send(KEY.ctrlE)
    await tty.send("!")
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("halo dunia!")
  })

  test("backspace menghapus sebelum kursor, bukan di ujung", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("abcd")
    await tty.send(KEY.left)
    await tty.send(KEY.backspace)
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("abd")
  })

  test("Ctrl+W menghapus kata sebelum kursor", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("satu dua tiga")
    await tty.send(KEY.ctrlW)
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("satu dua")
  })

  test("Ctrl+U mengosongkan baris", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("teks panjang sekali")
    await tty.send(KEY.ctrlU)
    await tty.send("baru")
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("baru")
  })

  test("emoji tetap utuh saat dihapus", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("a\u{1F600}b")
    await tty.send(KEY.backspace) // hapus 'b'
    await tty.send(KEY.backspace) // hapus emoji utuh
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("a")
  })

  test("paste bracketed masuk sebagai satu isian", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send(KEY.paste("teks hasil paste"))
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("teks hasil paste")
  })
})

describe("askLine: history", () => {
  test("panah atas mengganti baris, tidak menggabungkan", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("teks saya")
    tty.clear()
    await tty.send(KEY.up, 30)
    // Apa pun isi history mesin ini, hasilnya tidak boleh "teks saya <history>".
    expect(visible(tty)).not.toMatch(/teks saya \S/)
    await tty.send(KEY.ctrlC, 20)
    await p
  })
})

describe("askLine: mouse tidak mencemari input", () => {
  test("byte klik mouse dibuang, bukan jadi teks", async () => {
    tty = installFakeTty()
    const p = askLine({ prompt: "> " })
    await tty.ready()
    await tty.send("teks")
    await tty.send(KEY.mouseClick)
    await tty.send(KEY.enter, 30)
    expect(await p).toBe("teks")
  })
})

describe("runPicker", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    name: `model-${i}`,
    provider: i % 2 ? "prov-a" : "prov-b",
    value: `p::model-${i}`,
  }))

  test("render awal menampilkan judul dan item pertama tersorot", async () => {
    tty = installFakeTty({ rows: 24 })
    let picked: string | null | undefined
    const p = runPicker({
      title: "Select Model",
      items,
      filterable: true,
      onPick: (v) => {
        picked = v
      },
      onCancel: () => {
        picked = null
      },
    })
    await tty.ready()
    const out = visible(tty)
    expect(out).toContain("Select Model")
    expect(out).toContain("model-0")
    expect(out).toMatch(SELECTED)
    await tty.send(KEY.esc, 20)
    await p
    expect(picked).toBeNull()
  })

  test("filter menyaring daftar", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runPicker({
      title: "Select Model",
      items,
      filterable: true,
      onPick: () => {},
      onCancel: () => {},
    })
    await tty.ready()
    tty.clear()
    await tty.send("model-31")
    const out = visible(tty)
    expect(out).toContain("model-31")
    expect(out).not.toContain("model-0 ")
    await tty.send(KEY.esc, 20)
    await tty.send(KEY.esc, 20)
    await p
  })

  test("filter tanpa hasil memberi pesan; Enter membatalkan", async () => {
    tty = installFakeTty({ rows: 24 })
    let picked: string | null | undefined
    const p = runPicker({
      title: "Select Model",
      items,
      filterable: true,
      onPick: (v) => {
        picked = v
      },
      onCancel: () => {
        picked = null
      },
    })
    await tty.ready()
    tty.clear()
    await tty.send("zzzz")
    expect(visible(tty)).toContain("tidak ada yang cocok")
    await tty.send(KEY.enter, 20)
    await p
    expect(picked).toBeNull()
  })

  test("Esc pertama membersihkan filter, Esc kedua keluar", async () => {
    tty = installFakeTty({ rows: 24 })
    let canceled = false
    const p = runPicker({
      title: "Select Model",
      items,
      filterable: true,
      onPick: () => {},
      onCancel: () => {
        canceled = true
      },
    })
    await tty.ready()
    await tty.send("model-1")
    await tty.send(KEY.esc, 20)
    expect(canceled).toBe(false)
    await tty.send(KEY.esc, 20)
    await p
    expect(canceled).toBe(true)
  })

  test("panah bawah lalu Enter memilih item kedua", async () => {
    tty = installFakeTty({ rows: 24 })
    let picked = ""
    const p = runPicker({
      title: "t",
      items: items.slice(0, 3),
      onPick: (v) => {
        picked = v
      },
      onCancel: () => {},
    })
    await tty.ready()
    await tty.send(KEY.down)
    await tty.send(KEY.enter, 20)
    await p
    expect(picked).toBe("p::model-1")
  })

  test("daftar lebih panjang dari layar menampilkan indikator sisa", async () => {
    tty = installFakeTty({ rows: 16 })
    const p = runPicker({ title: "t", items, onPick: () => {}, onCancel: () => {} })
    await tty.ready()
    expect(visible(tty)).toContain("lagi")
    await tty.send(KEY.esc, 20)
    await p
  })

  test("fallback non-TTY mencetak daftar bernomor", async () => {
    tty = installFakeTty({ isTTY: false })
    await runPicker({
      title: "Pilih",
      items: items.slice(0, 2),
      onPick: () => {},
      onCancel: () => {},
    })
    const out = visible(tty)
    expect(out).toContain("Pilih")
    expect(out).toContain("[0]")
    expect(out).toContain("[1]")
  })

  test("memulihkan kursor saat keluar", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runPicker({
      title: "t",
      items: items.slice(0, 2),
      onPick: () => {},
      onCancel: () => {},
    })
    await tty.ready()
    tty.clear()
    await tty.send(KEY.esc, 20)
    await p
    expect(tty.all()).toContain("\x1b[?25h")
  })
})

describe("runPanel", () => {
  test("menampilkan judul dan isi; Enter menutup", async () => {
    tty = installFakeTty({ rows: 20 })
    const p = runPanel({ title: "Bantuan", lines: ["baris satu", "baris dua"] })
    await tty.ready()
    const out = visible(tty)
    expect(out).toContain("Bantuan")
    expect(out).toContain("baris satu")
    await tty.send(KEY.enter, 20)
    await p
  })

  test("isi lebih panjang dari layar bisa di-scroll", async () => {
    tty = installFakeTty({ rows: 12 })
    const lines = Array.from({ length: 40 }, (_, i) => `baris ${i + 1}`)
    const p = runPanel({ title: "Panjang", lines })
    await tty.ready()
    tty.clear()
    for (let i = 0; i < 6; i++) await tty.send(KEY.down, 5)
    expect(visible(tty)).toContain("baris 7")
    await tty.send(KEY.esc, 20)
    await p
  })

  test("tidak melebihi tinggi terminal", async () => {
    tty = installFakeTty({ rows: 12 })
    const lines = Array.from({ length: 60 }, (_, i) => `baris ${i + 1}`)
    const p = runPanel({ title: "Panjang", lines })
    await tty.ready()
    const drawn = visible(tty)
      .split("\n")
      .filter((l) => l.trim() !== "").length
    expect(drawn).toBeLessThanOrEqual(12)
    await tty.send(KEY.esc, 20)
    await p
  })

  test("fallback non-TTY mencetak semua baris", async () => {
    tty = installFakeTty({ isTTY: false })
    await runPanel({ title: "T", lines: ["a", "b"] })
    const out = visible(tty)
    expect(out).toContain("T")
    expect(out).toContain("a")
    expect(out).toContain("b")
  })
})

describe("runProviderManager", () => {
  test("fallback non-TTY mendaftar provider tanpa raw mode", async () => {
    tty = installFakeTty({ isTTY: false })
    await runProviderManager({ cwd: process.cwd() })
    expect(tty.all()).toBeTypeOf("string")
  })

  test("Esc menutup manager tanpa mengubah model", async () => {
    tty = installFakeTty({ rows: 24 })
    let overridden: string | undefined
    const p = runProviderManager({
      cwd: process.cwd(),
      setModelOverride: (m) => {
        overridden = m
      },
    })
    await tty.ready()
    expect(visible(tty)).toContain("Provider")
    await tty.send(KEY.esc, 30)
    await p
    expect(overridden).toBeUndefined()
  })

  test("footer menyebut pintasan a/d/e", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runProviderManager({ cwd: process.cwd() })
    await tty.ready()
    const out = visible(tty)
    expect(out).toContain("tambah")
    expect(out).toContain("hapus")
    expect(out).toContain("ubah")
    await tty.send(KEY.esc, 30)
    await p
  })
})

describe("captureOutput", () => {
  test("menangkap console.log dan stdout.write, lalu memulihkan keduanya", async () => {
    const origLog = console.log
    const { lines, value } = await captureOutput(async () => {
      console.log("satu")
      process.stdout.write("dua\n")
      return { handled: true as const }
    })
    expect(lines).toContain("satu")
    expect(lines).toContain("dua")
    expect(value.handled).toBe(true)
    expect(console.log).toBe(origLog)
  })

  test("memulihkan stdout meski fn melempar", async () => {
    const origLog = console.log
    await expect(
      captureOutput(async () => {
        console.log("x")
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(console.log).toBe(origLog)
  })

  test("membuang sekuens ANSI termasuk private-mode", async () => {
    const { lines } = await captureOutput(async () => {
      console.log("\x1b[32mhijau\x1b[0m")
      process.stdout.write("\x1b[?25lkursor\x1b[?25h\n")
    })
    expect(lines).toContain("hijau")
    expect(lines).toContain("kursor")
  })
})
