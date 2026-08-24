import { mkdirSync, appendFileSync } from "node:fs";
import { resolve, join } from "node:path";

export interface RunTrace {
  sessionId: string;
  timestamp: string;
  prompt: string;
  durationMs: number;
  steps: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cost?: number;
  model?: string;
  ok: boolean;
  error?: string;
}

// Telemetry ringan: satu baris JSON per run di .minicode/traces.jsonl.
// Tanpa OTel — cukup untuk agregasi manual / metrik sederhana.
export function writeTrace(cwd: string | undefined, trace: RunTrace): void {
  try {
    const dir = resolve(cwd ?? ".", ".minicode");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "traces.jsonl");
    appendFileSync(file, JSON.stringify(trace) + "\n", "utf8");
  } catch {}
}