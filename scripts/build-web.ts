// SSG web minicode (orkestrator tipis).
// Alur: landing + docs + blog -> site/ + sitemap + robots + 404 + aset.
// Tanpa dependensi: hanya node:fs/path. Output site/ di-gitignore.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildBlog } from "./web/blog.ts"
import { buildDocs } from "./web/docs.ts"
import { landingHero, landingWhy } from "./web/landing1.ts"
import { landingFaq, landingFeatures, landingFlags, landingProviders } from "./web/landing2.ts"
import { renderPage, softwareJsonld } from "./web/page.ts"

const repoRoot = join(import.meta.dir, "..")
const webDir = join(repoRoot, "web")
const siteDir = join(repoRoot, "site")
// Domain custom produksi. Mengapa konstanta, bukan argumen: canonical,
// sitemap, robots, dan RSS harus satu sumber agar tidak divergen diam-diam.
const base = "https://minicode.fun"
const customDomain = "minicode.fun"

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }
const version = pkg.version

function write(rel: string, content: string): void {
  const dest = join(siteDir, rel)
  mkdirSync(join(dest, ".."), { recursive: true })
  writeFileSync(dest, content, "utf8")
}

const landing =
  landingHero(version) +
  landingWhy() +
  landingFeatures() +
  landingProviders() +
  landingFlags() +
  landingFaq()
write(
  "index.html",
  renderPage(webDir, {
    title: "Coding agent CLI shell-native",
    desc: "Minicode: coding agent CLI shell-native di atas MiniCore — 37 tool, sandbox, MCP, memory RAG, checkpoint shadow-git. MIT, zero-dep, Bun.",
    canon: `${base}/`,
    body: landing,
    version,
    jsonld: softwareJsonld(version),
  }),
)
const urls = [
  `${base}/`,
  ...buildDocs(repoRoot, webDir, base, version, write),
  ...buildBlog(repoRoot, webDir, siteDir, base, version, write),
]

write(
  "robots.txt",
  `User-agent: *\nAllow: /\nDisallow: /admin.html\nSitemap: ${base}/sitemap.xml\n`,
)
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    [...new Set(urls)]
      .sort()
      .map((u) => `<url><loc>${u}</loc></url>`)
      .join("") +
    `</urlset>`,
)
write(
  "404.html",
  renderPage(webDir, {
    title: "Tidak ketemu",
    desc: "Halaman tidak ditemukan.",
    canon: `${base}/404.html`,
    body: `<div class="wrap" style="padding:96px 24px;max-width:640px"><div class="sec-kick">404</div><h1>Halaman tidak ketemu.</h1><p class="sec-sub">Coba <a href="/docs/">dokumentasi</a> atau <a href="/blog/">blog</a>.</p></div>`,
    version,
    jsonld: softwareJsonld(version),
  }),
)
for (const f of ["styles.css", "app.js", "favicon.svg"]) {
  write(f, readFileSync(join(webDir, f), "utf8"))
}
cpSync(join(webDir, "assets", "logo.svg"), join(siteDir, "assets", "logo.svg"))
write("admin.html", readFileSync(join(webDir, "admin.html"), "utf8"))
// File CNAME membuat binding custom domain persisten — deploy artifact
// tanpa file ini bisa melepas domain di Settings → Pages.
write("CNAME", `${customDomain}\n`)
write(".nojekyll", "")
console.log(`[web-build] ${urls.length} halaman -> site/`)
