import type { ModelProvider } from "#minicore/core/provider.ts"
import { createOpenAICompatProvider } from "#minicore/providers/openai-compat.ts"
import type { MinicodeConfig } from "../config.ts"
import { createAnthropicProvider } from "./anthropic.ts"
import { getValidAccessToken } from "./oauth.ts"

// Satu-satunya tempat membangun daftar provider dari config (hybrid anthropic/openai-compat).
// Dipakai CLI, sub-agent (task.ts), dan MCP server agar logika tidak terduplikasi.
// PENTING: id identitas provider WAJIB diteruskan — kalau tidak, router byId
// memetakan semua provider ke id generik "openai-compat" (provider terakhir menang).
export function buildProviderList(cfg: MinicodeConfig): ModelProvider[] {
  const out: ModelProvider[] = []
  for (const p of cfg.providers) {
    if (p.providerHint === "anthropic" || p.baseUrl.includes("anthropic")) {
      out.push(
        createAnthropicProvider({
          id: p.id,
          apiKey: p.apiKey,
          baseUrl: p.baseUrl,
          models: p.models,
          defaultModel: p.models[0],
        }) as unknown as ModelProvider,
      )
    } else {
      out.push(
        createOpenAICompatProvider({
          id: p.id,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          models: p.models,
          defaultModel: p.models[0],
        }),
      )
    }
  }
  return out
}

/**
 * Versi async: provider ber-`auth: "oauth"` mendapat access token segar dari
 * `~/.minicode/auth.json` (di-refresh bila perlu) alih-alih `apiKey` di config.
 *
 * Dipisah dari `buildProviderList` agar jalur sinkron yang sudah ada tidak
 * berubah perilaku, dan agar pemanggil yang tak peduli OAuth tak jadi async.
 * Provider OAuth yang belum login dibuang dengan peringatan — lebih baik hilang
 * dari daftar daripada mengirim `Authorization: Bearer undefined`.
 */
export async function buildProviderListAsync(cfg: MinicodeConfig): Promise<ModelProvider[]> {
  const resolved: MinicodeConfig = { ...cfg, providers: [] }
  for (const p of cfg.providers) {
    if (p.auth !== "oauth") {
      resolved.providers.push(p)
      continue
    }
    const token = await getValidAccessToken(p.id)
    if (!token) {
      process.stderr.write(
        `[auth] provider "${p.id}" uses OAuth but is not logged in (or refresh failed) — skipped. Run: minicode auth login ${p.id}\n`,
      )
      continue
    }
    resolved.providers.push({ ...p, apiKey: token })
  }
  return buildProviderList(resolved)
}
