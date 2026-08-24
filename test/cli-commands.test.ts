import { expect, test } from "bun:test";
import { handleBuiltinCommand } from "../cli/commands.ts";

test("commands: non-slash input returns handled: false", async () => {
  const dummyCtx = {
    sessionId: "test-sess",
    currentModel: "gpt-4o",
    usage: { get: () => ({ inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.001 }), reset: () => {} },
    skills: [],
    toolsCount: 20,
    setModelOverride: () => {},
  };

  const res = await handleBuiltinCommand("hello world", dummyCtx);
  expect(res.handled).toBe(false);
});

test("commands: /help, /clear, /status, /model are handled", async () => {
  let switchedModel = "";
  const dummyCtx = {
    sessionId: "test-sess",
    currentModel: "gpt-4o",
    usage: { get: () => ({ inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.001 }), reset: () => {} },
    skills: [],
    toolsCount: 20,
    setModelOverride: (m: string) => { switchedModel = m; },
  };

  const resHelp = await handleBuiltinCommand("/help", dummyCtx);
  expect(resHelp.handled).toBe(true);

  const resClear = await handleBuiltinCommand("/clear", dummyCtx);
  expect(resClear.handled).toBe(true);

  const resModel = await handleBuiltinCommand("/model deepseek-chat", dummyCtx);
  expect(resModel.handled).toBe(true);
  expect(switchedModel).toBe("deepseek-chat");

  const resExit = await handleBuiltinCommand("/exit", dummyCtx);
  expect(resExit.handled).toBe(true);
  expect(resExit.shouldExit).toBe(true);
});
