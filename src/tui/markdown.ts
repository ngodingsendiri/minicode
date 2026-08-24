// Markdown decoration — Ubuntu Server style.
// Code fence → indentasi 2-space dengan syntax highlight (tanpa separator).

import { highlightCode } from "./highlight.ts";

export function decorateMarkdown(text: string): string {
  if (!text.includes("```") && !text.includes("~~~")) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceLang = "";
  for (const line of lines) {
    const fence = /^\s*(```+|~~~+)([A-Za-z0-9_+.-]*)\s*$/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = fence[2] ?? "";
        continue;
      }
      inFence = false;
      fenceLang = "";
      continue;
    }
    out.push(inFence && fenceLang ? "  " + highlightCode(line, fenceLang) : line);
  }
  return out.join("\n");
}
