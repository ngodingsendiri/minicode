// Transport MCP: Streamable HTTP (spec 2025-03-26) + SSE legacy fallback.
//
// Sebelum ini client hanya mendukung stdio, jadi seluruh ekosistem MCP remote
// tak terjangkau — padahal sisi *server* minicode sudah menyajikan
// tools/resources/prompts. Asimetri itu yang ditutup di sini.
//
// Streamable HTTP singkatnya:
//   - Request  : POST <endpoint> dengan body JSON-RPC.
//   - Response : `application/json` (satu balasan) ATAU `text/event-stream`
//                (server boleh mengirim notifikasi lalu balasan).
//   - Sesi     : server boleh memberi `Mcp-Session-Id` di respons initialize;
//                header itu harus disertakan di request berikutnya.
//
// Keamanan yang diberlakukan di sini (bukan bawaan spec):
//   - Hanya http/https, dan host privat DITOLAK kecuali di-opt-in eksplisit.
//     Server MCP remote yang menunjuk ke 169.254.169.254 atau localhost adalah
//     jalur SSRF klasik; jail-nya memakai penjaga yang sama dengan `web_fetch`.
//   - Header Authorization tidak pernah di-log.
//   - Body respons dibatasi agar server nakal tak bisa membuat OOM.

import { LIMITS } from "../constants.ts"
import { isPrivateHostWithDns } from "../tools/web_fetch.ts"

/**
 * Kemampuan transport yang dipakai `McpConnection` setelah koneksi terbuka.
 * `connect()` sengaja TIDAK di sini karena bentuknya berbeda antar transport
 * (stdio butuh command/args, HTTP tidak) — pemilihannya ditangani connection.
 */
export interface McpTransportLike {
  request(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
  notify(method: string, params?: Record<string, unknown>): void
  close(): Promise<void>
}

export interface HttpTransportOptions {
  url: string
  headers?: Record<string, string>
  /** Izinkan host privat (localhost/LAN) — untuk server MCP yang dijalankan sendiri. */
  allowPrivateHost?: boolean
}

interface JsonRpcResponse {
  jsonrpc?: string
  id?: string | number | null
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export class McpHttpTransport implements McpTransportLike {
  private seq = 0
  private sessionId: string | null = null
  private closed = false
  private readonly url: URL
  private readonly extraHeaders: Record<string, string>
  private readonly allowPrivate: boolean
  /** Protokol yang dinegosiasikan; dikirim ulang di request berikutnya. */
  private protocolVersion: string | null = null

  constructor(opts: HttpTransportOptions) {
    let parsed: URL
    try {
      parsed = new URL(opts.url)
    } catch {
      throw new Error(`MCP http: URL tidak valid: ${opts.url}`)
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`MCP http: protokol tidak didukung: ${parsed.protocol}`)
    }
    this.url = parsed
    this.extraHeaders = opts.headers ?? {}
    this.allowPrivate = opts.allowPrivateHost === true
  }

  async connect(): Promise<void> {
    // Validasi host sebelum request PERTAMA, bukan setelahnya.
    if (!this.allowPrivate && (await isPrivateHostWithDns(this.url.hostname))) {
      throw new Error(
        `MCP http: host privat ditolak: ${this.url.hostname} (set allowPrivateHost untuk server lokal)`,
      )
    }
  }

