// Diff renderer - Ubuntu Server style: indentasi + warna, tanpa border.
import { c } from "./theme.ts"
import { truncateToWidth } from "./width.ts"

export interface DiffLine {
  type: "add" | "delete" | "context"
  oldLine?: number
  newLine?: number
  content: string
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n")
  const newLines = newText.split("\n")
  const result: DiffLine[] = []
  let i = 0,
    j = 0,
    oldNum = 1,
    newNum = 1

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({ type: "context", content: oldLines[i]! })
      i++
      j++
    } else if (
      j < newLines.length &&
      (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]!))
    ) {
      result.push({ type: "add", newLine: newNum++, content: newLines[j]! })
      j++
    } else if (i < oldLines.length) {
      result.push({ type: "delete", oldLine: oldNum++, content: oldLines[i]! })
      i++
    }
  }
  return result
}

// Render diff with 1 line context around changes
export function renderDiffCard(
  filePath: string,
  oldText: string,
  newText: string,
  opts: { maxLines?: number; width?: number } = {},
): string {
  const diff = computeLineDiff(oldText, newText)
  const changes = diff.filter((d) => d.type !== "context")
  if (changes.length === 0) return c.muted("  (tidak ada perubahan)")

  const max = opts.maxLines ?? 12
  // Baris diff bisa sepanjang baris kode aslinya. Tanpa batas, satu baris 300
  // karakter membungkus sendiri di terminal dan merusak frame TUI yang
  // menghitung tinggi per baris. Default mengikuti lebar terminal.
  const width = opts.width ?? (process.stdout.columns || 80)
  const cut = (s: string) => truncateToWidth(s, Math.max(8, width - 1))

  const lines: string[] = [c.accent(c.bold(cut(`  ${filePath}`)))]
  // collect indices of changes plus 1 context line before/after
  const include = new Set<number>()
  diff.forEach((d, i) => {
    if (d.type !== "context") {
      include.add(i)
      if (i > 0 && diff[i - 1]?.type === "context") include.add(i - 1)
      if (i + 1 < diff.length && diff[i + 1]?.type === "context") include.add(i + 1)
    }
  })
  let count = 0
  for (let i = 0; i < diff.length; i++) {
    if (!include.has(i)) continue
    if (count >= max) {
      const added = changes.filter((d) => d.type === "add").length
      const removed = changes.filter((d) => d.type === "delete").length
      lines.push(c.muted(`    ... (+${added} \u2212${removed})`))
      break
    }
    const d = diff[i]!
    if (d.type === "add") lines.push(c.success(cut(`  + ${d.content}`)))
    else if (d.type === "delete") lines.push(c.error(cut(`  - ${d.content}`)))
    else lines.push(c.dim(cut(`    ${d.content}`)))
    count++
  }
  return lines.join("\n")
}
