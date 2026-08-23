import { expect, test } from "bun:test";
import { getArg, promptFromArgs } from "../cli/args.ts";

test("getArg returns value after flag", () => {
  expect(getArg(["refactor", "--cwd", "src"], "--cwd")).toBe("src");
  expect(getArg(["refactor", "--cwd"], "--cwd")).toBeUndefined();
  expect(getArg(["refactor"], "--cwd")).toBeUndefined();
});

test("promptFromArgs removes boolean flags", () => {
  expect(promptFromArgs(["refactor", "src", "--verbose"])).toBe("refactor src");
  expect(promptFromArgs(["refactor", "--allow-all", "--tui"])).toBe("refactor");
  expect(promptFromArgs([])).toBe("");
});

test("promptFromArgs removes value flags + their values", () => {
  expect(promptFromArgs(["--cwd", "src", "refactor", "help"])).toBe("refactor help");
  expect(promptFromArgs(["build", "--model", "gpt-4o-mini", "--timeout", "1000"])).toBe("build");
  expect(promptFromArgs(["refactor", "--max-steps", "5"])).toBe("refactor");
});

test("promptFromArgs keeps prompt words resembling negative numbers", () => {
  expect(promptFromArgs(["-123", "x"])).toBe("-123 x");
});
