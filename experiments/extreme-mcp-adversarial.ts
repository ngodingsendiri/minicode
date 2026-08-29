#!/usr/bin/env bun
// EKSPERIMEN EKSTREM 3 — server MCP & provider yang bermusuhan.
//
// Test unit mcp-http menguji server yang berperilaku baik (atau gagal dengan
// cara yang wajar). Harness ini menjalankan server yang SENGAJA jahat: mencoba
// membuat klien hang, kehabisan memori, mengikuti redirect ke metadata endpoint,
// membocorkan Authorization, atau membanjiri dengan event yang tak pernah
// menjadi balasan.
//
// Yang diperiksa bukan "apakah request sukses" tapi "apakah klien tetap
// terkendali": ada batas waktu, ada batas ukuran, tidak ada penulisan ke tempat
// yang tak diminta, dan pesan errornya berguna.
//
// Usage: bun experiments/extreme-mcp-adversarial.ts

import { McpHttpTransport } from "../src/mcp/http-transport.ts"
import { isPrivateHost, isPrivateHostWithDns } from "../src/tools/web_fetch.ts"

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++
    console.log(`  ok    ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

type Handler = (req: Request) => Response | Promise<Response>
let server: ReturnType<typeof Bun.serve> | null = null

function serve(handler: Handler): string {
  server?.stop(true)
  server = Bun.serve({ port: 0, fetch: handler })
  return `http://127.0.0.1:${server.port}/mcp`
}
function stop(): void {
  server?.stop(true)
  server = null
}

// localhost butuh opt-in — itu sendiri bagian dari kontrak yang diuji.
const mk = (url: string, headers?: Record<string, string>) =>
  new McpHttpTransport({ url, headers, allowPrivateHost: true })

const jsonRpc = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result })

