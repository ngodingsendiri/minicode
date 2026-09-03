// View model registry — pola overlay transient yang konsisten dengan picker/
// provider-manager. Tetap shell-like: overlay sementara, hasil aksi tetap inline.
import { askLine } from "../input/input.ts"
import { createDecoderState, type DecoderState, decodeKeysStream } from "../input/prompt-engine.ts"
import { c } from "../render/theme.ts"
import { padToWidth, truncateToWidth } from "../render/width.ts"
import { clearTransientOverlay, renderTransientOverlay } from "./overlay.ts"

const DIM = "\x1b[2m",
  RESTORE = "\x1b[22m"

export interface ModelRow {
  /** Format "providerId::model". */
  id: string
  active: boolean
}

export interface ModelManagerViewOptions {
  initialRows: ModelRow[]
  onSelect(id: string): void
  /** Ambil baris terbaru setelah mutasi (atau saat add batal). */
  loadRows(): Promise<ModelRow[]>
  onAdd(providerId: string, model: string): Promise<ModelRow[]>
  onDelete(id: string): Promise<ModelRow[]>
}

export async function runModelManagerView(opts: ModelManagerViewOptions): Promise<void> {
  let rows = opts.initialRows
  let sel = Math.max(
    0,
    rows.findIndex((r) => r.active),
  )
  let scroll = 0
  let prevRows = 0

  return new Promise<void>((resolve) => {
    const visibleRows = () => Math.max(1, Math.min((process.stdout.rows || 24) - 4, 14))
    const width = () => Math.max(12, (process.stdout.columns || 80) - 2)

    const buildLines = (): string[] => {
      const v = visibleRows()
      if (sel < scroll) scroll = sel
      if (sel >= scroll + v) scroll = sel - v + 1
      const w = width()
      const cut = (s: string) => truncateToWidth(s, w)
      const view = rows.slice(scroll, scroll + v)
      const lines: string[] = []
      lines.push(
        cut(
          `${DIM}─ ${c.accent(c.bold("Models"))}${rows.length ? ` ${DIM}(${rows.length})${RESTORE}` : ""} ${DIM}─${RESTORE}`,
        ),
      )
      if (!rows.length) {
        lines.push(cut(`${DIM}  No models configured${RESTORE}`))
      } else {
        for (let i = 0; i < view.length; i++) {
          const row = view[i]!
          const picked = i === sel - scroll
          const label = truncateToWidth(
            `${padToWidth(row.id, w - 14)}${row.active ? "  active" : ""}`,
            w - 4,
          )
          if (picked) lines.push(`  ${c.accent("›")} ${c.accent(c.bold(label))}${RESTORE}`)
          else lines.push(`   ${DIM}${label}${RESTORE}`)
        }
        if (rows.length > scroll + v) {
          lines.push(cut(`${DIM}… ${c.accent(String(rows.length - scroll - v))} more${RESTORE}`))
        }
      }
      lines.push("")
      lines.push(
        cut(
          `${DIM}Enter:${RESTORE}${c.accent("select")}  ${DIM}a:${RESTORE}${c.accent("add")}  ${DIM}d:${RESTORE}${c.accent("delete")}  ${DIM}Esc:${RESTORE}${c.accent("close")}${RESTORE}`,
        ),
      )
      return lines
    }

    const render = () => {
      prevRows = renderTransientOverlay(buildLines(), prevRows)
    }

    let busy = false
    let done = false

    const suspend = () => {
      prevRows = clearTransientOverlay(prevRows)
      process.stdout.write("\x1b[0m\x1b[?25h")
      // TIDAK menulis \r\n — clearTransientOverlay sudah kembali ke anchor.
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener("data", onData)
      process.stdout.removeListener("resize", onResize)
    }

    const resume = () => {
      process.stdin.setMaxListeners(0)
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on("data", onData)
      process.stdout.on("resize", onResize)
      render()
    }

    const finish = () => {
      if (done) return
      done = true
      suspend()
      resolve()
    }

    const runAction = (fn: () => Promise<void>) =>
      (async () => {
        if (busy) return
        busy = true
        suspend()
        try {
          await fn()
        } catch (e) {
          console.error(`[model-manager] ${(e as Error).message}`)
        } finally {
          busy = false
          await loadRowsSafe()
          resume()
        }
      })()

    const loadRowsSafe = async () => {
      try {
        rows = await opts.loadRows()
      } catch {}
      sel = Math.min(Math.max(0, sel), Math.max(0, rows.length - 1))
    }

    const addModel = () =>
      runAction(async () => {
        const providerId = await askLine({ prompt: "Provider > " })
        const model = await askLine({ prompt: "Model > " })
        rows =
          providerId?.trim() && model?.trim()
            ? await opts.onAdd(providerId.trim(), model.trim())
            : await opts.loadRows()
        sel = Math.min(Math.max(0, sel), Math.max(0, rows.length - 1))
      })

    const deleteModel = () => {
      if (rows.length === 0) return
      const row = rows[sel]
      if (!row) return
      return runAction(async () => {
        const answer = await askLine({ prompt: `Delete ${row.id}? [y/N] ` })
        rows =
          answer?.trim().toLowerCase() === "y" ? await opts.onDelete(row.id) : await opts.loadRows()
        sel = Math.min(Math.max(0, sel), Math.max(0, rows.length - 1))
      })
    }

    const decoder: DecoderState = createDecoderState()
    const onData = (chunk: Buffer) => {
      if (busy) return
      try {
        for (const item of decodeKeysStream(chunk, decoder)) {
          if (item.key.type === "esc" || item.key.type === "ctrl-c" || item.key.type === "ctrl-d") {
            finish()
            return
          }
          if (item.key.type === "up") sel = Math.max(0, sel - 1)
          else if (item.key.type === "down") sel = Math.min(rows.length - 1, sel + 1)
          else if (item.key.type === "enter") {
            const row = rows[sel]
            if (row) opts.onSelect(row.id)
            finish()
            return
          } else if (item.key.type === "char" && item.key.ch.toLowerCase() === "a") {
            void addModel()
            return
          } else if (item.key.type === "char" && item.key.ch.toLowerCase() === "d") {
            void deleteModel()
            return
          }
        }
        render()
      } catch {
        finish()
      }
    }

    const onResize = () => render()

    process.stdout.write("\x1b[?25l")
    try {
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setMaxListeners(0)
      process.stdin.on("data", onData)
      process.stdout.on("resize", onResize)
      render()
    } catch {
      finish()
    }
  })
}
