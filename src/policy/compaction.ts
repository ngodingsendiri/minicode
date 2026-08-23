import type { CompactionStrategy } from "../../../minicore/src/core/compact.ts";
import { mechanicalCompaction } from "../../../minicore/src/core/compact.ts";
import type { ContextStore } from "../../../minicore/src/core/history.ts";
import type { ModelProvider } from "../../../minicore/src/core/provider.ts";
import { createOpenAICompatProvider } from "../../../minicore/src/providers/openai-compat.ts";

export interface LlmCompactionOptions {
  provider?: ModelProvider;
  model?: string; // deepseek v4 flash
  baseUrl?: string;
  apiKey?: string;
  keepRecentTurns?: number;
  maxSummaryTokens?: number;
  fallback?: CompactionStrategy;
}

export function createLlmCompaction(opts: LlmCompactionOptions = {}): CompactionStrategy {
  const fallback = opts.fallback ?? mechanicalCompaction;
  return {
    kind: fallback.kind, // sync kernel requires mechanical; async LLM is via compactWithLlm() helper
    compact(store: ContextStore, cOpts: { keepRecentTurns: number }): readonly import("../../../minicore/src/core/types.ts").Message[] {
      return fallback.compact(store, cOpts);
    },
  };
}

// shared kept calculation — mirrors mechanicalCompaction logic, single source for both sync/async
function getKeptCount(messages: readonly import("../../../minicore/src/core/types.ts").Message[], keepRecentTurns: number): number {
  let kept = 0, turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    kept++;
    if (messages[i]!.role === "user") turns++;
    if (turns >= keepRecentTurns) break;
  }
  while (kept < messages.length) {
    const cut = messages.length - kept;
    const firstKept = messages[cut]!;
    const prev = messages[cut - 1];
    const extendsPair = firstKept.role === "tool" && prev !== undefined && (prev.role === "tool" || (prev.role === "assistant" && (prev as unknown as { toolCalls?: unknown[] }).toolCalls !== undefined));
    if (extendsPair) kept++;
    else break;
  }
  return kept;
}

// Async helper — call explicitly before budget critical, or via wrapper that pre-compacts
export async function compactWithLlm(
  store: ContextStore,
  opts: { keepRecentTurns: number; provider?: ModelProvider; model?: string; baseUrl?: string; apiKey?: string },
  signal?: AbortSignal,
): Promise<readonly import("../../../minicore/src/core/types.ts").Message[]> {
  const keep = opts.keepRecentTurns;
  const messages = store.messages;
  const kept = getKeptCount(messages, keep);
  if (kept >= messages.length) return messages;
  const prefix = messages.slice(0, messages.length - kept);

  const provider =
    opts.provider ??
    (opts.apiKey
      ? createOpenAICompatProvider({ baseUrl: opts.baseUrl ?? "https://api.deepseek.com/v1", apiKey: opts.apiKey!, models: [opts.model ?? "deepseek-chat"], defaultModel: opts.model ?? "deepseek-chat" })
      : undefined);
  if (!provider) return mechanicalCompaction.compact(store, { keepRecentTurns: keep });

  // use safe head like mechanical: content truncated, tool results omitted
  const { contentToText } = await import("../../../minicore/src/core/tokens.ts");
  const head = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}…`);
  const lineFor = (m: import("../../../minicore/src/core/types.ts").Message): string => {
    if (m.role === "user") return `- user: ${head(contentToText(m.content), 400)}`;
    if (m.role === "assistant") {
      const calls = (m.toolCalls ?? []).map((c) => `${c.name}(${head(JSON.stringify(c.args), 80)})`).join(", ");
      return `- assistant${calls ? ` [${calls}]` : ""}: ${head(contentToText(m.content), 400)}`;
    }
    if (m.isError) return `- tool(${m.name}): ${head(String(m.content), 200)}`;
    return `- tool(${m.name}): <result omitted>`;
  };
  const summaryPrompt = `Summarize this conversation prefix for compaction. Keep key decisions, file paths, tool results errors, and next steps. Be concise (max 800 tokens). Prefix:\n${prefix.map(lineFor).join("\n").slice(0, 8000)}`;

  let summary = "";
  try {
    const stream = provider.stream({ messages: [{ role: "user", content: summaryPrompt }], model: opts.model ?? "deepseek-chat" }, signal ?? new AbortController().signal);
    for await (const ev of stream) {
      if (ev.type === "text") summary += ev.text;
      if (ev.type === "finish") break;
    }
    if (!summary.trim()) throw new Error("empty summary");
  } catch (e) {
    if (signal?.aborted) throw e;
    if ((e as Error).name === "AbortError") throw e;
    return mechanicalCompaction.compact(store, { keepRecentTurns: keep });
  }
  const lruSummary = { role: "user" as const, content: `Previous context (LLM summarized):\n${summary.slice(0, 2000)}` };
  return [lruSummary, ...messages.slice(-kept)];
}
