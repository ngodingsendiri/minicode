// AUDIT #03 — provider/routing/retry/recovery: buktikan invariant aktual.
// Hermetic: fake in-process + HTTP lokal, tanpa API key.

import { expect, test } from "bun:test"
import { ProviderError } from "#minicore/core/errors.ts"
import { createSession } from "#minicore/core/index.ts"
import type { ModelProvider, ProviderEvent, StreamRequest } from "#minicore/core/provider.ts"
import { allowAll, FakeProvider, finish, text, tool, toolCall } from "#minicore/test/fakes.ts"
import { createRouterProvider } from "../src/providers/router.ts"
import { friendlyError, friendlyFromCategory } from "../src/ui/render/errors.ts"

// Provider scriptable: merekam request, skenario per panggilan.
function scripted(
  id: string,
  models: string[],
  script: ((req: StreamRequest, n: number) => AsyncIterable<ProviderEvent>)[],
  extra?: { kind?: string },
): ModelProvider & { calls: StreamRequest[]; count: number } {
  const calls: StreamRequest[] = []
  let n = 0
  return {
    id,
    models,
    ...(extra?.kind ? { kind: extra.kind } : {}),
    async *stream(req: StreamRequest, _signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const i = n++
      calls.push(req)
      yield* script[Math.min(i, script.length - 1)]!(req, i)
    },
    calls,
    get count() {
      return n
    },
  } as unknown as ModelProvider & { calls: StreamRequest[]; count: number }
}

async function* oneText(t: string): AsyncGenerator<ProviderEvent> {
  yield { type: "text", text: t }
  yield { type: "finish", reason: "stop" }
}

function thrower(e: unknown): (req: StreamRequest, n: number) => AsyncIterable<ProviderEvent> {
  return async function* () {
    yield* []
    throw e
  }
}

async function drain(p: ModelProvider, req: Partial<StreamRequest> = {}): Promise<void> {
  const ac = new AbortController()
  for await (const _ of p.stream(
    { messages: [{ role: "user", content: "hi" }], ...req } as StreamRequest,
    ac.signal,
  )) {
  }
}

// ── 1. Fallback: tiap provider dicoba sekali, lalu menyerah ──

test("audit: fallback server-error mencoba tiap provider tepat sekali", async () => {
  const err = new ProviderError("server", "down")
  const a = scripted("a", ["m"], [thrower(err)])
  const b = scripted("b", ["m"], [thrower(err)])
  const router = createRouterProvider({ providers: [a, b] })
  await expect(drain(router, { model: "m" })).rejects.toThrow("down")
  expect(a.count).toBe(1)
  expect(b.count).toBe(1)
})

test("audit: 429 retry-after: coba-ulang-di-tempat lalu fallback (bounded)", async () => {
  const err429 = new ProviderError("rate_limit", "slow", 1)
  const a = scripted("a", ["m"], [thrower(err429)])
  const b = scripted(
    "b",
    ["m"],
    [
      async function* () {
        yield* oneText("ok-b")
      },
    ],
  )
  const router = createRouterProvider({ providers: [a, b] })
  await drain(router, { model: "m" })
  // a: gagal-429 → tunggu-di-tempat SEKALI (coba-ulang-di-tempat? tidak —
  // ada provider tersisa → fallback ke b). Total: a×1, b×1.
  expect(a.count).toBe(1)
  expect(b.count).toBe(1)
})

// ── 2. Amplification bound per turn ──

test("audit: upper bound attempts per step (1 initial + 3 retry)", async () => {
  const p = new FakeProvider([
    { error: new ProviderError("server", "x") },
    { error: new ProviderError("server", "x") },
    { error: new ProviderError("server", "x") },
    { error: new ProviderError("server", "x") },
  ])
  const s = createSession({ provider: p, permissions: allowAll })
  await expect(s.run("hi")).rejects.toThrow()
  // FakeProvider mencatat tiap stream(): 4 attempts, bukan loop abadi.
  expect(p.requests.length).toBe(4)
}, 30000)

// ── 3. Tool continuity lintas retry/fallback ──

test("audit: sampling retry tak mengeksekusi tool (tool jalan tepat sekali)", async () => {
  let runs = 0
  const t = tool("hitung", async () => {
    runs++
    return "selesai"
  })
  const p = new FakeProvider([
    { error: new ProviderError("network", "putus") },
    { error: new ProviderError("network", "putus") },
    { events: [toolCall("hitung", {}, "c-9"), finish("tool_calls")] },
    { events: [text("beres"), finish("stop")] },
  ])
  const s = createSession({ provider: p, permissions: allowAll, tools: [t] })
  const r = await s.run("go")
  expect(r.finalText).toBe("beres")
  expect(runs).toBe(1)
  // History: SATU assistant+toolCalls, SATU result — tanpa duplikat.
  const assistants = s.state.history.filter((m) => m.role === "assistant")
  expect(assistants).toHaveLength(2)
  expect(s.state.history.filter((m) => m.role === "tool")).toHaveLength(1)
})

