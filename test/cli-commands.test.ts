import { expect, test } from "bun:test";
import { handleBuiltinCommand } from "../cli/commands.ts";
import { saveSession } from "../src/session/persistence.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function dummyCtx(extra: { setModelOverride?: (m: string) => void } = {}) {
  return {
    sessionId: "test-sess",
    currentModel: "gpt-4o",
    usage: {
      get: () => ({ inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.001 }),
      reset: () => {},
      modelUsed: () => ({ effective: undefined, provider: undefined }),
    },
    skills: [],
    toolsCount: 20,
    setModelOverride: extra.setModelOverride ?? (() => {}),
  };
}

test("commands: non-slash input returns handled: false", async () => {
  const res = await handleBuiltinCommand("hello world", dummyCtx());
  expect(res.handled).toBe(false);
});

test("commands: BUILTIN_COMMANDS name tidak boleh berisi placeholder args", () => {
  const { BUILTIN_COMMANDS } = require("../cli/commands.ts") as { BUILTIN_COMMANDS: { name: string; args?: string }[] };
  for (const b of BUILTIN_COMMANDS) {
    expect(b.name).not.toMatch(/[<\[\s]/);
  }
});

test("commands: /models tanpa arg handled tanpa crash (args kosong)", async () => {
  const res = await handleBuiltinCommand("/models", dummyCtx());
  expect(res.handled).toBe(true);
});

test("commands: /help, /clear, /status, /model are handled", async () => {
  let switchedModel = "";
  const ctx = dummyCtx({ setModelOverride: (m: string) => { switchedModel = m; } });

  const resHelp = await handleBuiltinCommand("/help", ctx);
  expect(resHelp.handled).toBe(true);

  const resClear = await handleBuiltinCommand("/clear", ctx);
  expect(resClear.handled).toBe(true);

  const resModel = await handleBuiltinCommand("/model foo::deepseek-chat", ctx);
  expect(resModel.handled).toBe(true);
  expect(switchedModel).toBe("foo::deepseek-chat");

  const resExit = await handleBuiltinCommand("/exit", ctx);
  expect(resExit.handled).toBe(true);
  expect(resExit.shouldExit).toBe(true);
});

test("commands: /sessions lists saved sessions with cwd", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "minicode-sess-"));
  saveSession("sess-1", tmp, undefined, [{ role: "user", content: "hi" }], { inputTokens: 1 });
  const ctx = { ...dummyCtx(), cwd: tmp };
  const res = await handleBuiltinCommand("/sessions", ctx);
  expect(res.handled).toBe(true);
  rmSync(tmp, { recursive: true, force: true });
});

test("commands: /resume fails gracefully on unknown id", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "minicode-resume-"));
  const ctx = { ...dummyCtx(), cwd: tmp };
  const res = await handleBuiltinCommand("/resume no-such-id", ctx);
  expect(res.handled).toBe(true);
  rmSync(tmp, { recursive: true, force: true });
});
