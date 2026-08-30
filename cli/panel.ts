// Modal panel - VS Code palette
import { c, stripAnsi } from "../src/tui/theme.ts"
import { truncateToWidth } from "../src/tui/width.ts"
import { decodeKeys } from "./prompt-engine.ts"

export interface PanelOptions {
  title: string
  lines: string[]
}

const DIM = "\x1b[2m",
  RESTORE = "\x1b[22m",
  CLEAR = "\x1b[2K",
  SYNC_START = "\x1b[?2026h",
  SYNC_END = "\x1b[?2026l"

// Jalankan `fn` sambil menangkap stdout/console.log menjadi array baris.
// Generic: nilai kembalian `fn` diteruskan lewat `value` agar caller bisa
// memeriksa hasil (mis. flag `handled`) tanpa mengandalkan exception.
export function captureOutput<T>(fn: () => Promise<T>): Promise<{ lines: string[]; value: T }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    const origLog = console.log
    process.stdout.write = ((chunk: string | Uint8Array, ..._rest: unknown[]) => {
      const s = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
      for (const l of s.split("\n")) {
        const clean = stripAnsi(l.replace(/\s+$/, ""))
        if (clean.length) lines.push(clean)
      }
      return true
    }) as typeof process.stdout.write
    console.log = (...args: unknown[]) => {
      lines.push(stripAnsi(String(args.join(" ")).trim()))
    }
    fn().then(
      (value) => {
        process.stdout.write = origWrite
        console.log = origLog
        resolve({ lines, value })
      },
      (e) => {
        process.stdout.write = origWrite
        console.log = origLog
        reject(e)
      },
    )
  })
}

export async function runPanel(opts: PanelOptions): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log("\n" + opts.title)
    for (const l of opts.lines) console.log("  " + l)
    return
  }

  return new Promise<void>((resolve) => {
    let scroll = 0
    let prevRows = 0
    // Lebar/tinggi mengikuti terminal SUNGGUHAN. Lantai minimum sebelumnya
    // (`Math.max(40, …)` / `Math.max(5, …)`) mengabaikan terminal lebih kecil,
    // sehingga baris 75 kolom tetap digambar di terminal 40 kolom.
    const wrapWidth = () => Math.max(8, (process.stdout.columns || 80) - 4)
    const totalLines = Math.max(1, opts.lines.length + 2)
    const viewHeight = () => Math.max(3, Math.min((process.stdout.rows || 24) - 2, 20))

    const buildLines = (): string[] => {
      const v = viewHeight()
      const maxScroll = Math.max(0, totalLines - v)
      if (scroll > maxScroll) scroll = maxScroll
      const w = wrapWidth()
      const vis = opts.lines.slice(scroll, scroll + v - 2)
      const lines: string[] = []
      lines.push(truncateToWidth(`${DIM}─ ${c.accent(c.bold(opts.title))} ${DIM}─${RESTORE}`, w))
      for (let i = 0; i < v - 2; i++) {
        const text = vis[i] ?? ""
        // Potong per KOLOM: CJK dua kolom, ANSI nol.
        lines.push(`   ${truncateToWidth(text, w - 4)}`)
      }
      const hint =
        maxScroll > 0
          ? `↑/↓ geser · ${c.accent(String(scroll + 1))}/${totalLines}`
          : "Enter/Esc tutup"
      lines.push(truncateToWidth(`${DIM}${hint}${RESTORE}`, w))
      return lines
    }

    const render = () => {
      const lines = buildLines()
      const next = lines.length
      const max = Math.max(prevRows, next)
      process.stdout.write(SYNC_START)
      if (max > 0) {
        process.stdout.write("\r\n")
        for (let k = 0; k < max; k++) {
          process.stdout.write(CLEAR)
          if (k < max - 1) process.stdout.write("\r\n")
        }
        process.stdout.write(`\x1b[${max}A`)
      }
      if (next > 0) {
        process.stdout.write("\r\n")
        for (let i = 0; i < next; i++) {
          process.stdout.write(CLEAR + lines[i]!)
          if (i < next - 1) process.stdout.write("\r\n")
        }
        process.stdout.write(`\x1b[${next}A`)
      }
      process.stdout.write(SYNC_END)
      prevRows = next
    }

    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      process.stdout.write(SYNC_START)
      if (prevRows > 0) {
        process.stdout.write("\r\n")
        for (let k = 0; k < prevRows; k++) {
          process.stdout.write(CLEAR)
          process.stdout.write("\x1b[1M")
        }
        prevRows = 0
      }
      process.stdout.write("\x1b[0m\x1b[?25h")
      process.stdout.write(SYNC_END)
      process.stdout.write("\r\n")
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener("data", onData)
      process.stdout.removeListener("resize", onResize)
    }

    const onData = (chunk: Buffer) => {
      for (const d of decodeKeys(chunk)) {
        switch (d.key.type) {
          case "up":
            scroll = Math.max(0, scroll - 1)
            render()
            break
          case "down":
            scroll += 1
            render()
            break
          case "enter":
          case "esc":
          case "ctrl-c":
          case "ctrl-d":
            cleanup()
            resolve()
            return
          default:
            break
        }
      }
    }

    const onResize = () => render()

    process.stdout.write("\x1b[?25l")
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setMaxListeners(0)
    process.stdin.on("data", onData)
    process.stdout.on("resize", onResize)
    render()
  })
}
