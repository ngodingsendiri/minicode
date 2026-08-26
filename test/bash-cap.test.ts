import { expect, test } from "bun:test"
import { bashTool } from "../src/tools/bash.ts"

const ctx = { signal: new AbortController().signal } as never

test("bash caps huge output during streaming (no OOM, marker set)", async () => {
  // node mencetak ~1.2MB — jauh di atas cap 20k; proses tetap selesai cepat.
  const res = await bashTool.execute(
    { cmd: 'node -e "process.stdout.write(\\"x\\".repeat(1200000))"', timeoutMs: 20_000 },
    ctx,
  )
  const text = String(res)
  expect(text.length).toBeLessThanOrEqual(21_000)
  expect(text).toContain("… [output truncated]")
}, 30_000)

test("bash small output unchanged (no false truncation)", async () => {
  const res = await bashTool.execute({ cmd: "echo hello-cap" }, ctx)
  const text = String(res).trim()
  expect(text).toContain("hello-cap")
  expect(text).not.toContain("[output truncated]")
})

test("bash stderr merges and exit code prefix preserved", async () => {
  const res = await bashTool.execute({ cmd: "echo oops 1>&2 && exit 3" }, ctx)
  const text = String(res)
  expect(text.startsWith("exit 3")).toBe(true)
  expect(text).toContain("[stderr]")
})
