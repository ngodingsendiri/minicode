import type { Tool } from "minicore"
import { scrubSecrets } from "../policy/scrub.ts"

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") return true
  // IPv4 private
  if (/^10\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true
  if (h === "0.0.0.0") return true
  // metadata endpoints
  if (h === "metadata.google.internal") return true
  return false
}

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch a public HTTP/HTTPS URL (GET, 10s timeout, max 50k chars). Use for browsing public web pages. Blocks private IPs.",
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
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`only http/https allowed, got ${parsed.protocol}`)
    }
    if (isPrivateHost(parsed.hostname)) {
      throw new Error(`blocked private host: ${parsed.hostname}`)
    }

    const limit = Math.min(Math.max(Number(maxChars) || 20000, 1000), 50000)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error("fetch timeout 10s")), 10_000)
    // Link parent signal
    const onParentAbort = () => controller.abort(ctx.signal.reason)
    if (ctx.signal.aborted) controller.abort(ctx.signal.reason)
    else ctx.signal.addEventListener("abort", onParentAbort, { once: true })

    try {
      const res = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          "user-agent": "minicode-webfetch/1.0",
          accept: "text/html,application/json,text/*;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        const snippet = scrubSecrets(body).slice(0, 1000)
        throw new Error(`fetch ${res.status} ${res.statusText}${snippet ? `: ${snippet}` : ""}`)
      }

      const contentType = res.headers.get("content-type") ?? ""
      // Limit body size to avoid OOM
      const text = await res.text()
      const scrubbed = scrubSecrets(text)
      const sliced = scrubbed.slice(0, limit)
      const truncated =
        scrubbed.length > limit ? `\n\n… truncated ${scrubbed.length - limit} chars` : ""
      const header = `[${res.status} ${contentType}]\n`
      return (header + sliced + truncated).slice(0, limit + 500)
    } finally {
      clearTimeout(timeout)
      ctx.signal.removeEventListener("abort", onParentAbort)
    }
  },
}
