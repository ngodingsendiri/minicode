import { loadConfig, saveProvider } from "../src/config.ts"
import { askLine } from "./input.ts"
import { decodeKeys } from "./prompt-engine.ts"

/** Minimal model registry: list, select, add, and remove. */
export async function runModelManager(opts: {
  cwd?: string
  currentModel?: string
  setModelOverride?: (model: string) => void
}): Promise<void> {
  const cfg = await loadConfig(opts.cwd)
  if (!process.stdin.isTTY) {
    for (const p of cfg.providers) for (const model of p.models) console.log(`${p.id}::${model}`)
    return
  }

  let rows = cfg.providers.flatMap((p) => p.models.map((model) => ({ provider: p, model })))
  let selected = Math.max(
    0,
    rows.findIndex((r) => `${r.provider.id}::${r.model}` === opts.currentModel),
  )

  const reload = async () => {
    const next = await loadConfig(opts.cwd)
    rows = next.providers.flatMap((p) => p.models.map((model) => ({ provider: p, model })))
    selected = Math.min(Math.max(0, selected), Math.max(0, rows.length - 1))
  }

  return new Promise<void>((resolve) => {
    const render = () => {
      console.log("\nModels")
      if (!rows.length) console.log("  No models configured.")
      for (const [i, row] of rows.entries()) {
        const id = `${row.provider.id}::${row.model}`
        console.log(
          `${i === selected ? ">" : " "} ${id}${id === opts.currentModel ? "  active" : ""}`,
        )
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
          if (row && opts.setModelOverride)
            opts.setModelOverride(`${row.provider.id}::${row.model}`)
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
      const provider = cfg.providers.find((p) => p.id === providerId?.trim())
      if (provider && model?.trim() && !provider.models.includes(model.trim())) {
        provider.models = [...provider.models, model.trim()]
        await saveProvider(provider, {
          global: !opts.cwd || !(await Bun.file(`${opts.cwd}/.minicode/config.json`).exists()),
          cwd: opts.cwd,
        })
      }
      await reload()
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
      const answer = await askLine({ prompt: `Delete ${row.provider.id}::${row.model}? [y/N] ` })
      if (answer?.trim().toLowerCase() === "y") {
        row.provider.models = row.provider.models.filter((model) => model !== row.model)
        await saveProvider(row.provider, {
          global: !opts.cwd || !(await Bun.file(`${opts.cwd}/.minicode/config.json`).exists()),
          cwd: opts.cwd,
        })
      }
      await reload()
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
