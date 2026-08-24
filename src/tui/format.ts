// Formatter pesan event yang dipakai BERSAMA oleh renderer ANSI & Ink TUI,
// agar "apa yang ditampilkan" konsisten antar dua backend (tidak dobel logika).
import type { ToolCall } from "../../../minicore/src/core/types.ts";

export function formatArgsPreview(args: unknown): string {
  try {
    const a = args as Record<string, unknown>;
    if (a.path) return String(a.path);
    if (a.command) return String(a.command).slice(0, 60);
    if (a.query) return String(a.query);
    if (a.prompt) return String(a.prompt).slice(0, 40);
    return JSON.stringify(a).slice(0, 40);
  } catch {
    return "[args]";
  }
}

export function formatStepCalls(calls: readonly ToolCall[], argCap = 35): string {
  return calls.map((tc) => `${tc.name}(${JSON.stringify(tc.args).slice(0, argCap)})`).join(", ");
}

export function formatUsage(parts: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): string {
  const p = [
    parts.inputTokens != null ? `in:${parts.inputTokens}` : null,
    parts.outputTokens != null ? `out:${parts.outputTokens}` : null,
    parts.totalTokens != null ? `total:${parts.totalTokens}` : null,
  ].filter(Boolean) as string[];
  return p.join(" ");
}

export function formatProviderError(e: { category?: string; message?: string }): string {
  return `[${e.category ?? "unknown"}] ${e.message ?? ""}`;
}

export function formatCost(cost?: number): string {
  return cost != null ? `$${cost.toFixed(4)}` : "N/A";
}