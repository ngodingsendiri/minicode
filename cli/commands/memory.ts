import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getMemoryStats } from "../../src/memory/vector.ts"
import { c } from "../../src/ui/render/theme.ts"

const MEMORY_HELP = `minicode memory — vector RAG store stats

  minicode memory status [--json]  rows, size, models, hit-rate (default)`

interface MemoryTraceRow {
  memoryHits?: number
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function fmtDate(ts: number | null): string {
  if (ts == null) return "-"
  try {
    return new Date(ts).toISOString().slice(0, 10)
  } catch {
    return "-"
  }
}

// Hit-rate RAG dari traces.jsonl: rata-rata memoryHits per run yang mencatatnya.
function readHitRate(cwd?: string): { runs: number; avgHits: number } {
  let runs = 0
  let total = 0
  try {
    const lines = readFileSync(resolve(cwd ?? ".", ".minicode", "traces.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
    for (const l of lines) {
      try {
        const t = JSON.parse(l) as MemoryTraceRow
        if (typeof t.memoryHits === "number") {
          runs++
          total += t.memoryHits
        }
      } catch {}
    }
  } catch {}
  return { runs, avgHits: runs ? total / runs : 0 }
}

export async function handleMemory(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  const sub = args[1]
  if (sub === "--help" || sub === "-h") {
    console.log(MEMORY_HELP)
    process.exit(0)
  }
  if (sub && sub !== "status" && !sub.startsWith("-")) {
    console.error(`unknown memory subcommand "${sub}" — see: minicode memory status`)
    process.exit(1)
  }
  // Catatan: getArg() bersama berhenti di token subcommand ("memory" dianggap
  // batas prompt anti-injeksi), jadi --cwd/--json setelah subcommand tidak
  // terbaca lewatnya — bug yang sama ada di semua subcommand lain (stats,
  // sessions, providers, …). Parse lokal dari args[1..] agar flag command ini
  // benar-benar honored tanpa mengubah semantik getArg global.
  const subArg = (name: string): string | undefined => {
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!
      if (a === name) {
        const v = args[i + 1]
        return v !== undefined && !v.startsWith("-") ? v : undefined
      }
      if (a.startsWith(`${name}=`)) {
        const v = a.slice(name.length + 1)
        return v !== "" ? v : undefined
      }
    }
    return getArg(name)
  }
  const cwdArg = subArg("--cwd")
  const asJson = subArg("--json") !== undefined || process.argv.includes("--json")
  const s = getMemoryStats(cwdArg)
  const { runs, avgHits } = readHitRate(cwdArg)
  if (asJson) {
    console.log(
      JSON.stringify({
        rows: s.rows,
        dbBytes: s.dbBytes,
        walBytes: s.walBytes,
        shmBytes: s.shmBytes,
        models: s.models,
        dims: s.dims,
        oldest: s.oldest,
        newest: s.newest,
        traceRuns: runs,
        avgMemoryHits: Math.round(avgHits * 100) / 100,
      }),
    )
    process.exit(0)
  }
  const dot = "\u00b7"
  console.log(
    `\n${c.bold("Memory")}  ${s.rows} rows ${dot} ${fmtBytes(s.dbBytes + s.walBytes + s.shmBytes)} ` +
      `(db ${fmtBytes(s.dbBytes)} ${dot} wal ${fmtBytes(s.walBytes)} ${dot} shm ${fmtBytes(s.shmBytes)})`,
  )
  if (s.models.length)
    console.log(`  models: ${s.models.map((m) => `${m.model}×${m.count}`).join(", ")}`)
  if (s.dims.length)
    console.log(`  dims: ${s.dims.map((d) => `${d.dim || "none"}×${d.count}`).join(", ")}`)
  console.log(`  range: ${fmtDate(s.oldest)} → ${fmtDate(s.newest)}`)
  if (runs > 0)
    console.log(`  RAG hit-rate: ${avgHits.toFixed(2)} hits/run over ${runs} traced runs`)
  else console.log(c.dim(`  (no memoryHits in traces yet — run once to measure hit-rate)`))
  console.log("")
  process.exit(0)
}
