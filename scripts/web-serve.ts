// Server preview lokal untuk site/ (bukan untuk produksi).
// Mengapa file sendiri: `bun --hot` butuh entry yang serve folder site/
// dengan fallback .html rapi + header no-cache agar edit CSS langsung terlihat.
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..")
const siteDir = join(repoRoot, "site")
const port = Number(process.env.PORT ?? 3000)

export default {
  port,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    let path = decodeURIComponent(url.pathname)
    if (path.endsWith("/")) path += "index.html"
    const file = Bun.file(join(siteDir, path))
    if (await file.exists()) {
      return new Response(file, { headers: { "Cache-Control": "no-store" } })
    }
    // Fallback rapi: /docs/cli -> /docs/cli.html ; sisanya 404.html.
    const withHtml = Bun.file(join(siteDir, `${path}.html`))
    if (await withHtml.exists()) return new Response(withHtml)
    const notFound = Bun.file(join(siteDir, "404.html"))
    return new Response(notFound, { status: 404 })
  },
}
console.log(`[web-serve] http://localhost:${port} <- site/`)