  /** Header dasar; Authorization dari config diteruskan tapi tak pernah di-log. */
  private headers(accept: string): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept,
      ...this.extraHeaders,
    }
    if (this.sessionId) h["mcp-session-id"] = this.sessionId
    if (this.protocolVersion) h["mcp-protocol-version"] = this.protocolVersion
    return h
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = LIMITS.MCP_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed) throw new Error("MCP http: transport sudah ditutup")
    const id = ++this.seq
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs)
    let res: Response
    try {
      res = await fetch(this.url.toString(), {
        method: "POST",
        headers: this.headers("application/json, text/event-stream"),
        body,
        signal: controller.signal,
        redirect: "manual", // redirect ke host lain = permukaan SSRF
      })
    } catch (e) {
      clearTimeout(timer)
      const msg = (e as Error).message
      throw new Error(
        `MCP http: ${method} gagal: ${msg === "timeout" ? `timeout ${timeoutMs}ms` : msg}`,
      )
    }

    try {
      // Sesi dari server: simpan untuk request berikutnya (spec 2025-03-26).
      const sid = res.headers.get("mcp-session-id")
      if (sid) this.sessionId = sid

      if (res.status >= 300 && res.status < 400) {
        throw new Error(`MCP http: redirect tidak diikuti (${res.status}) — periksa URL server`)
      }
      if (!res.ok) {
        const snippet = (await res.text().catch(() => "")).slice(0, 400)
        throw new Error(`MCP http: ${method} → HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`)
      }

      const ctype = (res.headers.get("content-type") ?? "").toLowerCase()
      const payload = ctype.includes("text/event-stream")
        ? await readSseResponse(res, id)
        : await readJsonResponse(res)

      if (!payload) throw new Error(`MCP http: ${method} tidak mengembalikan balasan`)
      if (payload.error) {
        throw new Error(
          `MCP http: ${method} → ${payload.error.message ?? JSON.stringify(payload.error)}`,
        )
      }
      // Simpan protokol hasil negosiasi initialize.
      if (method === "initialize") {
        const pv = (payload.result as { protocolVersion?: string } | undefined)?.protocolVersion
        if (typeof pv === "string") this.protocolVersion = pv
      }
      return payload.result
    } finally {
      clearTimeout(timer)
    }
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    if (this.closed) return
    // Notifikasi tak punya id dan tak menunggu balasan; kegagalan tidak fatal.
    void fetch(this.url.toString(), {
      method: "POST",
      headers: this.headers("application/json, text/event-stream"),
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      redirect: "manual",
      signal: AbortSignal.timeout(LIMITS.MCP_HANDSHAKE_TIMEOUT_MS),
    }).catch(() => {})
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    // Spec: DELETE mengakhiri sesi. Server yang tak mendukung akan menolak —
    // itu bukan kegagalan bagi kita.
    if (this.sessionId) {
      await fetch(this.url.toString(), {
        method: "DELETE",
        headers: this.headers("application/json"),
        signal: AbortSignal.timeout(LIMITS.MCP_HANDSHAKE_TIMEOUT_MS),
      }).catch(() => {})
    }
  }
}

/** Baca body JSON dengan cap ukuran. Diekspor untuk test. */
export async function readJsonResponse(res: Response): Promise<JsonRpcResponse | null> {
  const text = await readCapped(res)
  if (!text.trim()) return null
  try {
    const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[]
    // Batch: ambil elemen pertama yang punya result/error.
    if (Array.isArray(parsed)) return parsed.find((p) => p.result !== undefined || p.error) ?? null
    return parsed
  } catch {
    throw new Error(`MCP http: balasan bukan JSON valid: ${text.slice(0, 200)}`)
  }
}

/**
 * Baca aliran SSE sampai menemukan balasan untuk `id`.
 *
 * Server boleh mengirim notifikasi/progress sebelum balasan; itu dilewati.
 * Diekspor untuk test.
 */
export async function readSseResponse(
  res: Response,
  id: string | number,
): Promise<JsonRpcResponse | null> {
  if (!res.body) return null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > LIMITS.MCP_OUTPUT_MAX_CHARS) {
        throw new Error("MCP http: aliran SSE melewati batas ukuran")
      }
      buffer += decoder.decode(value, { stream: true })

      // Event SSE dipisah baris kosong; tiap event bisa punya beberapa `data:`.
      let sep = findEventBoundary(buffer)
      while (sep !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep).replace(/^(?:\r?\n){1,2}/, "")
        const data = rawEvent
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("")
        if (data) {
          let msg: JsonRpcResponse | JsonRpcResponse[]
          try {
            msg = JSON.parse(data)
          } catch {
            sep = findEventBoundary(buffer)
            continue // event bukan JSON → lewati, jangan gagalkan seluruh request
          }
          const found = matchResponse(msg, id)
          if (found) return found
        }
        sep = findEventBoundary(buffer)
      }
    }
    // Aliran berakhir: coba sisa buffer.
    const tail = buffer
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("")
    if (tail) {
      try {
        return matchResponse(JSON.parse(tail), id)
      } catch {
        return null
      }
    }
    return null
  } finally {
    reader.releaseLock()
  }
}

function findEventBoundary(buf: string): number {
  const lf = buf.indexOf("\n\n")
  const crlf = buf.indexOf("\r\n\r\n")
  if (lf === -1) return crlf
  if (crlf === -1) return lf
  return Math.min(lf, crlf)
}

function matchResponse(
  msg: JsonRpcResponse | JsonRpcResponse[],
  id: string | number,
): JsonRpcResponse | null {
  const list = Array.isArray(msg) ? msg : [msg]
  for (const m of list) {
    // Balasan punya id yang sama; notifikasi tak punya id sama sekali.
    if (m.id === id && (m.result !== undefined || m.error)) return m
  }
  return null
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return ""
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let out = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out += decoder.decode(value, { stream: true })
      if (out.length > LIMITS.MCP_OUTPUT_MAX_CHARS) {
        throw new Error("MCP http: balasan melewati batas ukuran")
      }
    }
  } finally {
    reader.releaseLock()
  }
  return out
}
