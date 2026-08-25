// Modal picker — searchable, VS Code palette
import { c } from "../src/tui/theme.ts"
import { decodeKeys } from "./prompt-engine.ts"

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
  CLEAR = "\x1b[2K",
  SYNC_START = "\x1b[?2026h",
  SYNC_END = "\x1b[?2026l",
  ACC = (s: string) => c.accent(c.bold(s)),
  ACC_DIM = (s: string) => c.accent(s)

export async function runPicker(opts: PickerOptions): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log("\n" + opts.title)
    opts.items.forEach((it, i) => console.log(`  [${i}] ${it.provider}::${it.name}`))
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

    const visibleRows = () => Math.max(4, Math.min(process.stdout.rows - 6 || 10, 12))
    const width = () => Math.max(44, Math.min(process.stdout.columns - 2 || 78, 120))

    const buildLines = (): string[] => {
      const items = filteredItems()
      const v = visibleRows()
      if (sel >= items.length) sel = Math.max(0, items.length - 1)
      if (sel < scroll) scroll = sel
      if (sel >= scroll + v) scroll = sel - v + 1
      if (items.length === 0) scroll = 0
      const rows = items.slice(scroll, scroll + v)
      const w = width()
      const lines: string[] = []
      lines.push(`${DIM}─ ${ACC(opts.title)} ${DIM}─${RESTORE}`)
      if (isFilterable) {
        const placeholderText = opts.placeholder ?? "type to filter"
        const display = filter ? c.brightCyan(filter) : DIM + placeholderText + RESTORE
        const label = filter ? ACC_DIM("Search:") : `${DIM}Search:${RESTORE}`
        lines.push(`${label} ${display}`)
      }
      if (items.length === 0) {
        lines.push(`${DIM}  (no match for "${filter}")${RESTORE}`)
        return lines
      }
      for (let i = 0; i < rows.length; i++) {
        const it = rows[i]!
        const picked = i === sel - scroll
        const label = `${it.provider ? it.provider + " › " : ""}${it.name}`.slice(0, w - 4)
        if (picked) lines.push(`  ${c.accent("›")} ${c.accent(c.bold(label))}${RESTORE}`)
        else lines.push(`   ${DIM}${label}${RESTORE}`)
      }
      if (items.length > scroll + v) {
        lines.push(`${DIM}… ${c.accent(String(items.length - scroll - v))} more${RESTORE}`)
      } else if (isFilterable && filter) {
        lines.push(
          `${DIM}  ${c.accent(String(items.length))}/${opts.items.length} matches${RESTORE}`,
        )
      }
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
        // Delete overlay lines to avoid 18 blank gap: move to first overlay line and delete each
        process.stdout.write("\r\n")
        for (let k = 0; k < prevRows; k++) {
          process.stdout.write(CLEAR)
          // Delete current line (removes blank gap)
          process.stdout.write("\x1b[1M")
        }
        prevRows = 0
      }
      process.stdout.write("\x1b[0m\x1b[?25h")
      process.stdout.write(SYNC_END)
      // Ensure cursor at next line after anchor for result
      process.stdout.write("\r\n")
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener("data", onData)
      process.stdout.removeListener("resize", onResize)
    }

    const onData = (chunk: Buffer) => {
      for (const d of decodeKeys(chunk)) {
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
              filter = filter.slice(0, -1)
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
          case "esc":
            if (isFilterable && filter.length > 0) {
              filter = ""
              sel = 0
              scroll = 0
              render()
              break
            }
          // fallthrough
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