test("audit: fallback pasca-tool: tool tetap sekali, jawaban dari B", async () => {
  let runs = 0
  const t = tool("hitung", async () => {
    runs++
    return "selesai"
  })
  // Step 1 (provider A): tool_call → eksekusi. Step 2: A gagal → fallback B.
  const a = scripted(
    "a",
    ["m"],
    [
      async function* () {
        yield { type: "tool_call", id: "c-1", name: "hitung", args: {} }
        yield { type: "finish", reason: "tool_calls" }
      },
      thrower(new ProviderError("server", "A mati saat continuation")),
    ],
  )
  const b = scripted(
    "b",
    ["m"],
    [
      async function* () {
        yield* oneText("jawaban-B")
      },
    ],
  )
  const router = createRouterProvider({ providers: [a, b] })
  const s = createSession({ provider: router, permissions: allowAll, tools: [t] })
  const r = await s.run("go", { model: "m" })
  expect(r.finalText).toBe("jawaban-B")
  expect(runs).toBe(1)
  // Durable: SATU assistant message jawaban (tanpa duplikat A+B).
  const texts = s.state.history.filter((m) => m.role === "assistant")
  expect(texts.map((m) => (m as { content: string }).content)).toEqual(["", "jawaban-B"])
})

test("audit: duplicate call ID dalam satu respons: tiap call dapat hasil", async () => {
  const seen: string[] = []
  // Skema mengizinkan x — kalau tidak, validateArgs menolak SEBELUM eksekusi
  // (temuan sampingan yang benar: invalid args tak pernah dieksekusi).
  const t = tool(
    "echo",
    async ({ x }) => {
      seen.push(String(x))
      return `ok:${String(x)}`
    },
    {
      type: "object",
      properties: { x: { type: "string" } },
      required: ["x"],
      additionalProperties: false,
    },
  )
  const p = new FakeProvider([
    {
      events: [
        toolCall("echo", { x: "1" }, "sama"),
        toolCall("echo", { x: "2" }, "sama"),
        finish("tool_calls"),
      ],
    },
    { events: [text("done"), finish("stop")] },
  ])
  const s = createSession({ provider: p, permissions: allowAll, tools: [t] })
  await s.run("go")
  // Kernel mengeksekusi keduanya (pairing FIFO per id) — didokumentasikan:
  // id duplikat = bug provider, kernel tak crash dan tak menghilangkan hasil.
  const results = s.state.history.filter((m) => m.role === "tool")
  expect(results).toHaveLength(2)
  expect(seen.sort()).toEqual(["1", "2"])
})

// ── 4. Klasifikasi error ──

test("audit: auth gagal seketika tanpa retry", async () => {
  const a = scripted("a", ["m"], [thrower(new ProviderError("auth", "bad key"))])
  const router = createRouterProvider({ providers: [a] })
  const t0 = Date.now()
  await expect(drain(router, { model: "m" })).rejects.toThrow("bad key")
  expect(a.count).toBe(1)
  expect(Date.now() - t0).toBeLessThan(5000)
})

test("audit: unknown error bounded (retry 3x lalu menyerah)", async () => {
  const p = new FakeProvider([
    { error: new ProviderError("unknown", "aneh") },
    { error: new ProviderError("unknown", "aneh") },
    { error: new ProviderError("unknown", "aneh") },
    { error: new ProviderError("unknown", "aneh") },
  ])
  const s = createSession({ provider: p, permissions: allowAll })
  await expect(s.run("hi")).rejects.toThrow()
  expect(p.requests.length).toBe(4)
}, 30000)

test("audit: abort saat backoff retry langsung menolak (tak hang)", async () => {
  const p = new FakeProvider([
    { error: new ProviderError("network", "putus") },
    { events: [text("tak tercapai"), finish("stop")] },
  ])
  const s = createSession({ provider: p, permissions: allowAll })
  const c = new AbortController()
  const run = s.run("hi", { signal: c.signal })
  setTimeout(() => c.abort(), 100)
  const t0 = Date.now()
  await expect(run).rejects.toMatchObject({ kind: "aborted" })
  expect(Date.now() - t0).toBeLessThan(5000)
})

// ── 5. System preservation lintas fallback ──

