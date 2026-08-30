// Test permanen untuk temuan bug-hunter UI ronde 2: setiap komponen overlay
// harus menghormati ukuran terminal SUNGGUHAN (termasuk yang sangat kecil), dan
// teks dari model tidak boleh bisa mengendalikan terminal.

import { afterEach, describe, expect, test } from "bun:test"
import type { EventBus } from "#minicore/core/index.ts"
import { runPanel } from "../cli/panel.ts"
import { runPicker } from "../cli/picker.ts"
import { attachFullscreenMinimal } from "../src/tui/minimal/fullscreen.ts"
import { ESC, stripAnsi } from "../src/tui/theme.ts"
import { displayWidth } from "../src/tui/width.ts"
import { createFakeBus, type FakeTty, installFakeTty, KEY } from "./helpers/tui-harness.ts"

let tty: FakeTty | undefined
afterEach(() => {
  tty?.restore()
  tty = undefined
})

const lines = (t: FakeTty) => stripAnsi(t.all()).split("\n")
const widest = (t: FakeTty) => Math.max(...lines(t).map((l) => displayWidth(l)))

describe("picker: menghormati ukuran terminal", () => {
  test("label CJK panjang dipotong ke lebar kolom", async () => {
    tty = installFakeTty({ columns: 40, rows: 20 })
    const p = runPicker({
      title: "Uji",
      items: [
        { name: "这是一个非常长的中文模型名称需要被截断处理", provider: "提供者", value: "a" },
        { name: "b".repeat(120), provider: "p", value: "b" },
      ],
      onPick: () => {},
      onCancel: () => {},
    })
    await tty.ready()
    expect(widest(tty)).toBeLessThanOrEqual(40)
    await tty.send(KEY.esc, 30)
    await p
  })

  test("terminal 3 baris tidak dilampaui", async () => {
    tty = installFakeTty({ columns: 60, rows: 3 })
    const items = Array.from({ length: 30 }, (_, i) => ({
      name: `m${i}`,
      provider: "p",
      value: `${i}`,
    }))
    const p = runPicker({ title: "Pendek", items, onPick: () => {}, onCancel: () => {} })
    await tty.ready()
    const drawn = lines(tty).filter((l) => l.trim() !== "").length
    expect(drawn).toBeLessThanOrEqual(3)
    await tty.send(KEY.esc, 30)
    await p
  })

  test("resize mengecil langsung diikuti", async () => {
    tty = installFakeTty({ columns: 80, rows: 24 })
    const items = Array.from({ length: 40 }, (_, i) => ({
      name: `model-${i}`,
      provider: "provider-panjang",
      value: `${i}`,
    }))
    const p = runPicker({ title: "R", items, onPick: () => {}, onCancel: () => {} })
    await tty.ready()
    tty.clear()
    tty.resize(40, 10)
    await tty.send("", 40)
    expect(widest(tty)).toBeLessThanOrEqual(40)
    await tty.send(KEY.esc, 30)
    await p
  })

  test("filter dengan metakarakter regex tidak melempar", async () => {
    tty = installFakeTty({ rows: 20 })
    const p = runPicker({
      title: "T",
      items: [{ name: "a.b", provider: "p", value: "1" }],
      filterable: true,
      onPick: () => {},
      onCancel: () => {},
    })
    await tty.ready()
    for (const ch of "([{*+?^$|\\") await tty.send(ch, 3)
    // Tidak melempar = sampai di sini.
    await tty.send(KEY.esc, 20)
    await tty.send(KEY.esc, 20)
    await p
  })

  test("daftar kosong: Enter memanggil onCancel", async () => {
    tty = installFakeTty({ rows: 20 })
    let hasil: string | null | undefined
    const p = runPicker({
      title: "Kosong",
      items: [],
      onPick: (v) => {
        hasil = v
      },
      onCancel: () => {
        hasil = null
      },
    })
    await tty.ready()
    await tty.send(KEY.enter, 40)
    await p
    expect(hasil).toBeNull()
  })
})

