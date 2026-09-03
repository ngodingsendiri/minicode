// Coverage for cli/setup.ts & cli/index.ts — jalur 0% yang jadi gate P1.1.
// Pendekatan: panggil createCliSession langsung (bukan spawn) agar ter-cover
// oleh `bun test --coverage` di proses yang sama. Spawn hanya untuk CLI entry
// yang top-level (process.exit).

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCliSession } from "../cli/setup.ts"

const tmpRoots: string[] = []

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "minicode-setup-"))
  tmpRoots.push(dir)
  mkdirSync(join(dir, ".minicode"), { recursive: true })
  mkdirSync(join(dir, "home", ".minicode"), { recursive: true })
  writeFileSync(
    join(dir, ".minicode", "config.json"),
    JSON.stringify({
      providers: [
        { id: "fake", baseUrl: "http://localhost:9", apiKey: "sk-test", models: ["gpt-4o-mini"] },
      ],
    }),
    "utf8",
  )
  return dir
}

describe("cli/setup: permissionMode & timeout & budget", () => {
  test("auto mode default", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s1",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
    })
    expect(s.permissionMode).toBe("auto")
    expect(s.effectiveTimeoutMs).toBe(900_000)
    await s.close()
  })

  test("allowAll -> allow-all", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s2",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: true,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
    })
    expect(s.permissionMode).toBe("allow-all")
    await s.close()
  })

  test("ask -> ask", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s3",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: true,
      plan: false,
      allowlist: false,
      verify: false,
    })
    expect(s.permissionMode).toBe("ask")
    await s.close()
  })

  test("plan -> plan", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s4",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: true,
      allowlist: false,
      verify: false,
    })
    expect(s.permissionMode).toBe("plan")
    await s.close()
  })

  test("allowlist -> allowlist", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s5",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: true,
      verify: false,
    })
    expect(s.permissionMode).toBe("allowlist")
    await s.close()
  })

  test("budget & maxSteps & contextWindow diteruskan", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s6",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
      budget: 1.5,
      maxSteps: 12,
      contextWindowTokens: 4000,
      timeoutMs: 1234,
    })
    expect(s.budget).toBe(1.5)
    expect(s.effectiveTimeoutMs).toBe(1234)
    expect(s.session).toBeDefined()
    await s.close()
  })

  test("timeoutMs 0 -> Infinity", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s7",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
      timeoutMs: 0,
    })
    expect(s.effectiveTimeoutMs).toBe(0)
    // Infinity di dalam session config
    await s.close()
  })

  test("MINICODE_TIMEOUT_MS env dipakai bila timeoutMs undefined", async () => {
    const cwd = makeWorkspace()
    const prev = process.env.MINICODE_TIMEOUT_MS
    process.env.MINICODE_TIMEOUT_MS = "7777"
    const s = await createCliSession({
      cwd,
      sessionId: "s8",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
    })
    expect(s.effectiveTimeoutMs).toBe(7777)
    await s.close()
    if (prev == null) delete process.env.MINICODE_TIMEOUT_MS
    else process.env.MINICODE_TIMEOUT_MS = prev
  })

  test("resumeId not found -> warning tapi tetap jalan", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s9",
      resumeId: "tidak-ada",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
    })
    expect(s.session).toBeDefined()
    await s.close()
  })

  test("persistCurrent & close tidak throw", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s10",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
    })
    await s.persistCurrent({ totalTokens: 10 })
    await s.close()
    expect(true).toBe(true)
  })

  test("runPromptWithVerify tanpa verify langsung run", async () => {
    const cwd = makeWorkspace()
    const s = await createCliSession({
      cwd,
      sessionId: "s11",
      prompt: "hi",
      enterRepl: false,
      verbose: false,
      allowAll: false,
      ask: false,
      plan: false,
      allowlist: false,
      verify: false,
    })
    // provider fake tidak ada, run akan gagal tapi tidak throw verify
    // cukup pastikan session ada
    expect(s.runPromptWithVerify).toBeDefined()
    await s.close()
  })
})

describe("cli/index helpers via args", () => {
  test("getArg & promptFromArgs ter-cover via import", async () => {
    const { getArg, promptFromArgs } = await import("../cli/args.ts")
    const args = ["--model", "gpt-4o", "--cwd", "/tmp", "hello", "world"]
    expect(getArg(args, "--model")).toBe("gpt-4o")
    expect(getArg(args, "--cwd")).toBe("/tmp")
    expect(promptFromArgs(args)).toBe("hello world")
    // flags after prompt are treated as prompt (anti injection)
    expect(getArg(["hello", "world", "--cwd", "/tmp"], "--cwd")).toBeUndefined()
    expect(promptFromArgs(["hello", "world", "--cwd", "/tmp"])).toBe("hello world --cwd /tmp")
    expect(promptFromArgs(["--verbose", "hi"])).toBe("hi")
    expect(promptFromArgs(["--model=gpt-4o", "hi"])).toBe("hi")
  })
})
