import type { ToolExecutor, ExecutorDeps } from "../../../minicore/src/core/index.ts";
import { runCall } from "../../../minicore/src/core/executor.ts";
import type { ToolCall, ToolResult } from "../../../minicore/src/core/types.ts";

const WRITE_TOOLS = new Set(["write_file", "edit", "bash"]);

function isWrite(call: ToolCall): boolean {
  return WRITE_TOOLS.has(call.name);
}

export function parallelExecutor(opts: { concurrency?: number; writeConcurrency?: number } = {}): ToolExecutor {
  const concurrency = opts.concurrency ?? 8;
  const writeConcurrency = opts.writeConcurrency ?? 2;

  return {
    async execute(calls: readonly ToolCall[], deps: ExecutorDeps): Promise<readonly ToolResult[]> {
      if (calls.length === 0) return [];
      // split read vs write
      const reads: { call: ToolCall; idx: number }[] = [];
      const writes: { call: ToolCall; idx: number }[] = [];
      calls.forEach((c, i) => (isWrite(c) ? writes : reads).push({ call: c, idx: i }));
      const results: (ToolResult | undefined)[] = new Array(calls.length);

      async function runBatch(batch: { call: ToolCall; idx: number }[], limit: number) {
        let cursor = 0;
        const workers = Array(Math.min(limit, batch.length))
          .fill(0)
          .map(async () => {
            while (cursor < batch.length) {
              if (deps.signal.aborted) throw new Error("aborted");
              const item = batch[cursor++];
              if (!item) break;
              const res = await runCall(item.call, deps);
              results[item.idx] = res;
            }
          });
        await Promise.all(workers);
      }

      await runBatch(reads, concurrency);
      if (writes.length) await runBatch(writes, writeConcurrency);
      return results as ToolResult[];
    },
  };
}
