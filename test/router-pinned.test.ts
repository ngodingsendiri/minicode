// Pin eksplisit `provider::model` = kontrak: tanpa fallback lintas provider,
// tanpa substitusi diam-diam. Gagal = error jujur dari provider yang dipilih
// agar user memilih model lanjutannya sendiri (keputusan: no-auto-switch,
// terutama ke model berbayar). Model bare (tanpa `::`) tetap perilaku lama.
import { expect, test } from "bun:test"
import { ProviderError } from "#minicore/core/errors.ts"
import { createRouterProvider } from "../src/providers/router.ts"

function fake(id: string, models: string[], behavior: (calls: number) => AsyncGenerator<unknown>) {
  let calls = 0
  const p: any = {
    id,
    models,
    async *stream(_req: unknown, _signal: unknown): AsyncGenerator<unknown> {
      calls++
      yield* behavior(calls)
    },
  }
  return { p, calls: () => calls }
}

async function* textOut(s: string): AsyncGenerator<unknown> {
  yield { type: "text", text: s }
  yield { type: "finish", reason: "stop" }
}

// biome-ignore lint/correctness/useYield: fake gagal sebelum yield pertama
async function* alwaysThrow(err: unknown): AsyncGenerator<unknown> {
  throw err
}

async function collect(router: any, model: string): Promise<{ text: string; ext: unknown[] }> {
  const out: string[] = []
  const ext: unknown[] = []
  for await (const ev of router.stream(
    { messages: [{ role: "user", content: "hi" }], model },
    new AbortController().signal,
  )) {
    if ((ev as any).type === "text") out.push((ev as any).text)
    if ((ev as any).type === "extension") ext.push(ev)
  }
  return { text: out.join(""), ext }
}

test("pinned: model tak dikenal di provider itu → throw, provider lain tak tersentuh", async () => {
  const a = fake("zen", ["m1"], () => textOut("x"))
  const b = fake("openrouter", ["m2"], () => textOut("y"))
  const router = createRouterProvider({ providers: [a.p, b.p] })
  let err: unknown
  try {
    await collect(router, "zen::nope")
  } catch (e) {
    err = e
  }
  expect(err).toBeInstanceOf(ProviderError)
  expect((err as ProviderError).category).toBe("invalid_request")
  expect((err as Error).message).toContain("zen")
  expect((err as Error).message).toContain("nope")
  expect(a.calls()).toBe(0)
  expect(b.calls()).toBe(0)
})

test("pinned: server error provider itu tampil apa adanya, tanpa fallback", async () => {
  const a = fake("zen", ["m1"], () =>
    alwaysThrow(new ProviderError("server", "server error (500): zen down")),
  )
  const b = fake("openrouter", ["m2"], () => textOut("y"))
  const router = createRouterProvider({ providers: [a.p, b.p] })
  let err: unknown
  try {
    await collect(router, "zen::m1")
  } catch (e) {
    err = e
  }
  expect((err as Error).message).toContain("zen down")
  expect(a.calls()).toBe(1)
  expect(b.calls()).toBe(0)
})

test("pinned: 429 retryAfter = tunggu lalu ULANGI provider sama, bukan pindah", async () => {
  const a = fake("zen", ["m1"], async function* (calls: number) {
    if (calls === 1) throw new ProviderError("rate_limit", "rl", 20)
    yield* textOut("zen-ok")
  })
  const b = fake("openrouter", ["m2"], () => textOut("y"))
  const router = createRouterProvider({ providers: [a.p, b.p] })
  const r = await collect(router, "zen::m1")
  expect(r.text).toBe("zen-ok")
  expect(a.calls()).toBe(2)
  expect(b.calls()).toBe(0)
})

test("pinned: provider id tak dikenal → throw, tak ada provider dipanggil", async () => {
  const a = fake("zen", ["m1"], () => textOut("x"))
  const router = createRouterProvider({ providers: [a.p] })
  let err: unknown
  try {
    await collect(router, "void::m1")
  } catch (e) {
    err = e
  }
  expect((err as ProviderError).category).toBe("invalid_request")
  expect((err as Error).message).toContain("void")
  expect(a.calls()).toBe(0)
})

test("bare model: fallback + substitusi lama tetap jalan", async () => {
  const bad: any = {
    id: "bad",
    models: ["m1"],
    // biome-ignore lint/correctness/useYield: fake gagal sebelum yield pertama
    async *stream() {
      throw new ProviderError("rate_limit", "rl")
    },
  }
  const good = fake("good", ["m2"], () => textOut("ok"))
  const router = createRouterProvider({ providers: [bad, good.p] })
  const r = await collect(router, "m1")
  expect(r.text).toBe("ok")
  expect(r.ext.some((e: any) => e.kind === "effective-model")).toBe(true)
})
