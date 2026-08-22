import type { Tool } from "minicore";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

async function walkGrep(
  dir: string,
  re: RegExp,
  out: string[],
  root: string,
  limit: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new Error("aborted");
  if (out.length >= limit) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (out.length >= limit) break;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".git") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walkGrep(full, re, out, root, limit, signal);
    } else {
      // skip binary by extension
      if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|exe|dll|bin)$/i.test(e.name)) continue;
      const st = await stat(full).catch(() => null);
      if (!st || st.size > 1_000_000) continue;
      const text = await readFile(full, "utf8").catch(() => "");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          const rel = relative(root, full);
          out.push(`${rel}:${i + 1}: ${lines[i]!.slice(0, 300)}`);
          if (out.length >= limit) break;
        }
      }
    }
  }
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
  async execute({ pattern, cwd, limit }, ctx) {
    const root = (cwd as string) ?? ".";
    const lim = Math.min(Math.max((limit as number) ?? 100, 1), 500);
    let re: RegExp;
    try {
      re = new RegExp(pattern as string);
    } catch (e) {
      throw new Error(`invalid regex: ${(e as Error).message}`);
    }
    const out: string[] = [];
    await walkGrep(root, re, out, root, lim, ctx.signal);
    if (out.length === 0) return `no matches for /${pattern}/ in ${root}`;
    return out.join("\n");
  },
};
