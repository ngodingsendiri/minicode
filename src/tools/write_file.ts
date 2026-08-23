import type { Tool } from "minicore";
import { mkdir, writeFile, stat, rename, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, sep, basename } from "node:path";

const SENSITIVE_RE = /(^|[\/\\])\.env(\.|$|[\/\\])|\.git[\/\\]config|node_modules/;

function isOutsideRoot(p: string, root: string): boolean {
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (!rel) return false;
  if (isAbsolute(rel)) return true;
  return rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || rel.startsWith("..\\");
}

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
    const p = path as string;
    const root = process.cwd();
    if (isOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`);
    if (SENSITIVE_RE.test(p)) throw new Error(`blocked sensitive file: ${p}`);
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
    // resolve symlink to prevent symlink escape (parent dir + file itself)
    const realDir = await realpath(dirname(abs)).catch(() => dirname(abs));
    const fileReal = await realpath(abs).catch(() => null);
    const realAbs = fileReal ?? resolve(realDir, basename(abs));
    if (isOutsideRoot(realAbs, root)) throw new Error(`symlink points outside workspace: ${p}`);
    await mkdir(dirname(realAbs), { recursive: true });
    // guard large write
    const c = content as string;
    if (c.length > 5_000_000) throw new Error(`content too large: ${c.length} chars (max 5M)`);
    // atomic: write tmp then rename
    const tmp = `${realAbs}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, c, "utf8");
    await rename(tmp, realAbs);
    const st = await stat(realAbs).catch(() => null);
    return `wrote ${realAbs} (${st?.size ?? c.length} bytes)`;
  },
};
