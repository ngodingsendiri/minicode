// View model registry — pola overlay transient yang konsisten dengan picker/
// provider-manager. Tetap shell-like: overlay sementara, hasil aksi tetap inline.
import { askLine } from "../input/input.ts"
import { createDecoderState, type DecoderState, decodeKeysStream } from "../input/prompt-engine.ts"
import { c, glyphs } from "../render/theme.ts"
import { padToWidth, truncateToWidth } from "../render/width.ts"
import { clearTransientOverlay, renderTransientOverlay } from "./overlay.ts"
import { runPicker } from "./picker.ts"

const DIM = "\x1b[2m",
  RESTORE = "\x1b[22m"

export interface ModelRow {
  /** Format "providerId::model". */
  id: string
  active: boolean
  /** Effort tersimpan provider ini; absen/"default" = tanpa badge. */
  effort?: string
}

export interface ModelManagerViewOptions {
  initialRows: ModelRow[]
  onSelect(id: string): void | Promise<void>
  /** Ambil baris terbaru setelah mutasi (atau saat add batal). */
  loadRows(): Promise<ModelRow[]>
  onAdd(providerId: string, model: string): Promise<ModelRow[]>
  onDelete(id: string): Promise<ModelRow[]>
  onSetEffort?(id: string, effort: "default" | "low" | "medium" | "high"): Promise<ModelRow[]>
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
    // Lantai lebar tak boleh melebihi terminal (floor 12 lama membungkus di
    // kolom ≤13) — sama seperti picker/provider-manager.
    const width = () => Math.max(8, (process.stdout.columns || 80) - 2)

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
          // Badge effort hanya bila non-default — default adalah kondisi normal
          // yang tak perlu diumumkan tiap baris (minimalis).
          const badge = row.effort && row.effort !== "default" ? ` [${row.effort}]` : ""
          const label = truncateToWidth(
            `${padToWidth(`${row.id}${badge}`, w - 14)}${row.active ? "  active" : ""}`,
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
          `${DIM}Enter:${RESTORE}${c.accent("select+thinking")}  ${DIM}a:${RESTORE}${c.accent("add")}  ${DIM}d:${RESTORE}${c.accent("delete")}  ${DIM}Esc:${RESTORE}${c.accent("close")}${RESTORE}`,
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
          console.log(`${glyphs.cross} ${(e as Error).message}`)
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
        // Batal (Esc/Ctrl+C di baris kosong = null) harus berhenti DI SINI —
        // kalau lanjut ke prompt berikutnya, batal di prompt pertama terasa
        // seperti pindah pertanyaan.
        if (providerId == null) {
          console.log("Canceled")
          return
        }
        const model = await askLine({ prompt: "Model > " })
        if (model == null) {
          console.log("Canceled")
          return
        }
        if (!providerId.trim() || !model.trim()) {
          // Isian kosong (Enter tanpa teks) — beri tahu, jangan diam.
          console.log("Canceled")
          return
        }
        const prevCount = rows.length
        rows = await opts.onAdd(providerId.trim(), model.trim())
        // Panjang tak berubah = model sudah ada (bukan error — provider
        // ditemukan, onAdd tak lempar). Laporkan jujur, bukan "added".
        if (rows.length === prevCount)
          console.log(`${glyphs.dot} ${providerId.trim()}::${model.trim()} already exists`)
        else console.log(`${glyphs.check} added ${providerId.trim()}::${model.trim()}`)
        sel = Math.min(Math.max(0, sel), Math.max(0, rows.length - 1))
      })

    const deleteModel = () => {
      if (rows.length === 0) return
      const row = rows[sel]
      if (!row) return
      return runAction(async () => {
        // Model AKTIF yang dihapus membuat prompt berikutnya kehilangan model
        // tanpa sebab yang terlihat — sebutkan seperti provider-manager.
        const prefix = row.active ? "Delete ACTIVE model" : "Delete model"
        const answer = await askLine({ prompt: `${prefix} ${row.id}? [y/N] ` })
        if (answer?.trim().toLowerCase() === "y") {
          rows = await opts.onDelete(row.id)
          console.log(`${glyphs.check} deleted ${row.id}`)
        } else {
          console.log("Canceled")
          rows = await opts.loadRows()
        }
        sel = Math.min(Math.max(0, sel), Math.max(0, rows.length - 1))
      })
    }

    // Picker effort dipakai alur Enter (wajib) — satu-satunya jalan atur
    // effort sejak tombol `t` dihapus. Dipanggil saat manager di-suspend,
    // sehingga raw mode/lisener milik picker, bukan manager.
    const pickEffort = (): Promise<"default" | "low" | "medium" | "high" | null> =>
      new Promise<string | null>((resolvePick) => {
        void runPicker({
          title: "Thinking effort",
          items: [
            { name: "default", provider: "", value: "default" },
            { name: "low", provider: "", value: "low" },
            { name: "medium", provider: "", value: "medium" },
            { name: "high", provider: "", value: "high" },
          ],
          onPick: (v) => resolvePick(v),
          onCancel: () => resolvePick(null),
        })
      }).then((picked) =>
        picked && ["default", "low", "medium", "high"].includes(picked)
          ? (picked as "default" | "low" | "medium" | "high")
          : null,
      )

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
          else if (item.key.type === "down")
            sel = rows.length ? Math.min(rows.length - 1, sel + 1) : 0
          else if (item.key.type === "enter") {
            const row = rows[sel]
            if (!row) return // daftar kosong: jangan tutup (footer bilang select)
            if (busy) return
            busy = true
            suspend()
            // Alur: picker effort DULU, baru select+simpan. Dibalik (select
            // dulu) akan butuh rollback saat Esc — dipilih yang tanpa rollback:
            // Esc = batal total, kembali ke daftar tanpa select/simpan.
            ;(async () => {
              try {
                const picked = await pickEffort()
                if (!picked) {
                  busy = false
                  await loadRowsSafe()
                  resume()
                  return
                }
                try {
                  await opts.onSelect(row.id)
                  if (opts.onSetEffort) {
                    await opts.onSetEffort(row.id, picked)
                    console.log(`Thinking: ${picked} (next session)`)
                  }
                } catch (e) {
                  // Jangan tutup diam-diam: pilih model yang gagal harus
                  // terlihat, bukan dianggap sukses (manager lalu hilang).
                  console.log(`${glyphs.cross} ${(e as Error).message}`)
                } finally {
                  finish()
                }
              } catch {
                finish()
              }
            })()
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
