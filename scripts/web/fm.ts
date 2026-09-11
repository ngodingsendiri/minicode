// Util frontmatter + slug untuk SSG web minicode.
export interface Frontmatter {
  title: string
  date: string
  tags: string[]
  desc: string
  body: string
}

/** Parse blok --- yaml mini (title/date/tags/desc) di kepala markdown. */
export function parseFrontmatter(src: string, fallbackTitle: string): Frontmatter {
  // Normalisasi CRLF dulu: file dari Windows/GitBook export memakai \r\n
  // sehingga regex ^---$ gagal tanpa ini (bug: title jatuh ke nama file).
  const norm = src.replaceAll("\r\n", "\n")
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(norm)
  if (!m) return { title: fallbackTitle, date: "", tags: [], desc: "", body: src }
  const head = m[1] ?? ""
  const body = m[2] ?? ""
  const get = (k: string): string => {
    const r = new RegExp(`^${k}:\\s*"?([^"\\n]*)"?\\s*$`, "m").exec(head)
    return (r?.[1] ?? "").trim()
  }
  const tagsRaw = get("tags")
  const tags = tagsRaw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
  return {
    title: get("title") || fallbackTitle,
    date: get("date"),
    tags,
    desc: get("desc"),
    body,
  }
}

/** Slug URL aman: huruf-kecil, non-alnum jadi strip. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

/**
 * Ambil paragraf prose pertama sebagai deskripsi fallback (FIX#8 web).
 * Aturan (audit website): lewati heading, fence, tabel, SEMUA list (`- `,
 * `* `, `1. `), quote (`>`), dan baris kode; render `[teks](url)` jadi teks;
 * potong di batas kata ~155 char. Tanpa ini description berisi sintaks mentah
 * (`[Instalasi](getting-started.md)` → "Instalasigetting-star").
 */
export function firstPara(md: string): string {
  const norm = md.replaceAll("\r\n", "\n")
  const lines = norm.split("\n").map((l) => l.trim())
  for (const l of lines) {
    if (
      !l ||
      l.startsWith("#") ||
      l.startsWith("```") ||
      l.startsWith("|") ||
      l.startsWith("*") ||
      l.startsWith("- ") ||
      l.startsWith(">") ||
      /^\d+\.\s/.test(l)
    ) {
      continue
    }
    // [teks](url) → teks; sisa marker inline dibuang (bukan atribut: aman).
    const text = l
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (text.length < 20) continue
    if (text.length <= 155) return text
    const cut = text.slice(0, 154)
    return `${cut.slice(0, cut.lastIndexOf(" ") || 154).trimEnd()}…`
  }
  return ""
}

/** Escape untuk atribut/JSON-LD. */
export function escAttr(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
}
