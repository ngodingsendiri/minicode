import { c, box, stripAnsi } from "./theme.ts";

export interface ColumnDef {
  header: string;
  key: string;
  width?: number;
  align?: "left" | "right";
}

export function renderTable(columns: ColumnDef[], data: Record<string, unknown>[]): string {
  if (data.length === 0) {
    return c.dim("(no entries)");
  }

  // Calculate column widths
  const computedWidths = columns.map((col) => {
    let max = col.header.length;
    for (const row of data) {
      const val = String(row[col.key] ?? "");
      const clean = stripAnsi(val);
      if (clean.length > max) max = clean.length;
    }
    return col.width ?? Math.min(Math.max(max, col.header.length), 50);
  });

  const pad = (text: string, width: number, align: "left" | "right" = "left"): string => {
    const clean = stripAnsi(text);
    const diff = width - clean.length;
    if (diff <= 0) return text;
    const space = " ".repeat(diff);
    return align === "right" ? `${space}${text}` : `${text}${space}`;
  };

  // Header
  const topBorder = c.dim(
    `${box.topLeft}${computedWidths.map((w) => box.horizontal.repeat(w + 2)).join(box.tDown)}${box.topRight}`
  );

  const headerRow = computedWidths
    .map((w, i) => ` ${c.bold(c.cyan(pad(columns[i]!.header, w, columns[i]!.align)))} `)
    .join(c.dim(box.vertical));
  const headerLine = `${c.dim(box.vertical)}${headerRow}${c.dim(box.vertical)}`;

  const midBorder = c.dim(
    `${box.tRight}${computedWidths.map((w) => box.horizontal.repeat(w + 2)).join(box.cross)}${box.tLeft}`
  );

  // Rows
  const bodyRows = data.map((row) => {
    const cols = computedWidths.map((w, i) => {
      const col = columns[i]!;
      const val = String(row[col.key] ?? "");
      return ` ${pad(val, w, col.align)} `;
    });
    return `${c.dim(box.vertical)}${cols.join(c.dim(box.vertical))}${c.dim(box.vertical)}`;
  });

  const bottomBorder = c.dim(
    `${box.bottomLeft}${computedWidths.map((w) => box.horizontal.repeat(w + 2)).join(box.tUp)}${box.bottomRight}`
  );

  return [topBorder, headerLine, midBorder, ...bodyRows, bottomBorder].join("\n");
}
