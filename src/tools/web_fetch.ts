import type { Tool } from "minicore"
import { scrubSecrets } from "../policy/scrub.ts"

// Host validasi untuk anti-SSRF. Catatan: WHATWG URL sudah menormalisasi host
// IPv4 non-dotted (hex 0x7f000001 / desimal 2130706433) menjadi dotted-decimal,
// jadi cukup cek bentuk dotted di sini — bypass encoding tertutup oleh parser.
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 127 || a === 10 || a === 0) return true // loopback / priv10 / this-network
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true // link-local (cloud metadata IMDS)
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  return false
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (!h) return true
  if (h === "localhost" || h.endsWith(".localhost")) return true
  if (h.endsWith(".internal") || h.endsWith(".local")) return true
  if (h === "::1" || h === "::") return true
  if (h.startsWith("::ffff:")) return isPrivateIPv4(h.slice(7)) // IPv4-mapped IPv6
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]{0,1}:/.test(h)) return true // fe80::/10 link-local
  return isPrivateIPv4(h)
}

const MAX_REDIRECTS = 5
// Hard-cap pembacaan body SEBELUM slicing — cegah OOM dari response raksasa.
const BODY_HARD_CAP_CHARS = 2_000_000

async function readBodyCapped(
  res: Response,
  controller: AbortController,
): Promise<string> {
  if (!res.body) return ""
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let out = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out += decoder.decode(value, { stream: true })
      if (out.length > BODY_HARD_CAP_CHARS) {
        controller.abort(new Error("response exceeds body hard cap"))
        break
      }
    }
  } finally {
    reader.releaseLock()
  }
  return out
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch a public HTTP/HTTPS URL (GET, 10s timeout, max 50k chars). Use for browsing public web pages. Blocks private IPs and private redirect targets.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "https:// URL to fetch" },
      maxChars: { type: "number", description: "max chars to return (default 20000, max 50000)" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute({ url, maxChars }, ctx) {
    const u = String(url ?? "").trim()
    if (!u) throw new Error("url required")
    let parsed: URL
    try {
      parsed = new URL(u)
    } catch {
      throw new Error(`invalid url: ${u}`)
    }

    const limit = Math.min(Math.max(Number(maxChars) || 20000, 1000), 50000)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error("fetch timeout 10s")), 10_000)
    // Link parent signal — selalu pasang listener dulu, cek aborted setelahnya
    // (tutup race abort antara check dan addEventListener).
    const onParentAbort = () => controller.abort(ctx.signal.reason)
    ctx.signal.addEventListener("abort", onParentAbort, { once: true })
    if (ctx.signal.aborted) controller.abort(ctx.signal.reason)

    try {
      // Redirect ditangani MANUAL: tiap hop divalidasi ulang isPrivateHost —
      // menutup SSRF via open-redirect ke 169.254.169.254 / localhost dsb.
      let current = parsed
      if (isPrivateHost(current.hostname)) {
        throw new Error(`blocked private host: ${current.hostname}`)
      }
      const headers = {
        "user-agent": "minicode-webfetch/1.0",
        accept: "text/html,application/json,text/*;q=0.9,*/*;q=0.8",
      }
      let res: Response | undefined
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        res = await fetch(current.toString(), {
          signal: controller.signal,
          headers,
          redirect: "manual",
        })
        if (res.status < 300 || res.status >= 400) break
        const loc = res.headers.get("location")
        if (!loc) break
        let next: URL
        try {
          next = new URL(loc, current)
        } catch {
          throw new Error(`invalid redirect location: ${loc}`)
        }
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          throw new Error(`redirect to disallowed protocol: ${next.protocol}`)
        }
        if (isPrivateHost(next.hostname)) {
          throw new Error(`blocked private host (redirect target): ${next.hostname}`)
        }
        current = next
        void res.body?.cancel().catch(() => {})
      }
      if (!res) throw new Error("unreachable")
      if (res.status >= 300 && res.status < 400) {
        throw new Error(`too many redirects (>${MAX_REDIRECTS})`)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        const snippet = scrubSecrets(body).slice(0, 1000)
        throw new Error(`fetch ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ""}`)
      }

      const contentType = res.headers.get("content-type") ?? ""
      const raw = await readBodyCapped(res, controller)
      const scrubbed = scrubSecrets(raw)
      const sliced = scrubbed.slice(0, limit)
      const truncated =
        scrubbed.length > limit ? `\n\n… truncated ${scrubbed.length - limit} chars` : ""
      const header = `[${current} ${res.status} ${contentType}]\n`
      return (header + sliced + truncated).slice(0, limit + 500)
    } finally {
      clearTimeout(timeout)
      ctx.signal.removeEventListener("abort", onParentAbort)
    }
  },
}
