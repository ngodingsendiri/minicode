// Fail-soft thinking: param effort yang ditolak (400/500) diulang sekali
// TANPA param, lalu diingat per provider::model selama proses agar turn
// berikutnya langsung tanpa param. Auth/network/rate-limit/budget tak
// tersentuh (bukan penolakan param). Abort selalu diteruskan.
import { expect, test } from "bun:test"
import { AgentError, ProviderError } from "#minicore/core/errors.ts"
import {
  __resetEffortMemoryForTest,
  withEffortFallback,
  withStrippedRetry,
} from "../src/providers/effort.ts"

function fake(id: string, behavior: (calls: number) => AsyncGenerator<unknown>) {
  let calls = 0
  const p: any = {
    id,
    models: ["m"],
    async *stream(_req: unknown, _signal: unknown): AsyncGenerator<unknown> {
      calls++
      yield* behavior(calls)
    },
  }
  return { p, calls: () => calls }
}

async function* textOut(s: string): AsyncGenerator<unknown> {
  yield { type: "text", text: s }
}

async function drain(router: any, model = "p::m"): Promise<string> {
  const out: string[] = []
  for await (const ev of router.stream(
    { messages: [{ role: "user", content: "hi" }], model },
    new AbortController().signal,
  )) {
    if ((ev as any).type === "text") out.push((ev as any).text)
  }
  return out.join("")
}

test("400 param → ulangi tanpa effort + ingat (kedua kali langsung fallback)", async () => {
  __resetEffortMemoryForTest()
  const primary = fake("p", () => {
    throw new ProviderError("invalid_request", "400 unknown param")
  })
  const plain = fake("p", () => textOut("ok"))
  const w = withEffortFallback(primary.p as never, plain.p as never, {
    providerId: "p",
    effort: "medium",
  })
  expect(await drain(w)).toBe("ok")
  expect(primary.calls()).toBe(1)
  expect(plain.calls()).toBe(1)
  // Kedua kali: ingatan → langsung fallback, primary tak disentuh lagi.
  expect(await drain(w)).toBe("ok")
  expect(primary.calls()).toBe(1)
  expect(plain.calls()).toBe(2)
})

test("500 transien → ulangi tanpa effort tapi JANGAN ingat", async () => {
  __resetEffortMemoryForTest()
  let n = 0
  const flaky: any = {
    id: "p",
    models: ["m"],
    async *stream() {
      n++
      if (n === 1) throw new ProviderError("server", "500 boom")
      yield* textOut("recovered-with-effort")
    },
  }
  const plain = fake("p", () => textOut("plain"))
  const w = withEffortFallback(flaky as never, plain.p as never, {
    providerId: "p",
    effort: "high",
  })
  // 500 pertama → fallback polos (sukses) tanpa mengingat.
  expect(await drain(w, "p::m2")).toBe("plain")
  // Berikutnya coba primary lagi (pulih dengan effort).
  expect(await drain(w, "p::m2")).toBe("recovered-with-effort")
})

test("auth/rate_limit/network tak difallback (bukan penolakan param)", async () => {
  __resetEffortMemoryForTest()
  for (const cat of ["auth", "rate_limit", "network"] as const) {
    const primary = fake("p", () => {
      throw new ProviderError(cat, `${cat} err`)
    })
    const plain = fake("p", () => textOut("ok"))
    const w = withEffortFallback(primary.p as never, plain.p as never, {
      providerId: "p",
      effort: "low",
    })
    let err: unknown
    try {
      await drain(w, `p::m-${cat}`)
    } catch (e) {
      err = e
    }
    expect((err as ProviderError).category).toBe(cat)
    expect(plain.calls()).toBe(0)
  }
})

test("abort diteruskan, bukan ditelan fallback", async () => {
  __resetEffortMemoryForTest()
  const ctrl = new AbortController()
  ctrl.abort("stop")
  const primary = fake("p", () => textOut("x"))
  const plain = fake("p", () => textOut("y"))
  const w = withEffortFallback(primary.p as never, plain.p as never, {
    providerId: "p",
    effort: "low",
  })
  let err: unknown
  try {
    for await (const _ of (w as any).stream(
      { messages: [{ role: "user", content: "hi" }], model: "p::m" },
      ctrl.signal,
    )) {
    }
    expect(false).toBe(true)
  } catch (e) {
    err = e
  }
  expect(err).toBeInstanceOf(AgentError)
  expect((err as AgentError).kind).toBe("aborted")
})

test("inti generik: trigger kustom + skipPrimary + onStrip callback", async () => {
  __resetEffortMemoryForTest()
  const notes: { model: string; category: string }[] = []
  const primary = fake("p", () => {
    throw new ProviderError("server", "500 x")
  })
  const plain = fake("p", () => textOut("ok"))
  const w = withStrippedRetry(primary.p as never, plain.p as never, {
    providerId: "p",
    triggerCategories: new Set(["server"]),
    onStrip: (info) => notes.push(info),
  })
  expect(await drain(w, "m")).toBe("ok")
  expect(notes).toEqual([{ model: "p::m", category: "server" }])
  // skipPrimary: model terdaftar langsung fallback tanpa menyentuh primary.
  const w2 = withStrippedRetry(primary.p as never, plain.p as never, {
    providerId: "p",
    skipPrimary: (m) => m === "skip-me",
  })
  const before = primary.calls()
  for await (const _ of (w2 as any).stream(
    { messages: [{ role: "user", content: "hi" }], model: "skip-me" },
    new AbortController().signal,
  )) {
  }
  expect(primary.calls()).toBe(before)
})
