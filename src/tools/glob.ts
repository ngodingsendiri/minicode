import type { Tool } from "minicore";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

async function walk(dir: string, pattern: RegExp, out: string[], root: string, limit: number, signal: AbortSignal) {
  if (signal.aborted) throw new Error("aborted");
  if (out.length >= limit) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (out.length >= limit) break;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".git") continue;
    const full = join(dir, e.name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (e.isDirectory()) {
      await walk(full, pattern, out, root, limit, signal);
    } else if (pattern.test(rel) || pattern.test(e.name)) {
      out.push(rel);
    }
  }
}

function globToRegExp(glob: string): RegExp {
  // very small subset: * => [^/]*, ** => .*, ? => ., {a,b} handled naively
  let esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  esc = esc.replace(/\*\*/g, "§§");
  esc = esc.replace(/\*/g, "[^/]*");
  esc = esc.replace(/§§/g, ".*");
  esc = esc.replace(/\?/g, ".");
  return new RegExp("^" + esc + "$");
}

export const globTool: Tool = {
  name: "glob",
  description: "Cari file dengan glob pattern (mis **/*.ts, src/**/*.js). Mengembalikan daftar path relatif.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "glob seperti **/*.ts" },
      cwd: { type: "string", description: "direktori root, default '.'" },
      limit: { type: "number", description: "max hasil, default 100" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute({ pattern, cwd, limit }, ctx) {
    const root = (cwd as string) ?? ".";
    const lim = Math.min(Math.max((limit as number) ?? 100, 1), 500);
    const re = globToRegExp(pattern as string);
    const out: string[] = [];
    await walk(root, re, out, root, lim, ctx.signal);
    const st = await stat(root).catch(() => null);
    if (!st) return `cwd not found: ${root}`;
    if (out.length === 0) return `no files match ${pattern} in ${root}`;
    return out.slice(0, lim).join("\n");
  },
};
