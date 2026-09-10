// Navigasi docs: baca docs/SUMMARY.md agar sidebar web selalu 1:1.
// Mengapa parse SUMMARY, bukan hardcode: satu sumber navigasi — tambah
// halaman docs cukup edit SUMMARY.md + file md, sidebar web ikut.
import { readFileSync } from "node:fs"
import { join } from "node:path"

export interface DocEntry {
  group: string
  title: string
  file: string
  slug: string
}

const DOC_META: Record<string, { desc: string; src: string }> = {
  README: {
    desc: "Dokumentasi Minicode: coding agent CLI shell-native di atas MiniCore.",
    src: "docs/README.md",
  },
  "getting-started": {
    desc: "Instalasi Minicode: Bun, matriks OS, update, lokasi data.",
    src: "src/config.ts",
  },
  quickstart: {
    desc: "Dari nol ke prompt pertama yang ter-verify dalam 5 menit.",
    src: "cli/router.ts",
  },
  cli: { desc: "Mode CLI, flags, dan environment variables Minicode.", src: "cli/router.ts" },
  repl: { desc: "Slash command dan pintasan keyboard REPL Minicode.", src: "cli/repl.ts" },
  "config-providers": {
    desc: "14 preset gateway, OAuth device-code, model dan effort.",
    src: "src/providers/build.ts",
  },
  "pricing-budget": {
    desc: "Harga offline, sync 3.162 model, dan --budget fail-closed.",
    src: "src/policy/pricing.ts",
  },
  tools: {
    desc: "Referensi 37 tool: filesystem, exec, git, web, memory, MCP, LSP.",
    src: "src/tools/index.ts",
  },
  "policy-sandbox": {
    desc: "6 permission mode, bash-guard, sandbox otomatis, path jail.",
    src: "src/policy/permission.ts",
  },
  "memory-sessions": {
    desc: "Memory RAG hybrid, sessions sqlite, checkpoint shadow-git.",
    src: "src/memory/vector.ts",
  },
  "mcp-lsp": {
    desc: "MCP stdio dan Streamable HTTP plus LSP diagnostics.",
    src: "src/mcp/client.ts",
  },
  "verify-benchmark": {
    desc: "Auto-verify self-heal, benchmark, dan SWE-bench Lite.",
    src: "bench/runner.ts",
  },
  troubleshooting: { desc: "FAQ error umum dan minicode doctor.", src: "cli/commands/doctor.ts" },
  contributing: { desc: "Setup dev, gate, batas lapisan, dan aturan kode.", src: "AGENTS.md" },
  architecture: {
    desc: "Tiga lapisan, alur satu prompt, dan kontrak terminal.",
    src: "docs/ARCHITECTURE.html",
  },
  changelog: { desc: "Perubahan per versi Minicode.", src: "CHANGELOG.md" },
}

export function readDocNav(repoRoot: string): DocEntry[] {
  const raw = readFileSync(join(repoRoot, "docs", "SUMMARY.md"), "utf8")
  const out: DocEntry[] = []
  let group = "Docs"
  for (const line of raw.split("\n")) {
    const g = /^##\s+(.*)$/.exec(line.trim())
    if (g) {
      group = g[1]!.trim()
      continue
    }
    const e = /^\*\s+\[([^\]]+)\]\(([^)]+)\)/.exec(line.trim())
    if (e) {
      const file = e[2]!.trim()
      const slug = file.replace(/\.md$/, "").toLowerCase()
      out.push({ group, title: e[1]!.trim(), file, slug })
    }
  }
  return out
}

export function docMeta(slug: string): { desc: string; src: string } {
  return DOC_META[slug] ?? { desc: `Dokumentasi Minicode: ${slug}.`, src: `docs/${slug}.md` }
}

/** Sidebar HTML: grup + link, tanpa garis — pill aktif via background. */
export function sidebarHtml(entries: DocEntry[], active: string): string {
  let html = `<input class="side-search" id="sidesearch" type="search" placeholder="Cari halaman…" aria-label="Cari halaman docs">`
  let lastGroup = ""
  for (const e of entries) {
    if (e.group !== lastGroup) {
      lastGroup = e.group
      html += `<div class="side-group">${e.group}</div>`
    }
    const cls = e.slug === active ? "side-link active" : "side-link"
    const href = e.slug === "readme" ? "/docs/" : `/docs/${e.slug}.html`
    html += `<a class="${cls}" href="${href}">${e.title}</a>`
  }
  return html
}
