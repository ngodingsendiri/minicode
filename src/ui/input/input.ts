import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { stripAnsi } from "../render/theme.ts"
import { displayWidth, truncateToWidth } from "../render/width.ts"
import {
  applyKey,
  buildRenderSpec,
  createDecoderState,
  createState,
  type DecoderState,
  decodeKeysStream,
  MAX_VISIBLE,
  type PromptKey,
  pointLength,
  toGraphemes,
} from "./prompt-engine.ts"

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
    await writeFile(HISTORY_FILE, `${capped.join("\n")}\n`, "utf8")
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
  /**
   * Prefix prompt: string statis ATAU fungsi yang dipanggil setiap render.
   * Bentuk fungsi membuat perubahan eksternal — mis. cycle mode REPL via
   * Shift+Tab — langsung terlihat tanpa mengulang askLine.
   */
  prompt?: string | (() => string)
  hints?: (line: string) => string[]
  groupOf?: (text: string) => string // opsional: label grup (commands/skills)
  /**
   * Dipanggil untuk setiap keypress SEBELUM logika bawaan (history, applyKey).
   * Return truthy = key sudah ditangani pemanggil; askLine melewatkan handling
   * default dan tetap me-render ulang. Dipakai REPL linier untuk Shift+Tab
   * (cycle mode), Ctrl+T (reasoning), dan Ctrl+O (toggle compact).
   */
  onKey?: (key: PromptKey) => boolean
}

