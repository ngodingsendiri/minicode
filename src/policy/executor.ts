import { abortError } from "minicore/core/errors.ts"
import { runCall } from "minicore/core/executor.ts"
import type { ExecutorDeps, ToolExecutor } from "minicore/core/index.ts"
import type { ToolCall, ToolResult } from "minicore/core/types.ts"

const WRITE_TOOLS = new Set([
  "write_file",
  "edit",
  "apply_patch",
  "bash",
  "write_memory",
  "forget_memory",
])

function isWrite(call: ToolCall): boolean {
  return WRITE_TOOLS.has(call.name)
}

export function parallelExecutor(
  opts: { concurrency?: number; writeConcurrency?: number } = {},
): ToolExecutor {
  const concurrency = opts.concurrency ?? 8
  const writeConcurrency = opts.writeConcurrency ?? 2

  return {
    async execute(calls: readonly ToolCall[], deps: ExecutorDeps): Promise<readonly ToolResult[]> {
      if (calls.length === 0) return []
      const results: (ToolResult | undefined)[] = new Array(calls.length)

      // mixed write+read step → sequential in original order so a read after a
      // write on the same file sees the new content (parallel would race it)
      const anyWrite = calls.some(isWrite)
      const anyRead = calls.some((c) => !isWrite(c))
      if (anyWrite && anyRead) {
        for (let i = 0; i < calls.length; i++) {
          if (deps.signal.aborted) throw abortError(deps.signal)
          results[i] = await runCall(calls[i]!, deps)
        }
        return results as ToolResult[]
      }

      let cursor = 0
      let activeWrites = 0
      const writeWaiters: (() => void)[] = []
      // per-file lock to prevent same-file write race (e.g. two edits to same path)
      const fileLocks = new Map<string, number>()
      const fileWaiters = new Map<string, (() => void)[]>()

      function getFilePath(call: ToolCall): string | null {
        if (call.name === "write_file" || call.name === "edit" || call.name === "apply_patch") {
          const p = (call.args as Record<string, unknown>)?.path
          return typeof p === "string" ? p : null
        }
        return null
      }

      function acquireFileLock(path: string | null): Promise<void> {
        if (!path) return Promise.resolve()
        if ((fileLocks.get(path) ?? 0) === 0) {
          fileLocks.set(path, 1)
          return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
          const q = fileWaiters.get(path) ?? []
          q.push(resolve)
          fileWaiters.set(path, q)
        })
      }

      function releaseFileLock(path: string | null): void {
        if (!path) return
        const q = fileWaiters.get(path)
        if (q && q.length > 0) {
          const next = q.shift()!
          if (q.length === 0) fileWaiters.delete(path)
          // keep lock held by next waiter
          next()
        } else {
          fileLocks.delete(path)
        }
      }

      function acquireWrite(): Promise<void> {
        if (activeWrites < writeConcurrency) {
          activeWrites++
          return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
          writeWaiters.push(resolve)
        })
      }
      function releaseWrite(): void {
        activeWrites--
        const next = writeWaiters.shift()
        if (next) {
          activeWrites++
          next()
        }
      }

      const workers = Array(Math.min(concurrency, calls.length))
        .fill(0)
        .map(async () => {
          while (true) {
            if (deps.signal.aborted) throw abortError(deps.signal)
            const idx = cursor++
            if (idx >= calls.length) break
            const call = calls[idx]!
            const needWrite = isWrite(call)
            const filePath = needWrite ? getFilePath(call) : null
            if (needWrite) {
              if (deps.signal.aborted) throw abortError(deps.signal)
              await acquireWrite()
              if (deps.signal.aborted) {
                releaseWrite()
                throw abortError(deps.signal)
              }
              await acquireFileLock(filePath)
              if (deps.signal.aborted) {
                releaseFileLock(filePath)
                releaseWrite()
                throw abortError(deps.signal)
              }
            }
            try {
              if (deps.signal.aborted) throw abortError(deps.signal)
              const res = await runCall(call, deps)
              results[idx] = res
            } finally {
              if (needWrite) {
                releaseFileLock(filePath)
                releaseWrite()
              }
            }
          }
        })
      await Promise.all(workers)
      return results as ToolResult[]
    },
  }
}
