import type { Tool } from "minicore"
import { scrubSecrets } from "../policy/scrub.ts"
import { isPrivateHost } from "./web_fetch.ts"

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web (Google grounding-like via DuckDuckGo/Tavily). Returns top results with snippets. Uses web_fetch under the hood with SSRF guard.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "search query" },
      count: { type: "number", description: "max results (default 5, max 10)" },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute({ query, count }, ctx) {
    const q = String(query ?? "").trim()
    if (!q) throw new Error("query required")
    const n = Math.min(Math.max(Number(count) || 5, 1), 10)
    // Prefer Tavily if key available (more reliable than scraping)
    const tavilyKey = process.env.TAVILY_API_KEY
    if (tavilyKey) {
      try {
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 8000)
        const onAbort = () => controller.abort(ctx.signal.reason)
        ctx.signal.addEventListener("abort", onAbort, { once: true })
        try {
          const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              api_key: tavilyKey,
              query: q,
              max_results: n,
              search_depth: "basic",
            }),
            signal: controller.signal,
          })
          if (res.ok) {
            const data = (await res.json()) as {
              results?: { title: string; url: string; content: string }[]
            }
            const results = (data.results ?? []).slice(0, n)
            const out = results
              .map(
                (r, i) =>
                  `${i + 1}. ${r.title}\n   ${r.url}\n   ${scrubSecrets(r.content).slice(0, 400)}`,
              )
              .join("\n\n")
            return `[tavily ${results.length} results for "${q}"]\n${out}`.slice(0, 20000)
          }
        } finally {
          clearTimeout(t)
          ctx.signal.removeEventListener("abort", onAbort)
        }
      } catch {}
    }
    // Fallback: DuckDuckGo html lite (no API key, SSRF-guarded via web_fetch logic)
    // Use ddg search via html.duckduckgo.com/html/?q=
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
    try {
      const parsed = new URL(ddgUrl)
      if (isPrivateHost(parsed.hostname)) throw new Error("blocked")
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(ddgUrl, {
        signal: controller.signal,
        headers: { "user-agent": "minicode-websearch/1.0" },
      })
      clearTimeout(t)
      const html = await res.text()
      const scrubbed = scrubSecrets(html)
      // naive parse: extract result links
      const re = /<a[^>]+class="result__url"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g
      const results: { url: string; title: string }[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(scrubbed)) !== null && results.length < n) {
        results.push({ url: m[1] ?? "", title: (m[2] ?? "").trim() })
      }
      if (results.length) {
        return `[duckduckgo ${results.length} results for "${q}"]\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n")}`.slice(
          0,
          8000,
        )
      }
      return `[web_search] no structured results, raw snippet:\n${scrubbed.slice(0, 3000)}`
    } catch (e) {
      throw new Error(`web_search failed: ${(e as Error).message}`)
    }
  },
}
