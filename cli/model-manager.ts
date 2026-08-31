// Controller model registry — CRUD config; tampilannya di
// src/ui/screens/model-manager.ts.
import { loadConfig, type ProviderEntry } from "../src/config.ts"
import { saveProvider } from "../src/providers/provision.ts"
import { type ModelRow, runModelManagerView } from "../src/ui/screens/model-manager.ts"

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

  const rowsOf = (providers: ProviderEntry[]): ModelRow[] =>
    providers.flatMap((p) =>
      p.models.map((model) => ({
        id: `${p.id}::${model}`,
        active: `${p.id}::${model}` === opts.currentModel,
      })),
    )
  // Simpan ke scope yang sama dengan asal config aktif: tanpa cwd, atau tanpa
  // config lokal, targetnya global.
  const saveGlobal = async () =>
    !opts.cwd || !(await Bun.file(`${opts.cwd}/.minicode/config.json`).exists())

  return runModelManagerView({
    initialRows: rowsOf(cfg.providers),
    onSelect: (id) => opts.setModelOverride?.(id),
    loadRows: async () => rowsOf((await loadConfig(opts.cwd)).providers),
    onAdd: async (providerId, model) => {
      const next = await loadConfig(opts.cwd)
      const provider = next.providers.find((p) => p.id === providerId)
      if (provider && !provider.models.includes(model)) {
        provider.models = [...provider.models, model]
        await saveProvider(provider, { global: await saveGlobal(), cwd: opts.cwd })
      }
      return rowsOf((await loadConfig(opts.cwd)).providers)
    },
    onDelete: async (id) => {
      const sep = id.indexOf("::")
      const next = await loadConfig(opts.cwd)
      const provider = next.providers.find((p) => p.id === id.slice(0, sep))
      const model = id.slice(sep + 2)
      if (provider) {
        provider.models = provider.models.filter((m) => m !== model)
        await saveProvider(provider, { global: await saveGlobal(), cwd: opts.cwd })
      }
      return rowsOf((await loadConfig(opts.cwd)).providers)
    },
  })
}
