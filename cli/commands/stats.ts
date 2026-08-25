import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export async function handleStats(getArg: (name: string) => string | undefined): Promise<never> {
  const cwdArg = getArg("--cwd")
  const file = resolve(cwdArg ?? ".", ".minicode", "traces.jsonl")
  let traces: any[] = []
  try {
    traces = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  } catch {}
  const total = traces.length
  const ok = traces.filter((t) => t.ok).length
  const input = traces.reduce((s, t) => s + (t.inputTokens ?? 0), 0)
  const output = traces.reduce((s, t) => s + (t.outputTokens ?? 0), 0)
  const cost = traces.reduce((s, t) => s + (t.cost ?? 0), 0)
  const avgMs = total ? Math.round(traces.reduce((s, t) => s + (t.durationMs ?? 0), 0) / total) : 0
  console.log(
    `Runs: ${total} \u00b7 Resolved: ${ok}/${total} \u00b7 Tokens in=${input} out=${output} \u00b7 Cost: $${cost.toFixed(4)} \u00b7 Avg ${avgMs}ms`,
  )
  process.exit(0)
}
