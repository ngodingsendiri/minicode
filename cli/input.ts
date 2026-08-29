import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { stripAnsi } from "../src/tui/theme.ts"
import { applyKey, buildRenderSpec, createState, decodeKeys } from "./prompt-engine.ts"

const HISTORY_FILE = join(homedir(), ".minicode", "history")
const MAX_HISTORY = 1000

export async function loadHistory(): Promise<string[]> {
  try {
    const content = await readFile(HISTORY_FILE, "utf8")
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function appendHistory(entry: string): Promise<void> {
  const clean = entry.trim()
  if (!clean) return
  try {
    const existing = await loadHistory()
    const filtered = existing.filter((e) => e !== clean)
    filtered.push(clean)
    const capped = filtered.slice(-MAX_HISTORY)
    await mkdir(join(homedir(), ".minicode"), { recursive: true }).catch(() => {})
    await writeFile(HISTORY_FILE, capped.join("\n") + "\n", "utf8")
  } catch {}
}

// ── ANSI support detection (sekali per process, cached) ──
// Semua console modern (Windows Terminal, VS Code, conhost Windows 10+,
// macOS/Linux TTY) memproses VT sequences. JANGAN menggantungkan dropdown
// pada probe DSR - conhost PS5.1 tidak selalu membalas \x1b[6n padahal VT
// bekerja (itulah kenapa dropdown 'hilang' kembali ke inline).
// Opt-out eksplisit: MINICODE_DROPDOWN=0 (console benar-benar legacy).
let ansiCache: Promise<boolean> | undefined

export async function detectAnsi(): Promise<boolean> {
  if (process.env.MINICODE_DROPDOWN === "0") return false
  if (!process.stdin.isTTY) return false
  ansiCache ??= Promise.resolve(true)
  return ansiCache
}

export interface AskLineOptions {
  prompt?: string
  hints?: (line: string) => string[]
  groupOf?: (text: string) => string // opsional: label grup (commands/skills)
}

// Input interaktif satu baris + floating dropdown suggestions (dimmed).
// - ANSI (Windows Terminal/VS Code/macOS/Linux): dropdown baris di bawah prompt,
//   seleksi › hijau, navigasi ↑/↓, Tab = complete tetap editing, Enter = complete + submit.
// - Legacy console (tanpa VT): fallback inline hints di baris yang sama.
// Semua logika transisi ada di prompt-engine.ts (pure) - di sini hanya IO + render.
export async function askLine(opts: AskLineOptions = {}): Promise<string | null> {
  const { glyphs } = await import("../src/tui/theme.ts")
  const prompt = opts.prompt ?? `${glyphs.prompt} `

  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.question(prompt, (a) => {
        rl.close()
        resolve(a.trim())
      })
    })
  }

  const ansi = await detectAnsi()
  const { c } = await import("../src/tui/theme.ts")
  const DIM = "\x1b[2m",
    RESTORE = "\x1b[22m",
    CLEAR = "\x1b[2K",
    SYNC_START = "\x1b[?2026h",
    SYNC_END = "\x1b[?2026l"
  const hints = (l: string) => opts.hints?.(l) ?? []

  // History navigation via Up/Down when menu not open (append mode)
  const historyCache = await loadHistory()
  let historyIdx = -1
  let savedLine = ""

  return new Promise((resolve) => {
    process.stdin.setRawMode(true)
    process.stdin.resume()

    let state = createState()
    let prevRows = 0 // jumlah baris dropdown yang tergambar (untuk clear)
    let printedW = 0 // lebar teks yang ditulis (fallback inline)

    const matches = (): string[] => hints(state.line)

    // ── render ANSI: dropdown floating di bawah prompt ──
    // Horizontal scroll: bila line lebih panjang dari lebar terminal, tampilkan
    // suffix (bukan wrap ke baris baru) supaya input tidak berantakan.
    const scrollableLine = (line: string): string => {
      const cols = process.stdout.columns || 80
      const clean = stripAnsi(line)
      if (clean.length <= cols - 1) return line
      const keep = Math.max(20, cols - 4)
      return c.dim("…") + line.slice(-keep)
    }

    const renderAnsi = () => {
      const spec = buildRenderSpec(state, prompt, matches(), opts.groupOf)
      const maxRows = Math.max(prevRows, spec.totalRows)
      const inputLine = scrollableLine(spec.inputLine)

      process.stdout.write("\r" + CLEAR + inputLine)

      if (maxRows > 0) {
        process.stdout.write("\r\n")
        for (let k = 0; k < maxRows; k++) {
          process.stdout.write(CLEAR)
          if (k < maxRows - 1) process.stdout.write("\r\n")
        }
        process.stdout.write(`\x1b[${maxRows}A`)
        process.stdout.write("\r" + inputLine)
      }

      if (spec.rows.length > 0) {
        process.stdout.write("\r\n")
        for (let i = 0; i < spec.rows.length; i++) {
          const row = spec.rows[i]!
          if (row.kind === "header") {
            process.stdout.write(CLEAR + c.accent(c.bold(row.text)) + RESTORE)
          } else {
            const isPicked = row.picked
            const prefix = isPicked ? `  ${c.accent("›")} ` : "    "
            const text = isPicked ? c.accent(c.bold(row.text)) : row.text
            if (isPicked) {
              process.stdout.write(CLEAR + prefix + text + RESTORE)
            } else {
              process.stdout.write(CLEAR + DIM + prefix + text + RESTORE)
            }
          }
          if (i < spec.rows.length - 1) process.stdout.write("\r\n")
        }
        if (spec.moreCount > 0) {
          process.stdout.write("\r\n")
          process.stdout.write(CLEAR + DIM + `    … ${spec.moreCount} more` + RESTORE)
        }
        process.stdout.write(`\x1b[${spec.totalRows}A`)
        process.stdout.write("\r" + inputLine)
      }

      prevRows = spec.totalRows
    }

    // ── render inline (legacy console, tanpa ANSI) ──
    const renderInline = () => {
      const hs = matches()
      const content = hs.length
        ? `${prompt}${state.line}    ${hs.slice(0, 5).join("  ")}`
        : `${prompt}${state.line}`
      const pad = printedW - content.length
      process.stdout.write(
        "\r" + " ".repeat(printedW) + "\r" + content + (pad > 0 ? " ".repeat(pad) : ""),
      )
      printedW = content.length
    }

    const render = ansi ? renderAnsi : renderInline

    // Hapus overlay dropdown sepenuhnya (delete lines, bukan clear) supaya
    // tidak menyisakan gap kosong. Cursor kembali ke baris anchor.
    const clearOverlay = () => {
      if (prevRows <= 0) return
      process.stdout.write(SYNC_START)
      // turun ke baris overlay pertama, hapus satu per satu (baris bawah
      // shift-up otomatis tiap \x1b[1M), lalu naik balik ke anchor.
      process.stdout.write("\r\n")
      for (let k = 0; k < prevRows; k++) {
        process.stdout.write(CLEAR)
        process.stdout.write("\x1b[1M")
      }
      process.stdout.write("\x1b[1A")
      process.stdout.write(SYNC_END)
      prevRows = 0
    }

    const onData = (chunk: Buffer) => {
      for (const d of decodeKeys(chunk)) {
        // History navigation when dropdown not open (Up/Down -> browse history with append)
        if ((d.key.type === "up" || d.key.type === "down") && !state.menuOpen) {
          if (d.key.type === "up") {
            if (historyIdx < historyCache.length - 1) {
              if (historyIdx === -1) savedLine = state.line
              historyIdx++
              const hist = historyCache[historyCache.length - 1 - historyIdx] ?? ""
              if (savedLine.trim()) {
                state = { ...state, line: `${savedLine} ${hist}` }
              } else {
                state = { ...state, line: hist }
              }
              render()
            }
          } else {
            if (historyIdx > 0) {
              historyIdx--
              const hist = historyCache[historyCache.length - 1 - historyIdx] ?? ""
              if (savedLine.trim()) {
                state = { ...state, line: `${savedLine} ${hist}` }
              } else {
                state = { ...state, line: hist }
              }
              render()
            } else if (historyIdx === 0) {
              historyIdx = -1
              state = { ...state, line: savedLine }
              render()
            }
          }
          continue
        }
        // typing after history navigation resets savedLine/historyIdx
        if (d.key.type === "char" || d.key.type === "backspace") {
          historyIdx = -1
          savedLine = ""
        }
        const r = applyKey(state, d.key, hints)
        state = r.state
        if (r.action === "submit" || r.action === "cancel") {
          const v = r.action === "submit" ? state.line.trim() : null
          // Empty Enter = "" (not null) - REPL continues; null = cancel (break)
          if (ansi) {
            clearOverlay()
            const shown = scrollableLine(`${prompt}${state.line}`)
            process.stdout.write("\r" + CLEAR + shown + "\r\n")
          } else {
            process.stdout.write("\r" + CLEAR + `${prompt}${state.line}` + "\r\n")
          }
          finish(v)
          return
        }
      }
      // Satu render per chunk - paste 50+ char tidak meng-redraw 50 kali.
      render()
    }

    const finish = (v: string | null) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener("data", onData)
      resolve(v)
    }

    process.stdin.on("data", onData)
    render()
  })
}

export async function askSecret(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) return ""

  return new Promise((resolve) => {
    process.stdout.write(promptText)
    let secret = ""

    const onData = (chunk: Buffer) => {
      const str = chunk.toString()

      for (let i = 0; i < str.length; i++) {
        const char = str[i]!

        if (char === "\r" || char === "\n") {
          process.stdin.removeListener("data", onData)
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdout.write("\n")
          resolve(secret.trim())
          return
        } else if (char === "\u0003") {
          process.stdin.removeListener("data", onData)
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdout.write("\n")
          process.exit(130)
        } else if (char === "\u007f" || char === "\b") {
          if (secret.length > 0) {
            secret = secret.slice(0, -1)
            process.stdout.write("\b \b")
          }
        } else if (char.charCodeAt(0) >= 32) {
          secret += char
          process.stdout.write("*")
        }
      }
    }

    process.stdin.resume()
    process.stdin.setRawMode(true)
    process.stdin.on("data", onData)
  })
}
