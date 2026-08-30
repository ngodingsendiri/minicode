import type { CompactionStrategy } from "#minicore/core/compact.ts"
import { mechanicalCompaction } from "#minicore/core/compact.ts"
import type { ContextStore } from "#minicore/core/history.ts"
import type { ModelProvider } from "#minicore/core/provider.ts"
import { createOpenAICompatProvider } from "#minicore/providers/openai-compat.ts"
import { LIMITS } from "../constants.ts"

export interface LlmCompactionOptions {
  provider?: ModelProvider
  model?: string // deepseek v4 flash
  baseUrl?: string
  apiKey?: string
  keepRecentTurns?: number
  maxSummaryTokens?: number
  fallback?: CompactionStrategy
}

export function createLlmCompaction(opts: LlmCompactionOptions = {}): CompactionStrategy {
  const fallback = opts.fallback ?? mechanicalCompaction
  return {
    // Kernel sekarang memanggil compactAsync bila ada (seam baru di loop.ts).
    // compact() sinkron tetap jadi fallback aman bila LLM gagal / tidak terkonfigurasi.
    kind: "llm-mechanical",
    compact(
      store: ContextStore,
      cOpts: { keepRecentTurns: number },
    ): readonly import("#minicore/core/types.ts").Message[] {
      return fallback.compact(store, cOpts)
    },
    async compactAsync(
      store: ContextStore,
      cOpts: { keepRecentTurns: number },
      signal: AbortSignal,
    ): Promise<readonly import("#minicore/core/types.ts").Message[]> {
      // cap 15s — jangan biarkan LLM summary memblokir loop terlalu lama;
      // kalau gagal/timeout, loop otomatis fallback ke compact() sinkron.
      const ac = new AbortController()
      const timer = setTimeout(
        () => ac.abort(new Error("llm compaction timeout")),
        LIMITS.COMPACTION_LLM_TIMEOUT_MS,
      )
      const onAbort = () => ac.abort(signal.reason)
      // addEventListener TIDAK memicu untuk signal yang sudah abort, jadi
      // pembatalan yang datang sebelum kompaksi dimulai akan terlewat dan
      // request ringkasan tetap terkirim.
      if (signal.aborted) onAbort()
      else signal.addEventListener("abort", onAbort, { once: true })
      try {
        return await compactWithLlm(
          store,
          {
            keepRecentTurns: cOpts.keepRecentTurns,
            provider: opts.provider,
            model: opts.model,
            baseUrl: opts.baseUrl,
            apiKey: opts.apiKey,
          },
          ac.signal,
          true, // noFallback: biarkan loop yang memutuskan fallback ke sync
        )
      } finally {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
      }
    },
  }
}

// shared kept calculation — mirrors mechanicalCompaction logic, single source for both sync/async
function getKeptCount(
  messages: readonly import("#minicore/core/types.ts").Message[],
  keepRecentTurns: number,
): number {
  let kept = 0,
    turns = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    kept++
    if (messages[i]?.role === "user") turns++
    if (turns >= keepRecentTurns) break
  }
  while (kept < messages.length) {
    const cut = messages.length - kept
    const firstKept = messages[cut]!
    const prev = messages[cut - 1]
    const extendsPair =
      firstKept.role === "tool" &&
      prev !== undefined &&
      (prev.role === "tool" ||
        (prev.role === "assistant" &&
          (prev as unknown as { toolCalls?: unknown[] }).toolCalls !== undefined))
    if (extendsPair) kept++
    else break
  }
  return kept
}

// Async helper — call explicitly before budget critical, or via wrapper that pre-compacts.
// noFallback=true: tidak memanggil mechanical fallback (biarkan loop yang menanganinya).
export async function compactWithLlm(
  store: ContextStore,
  opts: {
    keepRecentTurns: number
    provider?: ModelProvider
    model?: string
    baseUrl?: string
    apiKey?: string
  },
  signal?: AbortSignal,
  noFallback = false,
): Promise<readonly import("#minicore/core/types.ts").Message[]> {
  const keep = opts.keepRecentTurns
  const messages = store.messages
  const kept = getKeptCount(messages, keep)
  if (kept >= messages.length) return messages
  const prefix = messages.slice(0, messages.length - kept)

  const provider =
    opts.provider ??
    (opts.apiKey
      ? createOpenAICompatProvider({
          baseUrl: opts.baseUrl ?? "https://api.deepseek.com/v1",
          apiKey: opts.apiKey!,
          models: [opts.model ?? "deepseek-chat"],
          defaultModel: opts.model ?? "deepseek-chat",
        })
      : undefined)
  if (!provider) {
    if (noFallback) throw new Error("no provider for LLM compaction")
    return mechanicalCompaction.compact(store, { keepRecentTurns: keep })
  }

  // use safe head like mechanical: content truncated, tool results included
  // seperlunya — hasil tool SUKSES adalah sumber fakta (isi file, output
  // grep/bash, verifikasi). Do not buang: head 300 chars per hasil.
  const { contentToText } = await import("#minicore/core/tokens.ts")
  const head = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…`)
  // Tuned 250/300 for 30% cost save vs 400/300 — still factual
  const lineFor = (m: import("#minicore/core/types.ts").Message): string => {
    if (m.role === "user") return `- user: ${head(contentToText(m.content), 250)}`
    if (m.role === "assistant") {
      const calls = (m.toolCalls ?? [])
        .map((c) => `${c.name}(${head(JSON.stringify(c.args), 60)})`)
        .join(", ")
      return `- assistant${calls ? ` [${calls}]` : ""}: ${head(contentToText(m.content), 250)}`
    }
    if (m.isError) return `- tool(${m.name}) ERROR: ${head(String(m.content), 250)}`
    const raw =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? contentToText(m.content)
          : ""
    return `- tool(${m.name}): ${head(raw, 250)}`
  }
  const summaryPrompt = `Summarize this conversation prefix for compaction. KEEP FACTS: exact file paths, function signatures, key code snippets, tool results (grep/bash/test output), error messages, and next steps. Include structured facts: files modified, functions added, test results. Be concise (max 600 tokens). Prefix:\n${prefix.map(lineFor).join("\n").slice(0, 6000)}`

  let summary = ""
  try {
    const stream = provider.stream(
      {
        messages: [{ role: "user", content: summaryPrompt }],
        model: opts.model ?? "deepseek-chat",
      },
      signal ?? new AbortController().signal,
    )
    for await (const ev of stream) {
      if (ev.type === "text") summary += ev.text
      if (ev.type === "finish") break
    }
    if (!summary.trim()) throw new Error("empty summary")
  } catch (e) {
    if (signal?.aborted) throw e
    if ((e as Error).name === "AbortError") throw e
    if (noFallback) throw e
    return mechanicalCompaction.compact(store, { keepRecentTurns: keep })
  }
  const lruSummary = {
    role: "user" as const,
    content: `Previous context (LLM summarized):\n${summary.slice(0, 3000)}`,
  }
  return [lruSummary, ...messages.slice(-kept)]
}