/** Jalankan fn dengan batas waktu; melempar bila melewatinya. */
async function within<T>(ms: number, label: string, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label}: melewati ${ms}ms — kemungkinan hang`)), ms)
  })
  try {
    return await Promise.race([fn(), guard])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  console.log("\n=== EXTREME MCP ADVERSARIAL ===\n")

  // ── 1. server yang tidak pernah membalas ──
  console.log("[1] server membisu")
  {
    const url = serve(() => new Promise<Response>(() => {}))
    const t = mk(url)
    await t.connect()
    let msg = ""
    const t0 = Date.now()
    try {
      await within(4000, "request", () => t.request("ping", {}, 400))
    } catch (e) {
      msg = (e as Error).message
    }
    const el = Date.now() - t0
    check("timeout dihormati, tidak hang", /timeout 400ms/.test(msg), msg)
    check("berhenti mendekati batas, bukan menunggu lama", el < 3000, `${el}ms`)
    stop()
  }

  // ── 2. aliran SSE tanpa akhir yang tak pernah memuat balasan ──
  // Server mengirim notifikasi terus. Klien harus dibatasi oleh cap ukuran atau
  // timeout — tidak boleh membaca selamanya.
  console.log("\n[2] SSE tak berujung (hanya notifikasi)")
  {
    const url = serve(
      () =>
        new Response(
          new ReadableStream({
            async start(c) {
              const enc = new TextEncoder()
              const notif = `data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\n`
              for (let i = 0; i < 200_000; i++) {
                c.enqueue(enc.encode(notif))
                if (i % 500 === 0) await Bun.sleep(0)
              }
              c.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )
    const t = mk(url)
    await t.connect()
    let msg = ""
    try {
      await within(20_000, "sse-flood", () => t.request("ping", {}, 8000))
    } catch (e) {
      msg = (e as Error).message
    }
    // Guard `within` melempar "melewati Nms" HANYA bila klien benar-benar hang;
    // pesan "batas ukuran"/"timeout" berarti klien menghentikan dirinya sendiri
    // — itu justru hasil yang diinginkan.
    check(
      "banjir notifikasi dihentikan (cap ukuran atau timeout)",
      /batas ukuran|timeout|tidak mengembalikan balasan/.test(msg),
      msg.slice(0, 120),
    )
    check("dihentikan oleh guard sendiri, bukan oleh watchdog", !/melewati \d+ms/.test(msg), msg.slice(0, 120))
    stop()
  }

  // ── 3. body JSON raksasa ──
  console.log("\n[3] body JSON raksasa")
  {
    const url = serve(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder()
              const chunk = enc.encode("x".repeat(256 * 1024))
              for (let i = 0; i < 2000; i++) c.enqueue(chunk) // ~512 MB
              c.close()
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    )
    const t = mk(url)
    await t.connect()
    const memBefore = process.memoryUsage().heapUsed
    let msg = ""
    try {
      await within(30_000, "flood", () => t.request("flood", {}, 20_000))
    } catch (e) {
      msg = (e as Error).message
    }
    const growthMb = Math.round((process.memoryUsage().heapUsed - memBefore) / 1024 / 1024)
    check("balasan raksasa ditolak oleh cap", /batas ukuran/.test(msg), msg.slice(0, 100))
    check(`heap tidak meledak (+${growthMb} MB)`, growthMb < 200, `${growthMb} MB`)
    stop()
  }

  // ── 4. redirect ke metadata endpoint cloud ──
  console.log("\n[4] redirect ke metadata endpoint")
  {
    const targets = [
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://127.0.0.1:22/",
      "http://[::1]:8080/",
    ]
    for (const target of targets) {
      const url = serve(() => new Response("", { status: 302, headers: { location: target } }))
      const t = mk(url)
      await t.connect()
      let msg = ""
      try {
        await t.request("ping", {}, 3000)
      } catch (e) {
        msg = (e as Error).message
      }
      check(`redirect ke ${target.slice(0, 42)} ditolak`, /redirect tidak diikuti/.test(msg), msg.slice(0, 80))
      stop()
    }
  }

  // ── 5. host privat tanpa opt-in ──
  console.log("\n[5] host privat tanpa opt-in")
  {
    const hosts = [
      "http://127.0.0.1:9/mcp",
      "http://localhost:9/mcp",
      "http://169.254.169.254/mcp",
      "http://10.0.0.1/mcp",
      "http://192.168.1.1/mcp",
      "http://172.16.0.1/mcp",
      "http://100.64.0.1/mcp",
      "http://[::1]/mcp",
      "http://[fd00::1]/mcp",
      "http://metadata.google.internal/mcp",
      "http://foo.internal/mcp",
      "http://bar.local/mcp",
    ]
    for (const h of hosts) {
      const t = new McpHttpTransport({ url: h })
      let msg = ""
      try {
        await t.connect()
      } catch (e) {
        msg = (e as Error).message
      }
      check(`${h.slice(0, 40)} ditolak`, /host privat ditolak/.test(msg), msg.slice(0, 70))
    }
  }

  // ── 6. protokol non-HTTP ──
  console.log("\n[6] protokol non-HTTP")
  for (const u of ["file:///etc/passwd", "ftp://x/y", "gopher://x", "data:text/plain,x", "ws://x/y"]) {
    let threw = false
    try {
      new McpHttpTransport({ url: u })
    } catch {
      threw = true
    }
    check(`${u.slice(0, 30)} ditolak saat konstruksi`, threw)
  }

  // ── 7. Authorization tidak bocor ke stderr/stdout ──
  // Server membalas error; pesan error yang kita lempar tak boleh memuat token.
  console.log("\n[7] kerahasiaan Authorization")
  {
    const SECRET = "Bearer sk-rahasia-jangan-bocor-1234567890"
    const url = serve(() => new Response("gagal karena alasan tertentu", { status: 500 }))
    const t = mk(url, { authorization: SECRET })
    await t.connect()
    let msg = ""
    try {
      await t.request("ping", {}, 3000)
    } catch (e) {
      msg = (e as Error).message
    }
    check("pesan error tidak memuat token", !msg.includes("sk-rahasia"), msg.slice(0, 100))
    check("pesan error tetap informatif", /500/.test(msg), msg.slice(0, 100))
    stop()
  }

  // ── 8. balasan JSON-RPC yang cacat ──
  console.log("\n[8] balasan cacat")
  {
    const bad: [string, string, string][] = [
      ["HTML", "<html>proxy</html>", "bukan JSON valid"],
      ["JSON tak lengkap", '{"jsonrpc":"2.0","id":1,"resu', "bukan JSON valid"],
      ["array kosong", "[]", "tidak mengembalikan balasan"],
      ["null", "null", "tidak mengembalikan balasan"],
      ["id salah", '{"jsonrpc":"2.0","id":999,"result":{}}', "tidak mengembalikan balasan"],
      ["hanya method", '{"jsonrpc":"2.0","method":"notif"}', "tidak mengembalikan balasan"],
    ]
    for (const [label, body, expect] of bad) {
      const url = serve(
        () => new Response(body, { headers: { "content-type": "application/json" } }),
      )
      const t = mk(url)
      await t.connect()
      let msg = ""
      try {
        await within(5000, label, () => t.request("ping", {}, 2000))
      } catch (e) {
        msg = (e as Error).message
      }
      check(`${label}: pesan jelas`, msg.includes(expect), msg.slice(0, 90))
      stop()
    }
  }

  // ── 9. session id jahat ──
  // Server mengirim Mcp-Session-Id berisi karakter kontrol / sangat panjang.
  // Klien meneruskannya sebagai header; yang penting tidak crash.
  console.log("\n[9] session id jahat")
  {
    for (const sid of ["a".repeat(5000), "with space", "tab\tinside"]) {
      const url = serve(async (req) => {
        const body = (await req.json()) as { id: number; method: string }
        const h: Record<string, string> = { "content-type": "application/json" }
        if (body.method === "initialize") {
          // Header dengan karakter ilegal akan ditolak Bun; bungkus agar server
          // tak crash dan skenario tetap terkirim.
          try {
            h["mcp-session-id"] = sid
          } catch {}
        }
        return new Response(jsonRpc(body.id, {}), { headers: h })
      })
      const t = mk(url)
      await t.connect()
      let ok = true
      try {
        await within(6000, "sid", async () => {
          await t.request("initialize", {}, 2500)
          await t.request("tools/list", {}, 2500)
        })
      } catch (e) {
        ok = false
        check(`session id ${JSON.stringify(sid.slice(0, 14))} tidak membuat crash`, false, (e as Error).message.slice(0, 90))
      }
      if (ok) check(`session id ${JSON.stringify(sid.slice(0, 14))} ditangani`, true)
      stop()
    }
  }

  // ── 10. status HTTP tak lazim ──
  console.log("\n[10] status HTTP tak lazim")
  {
    for (const status of [204, 401, 403, 418, 429, 500, 502, 503]) {
      const url = serve(() => new Response("detail", { status }))
      const t = mk(url)
      await t.connect()
      let msg = ""
      try {
        await within(5000, `status-${status}`, () => t.request("ping", {}, 2000))
      } catch (e) {
        msg = (e as Error).message
      }
      const ok = status === 204 ? msg.length > 0 : msg.includes(String(status))
      check(`HTTP ${status} dilaporkan`, ok, msg.slice(0, 80))
      stop()
    }
  }

  // ── 11. konsistensi penjaga host dengan web_fetch ──
  // MCP HTTP dan web_fetch harus memakai definisi "privat" yang sama; kalau
  // berbeda, salah satunya jadi celah.
  console.log("\n[11] konsistensi penjaga host")
  {
    const privateHosts = [
      "127.0.0.1",
      "localhost",
      "169.254.169.254",
      "10.1.2.3",
      "192.168.0.5",
      "172.20.0.1",
      "100.100.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "svc.internal",
      "box.local",
      "app.localhost",
    ]
    for (const h of privateHosts) {
      check(`isPrivateHost(${h})`, isPrivateHost(h))
    }
    const publicHosts = ["example.com", "1.1.1.1", "8.8.8.8", "93.184.216.34"]
    for (const h of publicHosts) {
      check(`isPrivateHost(${h}) = false`, !isPrivateHost(h))
      check(`isPrivateHostWithDns(${h}) = false`, !(await isPrivateHostWithDns(h)))
    }
  }

  console.log(`\n=== HASIL ===\npass ${pass} · fail ${fail}`)
  if (failures.length) {
    console.log("\nkegagalan:")
    for (const f of failures) console.log(`  - ${f}`)
  }
  stop()
  process.exit(fail === 0 ? 0 : 1)
}

try {
  await main()
} catch (e) {
  console.error(`\nFATAL: ${(e as Error).message}`)
  stop()
  process.exit(1)
}
