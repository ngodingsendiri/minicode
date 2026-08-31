// Controller provider manager — CRUD config + deteksi model; tampilannya di
// src/ui/screens/provider-manager.ts.

import { loadConfig, type MinicodeConfig } from "../src/config.ts"
import { GATEWAY_PRESETS } from "../src/providers/presets.ts"
import { detectAndSave, removeProvider } from "../src/providers/provision.ts"
import {
  type ProviderActionResult,
  type ProviderRow,
  runProviderManagerView,
} from "../src/ui/screens/provider-manager.ts"

const rowsFrom = (cfg: MinicodeConfig): ProviderRow[] =>
  cfg.providers.map((p) => ({
    id: p.id,
    baseUrl: p.baseUrl,
    models: p.models.length,
    hint: p.providerHint,
    firstModel: p.models[0],
  }))

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

  await runProviderManagerView({
    initialRows: rowsFrom(await loadConfig(opts.cwd)),
    presets: GATEWAY_PRESETS.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl })),
    currentModel: opts.currentModel,
    askScope: !!opts.cwd,
    onSelect: (row) => {
      if (row.firstModel && opts.setModelOverride) {
        opts.setModelOverride(`${row.id}::${row.firstModel}`)
      }
    },
    loadRows: async () => rowsFrom(await loadConfig(opts.cwd)),
    onAdd: async ({ preset, baseUrl, apiKey, scope }): Promise<ProviderActionResult> => {
      const full = preset ? GATEWAY_PRESETS.find((p) => p.id === preset.id) : undefined
      const fallbackModels = full?.fallbackModels ?? ["gpt-4o-mini"]
      try {
        const entry = await detectAndSave(baseUrl, apiKey, full?.id, {
          global: scope === "global",
          cwd: opts.cwd,
          fallbackModels,
        })
        return { ok: `Provider "${entry.id}" saved (${entry.models.length} models, ${scope}).` }
      } catch (e) {
        return { err: `Model detection failed: ${(e as Error).message.slice(0, 80)}` }
      }
    },
    onDelete: async (row): Promise<ProviderActionResult> => {
      await removeProvider(row.id, { global: true })
      if (opts.cwd) await removeProvider(row.id, { global: false, cwd: opts.cwd })
      return { ok: `Provider "${row.id}" deleted.` }
    },
    onEditDefaults: async (row) => {
      const cfg = await loadConfig(opts.cwd)
      const cur = cfg.providers.find((p) => p.id === row.id)
      if (!cur) return null
      return { baseUrl: cur.baseUrl, apiKey: cur.apiKey }
    },
    onEditSave: async (row, { baseUrl, apiKey }): Promise<ProviderActionResult> => {
      const cfg = await loadConfig(opts.cwd)
      const cur = cfg.providers.find((p) => p.id === row.id)
      if (!cur) return { err: "Provider not found" }
      try {
        await removeProvider(row.id, { global: true })
        if (opts.cwd) await removeProvider(row.id, { global: false, cwd: opts.cwd })
        const entry = await detectAndSave(baseUrl, apiKey, row.id, {
          global: true,
          cwd: opts.cwd,
          fallbackModels: cur.models,
        })
        return { ok: `Provider "${entry.id}" updated (${entry.models.length} models)` }
      } catch (e) {
        await detectAndSave(cur.baseUrl, cur.apiKey, cur.id, {
          global: true,
          cwd: opts.cwd,
          fallbackModels: cur.models,
        }).catch(() => {})
        return { err: `Update failed: ${(e as Error).message.slice(0, 80)}` }
      }
    },
  })
}
