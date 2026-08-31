// Test lapisan TUI fullscreen — sebelumnya nol cakupan, dan itu sebabnya bug
// rekursi spinner (REPL mati bisu pada prompt pertama) lolos ke main.
//
// Semua test memakai fake TTY: keystroke disuntik, frame stdout ditangkap.
// Assertion dilakukan pada teks yang terlihat, bukan pada urutan sekuens ANSI,
// supaya test tidak pecah saat tata letak digeser sedikit.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { EventBus } from "#minicore/core/index.ts"
import { attachFullscreenMinimal } from "../src/tui/minimal/fullscreen.ts"
import { ESC, stripAnsi } from "../src/tui/theme.ts"
import { createFakeBus, type FakeTty, installFakeTty, KEY } from "./helpers/tui-harness.ts"

/** Regex "ada sekuens SGR sebelum teks ini" — dibangun tanpa literal control char. */
const sgrBefore = (text: string) => new RegExp(`${ESC}\\[[0-9;]*m\\s*${text}`)

interface Harness {
  tty: FakeTty
  bus: ReturnType<typeof createFakeBus>
  detach(): void
  log: string[]
  mode(): string
  /** Selesaikan onLine yang sedang berjalan (mensimulasikan LLM membalas). */
  finishRun(): void
  cost: { value?: number }
}

const BUILTIN = ["/help", "/provider", "/model", "/sync", "/sessions", "/status", "/init", "/exit"]

interface SetupOptions {
  columns?: number
  rows?: number
  /** onLine menggantung sampai finishRun() dipanggil — meniru LLM yang lambat. */
  slowRun?: boolean
  overlayLines?: number
  history?: string[]
  budget?: number
}

function setup(opts: SetupOptions = {}): Harness {
  const tty = installFakeTty({ columns: opts.columns ?? 100, rows: opts.rows ?? 30 })
  const bus = createFakeBus()
  const log: string[] = []
  let mode = "auto"
  let release: (() => void) | undefined
  const cost: { value?: number } = {}

  const shell = attachFullscreenMinimal({
    bus: bus as unknown as EventBus,
    model: () => "prov::model-x",
    cwdName: "C:/work",
    initialMode: mode,
    ...(opts.budget != null ? { budget: opts.budget } : {}),
    usage: () => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      ...(cost.value != null ? { cost: cost.value } : {}),
    }),
    onCycleMode: () => {
      mode = mode === "auto" ? "ask" : mode === "ask" ? "plan" : "auto"
      return mode
    },
    // Cermin cli/fullscreen-driver.ts: daftar SUDAH difilter berdasar prefix.
    suggestions: (line: string) => {
      if (!line.startsWith("/")) return []
      const all = [
        ...BUILTIN.map((text) => ({ text, group: "commands" })),
        { text: "/review", group: "skills" },
        { text: "/spec", group: "skills" },
      ]
      return all.filter((s) => s.text.startsWith(line))
    },
    history: () => opts.history ?? ["prompt lama satu", "prompt lama dua"],
    onLine: async (q: string) => {
      log.push(`onLine(${q})`)
      if (!opts.slowRun) return "prompt"
      return new Promise<"prompt">((res) => {
        release = () => res("prompt")
      })
    },
    onPicker: async (q: string) => {
      log.push(`onPicker(${q})`)
      if (q.startsWith("/model")) {
        return {
          title: "Models",
          items: [
            { label: "p :: a", value: "p::a" },
            { label: "p :: b", value: "p::b" },
          ],
          onPick: (v: string) => `Selected ${v}`,
        }
      }
      return null
    },
    onOverlay: async (q: string) => {
      log.push(`onOverlay(${q})`)
      if (q.startsWith("/status")) {
        return { title: "status", lines: ["Session ID: abc", "Model: prov::model-x"] }
      }
      if (q.startsWith("/help")) {
        const n = opts.overlayLines ?? 3
        return {
          title: "help",
          lines: Array.from({ length: n }, (_, i) => `baris bantuan nomor ${i + 1}`),
        }
      }
      return null
    },
    onExit: async () => {
      log.push("onExit()")
    },
  })

  return {
    tty,
    bus,
    log,
    cost,
    mode: () => mode,
    finishRun: () => release?.(),
    detach: () => shell.detach(),
  }
}

