// Provider Manager window - VS Code palette

import { detectAndSave, loadConfig, removeProvider } from "../src/config.ts"
import { GATEWAY_PRESETS } from "../src/providers/presets.ts"
import { c } from "../src/tui/theme.ts"
import { askLine, askSecret } from "./input.ts"
import { decodeKeys } from "./prompt-engine.ts"

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
    const visibleRows = () => Math.max(4, Math.min(process.stdout.rows - 8 || 10, 14))
    const width = () => Math.max(50, Math.min(process.stdout.columns - 4 || 78, 100))

    const buildLines = (): string[] => {
      const v = visibleRows()
      if (sel < scroll) scroll = sel
      if (sel >= scroll + v) scroll = sel - v + 1
      const w = width()
      const rows = providers.slice(scroll, scroll + v)
      const lines: string[] = []
      lines.push(
        `${DIM}─ ${c.accent(c.bold("Providers"))}${providers.length ? ` ${DIM}(${providers.length})${RESTORE}` : ""} ${DIM}─${RESTORE}`,
      )
      if (providers.length === 0) {
        lines.push(`${DIM}  (no providers - press a to add)${RESTORE}`)
      } else {
        for (let i = 0; i < rows.length; i++) {
          const it = rows[i]!
          const picked = i === sel - scroll
          const label =
            `${it.id.padEnd(18)} ${String(c.accent(String(it.models))).padStart(3)} models  ${it.baseUrl}`.slice(
              0,
              w - 4,
            )
          if (picked) lines.push(`  ${c.accent("›")} ${c.accent(c.bold(label))}${RESTORE}`)
          else lines.push(`   ${DIM}${label}${RESTORE}`)
        }
        if (providers.length > scroll + v) {
          lines.push(`${DIM}… ${c.accent(String(providers.length - scroll - v))} more${RESTORE}`)
        }
      }
      lines.push("")
      lines.push(
        `${DIM}Enter:${RESTORE}${c.accent("set active")}  ${DIM}a:${RESTORE}${c.accent("add")}  ${DIM}d:${RESTORE}${c.accent("delete")}  ${DIM}e:${RESTORE}${c.accent("edit")}  ${DIM}Esc:${RESTORE}${c.accent("close")}${RESTORE}`,
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
      console.log("\nAdd New Provider\n")
      GATEWAY_PRESETS.forEach((p, i) => {
        console.log(`  [${i}] ${p.label}`)
        console.log(`      ${p.baseUrl}`)
      })
      const customIdx = GATEWAY_PRESETS.length
      console.log(`  [${customIdx}] Custom baseUrl\n`)
      const selStr = await askLine({ prompt: "select gateway # > " })
      if (selStr == null) {
        console.log("canceled")
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
          console.log("Base URL required.")
          busy = false
          await reload()
          resume()
          return
        }
        baseUrl = url.trim()
      } else {
        console.log("[FAIL] Unknown selection")
        busy = false
        await reload()
        resume()
        return
      }
      const apiKey = await askSecret("API Key (masked): ")
      if (!apiKey) {
        console.log("API Key required.")
        busy = false
        await reload()
        resume()
        return
      }
      let scope: "global" | "local" = "global"
      if (opts.cwd) {
        const ans = await askLine({ prompt: "Save globally to ~/.minicode? [Y/n] " })
        scope = ans?.trim().toLowerCase() === "n" ? "local" : "global"
      }
      console.log("Detecting models...")
      try {
        const entry = await detectAndSave(baseUrl, apiKey, hintId, {
          global: scope === "global",
          cwd: opts.cwd,
          fallbackModels,
        })
        console.log(`[OK] Provider "${entry.id}" saved (${entry.models.length} models, ${scope}).`)
      } catch (e) {
        console.log(`[FAIL] Detection failed: ${(e as Error).message.slice(0, 80)}`)
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
      const ans = await askLine({ prompt: `Delete "${target.id}"? [y/N] > ` })
      if (ans?.trim().toLowerCase() === "y") {
        await removeProvider(target.id, { global: true })
        if (opts.cwd) await removeProvider(target.id, { global: false, cwd: opts.cwd })
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
      console.log(`\nEdit provider "${target.id}" (leave blank to keep)\n`)
      const newUrl = await askLine({ prompt: `Base URL [${cur.baseUrl}]: ` })
      const newKey = await askSecret(`API Key [****]: `)
      const baseUrl = newUrl && newUrl.trim() ? newUrl.trim() : cur.baseUrl
      const apiKey = newKey && newKey.trim() ? newKey.trim() : cur.apiKey
      if (baseUrl === cur.baseUrl && apiKey === cur.apiKey) {
        console.log("No changes.")
      } else {
        console.log("Detecting models...")
        try {
          await removeProvider(target.id, { global: true })
          if (opts.cwd) await removeProvider(target.id, { global: false, cwd: opts.cwd })
          const entry = await detectAndSave(baseUrl, apiKey, target.id, {
            global: true,
            cwd: opts.cwd,
            fallbackModels: cur.models,
          })
          console.log(`[OK] Updated "${entry.id}" (${entry.models.length} models)`)
        } catch (e) {
          console.log(`[FAIL] ${(e as Error).message.slice(0, 80)}`)
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
