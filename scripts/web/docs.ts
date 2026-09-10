// Bangun halaman docs: 16 halaman dari docs/*.md via SUMMARY.md.
// Tiap halaman: sidebar 1:1 SUMMARY, badge sumber file:line, prev/next,
// link edit GitHub. Font kecil via body.doc (lihat styles.css).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { firstPara } from "./fm.ts"
import { mdToHtml } from "./md.ts"
import { docMeta, readDocNav, sidebarHtml } from "./nav.ts"
import { mdLinksToHtml, renderPage } from "./page.ts"

export function buildDocs(
  repoRoot: string,
  webDir: string,
  base: string,
  version: string,
  write: (rel: string, html: string) => void,
): string[] {
  const entries = readDocNav(repoRoot)
  const urls: string[] = []
  entries.forEach((e, idx) => {
    const raw = readFileSync(join(repoRoot, "docs", e.file), "utf8")
    const meta = docMeta(e.slug)
    const desc = (firstPara(raw).slice(0, 160) || meta.desc).trim()
    const safeDesc = desc.length >= 20 ? desc : meta.desc
    const content = mdLinksToHtml(mdToHtml(raw))
    const prev = entries[idx - 1]
    const next = entries[idx + 1]
    const hrefOf = (e2: { slug: string }): string =>
      e2.slug === "readme" ? "/docs/" : `/docs/${e2.slug}.html`
    const nav =
      `<nav class="doc-nav" aria-label="Navigasi docs">` +
      (prev
        ? `<a href="${hrefOf(prev)}"><span>Sebelumnya</span>${prev.title}</a>`
        : `<span></span>`) +
      (next
        ? `<a href="${hrefOf(next)}"><span>Berikutnya</span>${next.title}</a>`
        : `<span></span>`) +
      `</nav>`
    const edit = `https://github.com/startupmini/minicode/blob/main/docs/${e.file}`
    const body =
      `<div class="doc-layout"><aside class="sidebar" aria-label="Navigasi dokumentasi">` +
      `${sidebarHtml(entries, e.slug)}</aside>` +
      `<div class="doc-body"><h1>${e.title}</h1>` +
      `<div class="doc-meta"><span class="src-badge">sumber: ${meta.src}</span>` +
      `<a href="${edit}">Edit di GitHub</a></div>${content}${nav}</div></div>`
    const rel = e.slug === "readme" ? "docs/index.html" : `docs/${e.slug}.html`
    const canon = e.slug === "readme" ? `${base}/docs/` : `${base}/docs/${e.slug}.html`
    write(
      rel,
      renderPage(webDir, {
        title: e.title,
        desc: safeDesc,
        canon,
        body,
        bodyClass: "doc",
        version,
        jsonld: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: e.title,
        }),
      }),
    )
    urls.push(canon)
  })
  return urls
}
