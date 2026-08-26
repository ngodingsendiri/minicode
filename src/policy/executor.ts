import { abortError } from "minicore/core/errors.ts"
import { runCall } from "minicore/core/executor.ts"
import type { ExecutorDeps, ToolExecutor } from "minicore/core/index.ts"
import type { ToolCall, ToolResult } from "minicore/core/types.ts"
import { LIMITS } from "../constants.ts"

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

// Antrean abort-aware: saat signal abort, entry dibuang dari antrean dan
// promise langsung reject — worker tidak menunggu tool in-flight selesai.
interface Waiter {
  resolve(): void
  reject(reason: unknown): void
  onAbort?: () => void
}

function detach(w: Waiter, signal: AbortSignal | undefined): void {
  if (w.onAbort && signal) signal.removeEventListener("abort", w.onAbort)
  w.onAbort = undefined
}

function makeWaiter(
  signal: AbortSignal,
  removeFromQueue: (w: Waiter) => void,
): { promise: Promise<void>; waiter: Waiter } {
  let settle!: () => void
  let rejectFn!: (reason: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    settle = res
    rejectFn = rej
  })
  const waiter: Waiter = {
    resolve: () => {
      detach(waiter, signal)
      settle()
    },
    reject: (reason) => {
      detach(waiter, signal)
      rejectFn(reason)
    },
  }
  waiter.onAbort = () => {
    removeFromQueue(waiter)
    waiter.reject(abortError(signal))
  }
  if (signal.aborted) waiter.onAbort()
  else signal.addEventListener("abort", waiter.onAbort, { once: true })
  return { promise, waiter }
}

export function parallelExecutor(
  opts: { concurrency?: number; writeConcurrency?: number } = {},
): ToolExecutor {
  const concurrency = opts.concurrency ?? LIMITS.EXECUTOR_CONCURRENCY
  const writeConcurrency = opts.writeConcurrency ?? LIMITS.EXECUTOR_WRITE_CONCURRENCY

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
      // per-file lock to prevent same-file write race (e.g. two edits to same path)
      const fileLocks = new Map<string, number>()
      const fileWaiters = new Map<string, Waiter[]>()
      const writeWaiters: Waiter[] = []
      const signal = deps.signal

      function getFilePath(call: ToolCall): string | null {
        if (call.name === "write_file" || call.name === "edit" || call.name === "apply_patch") {
          const p = (call.args as Record<string, unknown>)?.path
          return typeof p === "string" ? p : null
        }
        return null
      }

      function acquireWrite(): Promise<void> {
        if (signal.aborted) return Promise.reject(abortError(signal))
        if (activeWrites < writeConcurrency) {
          activeWrites++
          return Promise.resolve()
        }
        const { promise, waiter } = makeWaiter(signal, (w) => {
          const i = writeWaiters.indexOf(w)
          if (i !== -1) writeWaiters.splice(i, 1)
        })
        writeWaiters.push(waiter)
        return promise
      }
      function releaseWrite(): void {
        const next = writeWaiters.shift()
        if (next) {
          // ownership berpindah — counter tetap (setara decrement+increment lama)
          next.resolve()
        } else {
          activeWrites--
        }
      }

      function acquireFileLock(path: string | null): Promise<void> {
        if (!path) return Promise.resolve()
        if (signal.aborted) return Promise.reject(abortError(signal))
        if ((fileLocks.get(path) ?? 0) === 0) {
          fileLocks.set(path, 1)
          return Promise.resolve()
        }
        const { promise, waiter } = makeWaiter(signal, (w) => {
          const q = fileWaiters.get(path)
          if (!q) return
          const i = q.indexOf(w)
          if (i !== -1) q.splice(i, 1)
          if (q.length === 0) fileWaiters.delete(path)
        })
        const q = fileWaiters.get(path) ?? []
        q.push(waiter)
        fileWaiters.set(path, q)
        return promise
      }
      function releaseFileLock(path: string | null): void {
        if (!path) return
        const q = fileWaiters.get(path)
        const next = q?.shift()
        if (next) {
          if (q && q.length === 0) fileWaiters.delete(path)
          next.resolve() // ownership berpindah ke waiter berikutnya
        } else {
          fileLocks.delete(path)
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
            let held = false
            try {
              if (needWrite) {
                await acquireWrite() // nothing held yet — safe to throw
                try {
                  await acquireFileLock(filePath)
                  held = true
                } catch (e) {
                  releaseWrite()
                  throw e
                }
              }
              const res = await runCall(call, deps)
              results[idx] = res
            } finally {
              if (held) {
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
