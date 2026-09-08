import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendLspDiagnostics,
  detectVerifyCommand,
  runVerify,
  runWithSelfHeal,
} from "../src/policy/verifier.ts"

test("runVerify: success returns ok", async () => {
  const rt = JSON.stringify(process.execPath)
  const r = await runVerify(`${rt} -e "console.log('ok')"`, process.cwd())
  expect(r.ok).toBe(true)
  expect(r.output).toContain("ok")
})

test("runVerify: failure returns not ok", async () => {
  const rt = JSON.stringify(process.execPath)
  const r = await runVerify(`${rt} -e "process.exit(1)"`, process.cwd())
  expect(r.ok).toBe(false)
})

test("runVerify: respects timeout", async () => {
  const rt = JSON.stringify(process.execPath)
  const r = await runVerify(`${rt} -e "setTimeout(()=>{}, 5000)"`, process.cwd(), 300)
  expect(r.ok).toBe(false)
})

test("detectVerifyCommand: uses package.json typecheck script", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minicode-vf-"))
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
    "utf8",
  )
  expect(detectVerifyCommand(dir)).toBe("tsc --noEmit")
  await rm(dir, { recursive: true, force: true })
})

test("detectVerifyCommand: falls back to tsconfig when no scripts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minicode-vf-"))
  await writeFile(join(dir, "tsconfig.json"), "{}", "utf8")
  expect(detectVerifyCommand(dir)).toBe("bun x tsc --noEmit")
  await rm(dir, { recursive: true, force: true })
})

test("detectVerifyCommand: returns undefined for empty dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minicode-vf-"))
  expect(detectVerifyCommand(dir)).toBeUndefined()
  await rm(dir, { recursive: true, force: true })
})

test("appendLspDiagnostics: no LSP configured → unchanged", async () => {
  const base = "edited src/a.ts"
  const out = await appendLspDiagnostics(join(process.cwd(), "src", "a.ts"), "const x = 1;", base)
  expect(out).toBe(base)
})

test("runWithSelfHeal: stops when verify passes immediately", async () => {
  const runs: string[] = []
  await runWithSelfHeal("task", {
    run: async (p) => {
      runs.push(p)
    },
    verify: async () => ({ ok: true, output: "clean", command: "t" }),
  })
  expect(runs).toEqual(["task"])
})

test("runWithSelfHeal: keeps fixing until verify passes", async () => {
  const runs: string[] = []
  let failCount = 2
  await runWithSelfHeal("task", {
    run: async (p) => {
      runs.push(p)
    },
    verify: async () => {
      if (failCount > 0) {
        failCount--
        return { ok: false, output: "err", command: "t" }
      }
      return { ok: true, output: "clean", command: "t" }
    },
  })
  expect(runs.length).toBe(3) // initial + 2 fix cycles
  expect(runs[1]).toContain("Auto-Verifier")
})

test("runWithSelfHeal: caps at max cycles", async () => {
  const runs: string[] = []
  let onCycleCalls = 0
  await runWithSelfHeal("task", {
    run: async (p) => {
      runs.push(p)
    },
    verify: async () => ({ ok: false, output: "err", command: "t" }),
    maxCycles: 3,
    onCycle: () => {
      onCycleCalls++
    },
  })
  // max=3: initial + 2 fix prompts (siklus ke-3 onCycle tanpa run)
  expect(runs.length).toBe(3)
  expect(onCycleCalls).toBe(3)
})

test("buildVerifySnippet: ringkas, potong prompt panjang", async () => {
  const { buildVerifySnippet } = await import("../src/policy/verifier.ts")
  const s = buildVerifySnippet("  perbaiki   bug login  ", "bun test", 2)
  expect(s).toContain("verified ok")
  expect(s).toContain("perbaiki bug login")
  expect(s).toContain("bun test")
  const long = buildVerifySnippet("x".repeat(500), "y".repeat(300), 9)
  expect(long.length).toBeLessThan(400)
})
