import type { Tool } from "minicore";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const editTool: Tool = {
  name: "edit",
  description: "Edit file dengan exact string replacement. oldString harus ada tepat sekali, newString menggantikannya. Untuk banyak replace, panggil berulang.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string", description: "teks lama yang akan diganti (harus match persis)" },
      newString: { type: "string", description: "teks baru" },
    },
    required: ["path", "oldString", "newString"],
    additionalProperties: false,
  },
  async execute({ path, oldString, newString }, ctx) {
    ctx.signal.throwIfAborted();
    const abs = resolve(path as string);
    const content = await readFile(abs, "utf8").catch(() => {
      throw new Error(`file not found: ${path}`);
    });
    const oldS = oldString as string;
    const newS = newString as string;
    if (oldS === newS) throw new Error("oldString == newString (no change)");
    const idx = content.indexOf(oldS);
    if (idx === -1) throw new Error(`oldString not found in ${path}`);
    // ensure uniqueness
    if (content.indexOf(oldS, idx + 1) !== -1) {
      throw new Error(`oldString found multiple times in ${path} — provide more surrounding lines to make it unique`);
    }
    const next = content.slice(0, idx) + newS + content.slice(idx + oldS.length);
    await writeFile(abs, next, "utf8");
    return `edited ${abs} (${oldS.length} → ${newS.length} chars)`;
  },
};