let h: Harness | undefined

afterEach(() => {
  h?.detach()
  h?.tty.restore()
  h = undefined
})

describe("fullscreen: submit prompt", () => {
  // Test inti. Pada HEAD sebelum perbaikan, `render()` memanggil startSpinner()
  // yang memanggil tickSpinner() -> render() tanpa pernah men-set timer lebih
  // dulu, jadi guard `if (spinnerTimer) return` selalu lolos: rekursi tak
  // berbatas -> RangeError -> onLine tidak pernah dipanggil dan layar diam.
  test("Enter memanggil onLine tepat sekali, tanpa rejection", async () => {
    h = setup({ slowRun: true })
    await h.tty.send("buat aplikasi todo")
    await h.tty.send(KEY.enter, 120)

    expect(h.tty.failures()).toEqual([])
    expect(h.log).toEqual(["onLine(buat aplikasi todo)"])
  })

  test("spinner berjalan saat busy tanpa meledakkan stack", async () => {
    h = setup({ slowRun: true })
    await h.tty.send("kerjakan sesuatu")
    await h.tty.send(KEY.enter, 400) // beberapa tick spinner harus lewat

    expect(h.tty.failures()).toEqual([])
    // Transcript memuat prompt user; spinner tidak menghentikan render.
    expect(h.tty.visibleLines().some((l) => l.includes("kerjakan sesuatu"))).toBe(true)
    h.finishRun()
    h.bus.emit("turn:completed", { result: { usage: { turns: 1 } } })
    await h.tty.send("", 60)
    expect(h.tty.failures()).toEqual([])
  })

  test("Enter pada baris kosong tidak memanggil onLine", async () => {
    h = setup()
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual([])
  })

  test("baris berakhir backslash dikirim tanpa backslash", async () => {
    h = setup()
    await h.tty.send("lanjut\\")
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(lanjut)"])
  })
})

describe("fullscreen: dropdown saran", () => {
  test("'/' membuka daftar perintah", async () => {
    h = setup()
    await h.tty.send("/")
    const lines = h.tty.visibleLines()
    expect(lines.some((l) => l.includes("/help"))).toBe(true)
  })

  test("mengetik memfilter daftar", async () => {
    h = setup()
    await h.tty.send("/s")
    // Hanya baris dropdown (ter-indentasi) — footer juga memuat "/help".
    const dropdown = h.tty
      .visibleLines()
      .filter((l) => l.startsWith("    ") || l.startsWith("  \u203a "))
      .join("\n")
    expect(dropdown).toContain("/sync")
    expect(dropdown).toContain("/status")
    expect(dropdown).not.toContain("/help")
  })

  test("panah bawah menandai item terpilih", async () => {
    h = setup()
    await h.tty.send("/s")
    await h.tty.send(KEY.down)
    const frame = h.tty.visibleFrame()
    expect(frame).toMatch(/›\s+\/sync/)
  })

  test("Tab melengkapi item yang sedang dipilih, bukan selalu yang pertama", async () => {
    h = setup()
    await h.tty.send("/s")
    await h.tty.send(KEY.down) // /sync
    await h.tty.send(KEY.down) // /sessions
    await h.tty.send(KEY.tab)
    await h.tty.send(KEY.enter, 60)
    expect(h.log.some((l) => l.includes("/sessions"))).toBe(true)
  })

  test("Tab tanpa seleksi melengkapi item pertama", async () => {
    h = setup()
    await h.tty.send("/sy")
    await h.tty.send(KEY.tab)
    await h.tty.send(KEY.enter, 60)
    expect(h.log.some((l) => l.includes("/sync"))).toBe(true)
  })
})

