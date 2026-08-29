// Telemetry gate — cek resolve-rate dari traces.jsonl.
// Target: resolved/total >= 0.3 (dari bench baseline; warn, bukan block).
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const cwd = process.argv[2] ?? "."
const file = resolve(cwd, ".minicode", "traces.jsonl")

if (!existsSync(file)) {
  console.log("[gate] no traces.jsonl — skipping telemetry gate")
  process.exit(0)
}

const traces = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))

const ok = traces.filter((t) => t.ok).length
const rate = traces.length ? ok / traces.length : 0
const TARGET = 0.3

console.log(
  `[gate] runs=${traces.length} resolved=${ok}/${traces.length} rate=${rate.toFixed(2)} (target ${TARGET})`,
)
if (traces.length < 3) {
  console.log("[gate] too few runs — passing (insufficient data)")
  process.exit(0)
}
if (rate < TARGET) {
  console.warn(`[gate] WARN: resolve rate ${rate.toFixed(2)} < ${TARGET}`)
  process.exit(1)
}
process.exit(0)
