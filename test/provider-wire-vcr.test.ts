// VCR wire-contract: rekaman respons provider ASLI (bukan karangan) yang
// di-replay lewat adapter sungguhan. Tiap fixture mendokumentasikan
// provenance-nya di bawah. Tanpa jaringan, deterministik, hermetic.
// Cara tambah tangkapan baru: simpan `{status, headers, body}` verbatim ke
// test/vcr/<nama>.json + satu test di sini. Jangan edit body agar tetap
// jadi saksi bentuk wire yang sebenarnya.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ProviderError } from "#minicore/core/errors.ts"
import { createOpenAICompatProvider } from "#minicore/providers/openai-compat.ts"
import { friendlyFromCategory } from "../src/ui/render/errors.ts"

const testDir = import.meta.dir

interface Capture {
  status: number
  headers: Record<string, string>
  body: unknown
}

function loadCapture(name: string): Capture {
  return JSON.parse(readFileSync(join(testDir, "vcr", name), "utf8")) as Capture
}

async function runCapture(name: string): Promise<{ err: ProviderError | null; body: string }> {
  const cap = loadCapture(name)
  const origFetch = globalThis.fetch
  ;(globalThis as unknown as { fetch: unknown }).fetch = (async () =>
    new Response(JSON.stringify(cap.body), {
      status: cap.status,
      headers: cap.headers,
    }) as unknown as Response) as unknown as typeof fetch
  const p = createOpenAICompatProvider({
    apiKey: "k",
    baseUrl: "https://gateway.test/v1",
    models: ["m"],
  })
  let err: ProviderError | null = null
  try {
    for await (const _ of p.stream(
      { messages: [{ role: "user", content: "hi" }], model: "m" },
      new AbortController().signal,
    )) {
    }
  } catch (e) {
    err = e as ProviderError
  } finally {
    globalThis.fetch = origFetch
  }
  return { err, body: JSON.stringify(cap.body) }
}

describe("vcr: rekaman live zen free 429 (2026-09-12, probe langsung)", () => {
  test("kategori rate_limit + pesan ramah, bukan dump", async () => {
    const { err, body } = await runCapture("zen-free-429.json")
    expect(err).toBeInstanceOf(ProviderError)
    expect(err?.category).toBe("rate_limit")
    const f = friendlyFromCategory(err!.category, `${err!.message} ${body}`.slice(0, 500))
    expect(f.message).toContain("rate-limiting")
    expect(f.fix ?? "").toContain("--ratelimit")
  })
})

describe("vcr: openrouter 402 observed (output live sesi user, bukan harness)", () => {
  test("kategori unknown + pesan saldo yang actionable", async () => {
    const { err } = await runCapture("openrouter-402-credits.json")
    expect(err).toBeInstanceOf(ProviderError)
    expect(err?.category).toBe("unknown")
    const f = friendlyFromCategory(err!.category, err!.message)
    expect(f.message).toContain("balance or quota")
    expect(f.fix ?? "").toContain("/model")
  })
})