describe("panel: menghormati ukuran terminal", () => {
  test("baris CJK & panjang dipotong ke lebar kolom", async () => {
    tty = installFakeTty({ columns: 40, rows: 16 })
    const p = runPanel({ title: "P", lines: ["这是中文".repeat(15), "x".repeat(150)] })
    await tty.ready()
    expect(widest(tty)).toBeLessThanOrEqual(40)
    await tty.send(KEY.enter, 30)
    await p
  })

  test("indikator posisi tidak melewati total", async () => {
    tty = installFakeTty({ columns: 60, rows: 12 })
    const p = runPanel({
      title: "S",
      lines: Array.from({ length: 30 }, (_, i) => `baris ${i + 1}`),
    })
    await tty.ready()
    for (let i = 0; i < 60; i++) await tty.send(KEY.down, 2)
    const teks = stripAnsi(tty.all())
    for (const m of teks.matchAll(/(\d+)\/(\d+)/g)) {
      expect(Number(m[1]), m[0]).toBeLessThanOrEqual(Number(m[2]))
    }
    await tty.send(KEY.esc, 30)
    await p
  })
})

describe("fullscreen: terminal ekstrem & teks tidak terpercaya", () => {
  function shell(opts: { columns?: number; rows?: number; overlay?: string[] } = {}) {
    const t = installFakeTty({ columns: opts.columns ?? 80, rows: opts.rows ?? 24 })
    const bus = createFakeBus()
    const s = attachFullscreenMinimal({
      bus: bus as unknown as EventBus,
      model: () => "m",
      cwdName: "c",
      initialMode: "auto",
      usage: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      onCycleMode: () => "auto",
      suggestions: (l: string) => (l.startsWith("/") ? [{ text: "/help", group: "c" }] : []),
      history: () => [],
      onLine: async () => "prompt",
      onPicker: async () => null,
      onOverlay: async () => (opts.overlay ? { title: "ov", lines: opts.overlay } : null),
      onExit: async () => {},
    })
    return { tty: t, bus, detach: () => s.detach() }
  }

  test("terminal 10x5 tidak dilampaui", async () => {
    const h = shell({ columns: 10, rows: 5 })
    tty = h.tty
    await h.tty.ready()
    h.bus.emit("turn:started", { turn: 1 })
    h.bus.emit("provider:text", { text: "teks panjang sekali yang tidak muat\n" })
    await h.tty.send("", 60)
    const frame = h.tty.lastFrame().split("\n")
    expect(frame.length).toBeLessThanOrEqual(5)
    for (const l of frame) expect(displayWidth(stripAnsi(l))).toBeLessThanOrEqual(10)
    h.detach()
  })

  test("overlay dengan baris CJK/panjang tetap di dalam frame", async () => {
    const h = shell({ columns: 40, rows: 16, overlay: ["这是中文".repeat(20), "y".repeat(200)] })
    tty = h.tty
    await h.tty.ready()
    await h.tty.send("/help")
    await h.tty.send(KEY.enter, 80)
    const frame = stripAnsi(h.tty.lastFrame()).split("\n")
    expect(frame.length).toBeLessThanOrEqual(16)
    for (const l of frame) expect(displayWidth(l)).toBeLessThanOrEqual(40)
    h.detach()
  })

  test("resize berulang saat streaming tetap dalam batas", async () => {
    const h = shell({ columns: 80, rows: 24 })
    tty = h.tty
    await h.tty.ready()
    h.bus.emit("turn:started", { turn: 1 })
    for (const [w, r] of [
      [40, 12],
      [120, 40],
      [20, 6],
      [80, 24],
    ] as [number, number][]) {
      h.tty.resize(w, r)
      h.bus.emit("provider:text", { text: `ukuran ${w}x${r}\n` })
      await h.tty.send("", 30)
      const frame = h.tty.lastFrame().split("\n")
      expect(frame.length, `${w}x${r} tinggi`).toBeLessThanOrEqual(r)
      for (const l of frame) {
        expect(displayWidth(stripAnsi(l)), `${w}x${r} lebar`).toBeLessThanOrEqual(w)
      }
    }
    h.detach()
  })

  // Teks model adalah masukan tidak terpercaya. Tanpa sanitasi ia bisa
  // membersihkan layar, keluar dari alternate screen, atau mengubah judul
  // jendela — terverifikasi sampai ke terminal sebelum diperbaiki.
  test("sekuens kontrol dari model tidak diteruskan ke terminal", async () => {
    const h = shell()
    tty = h.tty
    await h.tty.ready()
    h.bus.emit("turn:started", { turn: 1 })
    h.bus.emit("provider:text", {
      text: "aman\x1b[2J\x1b[H\x1b[?1049hJAHAT\x1b]0;bajak\x07\x1b[?25l\n",
    })
    await h.tty.send("", 60)
    const frame = h.tty.lastFrame()
    // Frame sendiri dimulai dengan clear+home dari renderer; periksa sisanya.
    const body = frame.slice(10)
    expect(body).not.toContain("\x1b[2J")
    expect(body).not.toContain("\x1b[?1049h")
    expect(body).not.toContain("\x1b]0;")
    expect(body).not.toContain("\x1b[?25l")
    // Teksnya tetap tampil.
    expect(stripAnsi(frame)).toContain("amanJAHAT")
    h.detach()
  })

  test("hasil tool juga disanitasi", async () => {
    const h = shell()
    tty = h.tty
    await h.tty.ready()
    h.bus.emit("execution:completed", {
      execution: {
        call: { name: "bash", args: { cmd: "cat berkas\x1b[2J" } },
        result: { isError: true, content: "gagal\x1b[?1049l\x1b]0;x\x07" },
      },
    })
    await h.tty.send("", 60)
    const body = h.tty.lastFrame().slice(10)
    expect(body).not.toContain("\x1b[2J")
    expect(body).not.toContain("\x1b[?1049l")
    expect(body).not.toContain("\x1b]0;")
    h.detach()
  })

  test("warna dari diff card tetap lewat setelah sanitasi", async () => {
    const h = shell()
    tty = h.tty
    await h.tty.ready()
    h.bus.emit("execution:completed", {
      execution: {
        call: { name: "edit", args: { path: "a.ts", oldString: "a\nb", newString: "a\nc" } },
        result: { isError: false, content: "" },
      },
    })
    await h.tty.send("", 60)
    // Masih ada sekuens SGR (warna) — sanitasi tidak membuang pewarnaan.
    expect(h.tty.lastFrame()).toMatch(new RegExp(`${ESC}\\[[0-9;]*m`))
    h.detach()
  })
})

