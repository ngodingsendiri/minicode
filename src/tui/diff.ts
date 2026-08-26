// Diff renderer - Ubuntu Server style: indentasi + warna, tanpa border.
import { c } from "./theme.ts"

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
  opts: { maxLines?: number } = {},
): string {
  const diff = computeLineDiff(oldText, newText)
  const changes = diff.filter((d) => d.type !== "context")
  if (changes.length === 0) return c.muted("  (no changes)")

  const max = opts.maxLines ?? 12
  const lines: string[] = [c.accent(c.bold(`  ${filePath}`))]
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
      lines.push(
        c.muted(
          `    ... (+${changes.filter((c) => c.type === "add").length} −${changes.filter((c) => c.type === "delete").length})`,
        ),
      )
      break
    }
    const d = diff[i]!
    if (d.type === "add") lines.push(c.success(`  + ${d.content}`))
    else if (d.type === "delete") lines.push(c.error(`  - ${d.content}`))
    else lines.push(c.dim(`    ${d.content}`))
    count++
  }
  return lines.join("\n")
}
