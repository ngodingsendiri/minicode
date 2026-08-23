import type { EventBus } from "../../../minicore/src/core/index.ts";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost?: number;
}

const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 5, output: 15 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "o1": { input: 15, output: 60 },
  "o3": { input: 2, output: 8 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "gemini-2.0": { input: 1.25, output: 10 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

function costFor(model: string, input: number, output: number): number | undefined {
  const sorted = Object.entries(PRICING).sort((a, b) => b[0].length - a[0].length);
  for (const [k, p] of sorted) if (model.includes(k)) return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
  return undefined;
}

export function createUsageCollector(bus: EventBus, model?: string) {
  let total: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  bus.on("provider:extension", (e) => {
    if (e.kind === "usage") {
      const d = e.data as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      const input = d.inputTokens ?? 0;
      const output = d.outputTokens ?? 0;
      // totalTokens computed from split to avoid double count when provider sends both
      total.inputTokens += input;
      total.outputTokens += output;
      total.totalTokens = total.inputTokens + total.outputTokens;
      if (model) total.cost = costFor(model, total.inputTokens, total.outputTokens);
    }
  });
  return {
    get: () => ({ ...total }),
    reset: () => {
      total = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    },
  };
}
