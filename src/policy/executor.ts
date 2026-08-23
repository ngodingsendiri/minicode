import type { ToolExecutor, ExecutorDeps } from "../../../minicore/src/core/index.ts";
import { runCall } from "../../../minicore/src/core/executor.ts";
import { abortError } from "../../../minicore/src/core/errors.ts";
import type { ToolCall, ToolResult } from "../../../minicore/src/core/types.ts";

const WRITE_TOOLS = new Set(["write_file", "edit", "bash", "write_memory", "forget_memory"]);

function isWrite(call: ToolCall): boolean {
  return WRITE_TOOLS.has(call.name);
}

export function parallelExecutor(opts: { concurrency?: number; writeConcurrency?: number } = {}): ToolExecutor {
  const concurrency = opts.concurrency ?? 8;
  const writeConcurrency = opts.writeConcurrency ?? 2;

  return {
    async execute(calls: readonly ToolCall[], deps: ExecutorDeps): Promise<readonly ToolResult[]> {
      if (calls.length === 0) return [];
      const results: (ToolResult | undefined)[] = new Array(calls.length);

      // mixed write+read step → sequential in original order so a read after a
      // write on the same file sees the new content (parallel would race it)
      const anyWrite = calls.some(isWrite);
      const anyRead = calls.some((c) => !isWrite(c));
      if (anyWrite && anyRead) {
        for (let i = 0; i < calls.length; i++) {
          if (deps.signal.aborted) throw abortError(deps.signal);
          results[i] = await runCall(calls[i]!, deps);
        }
        return results as ToolResult[];
      }

      let cursor = 0;
      let activeWrites = 0;
      const writeWaiters: (() => void)[] = [];

      function acquireWrite(): Promise<void> {
        if (activeWrites < writeConcurrency) {
          activeWrites++;
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          writeWaiters.push(resolve);
        });
      }
      function releaseWrite(): void {
        activeWrites--;
        const next = writeWaiters.shift();
        if (next) {
          activeWrites++;
          next();
        }
      }

      const workers = Array(Math.min(concurrency, calls.length))
        .fill(0)
        .map(async () => {
          while (true) {
            if (deps.signal.aborted) throw abortError(deps.signal);
            const idx = cursor++;
            if (idx >= calls.length) break;
            const call = calls[idx]!;
            const needWrite = isWrite(call);
            if (needWrite) {
              if (deps.signal.aborted) throw abortError(deps.signal);
              await acquireWrite();
              if (deps.signal.aborted) {
                releaseWrite();
                throw abortError(deps.signal);
              }
            }
            try {
              if (deps.signal.aborted) throw abortError(deps.signal);
              const res = await runCall(call, deps);
              results[idx] = res;
            } finally {
              if (needWrite) releaseWrite();
            }
          }
        });
      await Promise.all(workers);
      return results as ToolResult[];
    },
  };
}
