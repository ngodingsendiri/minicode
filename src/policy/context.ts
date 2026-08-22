import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import type { TokenEstimator } from "minicore";
import { DEFAULT_CHARS_PER_TOKEN } from "../../../minicore/src/core/tokens.ts";

// C5 fix: image-aware estimator — base64 size ~ bytes*4/3
export const minicodeEstimator: TokenEstimator = (text: string) => Math.ceil(text.length / DEFAULT_CHARS_PER_TOKEN);

export function estimateImageTokens(bytes: number): number {
  const b64 = Math.ceil((bytes * 4) / 3);
  return Math.ceil(b64 / DEFAULT_CHARS_PER_TOKEN);
}

export async function buildSystemPrompt(opts: { cwd?: string; extra?: string } = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const parts: string[] = [];
  parts.push("You are Minicode, a coding agent built on MiniCore. Use tools to read, edit, search, and run code. Be concise, deterministic.");
  // try load AGENTS.md
  for (const p of ["AGENTS.md", "CLAUDE.md", ".cursorrules"]) {
    try {
      const txt = await readFile(`${cwd}/${p}`, "utf8");
      parts.push(`\n# ${p}\n${txt.slice(0, 4000)}`);
      break;
    } catch {}
  }
  // git ls-files preamble (non-blocking)
  try {
    const files = execSync("git ls-files", { cwd, encoding: "utf8", timeout: 2000 }).trim().split("\n").slice(0, 80).join("\n");
    if (files) parts.push(`\n# Repo files (sample)\n${files}`);
  } catch {}
  if (opts.extra) parts.push(opts.extra);
  return parts.join("\n\n");
}
