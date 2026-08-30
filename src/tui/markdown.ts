// Markdown decoration - Ubuntu Server style.
// Heading -> bold, bullet -> indentasi, code fence -> indentasi + syntax highlight.
// Inline: **bold**, *italic*, `code`, ~~strike~~, [text](url) -> teks accent (no underline).

import { highlightCode } from "./highlight.ts"
import { c } from "./theme.ts"

// ── Inline markdown -> ANSI ──
export function renderInline(text: string): string {
  let t = text
  // [text](url) -> accent bold text (url hidden, no underline - terminal can't click)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string) => c.accent(c.bold(label)))
  // `code` -> brightCyan
  t = t.replace(/`([^`]+)`/g, (_m, code: string) => c.brightCyan(code))
  // **bold**
  t = t.replace(/\*\*([^*]+)\*\*/g, (_m, bold: string) => c.bold(bold))
  // *italic*
  t = t.replace(
    /(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g,
    (_m, pre: string, ital: string) => `${pre}${c.italic(ital)}`,
  )
  // __bold__
  t = t.replace(/__([^_]+)__/g, (_m, bold: string) => c.bold(bold))
  // ~~strike~~
  t = t.replace(/~~([^~]+)~~/g, (_m, del: string) => c.muted(del))
  return t
}

export function decorateMarkdown(text: string): string {
  const lines = text.split("\n")
  const out: string[] = []
  let inFence = false
  let fenceLang = ""

  for (const line of lines) {
    // Code fence handling
    const fence = /^\s*(```+|~~~+)([A-Za-z0-9_+.-]*)\s*$/.exec(line)
    if (fence) {
      inFence = !inFence
      fenceLang = inFence ? (fence[2] ?? "") : ""
      continue
    }

    // Di DALAM fence: isi kode tidak boleh disentuh markdown.
    //
    // Sebelumnya hanya fence BERBAHASA yang dilindungi (`if (inFence && fenceLang)`),
    // sehingga fence tanpa bahasa jatuh ke renderInline di bawah dan
    // `npm run build -- --flag=*value*` kehilangan bintangnya karena dianggap
    // italic. Fence tanpa bahasa justru bentuk paling umum untuk perintah shell.
    if (inFence) {
      out.push(`  ${fenceLang ? highlightCode(line, fenceLang) : line}`)
      continue
    }

    // Headings (# ## ###) -> bold with vertical spacing
    if (/^#{1,3}\s/.test(line)) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("")
      out.push(c.bold(line))
      continue
    }

    // Bullet list -> indentasi
    if (/^\s*[-*]\s/.test(line)) {
      out.push(`  ${renderInline(line.trimStart())}`)
      continue
    }

    out.push(renderInline(line))
  }
  return out.join("\n")
}
