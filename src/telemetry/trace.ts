import { appendFile, chmod, mkdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { LIMITS } from "../constants.ts"
import { atomicWriteText } from "../lib/atomic-write.ts"
import { scrubSecrets } from "../policy/scrub.ts"

export interface RunTrace {
  sessionId: string
  timestamp: string
  prompt: string
  durationMs: number
  steps: number
  turns: number
  inputTokens: number
  outputTokens: number
  cost?: number
  model?: string
  ok: boolean
  error?: string
}

// Opt-out privasi: MINICODE_TELEMETRY=0/false/off → tidak ada file ditulis.
function telemetryEnabled(): boolean {
  const v = (process.env.MINICODE_TELEMETRY ?? "").trim().toLowerCase()
  return v !== "0" && v !== "false" && v !== "off"
}

// Telemetry ringan: satu baris JSON per run di .minicode/traces.jsonl.
// Tanpa OTel — cukup untuk agregasi manual / metrik sederhana.
export async function writeTrace(cwd: string | undefined, trace: RunTrace): Promise<void> {
  if (!telemetryEnabled()) return
  try {
    const dir = resolve(cwd ?? ".", ".minicode")
    await mkdir(dir, { recursive: true })
    const file = join(dir, "traces.jsonl")
    // prompt di-redact sebelum persist — bisa berisi secret/PII dari user
    const safe: RunTrace = { ...trace, prompt: scrubSecrets(trace.prompt) }
    await appendFile(file, `${JSON.stringify(safe)}\n`, "utf8")
    await chmod(file, 0o600).catch(() => {})
    // Rotate: keep TRACE_MAX_LINES baris terakhir (tmp+rename agar anti-korupsi)
    try {
      const txt = await readFile(file, "utf8")
      const lines = txt.split("\n").filter(Boolean)
      if (lines.length > LIMITS.TRACE_MAX_LINES) {
        await atomicWriteText(file, `${lines.slice(-LIMITS.TRACE_MAX_LINES).join("\n")}\n`)
      }
    } catch {}
  } catch {}
}
