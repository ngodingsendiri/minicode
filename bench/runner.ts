// Benchmark runner: jalankan tugas sample terhadap minicode, ukur resolve rate,
// steps, token, durasi. `--fake` untuk smoke tanpa API key (dipakai CI).
// `--runs <n>`: jumlah run per task (default 1; 2 = stabil/median).
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import type { ModelProvider } from "minicore"
import { loadConfig } from "../src/config.ts"
import { createUsageCollector } from "../src/policy/usage.ts"
import { buildProviderList } from "../src/providers/build.ts"
import { createRouterProvider } from "../src/providers/router.ts"
import { createMinicodeSession } from "../src/session.ts"
import { allTools } from "../src/tools/index.ts"
import { BENCH_TASKS, loadExternalTasks } from "./tasks.ts"

const fake = process.argv.includes("--fake")
const runsArgIdx = process.argv.indexOf("--runs")
const runs =
  runsArgIdx !== -1 && Number(process.argv[runsArgIdx + 1]) > 0
    ? Number(process.argv[runsArgIdx + 1])
    : 1

async function main(): Promise<void> {
  let provider: ModelProvider
  if (fake) {
    provider = {
      id: "fake",
      models: ["fake"],
      async *stream() {
        yield { type: "text", text: "done" }
        yield { type: "finish", reason: "stop" }
      },
    }
  } else {
    const cfg = await loadConfig()
    const providers = buildProviderList(cfg)
    if (providers.length === 0) {
      console.error("no provider configured — jalankan setup wizard, atau pakai --fake")
      process.exit(1)
    }
    provider = createRouterProvider({ providers })
  }

  // --tasks <path.json>: muat task eksternal (SWE-bench-format) — ganti BENCH_TASKS
  let tasks = BENCH_TASKS
  const tasksPathIdx = process.argv.indexOf("--tasks")
  if (tasksPathIdx !== -1 && process.argv[tasksPathIdx + 1]) {
    tasks = await loadExternalTasks(process.argv[tasksPathIdx + 1]!)
  }

  // aggregator per task: median dari n run agar outlier provider tidak menyesatkan
  const results: Record<string, unknown>[] = []
  const perTask = new Map<string, { passed: number; durations: number[]; tokens: number[] }>()
  for (const task of tasks) {
    const stats = { passed: 0, durations: [] as number[], tokens: [] as number[] }
    for (let r = 0; r < runs; r++) {
      const dir = await task.setup()
      const session = await createMinicodeSession({
        provider,
        tools: allTools,
        cwd: dir,
        permissionMode: "auto",
      })
      const usage = createUsageCollector(session.events)
      const t0 = Date.now()
      let steps = 0
      let error: string | undefined
      try {
        const res = await session.run(task.prompt, {})
        steps = res.usage.steps
      } catch (e) {
        error = (e as Error).message
      }
      const durationMs = Date.now() - t0
      const u = usage.get()
      const rawVerify = await task.verify(dir)
      // --fake: provider palsu tak pernah benar-benar mengedit file → anggap passed bila harness jalan tanpa error
      const verify = fake ? { ...rawVerify, passed: true } : rawVerify
      await task.cleanup(dir)
      const passed = verify.passed && !error
      stats.passed += passed ? 1 : 0
      stats.durations.push(durationMs)
      stats.tokens.push(u.totalTokens)
      process.stdout.write(
        `${passed ? "PASS" : "FAIL"} ${task.id} run=${r + 1}/${runs} steps=${steps} tokens=${u.totalTokens} ${durationMs}ms${error ? ` error=${error.slice(0, 80)}` : ""}\n`,
      )
      // jeda antar task untuk hindari rate limit (provider gratis/quota)
      if (!fake && error?.includes("429")) await new Promise((r) => setTimeout(r, 10000))
    }
    perTask.set(task.id, stats)
    const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]!
    results.push({
      id: task.id,
      description: task.description,
      runs,
      passedCount: stats.passed,
      medianDurationMs: median(stats.durations),
      medianTokens: median(stats.tokens),
    })
  }

  const resolved = results.filter((r) => (r as { passedCount: number }).passedCount === runs).length
  const partial = results.filter(
    (r) =>
      (r as { passedCount: number }).passedCount > 0 &&
      (r as { passedCount: number }).passedCount < runs,
  ).length
  const summary = {
    timestamp: new Date().toISOString(),
    fake,
    runsPerTask: runs,
    total: results.length,
    resolved,
    partial,
    resolveRate: results.length ? Number((resolved / results.length).toFixed(3)) : 0,
  }
  // Delta vs run sebelumnya
  let deltaLine = ""
  try {
    if (existsSync("bench/results.json")) {
      const prev = JSON.parse(readFileSync("bench/results.json", "utf8")) as {
        resolveRate?: number
        timestamp?: string
      }
      if (typeof prev.resolveRate === "number") {
        const delta = summary.resolveRate - prev.resolveRate
        const sign = delta > 0 ? "+" : ""
        deltaLine = `  delta: ${sign}${(delta * 100).toFixed(1)}% (prev ${prev.resolveRate} @ ${String(prev.timestamp).slice(0, 10)})\n`
      }
    }
  } catch {}
  writeFileSync("bench/results.json", JSON.stringify({ ...summary, results }, null, 2))
  process.stdout.write(
    `\nresolve rate: ${resolved}/${results.length} (${summary.resolveRate})${partial ? ` (${partial} partial)` : ""}\n${deltaLine}`,
  )
}

main().catch((e) => {
  console.error(`[bench] ${(e as Error).message}`)
  process.exit(1)
})
