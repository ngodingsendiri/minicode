import { expect, test } from "bun:test"
import { createEventBus, createToolRegistry } from "minicore"
import { allowAll } from "../../minicore/test/fakes.ts"
import { parallelExecutor } from "../src/policy/executor.ts"

const slowTool = (ms: number, name = "bash") => ({
  name,
  description: "slow",
  parameters: { type: "object" as const, properties: {}, additionalProperties: true },
  async execute() {
    await new Promise((r) => setTimeout(r, ms))
    return "ok"
  },
})

function depsWith(signal: AbortSignal, tools: unknown) {
  return {
    registry: createToolRegistry(tools as never),
    permissions: allowAll,
    events: createEventBus(),
    signal,
    state: { history: [], turnCount: 0, stepCount: 0 },
    maxResultTokens: 4096,
  }
}

test("executor rejects PROMPTLY on abort while queued on write semaphore", async () => {
  const exec = parallelExecutor({ concurrency: 8, writeConcurrency: 1 })
  const ac = new AbortController()
  const deps = depsWith(ac.signal, [slowTool(500)])
  const t0 = Date.now()
  setTimeout(() => ac.abort(), 10)
  // Call1 memegang slot 500ms; Call2 mengantre. Abort @10ms harus reject <300ms,
  // TIDAK menunggu tool in-flight selesai.
  await expect(
    exec.execute(
      [
        { id: "1", name: "bash", args: {} },
        { id: "2", name: "bash", args: {} },
      ],
      deps,
    ),
  ).rejects.toThrow()
  expect(Date.now() - t0).toBeLessThan(300)
})

test("executor rejects PROMPTLY on abort while queued on file lock", async () => {
  const exec = parallelExecutor({ concurrency: 8, writeConcurrency: 8 })
  const ac = new AbortController()
  const deps = depsWith(ac.signal, [slowTool(500, "write_file")])
  const same = { path: "src/a.ts" }
  const t0 = Date.now()
  setTimeout(() => ac.abort(), 10)
  await expect(
    exec.execute(
      [
        { id: "1", name: "write_file", args: same },
        { id: "2", name: "write_file", args: same },
      ],
      deps,
    ),
  ).rejects.toThrow()
  expect(Date.now() - t0).toBeLessThan(300)
})

test("no slot/lock leak after abort storm — fresh run succeeds", async () => {
  const exec = parallelExecutor({ concurrency: 8, writeConcurrency: 2 })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 5)
  await expect(
    exec.execute(
      Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: "bash", args: {} })),
      depsWith(ac.signal, [slowTool(50)]),
    ),
  ).rejects.toThrow()
  // executor yang sama harus masih sehat: slot/lock balanced
  const res = await exec.execute(
    Array.from({ length: 4 }, (_, i) => ({
      id: `x${i}`,
      name: "write_file",
      args: { path: `f${i}.txt` },
    })),
    depsWith(new AbortController().signal, [slowTool(10)]),
  )
  expect(res.length).toBe(4)
})
