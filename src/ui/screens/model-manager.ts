// View minimal model registry — list, select, add, remove. Data dan mutasi
// config mengalir lewat callback dari controller (cli/model-manager.ts).
import { askLine } from "../input/input.ts"
import { decodeKeys } from "../input/prompt-engine.ts"

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
  let selected = Math.max(
    0,
    rows.findIndex((r) => r.active),
  )

  return new Promise<void>((resolve) => {
    const render = () => {
      console.log("\nModels")
      if (!rows.length) console.log("  No models configured.")
      for (const [i, row] of rows.entries()) {
        console.log(`${i === selected ? ">" : " "} ${row.id}${row.active ? "  active" : ""}`)
      }
      console.log("\na add  d delete  Enter select  Esc close")
    }
    const finish = () => {
      process.stdin.removeListener("data", onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      resolve()
    }
    const onData = (chunk: Buffer) => {
      for (const item of decodeKeys(chunk)) {
        if (item.key.type === "esc" || item.key.type === "ctrl-c" || item.key.type === "ctrl-d") {
          finish()
          return
        }
        if (item.key.type === "up") selected = Math.max(0, selected - 1)
        else if (item.key.type === "down") selected = Math.min(rows.length - 1, selected + 1)
        else if (item.key.type === "enter") {
          const row = rows[selected]
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
    }
    const addModel = async () => {
      process.stdin.removeListener("data", onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      const providerId = await askLine({ prompt: "Provider: " })
      const model = await askLine({ prompt: "Model: " })
      rows =
        providerId?.trim() && model?.trim()
          ? await opts.onAdd(providerId.trim(), model.trim())
          : await opts.loadRows()
      selected = Math.min(Math.max(0, selected), Math.max(0, rows.length - 1))
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on("data", onData)
      render()
    }
    const deleteModel = async () => {
      const row = rows[selected]
      if (!row) return
      process.stdin.removeListener("data", onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      const answer = await askLine({ prompt: `Delete ${row.id}? [y/N] ` })
      rows =
        answer?.trim().toLowerCase() === "y" ? await opts.onDelete(row.id) : await opts.loadRows()
      selected = Math.min(Math.max(0, selected), Math.max(0, rows.length - 1))
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on("data", onData)
      render()
    }
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on("data", onData)
    render()
  })
}
