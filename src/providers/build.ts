import type { ModelProvider } from "../../../minicore/src/core/provider.ts";
import { createOpenAICompatProvider } from "../../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "./anthropic.ts";
import type { MinicodeConfig } from "../config.ts";

// Satu-satunya tempat membangun daftar provider dari config (hybrid anthropic/openai-compat).
// Dipakai CLI, sub-agent (task.ts), dan MCP server agar logika tidak terduplikasi.
// PENTING: id identitas provider WAJIB diteruskan — kalau tidak, router byId
// memetakan semua provider ke id generik "openai-compat" (provider terakhir menang).
export function buildProviderList(cfg: MinicodeConfig): ModelProvider[] {
  const out: ModelProvider[] = [];
  for (const p of cfg.providers) {
    if (p.providerHint === "anthropic" || p.baseUrl.includes("anthropic")) {
      out.push(createAnthropicProvider({ id: p.id, apiKey: p.apiKey, baseUrl: p.baseUrl, models: p.models, defaultModel: p.models[0] }) as unknown as ModelProvider);
    } else {
      out.push(createOpenAICompatProvider({ id: p.id, baseUrl: p.baseUrl, apiKey: p.apiKey, models: p.models, defaultModel: p.models[0] }));
    }
  }
  return out;
}
