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

test("anthropic groups consecutive tool results into one user message", async () => {
  let body: any = null;
  const origFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (_url: unknown, init: any) => {
    body = JSON.parse(init.body);
    const sse = 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n';
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }) as unknown as Response;
  };
  const p = createAnthropicProvider({ apiKey: "k", models: ["claude-sonnet-4"] });
  const messages = [
    { role: "user", content: "go" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_file", args: { path: "a" } }, { id: "c2", name: "git_status", args: {} }] },
    { role: "tool", toolCallId: "c1", name: "read_file", content: "a-content" },
    { role: "tool", toolCallId: "c2", name: "git_status", content: "clean" },
    { role: "assistant", content: "here is the result" },
    { role: "user", content: "next" },
  ] as any;
  try {
    for await (const _ of p.stream({ messages }, new AbortController().signal)) {}
  } catch {}
  globalThis.fetch = origFetch;
  expect(body).not.toBeNull();
  // cari assistant yang memuat tool_use; pesan berikutnya harus user tunggal berisi 2 tool_result
  const idx = body.messages.findIndex((m: any) => m.role === "assistant" && m.content?.some((c: any) => c.type === "tool_use"));
  const next = body.messages[idx + 1];
  expect(next.role).toBe("user");
  expect(next.content).toHaveLength(2);
  expect(next.content[0].type).toBe("tool_result");
  expect(next.content[1].type).toBe("tool_result");
  expect(next.content[0].tool_use_id).toBe("c1");
  expect(next.content[1].tool_use_id).toBe("c2");
  // role harus bergantian — tidak boleh ada dua "user" berturut-turut dari tool results
  for (let i = 1; i < body.messages.length; i++) {
    if (body.messages[i].role === "user" && body.messages[i - 1].role === "user") {
      expect(true).toBe(false); // jangan sampai ada user berurutan
    }
  }
});

test("router fallback substitutes model not supported by target provider", async () => {
  const received: any[] = [];
  const bad: any = {
    id: "bad",
    models: ["gpt-4o"],
    async *stream() {
      throw new ProviderError("rate_limit", "rl", 100);
    },
  };
  const good: any = {
    id: "good",
    models: ["claude-sonnet-4"],
    async *stream(req: any) {
      received.push(req);
      yield { type: "text", text: "ok" };
      yield { type: "finish", reason: "stop" };
    },
  };
  const router = createRouterProvider({ providers: [bad, good] });
  const out: string[] = [];
  for await (const ev of router.stream({ messages: [{ role: "user", content: "hi" }], model: "gpt-4o" }, new AbortController().signal)) {
    if (ev.type === "text") out.push(ev.text);
  }
  expect(out.join("")).toBe("ok");
  // request ke provider kedua harus memakai model miliknya, bukan gpt-4o
  expect(received[0]!.model).toBe("claude-sonnet-4");
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