// Input interaktif satu baris + floating dropdown suggestions (dimmed).
// - ANSI (Windows Terminal/VS Code/macOS/Linux): dropdown baris di bawah prompt,
//   seleksi › hijau, navigasi ↑/↓, Tab = complete tetap editing, Enter = complete + submit.
// - Legacy console (tanpa VT): fallback inline hints di baris yang sama.
// Semua logika transisi ada di prompt-engine.ts (pure) - di sini hanya IO + render.
export async function askLine(opts: AskLineOptions = {}): Promise<string | null> {
  const { glyphs } = await import("../render/theme.ts")
  // Diselesaikan per pemakaian (bukan sekali di awal) supaya prompt berbentuk
  // fungsi — mis. prefix mode REPL yang berubah lewat Shift+Tab — tergambar baru.
  const promptOf = (): string =>
    typeof opts.prompt === "function" ? opts.prompt() : (opts.prompt ?? `${glyphs.prompt} `)

  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      rl.question(promptOf(), (a) => {
        rl.close()
        resolve(a.trim())
      })
    })
  }

  const ansi = await detectAnsi()
  const { c } = await import("../render/theme.ts")
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

  return new Promise((resolve, reject) => {
    // Raw mode harus dikembalikan BAGI BAGIAN body yang error: bila renderAnsi
    // melempar (mis. lebar terminal abnormal), terminal tidak boleh tertinggal
    // dalam raw + listener lama menumpuk (dulu REPL catch{continue} lalu
    // askLine berikutnya memasang listener kedua → MaxListenersExceeded).
    const decoder: DecoderState = createDecoderState()
    let done = false
    let onData!: (chunk: Buffer) => void
    const cleanup = () => {
      if (done) return
      done = true
      try {
        process.stdin.setRawMode(false)
      } catch {}
      process.stdin.pause()
      if (onData) process.stdin.removeListener("data", onData)
    }
    const finish = (v: string | null) => {
      cleanup()
      resolve(v)
    }
    const fail = (e: unknown) => {
      cleanup()
      reject(e)
    }

    try {
      process.stdin.setRawMode(true)
      process.stdin.resume()
    } catch (e) {
      reject(e)
      return
    }

    let state = createState()
    let prevRows = 0 // jumlah baris dropdown yang tergambar (untuk clear)
    let printedW = 0 // lebar teks yang ditulis (fallback inline)

    const matches = (): string[] => hints(state.line)

    // ── render ANSI: dropdown floating di bawah prompt ──
    // Horizontal scroll mengikuti KURSOR, bukan hanya ujung baris: saat user
    // menyunting di tengah prompt panjang, bagian yang sedang diedit harus
    // terlihat. Semua ukuran dalam KOLOM terminal — CJK/emoji dua kolom.
    // Sebelumnya memakai `.length` (karakter), sehingga baris CJK 53 kolom
    // dianggap "muat" di terminal 30 kolom lalu membungkus sendiri.
    const scrollableLine = (line: string, cursorCol: number): { text: string; col: number } => {
      const cols = process.stdout.columns || 80
      if (displayWidth(line) <= cols - 1) return { text: line, col: cursorCol }
      // Bekerja pada teks bersih: potongan tengah tidak bisa mempertahankan
      // sekuens ANSI dengan benar tanpa melacak state warna.
      const clean = stripAnsi(line)
      const pts = toGraphemes(clean)
      // Lebar kumulatif per posisi karakter.
      const colAt: number[] = [0]
      for (const ch of pts) colAt.push(colAt[colAt.length - 1]! + displayWidth(ch))
      // Jendela scroll tidak boleh melebihi terminal sendiri: `max(8, cols-4)`
      // di cols=5 menghasilkan keep 8 > cols → baris membungkus lagi.
      const keep = Math.min(Math.max(8, cols - 4), Math.max(4, cols - 1))
      // Cari indeks awal terkecil yang membuat kursor masuk jendela `keep`.
      let start = 0
      while (start < pts.length && cursorCol - colAt[start]! >= keep) start++
      const ell = start > 0 ? "…" : ""
      const body = truncateToWidth(pts.slice(start).join(""), keep - displayWidth(ell), "")
      return {
        text: (start > 0 ? c.dim(ell) : "") + body,
        col: displayWidth(ell) + (cursorCol - colAt[start]!),
      }
    }

    /** Pindahkan kursor terminal ke kolom logis (1-based di ANSI). */
    const placeCursor = (col: number) => {
      process.stdout.write(`\x1b[${Math.max(1, col + 1)}G`)
    }

    const renderAnsi = () => {
      const rows = process.stdout.rows || 24
      // Sisakan ruang untuk prompt + 1 baris status agar dropdown tidak
      // membungkus di terminal pendek.
      const maxVisible = Math.max(1, Math.min(MAX_VISIBLE, rows - 3))
      const spec = buildRenderSpec(state, promptOf(), matches(), opts.groupOf, maxVisible)
      const maxRows = Math.max(prevRows, spec.totalRows)
      const view = scrollableLine(spec.inputLine, spec.cursorCol)
      const inputLine = view.text

      process.stdout.write(`\r${CLEAR}${inputLine}`)

      if (maxRows > 0) {
        process.stdout.write("\r\n")
        for (let k = 0; k < maxRows; k++) {
          process.stdout.write(CLEAR)
          if (k < maxRows - 1) process.stdout.write("\r\n")
        }
        process.stdout.write(`\x1b[${maxRows}A`)
        process.stdout.write(`\r${inputLine}`)
      }

      if (spec.rows.length > 0) {
        const cols = process.stdout.columns || 80
        process.stdout.write("\r\n")
        for (let i = 0; i < spec.rows.length; i++) {
          const row = spec.rows[i]!
          if (row.kind === "header") {
            process.stdout.write(
              CLEAR + c.accent(c.bold(truncateToWidth(row.text, cols))) + RESTORE,
            )
          } else {
            const isPicked = row.picked
            const prefix = isPicked ? `  ${c.accent("›")} ` : "    "
            // Item dropdown juga dipotong ke lebar terminal.
            const label = truncateToWidth(row.text, Math.max(4, cols - 4))
            const text = isPicked ? c.accent(c.bold(label)) : label
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
          process.stdout.write(`${CLEAR + DIM}    … ${spec.moreCount} more${RESTORE}`)
        }
        process.stdout.write(`\x1b[${spec.totalRows}A`)
        process.stdout.write(`\r${inputLine}`)
      }

      // Kursor sungguhan di posisi logis — bukan selalu di ujung baris.
      placeCursor(view.col)
      prevRows = spec.totalRows
    }

    // ── render inline (legacy console, tanpa ANSI) ──
    const renderInline = () => {
      const hs = matches()
      const prompt = promptOf()
      const content = hs.length
        ? `${prompt}${state.line}    ${hs.slice(0, 5).join("  ")}`
        : `${prompt}${state.line}`
      // Fallback non-ANSI tetap harus mengukur lebar per KOLOM terminal.
      // Jika memakai .length, CJK/emoji meninggalkan jejak saat baris memendek.
      const contentW = displayWidth(content)
      const pad = printedW - contentW
      process.stdout.write(`\r${" ".repeat(printedW)}\r${content}${pad > 0 ? " ".repeat(pad) : ""}`)
      printedW = contentW
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

    onData = (chunk: Buffer) => {
      const keys = decodeKeysStream(chunk, decoder)
      for (const d of keys) {
        // Hook pemanggil: key yang ditangani sendiri (return truthy) dilewati
        // dari logika bawaan; render() di akhir chunk tetap menggambar efeknya.
        if (opts.onKey?.(d.key)) continue
        // Navigasi history saat dropdown tertutup.
        //
        // Sebelumnya entri history DIGABUNGKAN ke teks yang sedang ditulis
        // ("halo" + panah atas -> "halo <entri>"), yang menghancurkan prompt
        // yang sedang disusun. Semua shell mengganti baris; kita ikut. Baris
        // yang sedang ditulis disimpan dan kembali saat user turun melewati
        // entri terbaru.
        if ((d.key.type === "up" || d.key.type === "down") && !state.menuOpen) {
          const setLine = (line: string) => {
            state = { ...state, line, cursor: pointLength(line), sel: -1, menuOpen: false }
            render()
          }
          if (d.key.type === "up") {
            if (historyIdx < historyCache.length - 1) {
              if (historyIdx === -1) savedLine = state.line
              historyIdx++
              setLine(historyCache[historyCache.length - 1 - historyIdx] ?? "")
            }
          } else if (historyIdx > 0) {
            historyIdx--
            setLine(historyCache[historyCache.length - 1 - historyIdx] ?? "")
          } else if (historyIdx === 0) {
            historyIdx = -1
            setLine(savedLine)
          }
          continue
        }
        // Mengetik/menghapus/memindah kursor setelah menjelajah history
        // memutus mode history — semua shell begitu (setiap edit = edit baris
        // baru, bukan lanjut navigasi). Sebelumnya ctrl-w/ctrl-u/tab/panah
        // tidak me-reset historyIdx, jadi setelah recall history lalu Ctrl+W
        // panah bawah tetap kembali ke entri history lain.
        if (
          d.key.type === "char" ||
          d.key.type === "backspace" ||
          d.key.type === "delete" ||
          d.key.type === "ctrl-w" ||
          d.key.type === "ctrl-u" ||
          d.key.type === "tab" ||
          d.key.type === "left" ||
          d.key.type === "right"
        ) {
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
            const shown = scrollableLine(`${promptOf()}${state.line}`, 0).text
            process.stdout.write(`\r${CLEAR}${shown}\r\n`)
          } else {
            process.stdout.write(`\r${CLEAR}${promptOf()}${state.line}\r\n`)
          }
          finish(v)
          return
        }
      }
      // Satu render per chunk - paste 50+ char tidak meng-redraw 50 kali.
      try {
        render()
      } catch (e) {
        fail(e)
      }
    }

    process.stdin.on("data", onData)
    try {
      render()
    } catch (e) {
      fail(e)
    }
  })
}

