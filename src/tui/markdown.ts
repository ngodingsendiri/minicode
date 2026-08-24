// Markdown decoration — Ubuntu Server style.
// Heading → bold, bullet → indentasi, code fence → indentasi + syntax highlight.

import { highlightCode } from "./highlight.ts";
import { c } from "./theme.ts";

export function decorateMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceLang = "";

  for (const line of lines) {
    // Code fence handling
    const fence = /^\s*(```+|~~~+)([A-Za-z0-9_+.-]*)\s*$/.exec(line);
    if (fence) {
      inFence = !inFence;
      fenceLang = inFence ? (fence[2] ?? "") : "";
      continue;
    }

    // Inside code fence → indentasi + syntax highlight
    if (inFence && fenceLang) {
      out.push("  " + highlightCode(line, fenceLang));
      continue;
    }

    // Headings (# ## ###) → bold
    if (/^#{1,3}\s/.test(line)) {
      out.push(c.bold(line));
      continue;
    }

    // Bullet list → indentasi
    if (/^\s*[-*]\s/.test(line)) {
      out.push("  " + line.trimStart());
      continue;
    }

    out.push(line);
  }
  return out.join("\n");
}
