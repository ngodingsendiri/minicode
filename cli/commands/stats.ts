import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { c } from "../../src/ui/render/theme.ts"

interface TraceRow {
  ok?: boolean
  inputTokens?: number
  outputTokens?: number
  cost?: number
  durationMs?: number
}

export async function handleStats(getArg: (name: string) => string | undefined): Promise<never> {
  const cwdArg = getArg("--cwd")
  const asJson = process.argv.includes("--json")
  const file = resolve(cwdArg ?? ".", ".minicode", "traces.jsonl")
  let traces: TraceRow[] = []
  try {
    traces = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TraceRow)
  } catch {}
  const total = traces.length
  const ok = traces.filter((t) => t.ok).length
  const inputTokens = traces.reduce((s, t) => s + (t.inputTokens ?? 0), 0)
  const outputTokens = traces.reduce((s, t) => s + (t.outputTokens ?? 0), 0)
  const cost = traces.reduce((s, t) => s + (t.cost ?? 0), 0)
  const avgMs = total ? Math.round(traces.reduce((s, t) => s + (t.durationMs ?? 0), 0) / total) : 0

  // --json dulu diterima tanpa keluhan lalu diabaikan; kini benar-benar bekerja.
  if (asJson) {
    console.log(
      JSON.stringify({ runs: total, resolved: ok, inputTokens, outputTokens, cost, avgMs }),
    )
    process.exit(0)
  }
  const dot = "\u00b7"
  console.log(
    `Runs: ${total} ${dot} Resolved: ${ok}/${total} ${dot} Tokens in=${inputTokens} out=${outputTokens} ${dot} Cost: $${cost.toFixed(4)} ${dot} Avg ${avgMs}ms`,
  )
  if (total === 0) console.log(c.dim(`  (no traces yet in ${file})`))
  process.exit(0)
}