export async function askSecret(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) return ""

  return new Promise((resolve, reject) => {
    const decoder: DecoderState = createDecoderState()
    let done = false
    let onData!: (chunk: Buffer) => void
    const cleanup = () => {
      if (done) return
      done = true
      try {
        process.stdin.setRawMode(false)
      } catch {}
      process.stdin.pause()
      if (onData) process.stdin.removeListener("data", onData)
    }
    const finish = (value: string) => {
      cleanup()
      process.stdout.write("\n")
      resolve(value)
    }
    const fail = (e: unknown) => {
      cleanup()
      reject(e)
    }

    process.stdout.write(promptText)
    let secret = ""

    onData = (chunk: Buffer) => {
      try {
        for (const d of decodeKeysStream(chunk, decoder)) {
          const k = d.key
          if (k.type === "enter") {
            finish(secret.trim())
            return
          } else if (k.type === "ctrl-c" || k.type === "ctrl-d") {
            // Ctrl+C = BATALKAN PROMPT, bukan matikan proses.
            //
            // Dulu di sini `process.exit(130)`. Di raw mode Ctrl+C tidak
            // menghasilkan SIGINT, jadi itu emulasi manual — tapi `askSecret`
            // dipanggil dari `runProviderManager`, sebuah dialog di dalam REPL
            // yang hidup. Menekan Ctrl+C saat salah ketik API key mematikan
            // seluruh sesi beserta riwayatnya, bukan menutup dialognya.
            //
            // String kosong adalah sinyal batal yang SUDAH ditangani kedua
            // pemanggil. Ini juga menyamakan perilakunya dengan `askLine`,
            // yang membatalkan (null) alih-alih keluar.
            finish("")
            return
          } else if (k.type === "backspace") {
            // Hapus satu GRAPHEME (bukan code point/UTF-16 unit): emoji ZWJ
            // dan flag tidak meninggalkan setengah.
            const graphemes = toGraphemes(secret)
            if (graphemes.length > 0) {
              graphemes.pop()
              secret = graphemes.join("")
              process.stdout.write("\b \b")
            }
          } else if (k.type === "char") {
            // Sekuens kontrol dari paste dibuang — secret tidak boleh
            // mengandung newline/C0 (Enter adalah satu-satunya terminasi).
            const clean = k.ch
              .replace(/\r\n|\r|\n|\t/g, "")
              // biome-ignore lint/suspicious/noControlCharactersInRegex: membuang kontrol dari paste
              .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
            if (clean) {
              secret += clean
              process.stdout.write("*".repeat(toGraphemes(clean).length))
            }
          }
        }
      } catch (e) {
        fail(e)
      }
    }

    process.stdin.resume()
    process.stdin.setRawMode(true)
    process.stdin.on("data", onData)
  })
}
