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
//
// Chaining: response id terakhir per model disimpan per-instance provider,
// bukan global — global bocor antar sesi CLI paralel yang sharing model sama.
// Instance dibuat per sesi via buildProviderList, jadi isolasi sesi gratis.
const allChains = new Set<Map<string, string>>()
export function clearResponsesChain(): void {
  // Global clear untuk compat — bersihkan semua instance yang pernah dibuat
  for (const m of allChains) m.clear()
}

/**
 * Petakan riwayat kernel ke Responses input items TANPA menghancurkan linkage.
 * Versi lama me-JSON-kan seluruh pesan (tool_calls, tool_call_id, reasoning,
 * multimodal hilang) sehingga turn lanjutan buta terhadap tool-nya sendiri.
 * Multimodal non-teks tetap di-stringify (keterbatasan jujur: Responses
 * input teks; image akan ditangani bila adapter mendukung part image).
 */
export function toResponsesInput(
  messages: readonly {
    role: string
    content?: unknown
    toolCalls?: unknown
    toolCallId?: string
    isError?: boolean
  }[],
): unknown[] {
  const out: unknown[] = []
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? null)
    if (m.role === "assistant" && Array.isArray((m as { toolCalls?: unknown }).toolCalls)) {
      if (text) out.push({ role: "assistant", content: text })
      for (const c of (m as unknown as { toolCalls: { id: string; name: string; args: unknown }[] })
        .toolCalls) {
        out.push({
          type: "function_call",
          call_id: c.id,
          name: c.name,
          arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args ?? {}),
        })
      }
      continue
    }
    if (m.role === "tool") {
      const t = m as unknown as { toolCallId?: string; content?: unknown; isError?: boolean }
      const content = typeof t.content === "string" ? t.content : JSON.stringify(t.content ?? null)
      out.push({
        type: "function_call_output",
        call_id: t.toolCallId ?? "",
        output: t.isError ? `ERROR: ${content}` : content,
      })
      continue
    }
    out.push({ role: m.role, content: text })
  }
  return out
}

export function createResponsesProvider(config: ResponsesConfig): ModelProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "")
  const endpoint = `${baseUrl}/responses`
  const lastResponseByModel = new Map<string, string>()
  allChains.add(lastResponseByModel)
  const provider: ModelProvider & { kind: "responses"; clearResponsesChain?: () => void } = {
    id: config.id ?? "responses",
    models: config.models,
    // brand kind: router memakai ini untuk (a) skip binary-fix gaya Anthropic,
    // (b) skip penyelipan system-message (diurus via `instructions` di bawah).
    kind: "responses",
    clearResponsesChain: () => lastResponseByModel.clear(),
    async *stream(request: StreamRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const modelKey = request.model ?? config.defaultModel ?? config.models[0] ?? "default"
      const prev = lastResponseByModel.get(modelKey)
      const body = JSON.stringify({
        model: request.model ?? config.defaultModel ?? config.models[0],
        input: toResponsesInput(request.messages),
        tools: request.tools?.length
          ? request.tools.map((t) => ({
              type: "function",
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            }))
          : undefined,
        // System prompt KERNEL (MEMORY, repomap, instruksi) — versi lama
        // membuangnya total (body tanpa field ini). Responses API punya
        // field khusus; jangan selipkan sebagai user message.
        ...(request.system?.trim() ? { instructions: request.system } : {}),
        stream: true,
        store: false,
        ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
        // Rantai konteks antar turn; tanpa ini server memperlakukan tiap
        // request sebagai sesi baru (biaya konteks + hilang ingatan server).
        ...(prev ? { previous_response_id: prev } : {}),
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
        // Samakan dengan adapter lain: konteks kepanjangan = compact-and-retry
        // di loop, bukan retry-buta 3x lalu throw. Frasa pencocokan sama
        // dengan openai-compat/anthropic agar perilaku konsisten antar provider.
        if (
          (res.status === 400 || res.status === 422) &&
          /context|maximum context|too long|token/i.test(txt)
        ) {
          throw new ProviderError(
            "context_length_exceeded",
            `context too long (${res.status}): ${txt.slice(0, 500)}`,
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
                // response.completed → simpan id untuk chaining turn berikut.
                // Format nyata: {type:"response.completed", response:{id:"resp_…"}}.
                const dtype = data.type as string | undefined
                if (dtype === "response.completed" || dtype === "completed") {
                  const resp = data.response as { id?: unknown } | undefined
                  const rid = resp?.id ?? data.id
                  if (typeof rid === "string" && rid) lastResponseByModel.set(modelKey, rid)
                }
                const rawDelta: unknown = (data.delta as unknown) ?? data
                const drec = (
                  typeof rawDelta === "object" && rawDelta !== null
                    ? (rawDelta as Record<string, unknown>)
                    : {}
                ) as Record<string, unknown> & { output_text?: string }
                const text =
                  (typeof rawDelta === "string" ? rawDelta : undefined) ??
                  drec.text ??
                  drec.content ??
                  drec.output_text
                if (typeof text === "string" && text) yield { type: "text", text }
                const finish =
                  (data as { finish_reason?: string }).finish_reason ??
                  (drec as { finish_reason?: string }).finish_reason
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
  return provider
}