describe("fullscreen: overlay", () => {
  test("/status menampilkan overlay dan Esc menutupnya", async () => {
    h = setup()
    await h.tty.send("/status")
    await h.tty.send(KEY.enter, 80)
    expect(h.tty.visibleFrame()).toContain("Session ID: abc")

    await h.tty.send(KEY.esc, 40)
    expect(h.tty.visibleFrame()).not.toContain("Session ID: abc")
  })

  test("overlay lebih panjang dari tinggi terminal tidak meluber", async () => {
    h = setup({ rows: 20, overlayLines: 40 })
    await h.tty.send("/help")
    await h.tty.send(KEY.enter, 80)

    const rendered = h.tty.lastFrame().split("\n").length
    expect(rendered).toBeLessThanOrEqual(20)
    // Judul overlay tetap terlihat, tidak terguling keluar layar.
    expect(h.tty.visibleFrame()).toContain("help")
  })

  test("overlay panjang bisa di-scroll dengan panah", async () => {
    h = setup({ rows: 20, overlayLines: 40 })
    await h.tty.send("/help")
    await h.tty.send(KEY.enter, 80)
    const first = h.tty.visibleFrame()
    expect(first).toContain("baris bantuan nomor 1")

    for (let i = 0; i < 12; i++) await h.tty.send(KEY.down, 5)
    const scrolled = h.tty.visibleFrame()
    expect(scrolled).not.toBe(first)
    expect(scrolled).toContain("baris bantuan nomor 13")
  })
})

describe("fullscreen: picker", () => {
  test("/model membuka picker; Enter memilih item", async () => {
    h = setup()
    await h.tty.send("/model")
    await h.tty.send(KEY.enter, 80)
    expect(h.tty.visibleFrame()).toContain("p :: a")

    await h.tty.send(KEY.down)
    await h.tty.send(KEY.enter, 60)
    expect(h.tty.visibleFrame()).toContain("Selected p::b")
  })

  test("Esc membatalkan picker tanpa memilih", async () => {
    h = setup()
    await h.tty.send("/model")
    await h.tty.send(KEY.enter, 80)
    await h.tty.send(KEY.esc, 40)
    expect(h.tty.visibleFrame()).not.toContain("model aktif")
  })
})

describe("fullscreen: streaming & event tool", () => {
  test("provider:text muncul di transcript", async () => {
    h = setup()
    h.bus.emit("turn:started", { turn: 1 })
    h.bus.emit("provider:text", { text: "Baris satu\nBaris dua\n" })
    await h.tty.send("", 40)
    const frame = h.tty.visibleFrame()
    expect(frame).toContain("Baris satu")
    expect(frame).toContain("Baris dua")
  })

  test("diff card mempertahankan warna hijau/merah", async () => {
    h = setup()
    h.bus.emit("execution:completed", {
      execution: {
        call: { name: "edit", args: { path: "src/a.ts", oldString: "a\nb", newString: "a\nc" } },
        result: { isError: false, content: "" },
      },
    })
    await h.tty.send("", 40)
    const raw = h.tty.lastFrame()
    // Warna sukses/error tema aktif harus ada — bukan monokrom.
    expect(raw).toMatch(sgrBefore("\\+ c"))
    expect(raw).toMatch(sgrBefore("- b"))
  })

  test("markdown dari agent mempertahankan bold", async () => {
    h = setup()
    h.bus.emit("turn:started", { turn: 1 })
    h.bus.emit("provider:text", { text: "ini **tebal** ya\n" })
    h.bus.emit("turn:completed", { result: { usage: { turns: 1 } } })
    await h.tty.send("", 40)
    expect(h.tty.lastFrame()).toContain("\x1b[1m")
  })

  test("tool error tampil sebagai baris error", async () => {
    h = setup()
    h.bus.emit("execution:completed", {
      execution: {
        call: { name: "bash", args: { cmd: "exit 1" } },
        result: { isError: true, content: "gagal total" },
      },
    })
    await h.tty.send("", 40)
    expect(h.tty.visibleFrame()).toContain("gagal total")
  })
})

describe("fullscreen: cost & budget", () => {
  test("cost dari usage collector tampil di header", async () => {
    h = setup()
    h.cost.value = 0.0123
    h.bus.emit("turn:completed", { result: { usage: { turns: 1 } } })
    await h.tty.send("", 40)
    expect(h.tty.visibleFrame()).toContain("$0.0123")
  })

  test("tanpa cost header tidak menampilkan dolar", async () => {
    h = setup()
    await h.tty.send("", 40)
    expect(h.tty.visibleFrame()).not.toContain("$")
  })

  test("budget: peringatan muncul saat melewati 80%", async () => {
    h = setup({ budget: 1 })
    h.cost.value = 0.85
    h.bus.emit("turn:completed", { result: { usage: { turns: 1 } } })
    await h.tty.send("", 40)
    const frame = h.tty.visibleFrame()
    expect(frame).toContain("80%")
    expect(frame).toContain("$0.8500/$1.00")
  })

  test("budget: prompt baru ditolak setelah batas terlampaui", async () => {
    h = setup({ budget: 1 })
    h.cost.value = 1.5
    h.bus.emit("turn:completed", { result: { usage: { turns: 1 } } })
    await h.tty.send("", 40)
    expect(h.tty.visibleFrame()).toContain("melewati batas")

    h.log.length = 0
    await h.tty.send("prompt lanjutan")
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual([]) // onLine tidak dipanggil
    expect(h.tty.visibleFrame()).toContain("terlampaui")
  })
})

