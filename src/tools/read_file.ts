import type { Tool } from "minicore";
import { readFile, stat, realpath } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts";

// defense-in-depth: also jail inside tool (permission layer is primary)

export const readFileTool: Tool = {
  name: "read_file",
  description: "Baca isi file teks dalam workspace",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "path relatif" } },
    required: ["path"],
    additionalProperties: false,
  },
  async execute({ path }, ctx) {
    ctx.signal.throwIfAborted();
    const p = path as string;
    const root = process.cwd();
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`);
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`);
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
    // resolve symlink target — prevent symlink escape out of workspace
    const real = await realpath(abs).catch(() => abs);
    if (isPathOutsideRoot(real, root)) throw new Error(`symlink points outside workspace: ${p}`);
    const st = await stat(abs).catch(() => null);
    if (!st) throw new Error(`file not found: ${p}`);
    if (st.size > 2_000_000) throw new Error(`file too large: ${p} (${st.size})`);
    return await readFile(abs, "utf8");
  },
};
