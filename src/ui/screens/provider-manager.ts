// Provider Manager window — VS Code palette. Murni presentasi: render daftar,
// loop keyboard, dan dialog a/d/e; semua akses config lewat callback yang
// di-inject controller (cli/provider-manager.ts).

import { askLine, askSecret } from "../input/input.ts"
import { createDecoderState, type DecoderState, decodeKeysStream } from "../input/prompt-engine.ts"
import { sanitizeAnsiLine } from "../render/sanitize.ts"
import { c, glyphs } from "../render/theme.ts"
import { padToWidth, truncateToWidth } from "../render/width.ts"
import { clearTransientOverlay, renderTransientOverlay } from "./overlay.ts"

const DIM = "\x1b[2m",
  RESTORE = "\x1b[22m"

export interface ProviderRow {
  id: string
  baseUrl: string
  models: number
  hint?: string
  firstModel?: string
}

export interface ProviderPresetView {
  id: string
  label: string
  baseUrl: string
}

export interface ProviderActionResult {
  ok?: string
  err?: string
}

export interface ProviderManagerViewOptions {
  initialRows: ProviderRow[]
  presets: readonly ProviderPresetView[]
  currentModel?: string
  /** true bila ada cwd — dialog tambah menawarkan scope global/lokal. */
  askScope: boolean
  onSelect(row: ProviderRow): void
  /** Ambil baris terbaru dari controller setelah tiap aksi. */
  loadRows(): Promise<ProviderRow[]>
  onAdd(input: {
    preset?: ProviderPresetView
    baseUrl: string
    apiKey: string
    scope: "global" | "local"
  }): Promise<ProviderActionResult>
  onDelete(row: ProviderRow): Promise<ProviderActionResult>
  onEditDefaults(row: ProviderRow): Promise<{ baseUrl: string; apiKey: string } | null>
  onEditSave(
    row: ProviderRow,
    input: { baseUrl: string; apiKey: string },
  ): Promise<ProviderActionResult>
}