describe("fullscreen: history", () => {
  test("panah atas mengganti baris dengan entri history", async () => {
    h = setup({ history: ["perintah lama"] })
    await h.tty.send(KEY.up, 40)
    expect(h.tty.visibleFrame()).toContain("perintah lama")
  })

  test("panah atas tidak menggabungkan dengan teks yang sudah ditulis", async () => {
    h = setup({ history: ["perintah lama"] })
    await h.tty.send("halo")
    await h.tty.send(KEY.up, 40)
    const frame = h.tty.visibleFrame()
    expect(frame).toContain("perintah lama")
    expect(frame).not.toContain("halo perintah lama")
  })
})

describe("fullscreen: editing baris", () => {
  test("panah kiri memindahkan kursor; karakter disisipkan di tengah", async () => {
    h = setup()
    await h.tty.send("abcdef")
    await h.tty.send(KEY.left)
    await h.tty.send(KEY.left)
    await h.tty.send(KEY.left)
    await h.tty.send("X")
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(abcXdef)"])
  })

  test("Home lalu mengetik menyisipkan di awal", async () => {
    h = setup()
    await h.tty.send("dunia")
    await h.tty.send(KEY.ctrlA)
    await h.tty.send("halo ")
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(halo dunia)"])
  })

  test("End kembali ke akhir baris", async () => {
    h = setup()
    await h.tty.send("satu")
    await h.tty.send(KEY.ctrlA)
    await h.tty.send(KEY.ctrlE)
    await h.tty.send("!")
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(satu!)"])
  })

  test("backspace menghapus karakter sebelum kursor, bukan di ujung", async () => {
    h = setup()
    await h.tty.send("abcd")
    await h.tty.send(KEY.left)
    await h.tty.send(KEY.backspace)
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(abd)"])
  })

  test("Ctrl+U mengosongkan baris", async () => {
    h = setup()
    await h.tty.send("teks panjang")
    await h.tty.send(KEY.ctrlU)
    await h.tty.send("baru")
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(baru)"])
  })

  test("paste multi-baris masuk sebagai satu isian", async () => {
    h = setup()
    await h.tty.send(KEY.paste("baris1 baris2"))
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(baris1 baris2)"])
  })
})

describe("fullscreen: mode & tampilan", () => {
  test("Shift+Tab memutar mode permission", async () => {
    h = setup()
    expect(h.tty.visibleFrame()).toContain("auto")
    await h.tty.send(KEY.shiftTab, 40)
    expect(h.mode()).toBe("ask")
    expect(h.tty.visibleFrame()).toContain("ask")
  })

  test("Ctrl+O menandai mode detail", async () => {
    h = setup()
    await h.tty.send(KEY.ctrlO, 40)
    expect(h.tty.visibleFrame()).toContain("DETAIL")
  })

  test("terminal sempit memakai header dua baris tanpa memotong frame", async () => {
    h = setup({ columns: 60, rows: 20 })
    await h.tty.send("a", 40)
    const lines = h.tty.lastFrame().split("\n")
    expect(lines.length).toBeLessThanOrEqual(20)
    expect(h.tty.visibleFrame()).toContain("minicode")
  })

  test("resize memicu render ulang", async () => {
    h = setup({ columns: 100, rows: 30 })
    await h.tty.send("teks", 30)
    const before = h.tty.lastFrame()
    h.tty.resize(70, 20)
    await h.tty.send("", 30)
    expect(h.tty.lastFrame()).not.toBe(before)
  })

  test("baris sangat panjang tidak meninggalkan sekuens ANSI terpotong", async () => {
    h = setup({ columns: 60, rows: 20 })
    h.bus.emit("turn:started", { turn: 1 })
    h.bus.emit("provider:text", { text: `${"x".repeat(400)}\n` })
    await h.tty.send("", 40)
    const frame = h.tty.lastFrame()
    // Setiap ESC[ harus diakhiri huruf final — tidak ada sekuens tergantung.
    expect(frame).not.toMatch(new RegExp(`${ESC}\\[[0-9;]*$`))
    for (const line of frame.split("\n")) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(60)
    }
  })
})

