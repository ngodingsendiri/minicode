import { ProviderError } from "#minicore/core/errors.ts"
import type { ModelProvider, ProviderEvent, StreamRequest } from "#minicore/core/provider.ts"

export interface ResponsesConfig {
  id?: string
  baseUrl: string
  apiKey?: string
  models: readonly string[]
  defaultModel?: string
  reasoningEffort?: string
}

// Minimal Responses API adapter — /v1/responses, previous_response_id chaining, store:false
// Untuk P11 P1.1: providerHint "responses" → wire ini, bukan chat/completions.
// Implementasi streaming SSE mirip openai-compat, tapi endpoint berbeda.
export function createResponsesProvider(config: ResponsesConfig): ModelProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "")
  const endpoint = `${baseUrl}/responses`
  return {
    id: config.id ?? "responses",
    models: config.models,
    async *stream(request: StreamRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const body = JSON.stringify({
        model: request.model ?? config.defaultModel ?? config.models[0],
        input: request.messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        })),
        tools: request.tools?.length
          ? request.tools.map((t) => ({
              type: "function",
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            }))
          : undefined,
        stream: true,
        store: false,
        ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
        // previous_response_id akan diisi dari request.messages metadata bila ada (stub)
      })
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      }
      let res: Response
      try {
        res = await fetch(endpoint, { method: "POST", headers, body, signal })
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e
        throw new ProviderError("network", (e as Error).message)
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        const retryAfter = res.headers.get("retry-after")
        if (res.status === 429) {
          const ms = retryAfter ? Number(retryAfter) * 1000 : undefined
          throw new ProviderError(
            "rate_limit",
            `rate limited (${res.status}): ${txt.slice(0, 500)}`,
            Number.isFinite(ms) ? ms : undefined,
          )
        }
        throw new ProviderError(
          res.status >= 500 ? "server" : "unknown",
          `${res.status}: ${txt.slice(0, 500)}`,
        )
      }
      if (!res.body) throw new ProviderError("network", "empty response body")
      // Simplified SSE: forward text deltas
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      try {
        while (true) {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError")
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let idx = buf.indexOf("\n")
          while (idx >= 0) {
            const line = buf.slice(0, idx).replace(/\r$/, "")
            buf = buf.slice(idx + 1)
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim()
              if (payload === "[DONE]") return
              try {
                const data = JSON.parse(payload) as Record<string, unknown>
                const delta = (data.delta as Record<string, unknown> | undefined) ?? data
                const text =
                  delta.text ?? delta.content ?? (delta as { output_text?: string }).output_text
                if (typeof text === "string" && text) yield { type: "text", text }
                const finish =
                  (data as { finish_reason?: string }).finish_reason ??
                  (delta as { finish_reason?: string }).finish_reason
                if (finish)
                  yield {
                    type: "finish",
                    reason:
                      finish === "length"
                        ? "length"
                        : finish === "tool_calls"
                          ? "tool_calls"
                          : "stop",
                  }
              } catch {}
            }
            idx = buf.indexOf("\n")
          }
        }
      } finally {
        reader.releaseLock()
      }
      yield { type: "finish", reason: "stop" }
    },
  }
}
