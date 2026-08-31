// Fake provider OpenAI-compatible di localhost.
//
// Kenapa server sungguhan, bukan stub `globalThis.fetch`: jalur yang diuji
// (`cli/index.ts`, `cli/setup.ts`) hanya bisa dijalankan sebagai PROSES —
// keduanya top-level script dengan `process.exit`. Proses anak punya
// `globalThis` sendiri, jadi stub fetch di test tidak terlihat olehnya. Server
// HTTP nyata adalah satu-satunya seam yang dilewati keduanya.
//
// Dipakai juga oleh test in-process supaya perilaku provider identik di kedua
// jalur (SSE yang sama, urutan event yang sama).

/** Angka token yang dilaporkan provider; menentukan biaya yang dihitung CLI. */
export interface FakeUsage {
  inputTokens?: number
  outputTokens?: number
}

export type FakeReply =
  | { kind: "text"; text: string; usage?: FakeUsage }
  | { kind: "tool"; id?: string; name: string; args: unknown; usage?: FakeUsage }
  /** Balas error HTTP mentah (untuk menguji pemetaan kategori error). */
  | { kind: "status"; status: number; body: string }
  /** Terima request lalu diam — untuk menguji `--timeout`. */
  | { kind: "hang" }

export interface FakeProvider {
  /** Base URL yang dipakai di config provider (sudah termasuk `/v1`). */
  baseUrl: string
  /** Jumlah request /chat/completions yang sudah masuk. */
  requestCount(): number
  /** Body JSON tiap request, untuk memeriksa apa yang benar-benar dikirim. */
  requests(): Record<string, unknown>[]
  close(): void
}

function sse(lines: string[]): Response {
  const body = `${lines.map((l) => `data: ${l}\n\n`).join("")}data: [DONE]\n\n`
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function usageChunk(u?: FakeUsage): string {
  if (!u) return ""
  return JSON.stringify({
    prompt_tokens: u.inputTokens ?? 0,
    completion_tokens: u.outputTokens ?? 0,
    total_tokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
  })
}

function replyToResponse(reply: FakeReply): Response | null {
  if (reply.kind === "status") {
    return new Response(reply.body, { status: reply.status })
  }
  if (reply.kind === "hang") return null
  const chunks: string[] = []
  if (reply.kind === "text") {
    chunks.push(JSON.stringify({ choices: [{ delta: { content: reply.text } }] }))
  } else {
    chunks.push(
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: reply.id ?? "call_1",
                  function: { name: reply.name, arguments: JSON.stringify(reply.args) },
                },
              ],
            },
          },
        ],
      }),
    )
  }
  const finish = reply.kind === "tool" ? "tool_calls" : "stop"
  const usage = usageChunk(reply.usage)
  chunks.push(
    JSON.stringify({
      choices: [{ delta: {}, finish_reason: finish }],
      ...(usage ? { usage: JSON.parse(usage) } : {}),
    }),
  )
  return sse(chunks)
}

/**
 * Jalankan provider tiruan.
 *
 * `script` dikonsumsi berurutan; balasan terakhir diulang untuk request
 * berikutnya. Itu penting untuk loop agent: request 1 minta tool, request 2
 * menutup turn dengan teks.
 */
export function startFakeProvider(script: FakeReply[]): FakeProvider {
  if (script.length === 0) throw new Error("startFakeProvider: script tidak boleh kosong")
  const bodies: Record<string, unknown>[] = []
  let n = 0
  const server = Bun.serve({
    port: 0,
    // Hostname eksplisit: default Bun bisa mengikat ke ::1 saja pada sebagian
    // mesin Windows, dan proses anak menyambung ke 127.0.0.1.
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.endsWith("/models")) {
        return Response.json({ data: [{ id: "gpt-4o-mini" }] })
      }
      if (!url.pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 })
      }
      try {
        bodies.push((await req.json()) as Record<string, unknown>)
      } catch {
        bodies.push({})
      }
      const reply = script[Math.min(n, script.length - 1)]!
      n++
      const res = replyToResponse(reply)
      if (res) return res
      // hang: tahan selamanya. Klien-lah yang harus memutus (timeout).
      await new Promise(() => {})
      return new Response("unreachable")
    },
  })
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requestCount: () => n,
    requests: () => [...bodies],
    close: () => server.stop(true),
  }
}
