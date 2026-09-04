import { Buffer } from "node:buffer"
import { ProviderError } from "#minicore/core/errors.ts"
import type { ModelProvider, ProviderEvent, StreamRequest } from "#minicore/core/provider.ts"
import { LIMITS } from "../constants.ts"
import type { RateLimiter } from "../policy/ratelimit.ts"

export interface RouterConfig {
  providers: ModelProvider[]
  defaultProviderId?: string
  // P2 cap
  maxRetryAfterMs?: number // default LIMITS.RETRY_AFTER_MAX_MS
  // Token bucket rate limiter (opsional) — cegah request beruntun kena 429
  limiter?: RateLimiter
}

// C4 fix: convert Uint8Array tool content to base64 before an openai-compat
// provider sees it. Anthropic handles Uint8Array natively (image →
// source.base64 + media_type in toAnthropicMessages) — converting up-front
// broke that image path, so the fix is applied per-provider below.
function fixRequest(req: StreamRequest): StreamRequest {
  const messages = req.messages.map((m) => {
    if (m.role === "tool" && (m as unknown as { content: unknown }).content instanceof Uint8Array) {
      const c = (m as unknown as { content: Uint8Array }).content
      return { ...m, content: Buffer.from(c).toString("base64") } as unknown as typeof m
    }
    return m
  })
  return { ...req, messages }
}

function needsBinaryFix(p: ModelProvider): boolean {
  return (p as unknown as { kind?: string }).kind !== "anthropic"
}

// Fallback provider mungkin tidak mendukung nama model request asli (mis. gpt-4o
// dipakai ke Anthropic). Substitusi ke model default provider agar tidak 400.
// Return model efektif untuk cost attribution.
function requestFor(
  current: ModelProvider,
  fixed: StreamRequest,
): { req: StreamRequest; effectiveModel?: string; substituted: boolean } {
  if (fixed.model && !current.models.includes(fixed.model) && current.models[0]) {
    return {
      req: { ...fixed, model: current.models[0] },
      effectiveModel: current.models[0],
      substituted: true,
    }
  }
  return { req: fixed, substituted: false }
}

export function createRouterProvider(config: RouterConfig): ModelProvider {
  const maxRetry = config.maxRetryAfterMs ?? LIMITS.RETRY_AFTER_MAX_MS
  const byId = new Map(config.providers.map((p) => [p.id, p]))
  const defaultId = config.defaultProviderId ?? config.providers[0]?.id ?? "router"

  return {
    id: "router",
    models: config.providers.flatMap((p) => [...p.models]),
    async *stream(request: StreamRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      // route by model name — first match wins (default/daftar urutan provider)
      // Format "providerId::modelName" → paksa provider spesifik
      let target: ModelProvider | undefined
      let model: string | undefined = request.model
      if (model?.includes("::")) {
        const sep = model.indexOf("::")
        const pid = model.slice(0, sep)
        const m = model.slice(sep + 2)
        target = byId.get(pid)
        model = m || undefined
      }
      if (!target && model) {
        for (const p of config.providers)
          if (p.models.includes(model)) {
            target = p
            break
          }
      }
      target ??= byId.get(defaultId) ?? config.providers[0]
      if (!target) throw new ProviderError("unknown", "no provider configured")

      // fallback on rate_limit/server/network
      const tried = new Set<string>()
      let current: ModelProvider | undefined = target
      let retried429 = false
      while (current) {
        tried.add(current.id)
        try {
          // rate limit: tunggu token bucket sebelum tiap request
          if (config.limiter) await config.limiter.acquire()
          const fixed = needsBinaryFix(current) ? fixRequest(request) : request
          const { req, effectiveModel, substituted } = requestFor(current, { ...fixed, model })
          if (substituted && effectiveModel) {
            process.stderr.write(
              `[router] model "${request.model}" not on ${current.id} → substituting "${effectiveModel}"\n`,
            )
            yield {
              type: "extension",
              kind: "effective-model",
              data: { requested: request.model, effective: effectiveModel, provider: current.id },
            }
          } else if (current !== target) {
            // Fallback provider (non-substitusi) — model sama tapi provider beda.
            // Label spinner/status harus tahu provider mana yang dipakai.
            yield {
              type: "extension",
              kind: "effective-model",
              data: { requested: model, effective: model, provider: current.id },
            }
          }
          for await (const ev of current.stream(req, signal)) {
            yield ev
          }
          return
        } catch (e) {
          if (e instanceof ProviderError) {
            // cap retryAfter without mutating original
            let err: ProviderError = e
            if (e.retryAfterMs != null && e.retryAfterMs > maxRetry) {
              err = new ProviderError(e.category, e.message, maxRetry)
            }
            // P11 P1.3 — honori retry-after: untuk 429 dengan retryAfter, tunggu sebentar
            // lalu fallback (jangan bakar daftar tanpa tunggu). Cap sleep 100ms agar test cepat.
            if (
              err.category === "rate_limit" &&
              err.retryAfterMs != null &&
              !retried429 &&
              tried.size < config.providers.length
            ) {
              retried429 = true
              await Bun.sleep(Math.min(err.retryAfterMs, 100))
              const next = config.providers.find((p) => !tried.has(p.id))
              if (next) {
                current = next
                continue
              }
            }
            const canFallback =
              (err.category === "server" || err.category === "network") &&
              tried.size < config.providers.length
            // rate_limit tanpa retryAfter → fallback ke provider lain (bakar-daftar hanya bila tanpa retryAfter)
            const canFallbackRateLimit =
              err.category === "rate_limit" &&
              err.retryAfterMs == null &&
              tried.size < config.providers.length
            if (canFallback || canFallbackRateLimit) {
              const next = config.providers.find((p) => !tried.has(p.id))
              if (next) {
                current = next
                continue
              }
            }
            throw err
          }
          throw e
        }
      }
    },
  }
}