export async function runProviderManagerView(opts: ProviderManagerViewOptions): Promise<void> {
  let providers: ProviderRow[] = opts.initialRows
  let sel = 0
  let scroll = 0
  let prevRows = 0

  async function reload() {
    providers = await opts.loadRows()
    if (sel >= providers.length) sel = Math.max(0, providers.length - 1)
    if (scroll > sel) scroll = sel
  }

  return new Promise<void>((resolve) => {
    // Ukuran mengikuti terminal SUNGGUHAN (lihat picker.ts untuk alasan sama).
    const visibleRows = () => Math.max(1, Math.min((process.stdout.rows || 24) - 4, 14))
    const width = () => Math.max(12, (process.stdout.columns || 80) - 2)

    const buildLines = (): string[] => {
      const v = visibleRows()
      if (sel < scroll) scroll = sel
      if (sel >= scroll + v) scroll = sel - v + 1
      const w = width()
      const cut = (s: string) => truncateToWidth(s, w)
      const rows = providers.slice(scroll, scroll + v)
      const lines: string[] = []
      lines.push(
        cut(
          `${DIM}─ ${c.accent(c.bold("Providers"))}${providers.length ? ` ${DIM}(${providers.length})${RESTORE}` : ""} ${DIM}─${RESTORE}`,
        ),
      )
      if (providers.length === 0) {
        lines.push(cut(`${DIM}  No providers${RESTORE}`))
      } else {
        for (let i = 0; i < rows.length; i++) {
          const it = rows[i]!
          const picked = i === sel - scroll
          // Tandai provider yang sedang aktif supaya user tahu apa yang akan
          // hilang bila ia menekan d.
          const aktif = opts.currentModel?.startsWith(`${it.id}::`) ? " (active)" : ""
          const label = truncateToWidth(
            `${padToWidth(it.id, 18)} ${padToWidth(String(it.models), 3, "right")} models  ${it.baseUrl}${aktif}`,
            w - 4,
          )
          if (picked) lines.push(`  ${c.accent("›")} ${c.accent(c.bold(label))}${RESTORE}`)
          else lines.push(`   ${DIM}${label}${RESTORE}`)
        }
        if (providers.length > scroll + v) {
          lines.push(
            cut(`${DIM}… ${c.accent(String(providers.length - scroll - v))} more${RESTORE}`),
          )
        }
      }
      lines.push("")
      lines.push(
        cut(
          `${DIM}Enter:${RESTORE}${c.accent("select")}  ${DIM}a:${RESTORE}${c.accent("add")}  ${DIM}d:${RESTORE}${c.accent("delete")}  ${DIM}e:${RESTORE}${c.accent("edit")}  ${DIM}Esc:${RESTORE}${c.accent("close")}${RESTORE}`,
        ),
      )
      return lines
    }

    const render = () => {
      prevRows = renderTransientOverlay(buildLines(), prevRows)
    }

    let done = false
    let busy = false

    // Suspend: hapus overlay + lepas raw mode + listener sementara
    // (untuk askLine/askSecret di a/d/e). Tidak menyentuh `done` - manager
    // tetap hidup; resume() menggambar ulang overlay dari posisi kursor kini.
    const suspend = () => {
      prevRows = clearTransientOverlay(prevRows)
      process.stdout.write("\x1b[0m\x1b[?25h")
      // TIDAK menulis \r\n di sini: clearTransientOverlay sudah menaruh kursor
      // kembali ke anchor. \r\n sebelumnya membuat baris kosong permanen di
      // scrollback (append-only) — gap 1 baris tiap kali a/d/e dipakai.
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener("data", onData)
      process.stdout.removeListener("resize", onResize)
    }
    // Resume: pasang ulang raw mode + listener + render.
    const resume = () => {
      process.stdin.setMaxListeners(0)
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.on("data", onData)
      process.stdout.on("resize", onResize)
      render()
    }
    // Close final: suspend + tandai selesai (manager tidak bisa dibuka lagi).
    const cleanup = () => {
      if (done) return
      done = true
      suspend()
    }

    // SEMUA aksi a/d/e lewat sini: busy guard + suspend, lalu SELALU resume di
    // finally. Tanpa finally, exception di onAdd/askLine (atau loadRows) membuat
    // busy tetap true → onData menolak semua input → manager terkunci selamanya.
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
          await reload().catch(() => {})
          resume()
        }
      })()

    const doAdd = () =>
      runAction(async () => {
        console.log("\nAdd provider\n")
        opts.presets.forEach((p, i) => {
          console.log(`  [${i}] ${p.label}`)
          console.log(`      ${p.baseUrl}`)
        })
        const customIdx = opts.presets.length
        console.log(`  [${customIdx}] Custom URL\n`)
        const selStr = await askLine({ prompt: "Gateway > " })
        if (selStr == null) {
          console.log("Canceled")
          return
        }
        const pick = selStr.trim()
        const idx = Number(pick)
        let preset: ProviderPresetView | undefined
        let baseUrl: string
        if (Number.isInteger(idx) && idx >= 0 && idx < customIdx) {
          preset = opts.presets[idx]!
          baseUrl = preset.baseUrl
        } else if (idx === customIdx || (pick && !Number.isInteger(idx))) {
          const url = await askLine({ prompt: "Base URL > " })
          if (!url?.trim()) {
            console.log("Base URL is required.")
            return
          }
          baseUrl = url.trim()
        } else {
          console.log(`${glyphs.cross} Unknown selection`)
          return
        }
        const apiKey = await askSecret("API key: ")
        if (!apiKey) {
          console.log("API key is required.")
          return
        }
        let scope: "global" | "local" = "global"
        if (opts.askScope) {
          const ans = await askLine({ prompt: "Save globally? [Y/n] " })
          scope = ans?.trim().toLowerCase() === "n" ? "local" : "global"
        }
        console.log("Detecting models…")
        const res = await opts.onAdd({ preset, baseUrl, apiKey, scope })
        // Hasil dari jaringan/config — sanitasi sebelum tampil di scrollback.
        if (res.ok) console.log(`${glyphs.check} ${sanitizeAnsiLine(res.ok)}`)
        else if (res.err) console.log(`${glyphs.cross} ${sanitizeAnsiLine(res.err)}`)
      })

    const doDelete = () => {
      if (providers.length === 0) return
      const target = providers[sel]
      if (!target) return
      return runAction(async () => {
        // Konfirmasi menyebut DAMPAK, bukan hanya nama: berapa model ikut hilang,
        // dan apakah provider ini yang sedang dipakai. Tanpa itu user menekan "y"
        // tanpa tahu prompt berikutnya akan gagal.
        const active = opts.currentModel?.startsWith(`${target.id}::`)
        console.log(`\nDelete provider "${target.id}" and ${target.models} models?`)
        if (active) {
          console.log(`${glyphs.cross} Provider is active (${opts.currentModel}).`)
        }
        const ans = await askLine({ prompt: "Delete? [y/N] " })
        if (ans?.trim().toLowerCase() === "y") {
          const res = await opts.onDelete(target)
          if (res.ok) console.log(`${glyphs.check} ${res.ok}`)
          else if (res.err) console.log(`${glyphs.cross} ${res.err}`)
        } else {
          console.log("Canceled")
        }
      })
    }

    const doEdit = () => {
      if (providers.length === 0) return
      const target = providers[sel]
      if (!target) return
      return runAction(async () => {
        const defaults = await opts.onEditDefaults(target)
        if (!defaults) {
          console.log("Provider not found")
          return
        }
        console.log(`\nEdit provider "${target.id}"\n`)
        const newUrl = await askLine({ prompt: `Base URL [${defaults.baseUrl}]: ` })
        const newKey = await askSecret("API key [****]: ")
        const baseUrl = newUrl?.trim() ? newUrl.trim() : defaults.baseUrl
        const apiKey = newKey?.trim() ? newKey.trim() : defaults.apiKey
        if (baseUrl === defaults.baseUrl && apiKey === defaults.apiKey) {
          console.log("No changes.")
        } else {
          console.log("Detecting models…")
          const res = await opts.onEditSave(target, { baseUrl, apiKey })
          if (res.ok) console.log(`${glyphs.check} ${res.ok}`)
          else if (res.err) console.log(`${glyphs.cross} ${res.err}`)
        }
      })
    }

    const decoder: DecoderState = createDecoderState()
    const onData = (chunk: Buffer) => {
      if (busy) return
      try {
        for (const d of decodeKeysStream(chunk, decoder)) {
          switch (d.key.type) {
            case "up":
              sel = Math.max(0, sel - 1)
              render()
              break
            case "down":
              sel = Math.min(providers.length - 1, sel + 1)
              render()
              break
            case "char": {
              const ch = d.key.ch.toLowerCase()
              if (ch === "a") {
                void doAdd()
                return
              }
              if (ch === "d") {
                void doDelete()
                return
              }
              if (ch === "e") {
                void doEdit()
                return
              }
              break
            }
            case "enter": {
              // Set model sync dari data yang sudah dimuat - tidak ada console.log
              // dan tidak ada async yang nembak setelah resolve (menghentikan REPL).
              const p = providers[sel]
              if (p) opts.onSelect(p)
              cleanup()
              resolve()
              return
            }
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
      } catch {
        cleanup()
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
      cleanup()
    }
  })
}
