import { expect, test } from "bun:test";
import { handleBuiltinCommand } from "../cli/commands.ts";

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
