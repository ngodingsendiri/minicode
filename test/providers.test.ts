import { expect, test } from "bun:test";
import { createAnthropicProvider } from "../src/providers/anthropic.ts";
import { createRouterProvider } from "../src/providers/router.ts";
import { ProviderError } from "../../minicore/src/core/errors.ts";

test("anthropic maps 429 retryAfter capped 30s", async () => {
  const origFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response("rate limit", { status: 429, headers: { "retry-after": "3600" } }) as unknown as Response;
  const p = createAnthropicProvider({ apiKey: "k", models: ["claude-sonnet-4"] });
  try {
    for await (const _ of p.stream({ messages: [{ role: "user", content: "hi" }] }, new AbortController().signal)) {}
    expect(false).toBe(true);
  } catch (e) {
    expect((e as ProviderError).category).toBe("rate_limit");
    expect((e as ProviderError).retryAfterMs).toBe(30_000);
  }
  globalThis.fetch = origFetch;
});

test("anthropic maps context_length", async () => {
  const origFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => new Response("prompt is too long", { status: 400, headers: {} }) as unknown as Response;
  const p = createAnthropicProvider({ apiKey: "k", models: ["claude-sonnet-4"] });
  try {
    for await (const _ of p.stream({ messages: [{ role: "user", content: "hi" }] }, new AbortController().signal)) {}
    expect(false).toBe(true);
  } catch (e) {
    expect((e as ProviderError).category).toBe("context_length_exceeded");
  }
  globalThis.fetch = origFetch;
});

test("router fallback on rate_limit", async () => {
  const bad: any = {
    id: "bad",
    models: ["m1"],
    async *stream() {
      throw new ProviderError("rate_limit", "rl", 100);
    },
  };
  const good: any = {
    id: "good",
    models: ["m2"],
    async *stream() {
      yield { type: "text", text: "ok" };
      yield { type: "finish", reason: "stop" };
    },
  };
  const router = createRouterProvider({ providers: [bad, good] });
  const out: string[] = [];
  for await (const ev of router.stream({ messages: [{ role: "user", content: "hi" }], model: "m1" }, new AbortController().signal)) {
    if (ev.type === "text") out.push(ev.text);
  }
  expect(out.join("")).toBe("ok");
});

test("router C4 fix Uint8Array -> base64", async () => {
  let captured: any = null;
  const inner: any = {
    id: "inner",
    models: ["m"],
    async *stream(req: any) {
      captured = req;
      yield { type: "text", text: "hi" };
      yield { type: "finish", reason: "stop" };
    },
  };
  const router = createRouterProvider({ providers: [inner] });
  const bytes = new Uint8Array([1, 2, 3]);
  for await (const _ of router.stream(
    { messages: [{ role: "tool", toolCallId: "c1", name: "t", content: bytes } as any] },
    new AbortController().signal,
  )) {}
  expect(typeof captured.messages[0].content).toBe("string");
  expect(captured.messages[0].content).toBe(Buffer.from(bytes).toString("base64"));
});

test("router caps retryAfter 3600 -> 30s", async () => {
  const bad: any = {
    id: "bad",
    models: ["m"],
    async *stream() {
      throw new ProviderError("rate_limit", "rl", 3600_000);
    },
  };
  const router = createRouterProvider({ providers: [bad], maxRetryAfterMs: 30_000 });
  try {
    for await (const _ of router.stream({ messages: [{ role: "user", content: "hi" }] }, new AbortController().signal)) {}
    expect(false).toBe(true);
  } catch (e) {
    expect((e as ProviderError).retryAfterMs).toBe(30_000);
  }
});
