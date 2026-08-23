import type { ModelProvider } from "../../../minicore/src/core/provider.ts";
import { createOpenAICompatProvider } from "../../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "./anthropic.ts";
import type { MinicodeConfig } from "../config.ts";

// Satu-satunya tempat membangun daftar provider dari config (hybrid anthropic/openai-compat).
// Dipakai CLI, sub-agent (task.ts), dan MCP server agar logika tidak terduplikasi.
export function buildProviderList(cfg: MinicodeConfig): ModelProvider[] {
  const out: ModelProvider[] = [];
  for (const p of cfg.providers) {
    if (p.providerHint === "anthropic" || p.baseUrl.includes("anthropic")) {
      out.push(createAnthropicProvider({ apiKey: p.apiKey, baseUrl: p.baseUrl, models: p.models, defaultModel: p.models[0] }) as unknown as ModelProvider);
    } else {
      out.push(createOpenAICompatProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, models: p.models, defaultModel: p.models[0] }));
    }
  }
  return out;
}
