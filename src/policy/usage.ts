import type { EventBus } from "../../../minicore/src/core/index.ts";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

const PRICING: Record<string, { input: number; output: number; cacheRead?: number }> = {
  "gpt-4o": { input: 5, output: 15, cacheRead: 2.5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5 },
  "o1": { input: 15, output: 60, cacheRead: 7.5 },
  "o3": { input: 2, output: 8, cacheRead: 0.5 },
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3 },
  "deepseek-chat": { input: 0.14, output: 0.28, cacheRead: 0.014 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14 },
  "gemini-2.0": { input: 1.25, output: 10, cacheRead: 0.31 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

function costFor(model: string, input: number, output: number, cacheRead: number = 0): number | undefined {
  const sorted = Object.entries(PRICING).sort((a, b) => b[0].length - a[0].length);
  for (const [k, p] of sorted) {
    if (model.includes(k)) {
      const normalInput = Math.max(0, input - cacheRead);
      const inputCost = (normalInput / 1_000_000) * p.input;
      const cacheCost = p.cacheRead ? (cacheRead / 1_000_000) * p.cacheRead : 0;
      const outputCost = (output / 1_000_000) * p.output;
      return inputCost + cacheCost + outputCost;
    }
  }
  return undefined;
}

export function createUsageCollector(bus: EventBus, model?: string) {
  let total: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  bus.on("provider:extension", (e) => {
    if (e.kind === "usage") {
      const d = e.data as {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
      const input = d.inputTokens ?? 0;
      const output = d.outputTokens ?? 0;
      const cRead = d.cacheReadTokens ?? 0;
      const cWrite = d.cacheWriteTokens ?? 0;

      total.inputTokens += input;
      total.outputTokens += output;
      total.totalTokens = total.inputTokens + total.outputTokens;
      total.cacheReadTokens = (total.cacheReadTokens ?? 0) + cRead;
      total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + cWrite;
    }
  });

  return {
    get: (m?: string) => {
      const eff = m ?? model;
      const base: Usage = { ...total };
      return eff ? { ...base, cost: costFor(eff, base.inputTokens, base.outputTokens, base.cacheReadTokens) } : base;
    },
    reset: () => {
      total = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    },
  };
}
