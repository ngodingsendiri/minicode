// Modal picker - searchable, VS Code palette

import {
  createDecoderState,
  type DecoderState,
  decodeKeysStream,
  toGraphemes,
} from "../input/prompt-engine.ts"
import { c } from "../render/theme.ts"
import { truncateToWidth } from "../render/width.ts"
import { clearTransientOverlay, renderTransientOverlay } from "./overlay.ts"

export interface PickerItem {
  name: string
  provider: string
  value: string
}

export interface PickerOptions {
  title: string
  items: PickerItem[]
  onPick: (value: string) => void
  onCancel: () => void
  placeholder?: string
  filterable?: boolean
}

const DIM = "\x1b[2m",
  RESTORE = "\x1b[22m",
  ACC = (s: string) => c.accent(c.bold(s)),
  ACC_DIM = (s: string) => c.accent(s)

// Tandai substring query di label agar user tahu KENAPA item cocok.
// Operasi pada teks plain (sebelum truncate) — SGR bold nol kolom.
function highlightMatch(label: string, query: string): string {
  if (!query) return label
  const idx = label.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return label
  return (
    label.slice(0, idx) +
    c.bold(label.slice(idx, idx + query.length)) +
    label.slice(idx + query.length)
  )
}

export async function runPicker(opts: PickerOptions): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log(`\n${opts.title}`)
    for (const [i, it] of opts.items.entries()) console.log(`  [${i}] ${it.provider}::${it.name}`)
    console.log("")
    return
  }

  return new Promise<void>((resolve) => {
    let sel = 0
    let scroll = 0
    let filter = ""
    let prevRows = 0
    const isFilterable = opts.filterable ?? false

    const filteredItems = (): PickerItem[] => {
      if (!isFilterable || !filter) return opts.items
      const q = filter.toLowerCase()
      return opts.items.filter(
        (it) => it.name.toLowerCase().includes(q) || it.provider.toLowerCase().includes(q),
      )
    }

    // Lebar/tinggi mengikuti terminal SUNGGUHAN.
    //
    // Sebelumnya keduanya punya lantai minimum (`Math.max(44, …)` dan
    // `Math.max(4, …)`) yang MENGABAIKAN terminal lebih kecil: pada 40 kolom
    // label 55 kolom tetap digambar, dan pada rows=3 overlay 6 baris tetap
    // dicetak — keduanya membungkus dan merusak tampilan.
    const visibleRows = () => {
      const rows = process.stdout.rows || 24
      // Sisakan ruang untuk judul, baris filter, dan baris hint/sisa.
      const chrome = isFilterable ? 3 : 2
      return Math.max(1, Math.min(rows - chrome, 12))
    }
    const width = () => Math.max(8, (process.stdout.columns || 80) - 2)

    const buildLines = (): string[] => {
      const items = filteredItems()
      const v = visibleRows()
      if (sel >= items.length) sel = Math.max(0, items.length - 1)
      if (sel < scroll) scroll = sel
      if (sel >= scroll + v) scroll = sel - v + 1
      if (items.length === 0) scroll = 0
      const rows = items.slice(scroll, scroll + v)
      const w = width()
      const cut = (s: string) => truncateToWidth(s, w)
      const lines: string[] = []
      lines.push(cut(`${DIM}─ ${ACC(opts.title)} ${DIM}─${RESTORE}`))
      if (isFilterable) {
        const placeholderText = opts.placeholder ?? "type to filter"
        const display = filter ? c.brightCyan(filter) : DIM + placeholderText + RESTORE
        const label = filter ? ACC_DIM("Filter:") : `${DIM}Filter:${RESTORE}`
        lines.push(cut(`${label} ${display}`))
      }
      if (items.length === 0) {
        lines.push(cut(`${DIM}  No matches for "${filter}"${RESTORE}`))
        return lines
      }
      for (let i = 0; i < rows.length; i++) {
        const it = rows[i]!
        const picked = i === sel - scroll
        // Potong label ke KOLOM (CJK 2 kolom), sisakan ruang untuk penanda "› ".
        // Highlight query DITERAPKAN sebelum truncate agar posisi kolom tepat.
        const rawLabel = `${it.provider ? `${it.provider} › ` : ""}${it.name}`
        const label = highlightMatch(truncateToWidth(rawLabel, w - 4), filter)
        if (picked) lines.push(`  ${c.accent("›")} ${c.accent(c.bold(label))}${RESTORE}`)
        else lines.push(`   ${DIM}${label}${RESTORE}`)
      }
      if (items.length > scroll + v) {
        lines.push(cut(`${DIM}… ${c.accent(String(items.length - scroll - v))} more${RESTORE}`))
      } else if (isFilterable && filter) {
        lines.push(
          cut(`${DIM}  ${c.accent(String(items.length))}/${opts.items.length} matches${RESTORE}`),
        )
      }
      return lines
    }

    const render = () => {
      prevRows = renderTransientOverlay(buildLines(), prevRows)
    }

    let done = false
    let onData!: (chunk: Buffer) => void
    let onResize!: () => void
    const decoder: DecoderState = createDecoderState()
    const cleanup = () => {
      if (done) return
      done = true
      prevRows = clearTransientOverlay(prevRows)
      process.stdout.write("\x1b[0m\x1b[?25h")
      // Ensure cursor at next line after anchor for result
      process.stdout.write("\r\n")
      try {
        process.stdin.setRawMode(false)
      } catch {}
      process.stdin.pause()
      if (onData) process.stdin.removeListener("data", onData)
      if (onResize) process.stdout.removeListener("resize", onResize)
    }

    onData = (chunk: Buffer) => {
      try {
        for (const d of decodeKeysStream(chunk, decoder)) {
          const items = filteredItems()
          switch (d.key.type) {
            case "up":
              sel = Math.max(0, sel - 1)
              render()
              break
            case "down":
              sel = Math.min(items.length - 1, sel + 1)
              render()
              break
            case "char": {
              if (isFilterable) {
                filter += d.key.ch
                sel = 0
                scroll = 0
                render()
              }
              break
            }
            case "backspace": {
              if (isFilterable && filter.length > 0) {
                // Hapus satu grapheme (filter bisa berisi emoji/flag).
                const graphemes = toGraphemes(filter)
                graphemes.pop()
                filter = graphemes.join("")
                sel = 0
                scroll = 0
                render()
              }
              break
            }
            case "enter": {
              const item = items[sel]
              cleanup()
              if (item) opts.onPick(item.value)
              else opts.onCancel()
              resolve()
              return
            }
            case "esc": {
              // Esc pertama membersihkan filter; Esc kedua (filter kosong) keluar.
              if (isFilterable && filter.length > 0) {
                filter = ""
                sel = 0
                scroll = 0
                render()
                break
              }
              cleanup()
              opts.onCancel()
              resolve()
              return
            }
            case "ctrl-c":
            case "ctrl-d":
              cleanup()
              opts.onCancel()
              resolve()
              return
            default:
              break
          }
        }
      } catch {
        cleanup()
      }
    }

    onResize = () => render()

    process.stdout.write("\x1b[?25l")
    try {
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setMaxListeners(0)
      process.stdin.on("data", onData)
      process.stdout.on("resize", onResize)
      render()
    } catch {
      cleanup()
    }
  })
}
