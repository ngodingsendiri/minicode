import { c } from "./theme.ts"
import { displayWidth, padToWidth, truncateToWidth } from "./width.ts"

export interface ColumnDef {
  header: string
  /** Lebar kolom dalam KOLOM terminal sebagai BATAS KERAS; isi lebih panjang dipotong "…". */
  width?: number
  key: string
  align?: "left" | "right"
}

const ELLIPSIS = "\u2026"
/** Batas otomatis bila `width` tidak diberikan. */
const AUTO_MAX = 50

/**
 * Nilai sel siap tampil: newline/tab/karakter kontrol dibuang.
 *
 * Satu newline dalam nilai memecah baris tabel menjadi dua dan seluruh
 * kolom setelahnya bergeser — pemanggil (`config list`, `providers`, `skills`)
 * mengambil nilai dari config/frontmatter yang bisa berisi apa pun.
 */
function sanitizeCell(v: unknown): string {
  const s = v == null ? "" : String(v)
  // Sekuens ANSI (untuk warna) dipertahankan; hanya kontrol tata letak dibuang.
  return s.replace(/\r\n|\r|\n/g, " ").replace(/[\t\v\f\u0085\u2028\u2029]/g, " ")
}

// Table minimal - kolom aligned + separator header, tanpa border.
export function renderTable(columns: ColumnDef[], data: Record<string, unknown>[]): string {
  if (columns.length === 0) return c.muted("(tidak ada kolom)")
  if (data.length === 0) return c.muted("(tidak ada entri)")

  const cells = data.map((row) => columns.map((col) => sanitizeCell(row[col.key])))

  // `width` yang dideklarasikan adalah batas keras dalam KOLOM terminal
  // (CJK/emoji dihitung dua). Sebelumnya ia hanya MINIMUM dan diukur per
  // karakter, sehingga satu nilai panjang mendorong kolom melebar dan header
  // berhenti berbaris dengan body.
  const widths = columns.map((col, i) => {
    // Nilai negatif/NaN dari pemanggil tidak boleh membuat "".repeat() melempar.
    if (col.width != null && Number.isFinite(col.width)) return Math.max(0, Math.trunc(col.width))
    let max = displayWidth(col.header)
    for (const row of cells) {
      const w = displayWidth(row[i] ?? "")
      if (w > max) max = w
    }
    return Math.min(max, AUTO_MAX)
  })

  const cell = (text: string, width: number, align: "left" | "right" = "left"): string =>
    padToWidth(truncateToWidth(text, width, ELLIPSIS), width, align)

  const header = columns
    .map((col, i) => ` ${c.bold(c.accent(cell(col.header, widths[i]!, col.align)))} `)
    .join(" ")

  // Separator (─ antara header dan body). Lebarnya harus SAMA dengan baris
  // data: tiap sel adalah " isi " (width+2) dan antar sel disatukan satu spasi.
  const sep = c.dim(widths.map((w) => "─".repeat(w + 2)).join(" "))

  const rows = cells.map((row) =>
    columns.map((col, i) => ` ${cell(row[i] ?? "", widths[i]!, col.align)} `).join(" "),
  )

  return [sep, header, ...rows].join("\n")
}
