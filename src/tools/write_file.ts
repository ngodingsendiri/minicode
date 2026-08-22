import type { Tool } from "minicore";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Buat/timpa file dengan konten teks. Buat direktori induk otomatis.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "path file relatif terhadap cwd" },
      content: { type: "string", description: "konten file" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute({ path, content }, ctx) {
    ctx.signal.throwIfAborted();
    const abs = resolve(path as string);
    await mkdir(dirname(abs), { recursive: true });
    // guard large write
    const c = content as string;
    if (c.length > 5_000_000) throw new Error(`content too large: ${c.length} chars (max 5M)`);
    await writeFile(abs, c, "utf8");
    const st = await stat(abs).catch(() => null);
    return `wrote ${abs} (${st?.size ?? c.length} bytes)`;
  },
};
