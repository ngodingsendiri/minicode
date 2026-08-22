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
  "claude-sonnet-4": { input: 3, output: 15 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

function costFor(model: string, input: number, output: number): number | undefined {
  for (const [k, p] of Object.entries(PRICING)) if (model.includes(k)) return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
  return undefined;
}

export function createUsageCollector(bus: EventBus, model?: string) {
  let total: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  bus.on("provider:extension", (e) => {
    if (e.kind === "usage") {
      const d = e.data as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      total.inputTokens += d.inputTokens ?? 0;
      total.outputTokens += d.outputTokens ?? 0;
      total.totalTokens += d.totalTokens ?? (d.inputTokens ?? 0) + (d.outputTokens ?? 0);
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
