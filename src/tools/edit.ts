import type { Tool } from "minicore";
import { readFile, writeFile, stat, rename, realpath } from "node:fs/promises";
import { resolve, isAbsolute, dirname, basename } from "node:path";
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts";

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
    const p = path as string;
    const root = process.cwd();
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`);
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`);
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
    // resolve symlink to prevent symlink escape (parent dir + file itself)
    const realDir = await realpath(dirname(abs)).catch(() => dirname(abs));
    const fileReal = await realpath(abs).catch(() => null);
    const realAbs = fileReal ?? resolve(realDir, basename(abs));
    if (isPathOutsideRoot(realAbs, root)) throw new Error(`symlink points outside workspace: ${p}`);
    const st = await stat(realAbs).catch(() => null);
    if (!st) throw new Error(`file not found: ${p}`);
    if (st.size > 2_000_000) throw new Error(`file too large: ${p} (${st.size})`);
    const content = await readFile(realAbs, "utf8").catch(() => {
      throw new Error(`file not found: ${p}`);
    });
    const oldS = oldString as string;
    const newS = newString as string;
    if (oldS === newS) throw new Error("oldString == newString (no change)");
    const idx = content.indexOf(oldS);
    if (idx === -1) throw new Error(`oldString not found in ${p}`);
    // ensure uniqueness
    if (content.indexOf(oldS, idx + 1) !== -1) {
      throw new Error(`oldString found multiple times in ${p} — provide more surrounding lines to make it unique`);
    }
    const next = content.slice(0, idx) + newS + content.slice(idx + oldS.length);
    if (next.length > 5_000_000) throw new Error(`result too large: ${next.length} chars (max 5M)`);
    // atomic
    const tmp = `${realAbs}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, next, "utf8");
    await rename(tmp, realAbs);
    return `edited ${realAbs} (${oldS.length} → ${newS.length} chars)`;
  },
};
