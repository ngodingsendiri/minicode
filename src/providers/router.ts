import type { ModelProvider, StreamRequest, ProviderEvent } from "../../../minicore/src/core/provider.ts";
import { ProviderError } from "../../../minicore/src/core/errors.ts";
import { createOpenAICompatProvider } from "../../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "./anthropic.ts";

export interface RouterConfig {
  providers: ModelProvider[];
  defaultProviderId?: string;
  // P2 cap
  maxRetryAfterMs?: number; // default 30_000
}

// C4 fix: convert Uint8Array tool content to base64 before provider sees it
function fixRequest(req: StreamRequest): StreamRequest {
  const messages = req.messages.map((m) => {
    if (m.role === "tool" && (m as unknown as { content: unknown }).content instanceof Uint8Array) {
      const c = (m as unknown as { content: Uint8Array }).content;
      return { ...m, content: Buffer.from(c).toString("base64") } as unknown as typeof m;
    }
    return m;
  });
  return { ...req, messages };
}

export function createRouterProvider(config: RouterConfig): ModelProvider {
  const maxRetry = config.maxRetryAfterMs ?? 30_000;
  const byId = new Map(config.providers.map((p) => [p.id, p]));
  const defaultId = config.defaultProviderId ?? config.providers[0]?.id ?? "router";

  return {
    id: "router",
    models: config.providers.flatMap((p) => [...p.models]),
    async *stream(request: StreamRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const fixed = fixRequest(request);
      // route by model name — last match wins (local overrides global)
      let target: ModelProvider | undefined;
      if (fixed.model) {
        for (const p of config.providers) if (p.models.includes(fixed.model)) target = p;
      }
      target ??= byId.get(defaultId) ?? config.providers[0];
      if (!target) throw new ProviderError("unknown", "no provider configured");

      // fallback on rate_limit/server/network
      const tried = new Set<string>();
      let current: ModelProvider | undefined = target;
      while (current) {
        tried.add(current.id);
        try {
          for await (const ev of current.stream(fixed, signal)) {
            yield ev;
          }
          return;
        } catch (e) {
          if (e instanceof ProviderError) {
            // cap retryAfter without mutating original
            let err: ProviderError = e;
            if (e.retryAfterMs != null && e.retryAfterMs > maxRetry) {
              err = new ProviderError(e.category, e.message, maxRetry);
            }
            const canFallback = (err.category === "rate_limit" || err.category === "server" || err.category === "network") && tried.size < config.providers.length;
            if (canFallback) {
              const next = config.providers.find((p) => !tried.has(p.id));
              if (next) {
                current = next;
                continue;
              }
            }
            throw err;
          }
          throw e;
        }
      }
    },
  };
}

export function createDefaultRouter(opts: {
  openaiBaseUrl?: string;
  openaiApiKey?: string;
  openaiModels?: string[];
  anthropicApiKey?: string;
  anthropicModels?: string[];
}): ModelProvider {
  const providers: ModelProvider[] = [];
  if (opts.openaiApiKey || opts.openaiBaseUrl) {
    providers.push(
      createOpenAICompatProvider({
        baseUrl: opts.openaiBaseUrl ?? "https://api.openai.com/v1",
        apiKey: opts.openaiApiKey,
        models: opts.openaiModels ?? ["gpt-4o-mini"],
        defaultModel: opts.openaiModels?.[0] ?? "gpt-4o-mini",
      }),
    );
  }
  if (opts.anthropicApiKey) {
    providers.push(
      createAnthropicProvider({
        apiKey: opts.anthropicApiKey,
        models: opts.anthropicModels ?? ["claude-sonnet-4"],
        defaultModel: opts.anthropicModels?.[0] ?? "claude-sonnet-4",
      }),
    );
  }
  if (providers.length === 0) {
    // dummy for tests
    providers.push(createOpenAICompatProvider({ baseUrl: "https://api.openai.com/v1", models: ["dummy"] }));
  }
  return createRouterProvider({ providers });
}
