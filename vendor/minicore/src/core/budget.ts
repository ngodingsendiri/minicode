// Token budget policy: pure functions over a budget state. No storage, no side effects.

export type PressureLevel = "low" | "medium" | "high" | "critical";

export interface BudgetState {
  usedTokens: number;
  limitTokens: number;
}

export interface BudgetPolicy {
  evaluate(state: BudgetState): PressureLevel;
  shouldCompact(pressure: PressureLevel): boolean;
}

export const defaultBudgetPolicy: BudgetPolicy = {
  evaluate({ usedTokens, limitTokens }) {
    const ratio = usedTokens / Math.max(1, limitTokens);
    if (ratio >= 1) return "critical";
    if (ratio >= 0.9) return "high";
    if (ratio >= 0.75) return "medium";
    return "low";
  },
  shouldCompact(pressure) {
    return pressure === "medium" || pressure === "high" || pressure === "critical";
  },
};