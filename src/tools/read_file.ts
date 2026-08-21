import type { Tool } from "minicore";
import { readFile, stat } from "node:fs/promises";

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
    const st = await stat(path).catch(() => null);
    if (!st) throw new Error(`file not found: ${path}`);
    if (st.size > 2_000_000) throw new Error(`file too large: ${path} (${st.size})`);
    return await readFile(path, "utf8");
  },
};
