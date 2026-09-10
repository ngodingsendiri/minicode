// Parser markdown mini untuk web minicode.
// Mengapa mini, bukan library: repo berpostur zero-dep runtime dan dokumen
// sumber hanya memakai subset (heading, fence, tabel, list, link, inline
// code, bold). Cukup untuk docs + blog tanpa menambah dependensi.
export function escHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function inlineMd(s: string): string {
  // Inline code dulu agar isi `...` tidak diproses bold/link.
  // Penanda pakai string biasa (bukan NUL): biome melarang control char di regex.
  const codes: string[] = []
  let out = s.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${escHtml(c)}</code>`)
    return `@@MC${codes.length - 1}@@`
  })
  out = escHtml(out)
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t: string, u: string) => {
    const url = u.trim()
    // Hanya izinkan http(s), path absolut/relatif, dan anchor.
    if (!/^(https?:\/\/|\/|#|[a-zA-Z0-9._-]+\/|[a-zA-Z0-9._-]+\.html)/.test(url)) return t
    return `<a href="${escHtml(url)}">${t}</a>`
  })
  out = out.replace(/@@MC(\d+)@@/g, (_, i: string) => codes[Number(i)] ?? "")
  return out
}

function isTableSep(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|.-]*$/.test(line) && line.includes("-")
}

function renderTable(head: string, rows: string[]): string {
  const cells = (l: string): string[] =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim())
  const th = cells(head)
    .map((c) => `<th>${inlineMd(c)}</th>`)
    .join("")
  const tr = rows
    .map(
      (r) =>
        `<tr>${cells(r)
          .map((c) => `<td>${inlineMd(c)}</td>`)
          .join("")}</tr>`,
    )
    .join("")
  const cls = "flat"
  return `<table class="${cls}"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
}

/** Ubah markdown subset menjadi HTML. Aman: fence di-escape penuh. */
export function mdToHtml(src: string): string {
  const lines = src.replaceAll("\r\n", "\n").split("\n")
  const html: string[] = []
  let i = 0
  let inFence = false
  let fenceLang = ""
  let fenceBuf: string[] = []
  let listOpen = false
  const closeList = (): void => {
    if (listOpen) {
      html.push("</ul>")
      listOpen = false
    }
  }
  const flushFence = (): void => {
    const code = escHtml(fenceBuf.join("\n"))
    const lang = fenceLang ? ` data-lang="${escHtml(fenceLang)}"` : ""
    html.push(`<pre${lang}><code>${code}</code></pre>`)
    fenceBuf = []
  }
  while (i < lines.length) {
    const line = lines[i] ?? ""
    const fence = /^```(\w*)\s*$/.exec(line.trim())
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceLang = fence[1] ?? ""
        closeList()
      } else {
        inFence = false
        flushFence()
        fenceLang = ""
      }
      i++
      continue
    }
    if (inFence) {
      fenceBuf.push(line)
      i++
      continue
    }
    if (/^\s*$/.test(line)) {
      closeList()
      i++
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      closeList()
      const lvl = h[1]!.length
      html.push(`<h${lvl}>${inlineMd(h[2]!.trim())}</h${lvl}>`)
      i++
      continue
    }
    if (i + 1 < lines.length && isTableSep(lines[i + 1] ?? "")) {
      closeList()
      const rows: string[] = []
      i += 2
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        rows.push(lines[i]!)
        i++
      }
      html.push(renderTable(line, rows))
      continue
    }
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (li) {
      if (!listOpen) {
        html.push("<ul>")
        listOpen = true
      }
      html.push(`<li>${inlineMd(li[1]!.trim())}</li>`)
      i++
      continue
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line)
    if (ol) {
      closeList()
      html.push(`<p>${inlineMd(line.trim())}</p>`)
      i++
      continue
    }
    if (line.trim().startsWith(">")) {
      closeList()
      html.push(`<p><em>${inlineMd(line.replace(/^>\s?/, "").trim())}</em></p>`)
      i++
      continue
    }
    closeList()
    // Gabung baris lanjutan menjadi satu paragraf.
    let para = line.trim()
    while (
      i + 1 < lines.length &&
      (lines[i + 1] ?? "").trim() !== "" &&
      !/^(#{1,3}\s|```|[-*]\s|\d+\.\s|>)/.test(lines[i + 1] ?? "") &&
      !(lines[i + 1] ?? "").includes("|")
    ) {
      para += ` ${(lines[i + 1] ?? "").trim()}`
      i++
    }
    html.push(`<p>${inlineMd(para)}</p>`)
    i++
  }
  closeList()
  if (inFence) flushFence()
  return html.join("\n")
}
