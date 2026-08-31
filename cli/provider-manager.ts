// Provider Manager window - VS Code palette

import { detectAndSave, loadConfig, removeProvider } from "../src/config.ts"
import { GATEWAY_PRESETS } from "../src/providers/presets.ts"
import { askLine, askSecret } from "../src/ui/input/input.ts"
import { decodeKeys } from "../src/ui/input/prompt-engine.ts"
import { c, glyphs } from "../src/ui/render/theme.ts"
import { padToWidth, truncateToWidth } from "../src/ui/render/width.ts"

const DIM = "\x1b[2m",
  RESTORE = "\x1b[22m",
  CLEAR = "\x1b[2K",
  SYNC_START = "\x1b[?2026h",
  SYNC_END = "\x1b[?2026l"

interface ProviderRow {
  id: string
  baseUrl: string
  models: number
  hint?: string
  firstModel?: string
}

export async function runProviderManager(opts: {
  cwd?: string
  currentModel?: string
  setModelOverride?: (m: string) => void
}): Promise<void> {
  if (!process.stdin.isTTY) {
    const cfg = await loadConfig(opts.cwd)
    console.log("\nProviders:")
    for (const p of cfg.providers)
      console.log(`  ${p.id} - ${p.baseUrl} (${p.models.length} models)`)
    return
  }

  let providers: ProviderRow[] = []
  let sel = 0
  let scroll = 0
  let prevRows = 0

  async function reload() {
    const cfg = await loadConfig(opts.cwd)
    providers = cfg.providers.map((p) => ({
      id: p.id,
      baseUrl: p.baseUrl,
      models: p.models.length,
      hint: p.providerHint,
      firstModel: p.models[0],
    }))
    if (sel >= providers.length) sel = Math.max(0, providers.length - 1)
    if (scroll > sel) scroll = sel
  }

  await reload()

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
            cut(`${DIM}… ${c.accent(String(providers.length - scroll - v))} lagi${RESTORE}`),
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
    let busy = false

    // Suspend: hapus overlay + lepas raw mode + listener sementara
    // (untuk askLine/askSecret di a/d/e). Tidak menyentuh `done` - manager
    // tetap hidup; resume() menggambar ulang overlay dari posisi kursor kini.
    const suspend = () => {
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

    const doAdd = async () => {
      if (busy) return
      busy = true
      suspend()
      console.log("\nAdd provider\n")
      GATEWAY_PRESETS.forEach((p, i) => {
        console.log(`  [${i}] ${p.label}`)
        console.log(`      ${p.baseUrl}`)
      })
      const customIdx = GATEWAY_PRESETS.length
      console.log(`  [${customIdx}] Custom URL\n`)
      const selStr = await askLine({ prompt: "Gateway > " })
      if (selStr == null) {
        console.log("Canceled")
        busy = false
        await reload()
        resume()
        return
      }
      const pick = selStr.trim()
      const idx = Number(pick)
      let baseUrl: string
      let fallbackModels: string[] = ["gpt-4o-mini"]
      let hintId: string | undefined
      if (Number.isInteger(idx) && idx >= 0 && idx < customIdx) {
        const preset = GATEWAY_PRESETS[idx]!
        baseUrl = preset.baseUrl
        fallbackModels = preset.fallbackModels
        hintId = preset.id
      } else if (idx === customIdx || (pick && !Number.isInteger(idx))) {
        const url = await askLine({ prompt: "Base URL > " })
        if (!url || !url.trim()) {
          console.log("Base URL is required.")
          busy = false
          await reload()
          resume()
          return
        }
        baseUrl = url.trim()
      } else {
        console.log(`${glyphs.cross} Unknown selection`)
        busy = false
        await reload()
        resume()
        return
      }
      const apiKey = await askSecret("API key: ")
      if (!apiKey) {
        console.log("API key is required.")
        busy = false
        await reload()
        resume()
        return
      }
      let scope: "global" | "local" = "global"
      if (opts.cwd) {
        const ans = await askLine({ prompt: "Save globally? [Y/n] " })
        scope = ans?.trim().toLowerCase() === "n" ? "local" : "global"
      }
      console.log("Detecting models…")
      try {
        const entry = await detectAndSave(baseUrl, apiKey, hintId, {
          global: scope === "global",
          cwd: opts.cwd,
          fallbackModels,
        })
        console.log(
          `${glyphs.check} Provider "${entry.id}" saved (${entry.models.length} models, ${scope}).`,
        )
      } catch (e) {
        console.log(`${glyphs.cross} Model detection failed: ${(e as Error).message.slice(0, 80)}`)
      }
      busy = false
      await reload()
      resume()
    }

    const doDelete = async () => {
      if (busy || providers.length === 0) return
      const target = providers[sel]
      if (!target) return
      busy = true
      suspend()
      // Konfirmasi menyebut DAMPAK, bukan hanya nama: berapa model ikut hilang,
      // dan apakah provider ini yang sedang dipakai. Tanpa itu user menekan "y"
      // tanpa tahu prompt berikutnya akan gagal.
      const aktif = opts.currentModel?.startsWith(`${target.id}::`)
      console.log(`\nDelete provider "${target.id}" and ${target.models} models?`)
      if (aktif) {
        console.log(`${glyphs.cross} Provider is active (${opts.currentModel}).`)
      }
      const ans = await askLine({ prompt: "Delete? [y/N] " })
      if (ans?.trim().toLowerCase() === "y") {
        await removeProvider(target.id, { global: true })
        if (opts.cwd) await removeProvider(target.id, { global: false, cwd: opts.cwd })
        console.log(`${glyphs.check} Provider "${target.id}" deleted.`)
      } else {
        console.log("Canceled")
      }
      busy = false
      await reload()
      resume()
    }

    const doEdit = async () => {
      if (busy || providers.length === 0) return
      const target = providers[sel]
      if (!target) return
      busy = true
      suspend()
      const cfg = await loadConfig(opts.cwd)
      const cur = cfg.providers.find((p) => p.id === target.id)
      if (!cur) {
        console.log("Provider not found")
        busy = false
        await reload()
        resume()
        return
      }
      console.log(`\nEdit provider "${target.id}"\n`)
      const newUrl = await askLine({ prompt: `Base URL [${cur.baseUrl}]: ` })
      const newKey = await askSecret("API key [****]: ")
      const baseUrl = newUrl && newUrl.trim() ? newUrl.trim() : cur.baseUrl
      const apiKey = newKey && newKey.trim() ? newKey.trim() : cur.apiKey
      if (baseUrl === cur.baseUrl && apiKey === cur.apiKey) {
        console.log("No changes.")
      } else {
        console.log("Detecting models…")
        try {
          await removeProvider(target.id, { global: true })
          if (opts.cwd) await removeProvider(target.id, { global: false, cwd: opts.cwd })
          const entry = await detectAndSave(baseUrl, apiKey, target.id, {
            global: true,
            cwd: opts.cwd,
            fallbackModels: cur.models,
          })
          console.log(
            `${glyphs.check} Provider "${entry.id}" updated (${entry.models.length} models)`,
          )
        } catch (e) {
          console.log(`${glyphs.cross} Update failed: ${(e as Error).message.slice(0, 80)}`)
          await detectAndSave(cur.baseUrl, cur.apiKey, cur.id, {
            global: true,
            cwd: opts.cwd,
            fallbackModels: cur.models,
          }).catch(() => {})
        }
      }
      busy = false
      await reload()
      resume()
    }

    const onData = (chunk: Buffer) => {
      if (busy) return
      for (const d of decodeKeys(chunk)) {
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
            if (p && p.firstModel && opts.setModelOverride) {
              opts.setModelOverride(`${p.id}::${p.firstModel}`)
            }
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
