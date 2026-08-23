import { readFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, isAbsolute, sep } from "node:path";
import type { TokenEstimator } from "minicore";
import { DEFAULT_CHARS_PER_TOKEN } from "../../../minicore/src/core/tokens.ts";
import { loadMemoryFiles } from "../memory/files.ts";

const execAsync = promisify(exec);

export const minicodeEstimator: TokenEstimator = (text: string) => Math.ceil(text.length / DEFAULT_CHARS_PER_TOKEN);

// helper for image content: base64 overhead 4/3 — use when estimating tool image results
export function estimateImageTokens(bytes: number): number {
  const b64 = Math.ceil((bytes * 4) / 3);
  return Math.ceil(b64 / DEFAULT_CHARS_PER_TOKEN);
}

const MAX_SYSTEM_CHARS = 8000;

function isPathOutsideRoot(p: string, root: string): boolean {
  if (!p) return true;
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (!rel) return false;
  if (isAbsolute(rel)) return true;
  return rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || rel.startsWith("..\\");
}

export async function buildSystemPrompt(opts: { cwd?: string; extra?: string } = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const parts: string[] = [];
  parts.push("You are Minicode, a coding agent built on MiniCore. Use tools to read, edit, search, and run code. Be concise, deterministic.");
  // load MEMORY.md (project + global hybrid) — capped
  try {
    const mem = await loadMemoryFiles(cwd);
    if (mem.trim()) parts.push(`\n# MEMORY (hybrid RAG)\n${mem.slice(0, 4000)}`);
  } catch {}
  // try load AGENTS.md
  for (const p of ["AGENTS.md", "CLAUDE.md", ".cursorrules"]) {
    try {
      const txt = await readFile(`${cwd}/${p}`, "utf8");
      parts.push(`\n# ${p}\n${txt.slice(0, 3000)}`);
      break;
    } catch {}
  }
  // git ls-files — async, non-blocking, 2s timeout, jail cwd
  if (!isPathOutsideRoot(cwd, process.cwd())) {
    try {
      const { stdout } = await execAsync("git ls-files", { cwd, timeout: 2000, encoding: "utf8" } as unknown as never);
      const files = (stdout as unknown as string).trim().split("\n").slice(0, 80).join("\n");
      if (files) parts.push(`\n# Repo files (sample)\n${files}`);
    } catch {}
  }
  if (opts.extra) parts.push(opts.extra);
  const full = parts.join("\n\n");
  // single total budget — keep system prompt lean
  if (full.length > MAX_SYSTEM_CHARS) return full.slice(0, MAX_SYSTEM_CHARS);
  return full;
}
