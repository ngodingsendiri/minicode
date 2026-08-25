import { expect, test } from "bun:test";
import { handleBuiltinCommand, buildModelCatalog } from "../cli/commands.ts";

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "test-sess",
    currentModel: "gpt-4o",
    currentProviderId: "p1",
    usage: { get: () => ({ inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.001 }), reset: () => {} },
    skills: [],
    toolsCount: 20,
    setModelOverride: () => {},
    ...(overrides as object),
  };
}

test("commands: non-slash input returns handled: false", async () => {
  const res = await handleBuiltinCommand("hello world", makeCtx());
  expect(res.handled).toBe(false);
});

test("commands: /help, /clear, /status, /exit handled", async () => {
  const ctx = makeCtx();
  expect((await handleBuiltinCommand("/help", ctx)).handled).toBe(true);
  expect((await handleBuiltinCommand("/clear", ctx)).handled).toBe(true);
  expect((await handleBuiltinCommand("/status", ctx)).handled).toBe(true);
  const exit = await handleBuiltinCommand("/exit", ctx);
  expect(exit.handled).toBe(true);
  expect(exit.shouldExit).toBe(true);
});

test("commands: /model <name> switches model with provider resolution", async () => {
  let switched: { m?: string; p?: string } = {};
  const ctx = makeCtx({
    allModels: () => [
      { model: "deepseek-chat", providers: ["p1", "p2"] },
      { model: "nemo", providers: ["p2"] },
    ],
    setModelOverride: (m: string, p?: string) => { switched = { m, p }; },
  });
  const res = await handleBuiltinCommand("/model deepseek-chat", ctx);
  expect(res.handled).toBe(true);
  expect(switched.m).toBe("deepseek-chat");
  expect(switched.p).toBe("p1"); // current provider holds the model → preferred

  await handleBuiltinCommand("/model nemo", ctx);
  expect(switched.p).toBe("p2");

  await handleBuiltinCommand("/model deepseek-chat@p2", ctx);
  expect(switched.p).toBe("p2");
});

test("commands: /model <number> picks from list", async () => {
  let switched: { m?: string; p?: string } = {};
  const ctx = makeCtx({
    allModels: () => [
      { model: "a", providers: ["p1"] },
      { model: "b", providers: ["p2"] },
    ],
    setModelOverride: (m: string, p?: string) => { switched = { m, p }; },
  });
  const res = await handleBuiltinCommand("/model 2", ctx);
  expect(res.handled).toBe(true);
  expect(switched.m).toBe("b");
});

test("commands: unknown slash command is handled (never sent to LLM)", async () => {
  const res = await handleBuiltinCommand("/provider", makeCtx());
  expect(res.handled).toBe(true);
});

test("commands: skill slash passthrough returns handled: false", async () => {
  const ctx = makeCtx({ skills: [{ name: "deploy", description: "d", argsSchema: undefined }] });
  const res = await handleBuiltinCommand("/deploy app", ctx);
  expect(res.handled).toBe(false);
});

test("buildModelCatalog: dedupes same model across providers", () => {
  const cat = buildModelCatalog([
    { id: "p1", models: ["m1", "m2"] },
    { id: "p2", models: ["m2", "m3"] },
  ]);
  expect(cat).toEqual([
    { model: "m1", providers: ["p1"] },
    { model: "m2", providers: ["p1", "p2"] },
    { model: "m3", providers: ["p2"] },
  ]);
});
