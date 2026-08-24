// Benchmark runner: jalankan tugas sample terhadap minicode, ukur resolve rate,
// steps, token, durasi. `--fake` untuk smoke tanpa API key (dipakai CI).
import { writeFileSync } from "node:fs";
import { BENCH_TASKS } from "./tasks.ts";
import { loadConfig } from "../src/config.ts";
import { buildProviderList } from "../src/providers/build.ts";
import { createRouterProvider } from "../src/providers/router.ts";
import { createMinicodeSession } from "../src/session.ts";
import { allTools } from "../src/tools/index.ts";
import { createUsageCollector } from "../src/policy/usage.ts";
import type { ModelProvider } from "minicore";

const fake = process.argv.includes("--fake");

async function main(): Promise<void> {
  let provider: ModelProvider;
  if (fake) {
    provider = {
      id: "fake", models: ["fake"],
      async *stream() {
        yield { type: "text", text: "done" };
        yield { type: "finish", reason: "stop" };
      },
    };
  } else {
    const cfg = await loadConfig();
    const providers = buildProviderList(cfg);
    if (providers.length === 0) {
      console.error("no provider configured — jalankan setup wizard, atau pakai --fake");
      process.exit(1);
    }
    provider = createRouterProvider({ providers });
  }

  const results: Record<string, unknown>[] = [];
  for (const task of BENCH_TASKS) {
    const dir = await task.setup();
    const session = await createMinicodeSession({ provider, tools: allTools, cwd: dir, permissionMode: "auto" });
    const usage = createUsageCollector(session.events);
    const t0 = Date.now();
    let steps = 0;
    let error: string | undefined;
    try {
      const res = await session.run(task.prompt, {});
      steps = res.usage.steps;
    } catch (e) {
      error = (e as Error).message;
    }
    const durationMs = Date.now() - t0;
    const u = usage.get();
    const rawVerify = await task.verify(dir);
    // --fake: provider palsu tak pernah benar-benar mengedit file → anggap passed bila harness jalan tanpa error
    const verify = fake ? { ...rawVerify, passed: true } : rawVerify;
    await task.cleanup(dir);
    const passed = verify.passed && !error;
    results.push({ id: task.id, description: task.description, passed, steps, durationMs, inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens, cost: u.cost, error, detail: verify.detail });
    process.stdout.write(`${passed ? "PASS" : "FAIL"} ${task.id} steps=${steps} tokens=${u.totalTokens} ${durationMs}ms${error ? ` error=${error.slice(0, 80)}` : ""}\n`);
  }

  const resolved = results.filter((r) => r.passed).length;
  const summary = {
    timestamp: new Date().toISOString(),
    fake,
    total: results.length,
    resolved,
    resolveRate: results.length ? Number((resolved / results.length).toFixed(3)) : 0,
  };
  writeFileSync("bench/results.json", JSON.stringify({ ...summary, results }, null, 2));
  process.stdout.write(`\nresolve rate: ${resolved}/${results.length} (${summary.resolveRate})\n`);
}

main().catch((e) => {
  console.error(`[bench] ${(e as Error).message}`);
  process.exit(1);
});