describe("fullscreen: interupsi & keluar", () => {
  test("Ctrl+C saat busy membatalkan run, bukan keluar", async () => {
    h = setup({ slowRun: true })
    await h.tty.send("kerja panjang")
    await h.tty.send(KEY.enter, 80)
    await h.tty.send(KEY.ctrlC, 40)
    expect(h.log).not.toContain("onExit()")
    expect(h.tty.visibleFrame()).toContain("dihentikan")
  })

  test("Ctrl+C dua kali saat idle keluar", async () => {
    h = setup()
    await h.tty.send(KEY.ctrlC, 20)
    expect(h.log).not.toContain("onExit()")
    await h.tty.send(KEY.ctrlC, 40)
    expect(h.log).toContain("onExit()")
  })

  test("perintah tak dikenal memberi pesan, bukan diam", async () => {
    h = setup()
    await h.tty.send("/tidakada")
    await h.tty.send(KEY.enter, 80)
    expect(h.tty.visibleFrame()).toContain("tidak dikenal")
  })

  test("perintah tak dikenal tidak menjalankan picker/overlay/onLine", async () => {
    h = setup()
    await h.tty.send("/tidakada")
    await h.tty.send(KEY.enter, 80)
    // Nama divalidasi lebih dulu; tidak ada kerja sia-sia untuk salah ketik.
    expect(h.log).toEqual([])
  })
})

describe("fullscreen: mouse tidak mencemari input", () => {
  test("byte klik mouse tidak masuk sebagai teks", async () => {
    h = setup()
    await h.tty.send("teks")
    await h.tty.send(KEY.mouseClick, 40)
    await h.tty.send(KEY.enter, 60)
    expect(h.log).toEqual(["onLine(teks)"])
  })

  test("mouse tracking tidak diaktifkan", async () => {
    h = setup()
    await h.tty.send("", 20)
    expect(h.tty.all()).not.toContain("\x1b[?1000h")
  })
})

describe("fullscreen: non-TTY", () => {
  test("attach di luar TTY tidak melempar", () => {
    const tty = installFakeTty({ isTTY: false })
    const bus = createFakeBus()
    let shell: { detach(): void } | undefined
    try {
      expect(() => {
        shell = attachFullscreenMinimal({
          bus: bus as unknown as EventBus,
          model: () => "m",
          cwdName: "c",
          initialMode: "auto",
          usage: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
          onCycleMode: () => "auto",
          suggestions: () => [],
          history: () => [],
          onLine: async () => "prompt",
          onPicker: async () => null,
          onOverlay: async () => null,
          onExit: async () => {},
        })
      }).not.toThrow()
    } finally {
      shell?.detach()
      tty.restore()
    }
  })
})

describe("fullscreen: detach membersihkan terminal", () => {
  test("detach memulihkan kursor dan keluar dari alternate screen", async () => {
    const local = setup()
    await local.tty.send("", 20)
    local.tty.clear()
    local.detach()
    const out = local.tty.all()
    expect(out).toContain("\x1b[?25h") // kursor tampil kembali
    expect(out).toContain("\x1b[?1049l") // keluar alternate screen
    local.tty.restore()
    h = undefined
  })
})

// Regresi murni: bus listener harus dilepas saat detach supaya event setelah
// keluar tidak menulis ke stdout yang sudah dikembalikan ke terminal.
test("detach melepas semua listener bus", async () => {
  const local = setup()
  await local.tty.send("", 20)
  const before = local.bus.listenerCount("provider:text")
  expect(before).toBeGreaterThan(0)
  local.detach()
  expect(local.bus.listenerCount("provider:text")).toBe(0)
  local.tty.restore()
  h = undefined
})

beforeEach(() => {
  h = undefined
})
