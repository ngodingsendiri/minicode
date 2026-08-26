import { c, stripAnsi } from "./theme.ts"

export interface ColumnDef {
  header: string
  key: string
  width?: number
  align?: "left" | "right"
}

// Table minimal - kolom aligned + separator header, tanpa border.
export function renderTable(columns: ColumnDef[], data: Record<string, unknown>[]): string {
  if (data.length === 0) return c.muted("(no entries)")

  const widths = columns.map((col) => {
    let max = col.header.length
    for (const row of data) {
      const clean = stripAnsi(String(row[col.key] ?? ""))
      if (clean.length > max) max = clean.length
    }
    return col.width ?? Math.min(Math.max(max, col.header.length), 50)
  })

  const pad = (text: string, width: number, align: "left" | "right" = "left"): string => {
    const clean = stripAnsi(text)
    const diff = width - clean.length
    if (diff <= 0) return text
    return align === "right" ? `${" ".repeat(diff)}${text}` : `${text}${" ".repeat(diff)}`
  }

  // Header row - VS Code accent
  const header = columns
    .map((col, i) => ` ${c.bold(c.accent(pad(col.header, widths[i]!, col.align)))} `)
    .join(" ")

  // Separator (─ antara header dan body)
  const sep = c.dim(widths.map((w) => "─".repeat(w + 2)).join("  "))

  // Body rows
  const rows = data.map((row) =>
    columns
      .map((col, i) => ` ${pad(String(row[col.key] ?? ""), widths[i]!, col.align)} `)
      .join(" "),
  )

  return [sep, header, ...rows].join("\n")
}
