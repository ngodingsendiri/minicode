import type { EventBus } from "../../../minicore/src/core/index.ts";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
}

const PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }> = {
  "gpt-4o": { input: 5, output: 15, cacheRead: 2.5, cacheWrite: 5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  "gpt-4.1": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
  "o1": { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 15 },
  "o3": { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },
  "claude-sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "deepseek-chat": { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
  "deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
  // b.ai deepseek-v4-flash (berbeda keluarga deepseek-chat)
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.014, cacheWrite: 0.14 },
  "gemini-2.0": { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

// cacheIncluded=true (Anthropic): input_tokens SUDAH termasuk cache_read+cache_write,
// jadi normal input = input - cacheRead - cacheWrite (hindari double-count).
// cacheIncluded=false (provider lain): input_tokens terpisah dari cache → jangan kurangi.
function costFor(model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0, cacheIncluded = true): number | undefined {
  const sorted = Object.entries(PRICING).sort((a, b) => b[0].length - a[0].length);
  for (const [k, p] of sorted) {
    if (model.includes(k)) {
      const normalInput = cacheIncluded ? Math.max(0, input - cacheRead - cacheWrite) : input;
      const inputCost = (normalInput / 1_000_000) * p.input;
      const readCost = p.cacheRead ? (cacheRead / 1_000_000) * p.cacheRead : 0;
      const writeCost = p.cacheWrite ? (cacheWrite / 1_000_000) * p.cacheWrite : 0;
      const outputCost = (output / 1_000_000) * p.output;
      return inputCost + readCost + writeCost + outputCost;
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
  let cacheIncluded = true;
  // Cost attribution: kalau router fallback menyubstitusi model, harga harus
  // dihitung pakai model EFEKTIF yang benar-benar dipakai.
  let effectiveModel: string | undefined;
  let effectiveProvider: string | undefined;

  bus.on("provider:extension", (e) => {
    if (e.kind === "effective-model") {
      const d = e.data as { requested?: string; effective?: string; provider?: string };
      effectiveModel = d.effective ?? effectiveModel;
      effectiveProvider = d.provider ?? effectiveProvider;
      return;
    }
    if (e.kind === "usage") {
      const d = e.data as {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cacheIncluded?: boolean;
      };
      const input = d.inputTokens ?? 0;
      const output = d.outputTokens ?? 0;
      const cRead = d.cacheReadTokens ?? 0;
      const cWrite = d.cacheWriteTokens ?? 0;
      if (typeof d.cacheIncluded === "boolean") cacheIncluded = d.cacheIncluded;

      total.inputTokens += input;
      total.outputTokens += output;
      total.totalTokens = total.inputTokens + total.outputTokens;
      total.cacheReadTokens = (total.cacheReadTokens ?? 0) + cRead;
      total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + cWrite;
    }
  });

  return {
    get: (m?: string) => {
      // prioritas: model efektif (dari fallback) > argumen > model default
      const eff = effectiveModel ?? m ?? model;
      const base: Usage = { ...total };
      return eff ? { ...base, cost: costFor(eff, base.inputTokens, base.outputTokens, base.cacheReadTokens ?? 0, base.cacheWriteTokens ?? 0, cacheIncluded) } : base;
    },
    modelUsed: () => ({ effective: effectiveModel, provider: effectiveProvider }),
    reset: () => {
      total = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      effectiveModel = undefined;
      effectiveProvider = undefined;
    },
  };
}
