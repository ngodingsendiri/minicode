import { c, box } from "./theme.ts";

export interface DiffLine {
  type: "add" | "delete" | "context";
  oldLine?: number;
  newLine?: number;
  content: string;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  let i = 0;
  let j = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      result.push({
        type: "context",
        oldLine: oldLineNum++,
        newLine: newLineNum++,
        content: oldLines[i]!,
      });
      i++;
      j++;
    } else if (j < newLines.length && (i >= oldLines.length || !oldLines.slice(i).includes(newLines[j]!))) {
      result.push({
        type: "add",
        newLine: newLineNum++,
        content: newLines[j]!,
      });
      j++;
    } else if (i < oldLines.length) {
      result.push({
        type: "delete",
        oldLine: oldLineNum++,
        content: oldLines[i]!,
      });
      i++;
    }
  }

  return result;
}

export function renderDiffCard(filePath: string, oldText: string, newText: string, opts: { contextLines?: number; maxLines?: number } = {}): string {
  const diff = computeLineDiff(oldText, newText);
  const context = opts.contextLines ?? 3;
  const maxLines = opts.maxLines ?? 40;

  // Filter diff to only changes + surrounding context lines
  const changeIndices = diff
    .map((line, idx) => (line.type !== "context" ? idx : -1))
    .filter((idx) => idx !== -1);

  if (changeIndices.length === 0) {
    return c.dim(`  ${box.vertical} (no changes)`);
  }

  const visibleSet = new Set<number>();
  for (const idx of changeIndices) {
    for (let k = Math.max(0, idx - context); k <= Math.min(diff.length - 1, idx + context); k++) {
      visibleSet.add(k);
    }
  }

  const sortedIndices = Array.from(visibleSet).sort((a, b) => a - b);
  const linesToRender: { index: number; line: DiffLine }[] = [];
  for (const idx of sortedIndices) {
    linesToRender.push({ index: idx, line: diff[idx]! });
  }

  const header = ` ${filePath} `;
  const topBorder = c.dim(`${box.topLeft}${box.horizontal}`) + c.cyan(c.bold(header)) + c.dim(box.horizontal.repeat(Math.max(2, 60 - filePath.length)));
  const bottomBorder = c.dim(`${box.bottomLeft}${box.horizontal.repeat(64)}`);

  const formatted: string[] = [];
  let lastIndex = -1;

  for (const { index, line } of linesToRender.slice(0, maxLines)) {
    if (lastIndex !== -1 && index > lastIndex + 1) {
      formatted.push(c.dim(`   ··· ··· ${box.vertical} ⋯`));
    }
    lastIndex = index;

    const oldNum = line.oldLine != null ? String(line.oldLine).padStart(3, " ") : "   ";
    const newNum = line.newLine != null ? String(line.newLine).padStart(3, " ") : "   ";
    const gutter = c.dim(`${oldNum} ${newNum} ${box.vertical} `);

    if (line.type === "add") {
      formatted.push(`${gutter}${c.green(c.bold("+ " + line.content))}`);
    } else if (line.type === "delete") {
      formatted.push(`${gutter}${c.red(c.strikethrough("- " + line.content))}`);
    } else {
      formatted.push(`${gutter}${c.dim("  " + line.content)}`);
    }
  }

  if (linesToRender.length > maxLines) {
    formatted.push(c.dim(`   ··· ··· ${box.vertical} ... (${linesToRender.length - maxLines} more lines changed)`));
  }

  return `${topBorder}\n${formatted.join("\n")}\n${bottomBorder}`;
}
