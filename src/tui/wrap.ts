// Word-wrap + justify (rata kanan-kiri) - untuk output teks AI.
// ANSI escape (warna/bold) tidak dihitung sebagai karakter lebar.

import { ANSI_PATTERN } from "./theme.ts"

export function stripAnsi(s: string): string {
  return s.replace(new RegExp(ANSI_PATTERN, "g"), "")
}

export function visibleLen(s: string): number {
  return stripAnsi(s).length
}

// Wrap teks ke baris-baris ≤ `width` dengan potongan di batas spasi.
// Baris dalam code fence (```) tidak di-justify - hanya wrapped.
export function wordWrap(text: string, width: number): string {
  if (width <= 0) return text
  const lines = text.split("\n")
  const out: string[] = []
  for (const line of lines) {
    if (visibleLen(line) <= width) {
      out.push(line)
      continue
    }
    const words = line.split(" ")
    let current = ""
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (visibleLen(candidate) > width && current) {
        out.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) out.push(current)
  }
  return out.join("\n")
}

// Justify satu baris: distribusi spasi ekstra supaya ujung kiri & kanan rata.
// Baris kosong / <2 kata / baris yang sudah penuh dibiarkan.
export function justifyLine(line: string, width: number): string {
  const clean = visibleLen(line)
  if (clean >= width || width <= 0) return line
  const words = line.split(" ")
  if (words.length < 2) return line
  const gaps = words.length - 1
  const extra = width - clean
  const perGap = Math.floor(extra / gaps)
  const extraGap = extra % gaps
  return words
    .map((w, i) => {
      if (i >= gaps) return w
      const spaces = 1 + perGap + (i < extraGap ? 1 : 0)
      return w + " ".repeat(spaces)
    })
    .join("")
}

// Wrap + justify: untuk output streaming per paragraf.
export function formatWrapped(text: string, width: number, justify = true): string {
  const wrapped = wordWrap(text, width)
  if (!justify) return wrapped
  return wrapped
    .split("\n")
    .map((line) => {
      if (/^\s*(```|#|[-*] |>\s)/.test(line) || /^\s*$/.test(line)) return line
      return justifyLine(line, width)
    })
    .join("\n")
}