test("audit: fallback A→B mempertahankan system + history", async () => {
  const bodiesA: unknown[] = []
  const bodiesB: unknown[] = []
  const a = scripted(
    "pa",
    ["m"],
    [
      async function* (req) {
        bodiesA.push(req)
        yield* []
        throw new ProviderError("server", "A down")
      },
    ],
  )
  const b = scripted(
    "pb",
    ["m"],
    [
      async function* (req) {
        bodiesB.push(req)
        yield* oneText("ok")
      },
    ],
  )
  const router = createRouterProvider({ providers: [a, b] })
  const ac = new AbortController()
  for await (const _ of router.stream(
    {
      messages: [{ role: "user", content: "hi" }],
      model: "m",
      system: "SYS",
      tools: [{ name: "t", description: "d", parameters: { type: "object" } }],
    } as never,
    ac.signal,
  )) {
  }
  const rb = bodiesB[0] as { messages: unknown[]; tools: unknown[]; system?: string }
  const ra = bodiesA[0] as { messages: unknown[]; tools: unknown[]; system?: string }
  // Router kind-less → system diselipkan sebagai user pertama di KEDUA attempt.
  for (const r of [ra, rb]) {
    expect((r.messages[0] as { content: string }).content).toBe("SYS")
    expect(r.messages).toHaveLength(2)
    expect(r.tools).toHaveLength(1)
  }
})

// ── 6. Usage responses + redact error ──

test("audit: responses completed usage → event usage", async () => {
  const { createResponsesProvider } = await import("../src/providers/responses.ts")
  const srv = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        'data: {"type":"response.completed","response":{"id":"r1","usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      ),
  })
  try {
    const p = createResponsesProvider({ baseUrl: `http://127.0.0.1:${srv.port}/v1`, models: ["m"] })
    const ac = new AbortController()
    const kinds: unknown[] = []
    for await (const ev of p.stream(
      { messages: [{ role: "user", content: "hi" }], model: "m" },
      ac.signal,
    )) {
      if (ev.type === "extension") kinds.push(ev)
    }
    const u = kinds.find((k) => (k as { kind: string }).kind === "usage") as
      | { data: { inputTokens: number; outputTokens: number; totalTokens: number } }
      | undefined
    expect(u?.data).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  } finally {
    srv.stop(true)
  }
})

test("audit: responses 401 = auth (tanpa retry buta)", async () => {
  const { createResponsesProvider } = await import("../src/providers/responses.ts")
  let n = 0
  const srv = Bun.serve({
    port: 0,
    fetch: () => {
      n++
      return new Response("unauthorized", { status: 401 })
    },
  })
  try {
    const p = createResponsesProvider({ baseUrl: `http://127.0.0.1:${srv.port}/v1`, models: ["m"] })
    const ac = new AbortController()
    let cat = ""
    try {
      for await (const _ of p.stream(
        { messages: [{ role: "user", content: "hi" }], model: "m" },
        ac.signal,
      )) {
      }
    } catch (e) {
      cat = (e as ProviderError).category
    }
    expect(cat).toBe("auth")
    expect(n).toBe(1)
  } finally {
    srv.stop(true)
  }
})

test("audit: pesan error tak membocorkan kredensial", () => {
  const f = friendlyFromCategory("server", '{"error":{"message":"denied for token=SEKRET-1"}}')
  expect(f.message).not.toContain("SEKRET-1")
  expect(f.message).toContain("[redacted]")
  const g = friendlyError("oops token=SEKRET-2 end")
  expect(g.message).not.toContain("SEKRET-2")
})

// ── 7. OAuth refresh dedup ──

test("audit: refresh konkuren satu POST (dedup inflight)", async () => {
  const { getValidAccessToken } = await import("../src/providers/oauth.ts")
  const { saveAuth, removeAuth } = await import("../src/providers/auth-store.ts")
  let posts = 0
  const srv = Bun.serve({
    port: 0,
    fetch: async () => {
      posts++
      await Bun.sleep(150)
      return Response.json({ access_token: "AT-baru", expires_in: 3600 })
    },
  })
  const pid = "test-oauth-dedup-audit03"
  try {
    await saveAuth(pid, {
      type: "oauth",
      refreshToken: "RT",
      tokenUrl: `http://127.0.0.1:${srv.port}/token`,
      clientId: "cid",
      accessToken: "AT-lama",
      expiresAt: Date.now() - 1000,
    })
    const [a, b] = await Promise.all([getValidAccessToken(pid), getValidAccessToken(pid)])
    expect(a).toBe("AT-baru")
    expect(b).toBe("AT-baru")
    expect(posts).toBe(1)
  } finally {
    await removeAuth(pid).catch(() => {})
    srv.stop(true)
  }
})
