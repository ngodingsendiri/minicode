// Hashline deterministic edit — port dari OpenCode (deterministic file modification).
// Setiap line di-hash (FNV-1a 32-bit) → hunk dicocokkan via hash, bukan string diff naive.
// Ini menghindari partial-write failures yang sering terjadi di diff-based editor.

function fnv1a(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function hashLine(line: string): string {
  return fnv1a(line).toString(16).padStart(8, "0")
}

export function hashLines(lines: string[]): string[] {
  return lines.map(hashLine)
}

// Cari hunk `search` di `content` via hash matching. Return {start, end} index lines atau null.
// Menggunakan sliding window hash comparison — lebih robust vs whitespace/CRLF.
export function findHashlineHunk(
  content: string,
  search: string,
): { start: number; end: number } | null {
  const contentLines = content.split("\n")
  const searchLines = search.split("\n")
  if (searchLines.length === 0 || searchLines.length > contentLines.length) return null
  const contentHashes = hashLines(contentLines)
  const searchHashes = hashLines(searchLines)
  // exact hash first
  outer: for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    for (let j = 0; j < searchLines.length; j++) {
      if (contentHashes[i + j] !== searchHashes[j]) continue outer
    }
    // verify raw equality to guard hash collision (extremely rare)
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j] !== searchLines[j]) continue outer
    }
    return { start: i, end: i + searchLines.length }
  }
  // fallback: trimmed hash (ignore leading/trailing whitespace) — fuzzy match
  const trimmedContentHashes = hashLines(contentLines.map((l) => l.trim()))
  const trimmedSearchHashes = hashLines(searchLines.map((l) => l.trim()))
  outer2: for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    for (let j = 0; j < searchLines.length; j++) {
      if (trimmedContentHashes[i + j] !== trimmedSearchHashes[j]) continue outer2
    }
    return { start: i, end: i + searchLines.length }
  }
  return null
}

// Apply hunk: replace `search` dengan `replace` di `content` via hashline.
export function applyHashline(content: string, search: string, replace: string): string | null {
  const hunk = findHashlineHunk(content, search)
  if (!hunk) return null
  const lines = content.split("\n")
  const replaceLines = replace.split("\n")
  // handle trailing newline preservation
  const before = lines.slice(0, hunk.start)
  const after = lines.slice(hunk.end)
  return [...before, ...replaceLines, ...after].join("\n")
}
