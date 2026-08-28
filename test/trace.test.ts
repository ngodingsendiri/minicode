import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeTrace } from "../src/telemetry/trace.ts"

let dir: string
const prevTele = process.env.MINICODE_TELEMETRY

afterEach(async () => {
  process.env.MINICODE_TELEMETRY = prevTele
  if (dir) await rm(dir, { recursive: true, force: true })
})

function baseTrace() {
  return {
    sessionId: `s-${randomUUID().slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    prompt: "hello",
    durationMs: 10,
    steps: 1,
    turns: 1,
    inputTokens: 1,
    outputTokens: 1,
    ok: true,
  }
}

describe("telemetry trace (C16)", () => {
  test("writes jsonl and scrubs prompt secrets", async () => {
    dir = await mkdtemp(join(tmpdir(), "minicode-trace-"))
    await writeTrace(dir, { ...baseTrace(), prompt: "key sk-abc123XYZ987abc123XYZ987abc123" })
    const txt = await readFile(`${dir}/.minicode/traces.jsonl`, "utf8")
    expect(txt).toContain('"sessionId"')
    expect(txt).not.toContain("sk-abc123")
    expect(txt).toContain("[REDACTED]")
  })

  test("MINICODE_TELEMETRY=0 disables writing entirely", async () => {
    dir = await mkdtemp(join(tmpdir(), "minicode-trace-off-"))
    process.env.MINICODE_TELEMETRY = "0"
    await writeTrace(dir, baseTrace())
    const files = await readdir(dir).catch(() => ["<no-dir>"])
    expect(files).toEqual([])
  })

  test("rotation keeps last N lines via atomic rewrite", async () => {
    dir = await mkdtemp(join(tmpdir(), "minicode-trace-rot-"))
    await mkdir(`${dir}/.minicode`, { recursive: true })
    // tulis 1005 baris manual lalu satu trace baru → harus terpotong ke <=1000
    let seed = ""
    for (let i = 0; i < 1005; i++) seed += `${JSON.stringify({ sessionId: `old-${i}` })}\n`
    await import("node:fs/promises").then((m) =>
      m.writeFile(`${dir}/.minicode/traces.jsonl`, seed, "utf8"),
    )
    const t = baseTrace()
    await writeTrace(dir, t)
    const after = (await readFile(`${dir}/.minicode/traces.jsonl`, "utf8"))
      .split("\n")
      .filter(Boolean)
    expect(after.length).toBe(1000)
    expect(after[999]).toContain(t.sessionId)
    const leftovers = (await readdir(`${dir}/.minicode`)).filter((f) => f.includes(".tmp."))
    expect(leftovers).toEqual([])
  })
})
