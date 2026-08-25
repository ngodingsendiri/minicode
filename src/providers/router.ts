import type { ModelProvider, StreamRequest, ProviderEvent } from "../../../minicore/src/core/provider.ts";
import { ProviderError } from "../../../minicore/src/core/errors.ts";
import type { RateLimiter } from "../policy/ratelimit.ts";

export interface RouterConfig {
  providers: ModelProvider[];
  defaultProviderId?: string;
  // Provider aktif (dinamis, mutable) — dipilih user via /model atau /providers.
  // Router TIDAK lagi "last-match-wins" bila preferensi dinyatakan:
  // model yang ada di >1 provider (mis. deepseek-v4-flash) bisa nyasar.
  preferProviderId?: { current?: string };
  // P2 cap
  maxRetryAfterMs?: number; // default 30_000
  // Token bucket rate limiter (opsional) — cegah request beruntun kena 429
  limiter?: RateLimiter;
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

// Fallback provider mungkin tidak mendukung nama model request asli (mis. gpt-4o
// dipakai ke Anthropic). Substitusi ke model default provider agar tidak 400.
function requestFor(current: ModelProvider, fixed: StreamRequest): StreamRequest {
  if (fixed.model && !current.models.includes(fixed.model) && current.models[0]) {
    return { ...fixed, model: current.models[0] };
  }
  return fixed;
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
      // route by model name — prefer provider aktif bila ada, else last match wins
      // (last match = local overrides global)
      let target: ModelProvider | undefined;
      if (fixed.model) {
        const preferredId = config.preferProviderId?.current;
        if (preferredId && byId.get(preferredId)?.models.includes(fixed.model)) {
          target = byId.get(preferredId);
        }
        if (!target) {
          for (const p of config.providers) if (p.models.includes(fixed.model)) target = p;
        }
      }
      target ??= byId.get(defaultId) ?? config.providers[0];
      if (!target) throw new ProviderError("unknown", "no provider configured");

      // fallback on rate_limit/server/network
      const tried = new Set<string>();
      let current: ModelProvider | undefined = target;
      while (current) {
        tried.add(current.id);
        try {
          // rate limit: tunggu token bucket sebelum tiap request
          if (config.limiter) await config.limiter.acquire();
          for await (const ev of current.stream(requestFor(current, fixed), signal)) {
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

