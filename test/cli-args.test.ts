import { expect, test } from "bun:test"
import { getArg, promptFromArgs } from "../cli/args.ts"

test("getArg returns value after flag", () => {
  expect(getArg(["refactor", "--cwd", "src"], "--cwd")).toBe("src")
  expect(getArg(["refactor", "--cwd"], "--cwd")).toBeUndefined()
  expect(getArg(["refactor"], "--cwd")).toBeUndefined()
})

test("promptFromArgs removes boolean flags", () => {
  expect(promptFromArgs(["refactor", "src", "--verbose"])).toBe("refactor src")
  expect(promptFromArgs(["refactor", "--allow-all", "--tui"])).toBe("refactor")
  expect(promptFromArgs([])).toBe("")
})

test("promptFromArgs removes value flags + their values", () => {
  expect(promptFromArgs(["--cwd", "src", "refactor", "help"])).toBe("refactor help")
  expect(promptFromArgs(["build", "--model", "gpt-4o-mini", "--timeout", "1000"])).toBe("build")
  expect(promptFromArgs(["refactor", "--max-steps", "5"])).toBe("refactor")
})

test("promptFromArgs keeps prompt words resembling negative numbers", () => {
  expect(promptFromArgs(["-123", "x"])).toBe("-123 x")
})

// ── C12 regressions ──────────────────────────────────────────────────────────

test("--verify is a known boolean flag, not prompt text", () => {
  expect(promptFromArgs(["fix bugs", "--verify"])).toBe("fix bugs")
  expect(promptFromArgs(["--verify", "fix bugs"])).toBe("fix bugs")
})

test("supports --flag=value form in prompt filtering", () => {
  expect(promptFromArgs(["hi", "--model=gpt-4o", "--cwd=src"])).toBe("hi")
})

test("getArg supports --flag=value form", () => {
  expect(getArg(["run", "--model=gpt-4o"], "--model")).toBe("gpt-4o")
  expect(getArg(["run", "--budget=5"], "--budget")).toBe("5")
  expect(getArg(["run", "--model="], "--model")).toBeUndefined()
})

test("repeated value flags are all filtered from the prompt", () => {
  expect(promptFromArgs(["--cwd", "a", "--cwd", "b", "do it"])).toBe("do it")
  // last occurrence wins (konsisten dgn getArg baru)
  expect(getArg(["--cwd", "a", "--cwd", "b"], "--cwd")).toBe("b")
})
