// Decorasi sederhana untuk code fence markdown di TUI (tanpa parse penuh).
// ```lang ... ``` → baris pembuka berlabel + baris penutup, agar blok kode
// terlihat jelas di viewport respons.

import { highlightCode } from "./highlight.ts";

const BAR = "─".repeat(3);

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
        out.push(`${BAR} ${fenceLang || "code"} ${BAR}`);
      } else {
        inFence = false;
        fenceLang = "";
        out.push(`${BAR} end ${BAR}`);
      }
      continue;
    }
    out.push(inFence && fenceLang ? highlightCode(line, fenceLang) : line);
  }
  return out.join("\n");
}