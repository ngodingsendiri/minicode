// Test SSG web: jaga link internal + anti-bocor + kelengkapan sidebar.
// Mengapa ada: satu-satunya penjaga agar edit docs/SUMMARY.md atau layout
// yang typo langsung gagal di `bun test`, bukan setelah deploy Pages.
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFrontmatter } from "../scripts/web/fm.ts"
import { mdToHtml } from "../scripts/web/md.ts"
import { readDocNav } from "../scripts/web/nav.ts"

const repoRoot = join(import.meta.dir, "..")

describe("web ssg", () => {
  test("SUMMARY semua file ada", () => {
    const entries = readDocNav(repoRoot)
    expect(entries.length).toBeGreaterThanOrEqual(16)
    for (const e of entries) {
      expect(existsSync(join(repoRoot, "docs", e.file))).toBe(true)
    }
  })

  test("template layout punya slot wajib + tanpa border", () => {
    const layout = readFileSync(join(repoRoot, "web", "layout.html"), "utf8")
    for (const slot of ["{{TITLE}}", "{{DESC}}", "{{CANON}}", "{{CONTENT}}", "{{JSONLD}}"]) {
      expect(layout.includes(slot)).toBe(true)
    }
    // Aturan flat: tidak ada `border:` di CSS gabungan.
    const css = readFileSync(join(repoRoot, "web", "styles.css"), "utf8")
    expect(/border\s*:/.test(css)).toBe(false)
    // Logo: pakai logo milik pengguna, tanpa sisa mark/aneka logo lama.
    expect(layout).toContain("logo-user.svg")
    expect(layout).not.toContain("brand-mark")
    expect(layout).not.toContain("favicon.svg")
  })

  test("blog frontmatter valid", () => {
    const dir = join(repoRoot, "content", "blog")
    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const f of files) {
      const fm = parseFrontmatter(readFileSync(join(dir, f), "utf8"), f)
      expect(fm.title.length).toBeGreaterThan(8)
      expect(fm.desc.length).toBeGreaterThanOrEqual(20)
      expect(/^\d{4}-\d{2}-\d{2}/.test(f)).toBe(true)
    }
  })

  test("md renderer escape fence + tabel", () => {
    const html = mdToHtml(
      "# H\n\n```js\n<script>x</script>\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
    )
    expect(html.includes("<h1>H</h1>")).toBe(true)
    expect(html.includes("&lt;script&gt;")).toBe(true)
    expect(html.includes("<table")).toBe(true)
  })

  test("artikel blog contoh ter-render", () => {
    // Gagal di kode lama: CRLF membuat frontmatter tak terparse (title = nama file).
    const raw = readFileSync(
      join(repoRoot, "content", "blog", "2026-09-10-kenapa-shell-native.md"),
      "utf8",
    )
    const fm = parseFrontmatter(raw, "x")
    expect(fm.title).toBe("Kenapa Minicode memilih shell-native, bukan TUI")
  })

  test("site/ hasil build lengkap (bila sudah di-build)", () => {
    const site = join(repoRoot, "site")
    if (!existsSync(site)) return // build belum jalan — checker CI yang jaga
    const has = (p: string): boolean => !!statSync(join(site, p), { throwIfNoEntry: false })
    for (const p of [
      "index.html",
      "docs/index.html",
      "docs/tools.html",
      "blog/index.html",
      "sitemap.xml",
      "rss.xml",
      "robots.txt",
      "admin.html",
      "CNAME",
    ]) {
      expect(has(p)).toBe(true)
    }
    // Canonical + sitemap wajib memakai domain produksi, bukan github.io.
    const index = readFileSync(join(site, "index.html"), "utf8")
    expect(index).toContain("https://minicode.fun/")
    expect(index).not.toContain("startupmini.github.io")
    expect(readFileSync(join(site, "CNAME"), "utf8").trim()).toBe("minicode.fun")
    // Logo user ikut di-copy.
    expect(has("assets/logo-user.svg")).toBe(true)
    // Judul docs tidak ganda (satu <h1> per halaman).
    const docIndex = readFileSync(join(site, "docs", "index.html"), "utf8")
    expect(docIndex.includes("<h1>Minicode — Dokumentasi</h1>")).toBe(true)
    expect(docIndex.split("<h1>").length).toBe(2)
    // Tidak ada sisa badge/sidebar/pill / lalu lintas lama.
    expect(docIndex).not.toContain("src-badge")
    expect(docIndex).not.toContain("doc-meta")
    expect(docIndex).not.toContain("doc-rail")
    expect(docIndex).not.toContain("side-link")
    // Prev/Next di bawah, teks polos, tanpa judul halaman di box.
    const docTools = readFileSync(join(site, "docs", "tools.html"), "utf8")
    expect(docTools).toContain(">‹ Prev<")
    expect(docTools).toContain("Next ›<")
    expect(docTools).not.toContain("Sebelumnya</span>")
  })
})