// Terminal tanpa dukungan VT (TERM=dumb, Emacs shell, CI log) akan MENAMPILKAN
// sekuens sebagai teks sampah. isTTY saja tidak menjamin dukungan VT.
describe("screen: dukungan VT diperiksa sebelum menulis sekuens", () => {
  const origTerm = process.env.TERM
  const origWt = process.env.WT_SESSION
  const origNoAlt = process.env.MINICODE_NO_ALT

  afterEach(() => {
    if (origTerm == null) delete process.env.TERM
    else process.env.TERM = origTerm
    if (origWt == null) delete process.env.WT_SESSION
    else process.env.WT_SESSION = origWt
    if (origNoAlt == null) delete process.env.MINICODE_NO_ALT
    else process.env.MINICODE_NO_ALT = origNoAlt
  })

  test("TERM=dumb: tidak ada sekuens alternate-screen ditulis", async () => {
    tty = installFakeTty({ vt: false })
    process.env.TERM = "dumb"
    delete process.env.WT_SESSION
    const { enterAlternate, hideCursor, exitAlternate, supportsVt } = await import(
      "../src/tui/minimal/screen.ts"
    )
    expect(supportsVt()).toBe(false)
    tty.clear()
    enterAlternate()
    hideCursor()
    exitAlternate()
    expect(tty.all()).toBe("")
  })

  test("MINICODE_NO_ALT=1 mematikan alternate screen secara manual", async () => {
    tty = installFakeTty()
    process.env.MINICODE_NO_ALT = "1"
    const { enterAlternate, supportsVt } = await import("../src/tui/minimal/screen.ts")
    expect(supportsVt()).toBe(false)
    tty.clear()
    enterAlternate()
    expect(tty.all()).toBe("")
  })

  test("terminal modern: sekuens tetap ditulis", async () => {
    tty = installFakeTty()
    process.env.TERM = "xterm-256color"
    delete process.env.MINICODE_NO_ALT
    const { enterAlternate, supportsVt } = await import("../src/tui/minimal/screen.ts")
    expect(supportsVt()).toBe(true)
    tty.clear()
    enterAlternate()
    expect(tty.all()).toContain("\x1b[?1049h")
  })

  test("non-TTY: tidak ada sekuens", async () => {
    tty = installFakeTty({ isTTY: false })
    const { enterAlternate, supportsVt } = await import("../src/tui/minimal/screen.ts")
    expect(supportsVt()).toBe(false)
    tty.clear()
    enterAlternate()
    expect(tty.all()).toBe("")
  })

  test("getSize memberi nilai bawaan yang wajar", async () => {
    tty = installFakeTty({ columns: 111, rows: 33 })
    const { getSize } = await import("../src/tui/minimal/screen.ts")
    expect(getSize()).toEqual({ width: 111, height: 33 })
  })
})
