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
  const model = opts.model ?? "deepseek-chat"; // v4 flash alias
  const baseUrl = opts.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? process.env.AGENT_BASE_URL ?? "https://api.deepseek.com/v1";
  const apiKey = opts.apiKey ?? process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY;

  // provider lazy
  let provider: ModelProvider | undefined = opts.provider;
  if (!provider && apiKey) {
    provider = createOpenAICompatProvider({ baseUrl, apiKey, models: [model], defaultModel: model });
  }

  return {
    kind: `llm:${model}`,
    compact(store: ContextStore, cOpts: { keepRecentTurns: number }): readonly import("../../../minicore/src/core/types.ts").Message[] {
      // sync fallback — LLM is async, but CompactionStrategy is sync per minicore.
      // For true async LLM, we do best-effort sync fallback to mechanical,
      // and expose async helper for explicit use via createMinicodeSession.
      // To keep kernel sync, we return mechanical here; async LLM is via compactAsync().
      return fallback.compact(store, cOpts);
    },
  };
}

// Async helper — call explicitly before budget critical, or via wrapper that pre-compacts
export async function compactWithLlm(
  store: ContextStore,
  opts: { keepRecentTurns: number; provider?: ModelProvider; model?: string; baseUrl?: string; apiKey?: string },
  signal?: AbortSignal,
): Promise<readonly import("../../../minicore/src/core/types.ts").Message[]> {
  const keep = opts.keepRecentTurns;
  const messages = store.messages;
  let kept = 0, turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    kept++;
    if (messages[i]!.role === "user") turns++;
    if (turns >= keep) break;
  }
  while (kept < messages.length) {
    const cut = messages.length - kept;
    const firstKept = messages[cut]!;
    const prev = messages[cut - 1];
    const extendsPair = firstKept.role === "tool" && prev !== undefined && (prev.role === "tool" || (prev.role === "assistant" && (prev as unknown as { toolCalls?: unknown[] }).toolCalls !== undefined));
    if (extendsPair) kept++;
    else break;
  }
  if (kept >= messages.length) return messages;
  const prefix = messages.slice(0, messages.length - kept);

  const provider =
    opts.provider ??
    (opts.apiKey
      ? createOpenAICompatProvider({ baseUrl: opts.baseUrl ?? "https://api.deepseek.com/v1", apiKey: opts.apiKey!, models: [opts.model ?? "deepseek-chat"], defaultModel: opts.model ?? "deepseek-chat" })
      : undefined);
  if (!provider) return mechanicalCompaction.compact(store, { keepRecentTurns: keep });

  const summaryPrompt = `Summarize this conversation prefix for compaction. Keep key decisions, file paths, tool results errors, and next steps. Be concise (max 800 tokens). Prefix:\n${prefix.map((m) => `${m.role}: ${JSON.stringify(m).slice(0, 500)}`).join("\n").slice(0, 8000)}`;

  let summary = "";
  try {
    const stream = provider.stream({ messages: [{ role: "user", content: summaryPrompt }], model: opts.model ?? "deepseek-chat" }, signal ?? new AbortController().signal);
    for await (const ev of stream) {
      if (ev.type === "text") summary += ev.text;
      if (ev.type === "finish") break;
    }
    if (!summary.trim()) throw new Error("empty summary");
  } catch {
    return mechanicalCompaction.compact(store, { keepRecentTurns: keep });
  }
  const lruSummary = { role: "user" as const, content: `Previous context (LLM summarized):\n${summary.slice(0, 2000)}` };
  return [lruSummary, ...messages.slice(-kept)];
}
