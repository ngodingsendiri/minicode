import type { Tool } from "minicore";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { isPathOutsideRoot } from "../policy/jail.ts";

async function walkGrep(
  dir: string,
  re: RegExp,
  out: string[],
  root: string,
  limit: number,
  signal: AbortSignal,
  includeRe?: RegExp | null,
) {
  if (signal.aborted) throw new Error("aborted");
  if (out.length >= limit) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (out.length >= limit) break;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".git") continue;
    const full = join(dir, e.name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (e.isDirectory()) {
      await walkGrep(full, re, out, root, limit, signal, includeRe);
    } else {
      if (includeRe && !includeRe.test(rel) && !includeRe.test(e.name)) continue;
      if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|exe|dll|bin)$/i.test(e.name)) continue;
      const st = await stat(full).catch(() => null);
      if (!st || st.size > 1_000_000) continue;
      const text = await readFile(full, "utf8").catch(() => "");
      if (text.includes("\0")) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i]!)) {
          out.push(`${rel}:${i + 1}: ${lines[i]!.slice(0, 300)}`);
          if (out.length >= limit) break;
        }
      }
    }
  }
}

function includeToRegExp(include: string): RegExp | null {
  if (!include) return null;
  let esc = include.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  esc = esc.replace(/\*\*/g, "§§");
  esc = esc.replace(/\*/g, "[^/]*");
  esc = esc.replace(/§§/g, ".*");
  esc = esc.replace(/\?/g, ".");
  return new RegExp("^" + esc + "$");
}

export const grepTool: Tool = {
  name: "grep",
  description: "Cari regex di file (ripgrep-like). Mengembalikan file:line: content.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "regex, mis log.*Error" },
      cwd: { type: "string", description: "root dir default '.'" },
      include: { type: "string", description: "filter file glob, mis *.ts" },
      limit: { type: "number" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute({ pattern, cwd, include, limit }, ctx) {
    const root = (cwd as string) ?? ".";
    if (isPathOutsideRoot(root, process.cwd())) throw new Error(`cwd outside workspace: ${root}`);
    const lim = Math.min(Math.max((limit as number) ?? 100, 1), 500);
    let re: RegExp;
    try {
      re = new RegExp(pattern as string);
    } catch (e) {
      throw new Error(`invalid regex: ${(e as Error).message}`);
    }
    const incRe = include ? includeToRegExp(include as string) : null;
    const out: string[] = [];
    await walkGrep(root, re, out, root, lim, ctx.signal, incRe);
    if (out.length === 0) return `no matches for /${pattern}/ in ${root}${include ? ` (include ${include})` : ""}`;
    return out.join("\n");
  },
};
