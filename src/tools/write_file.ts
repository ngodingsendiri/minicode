import { realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
import { atomicWriteText } from "../lib/atomic-write.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"
import { appendLspDiagnostics } from "../policy/verifier.ts"

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Create/overwrite a file with text content. Creates parent directories automatically.",
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
    ctx.signal.throwIfAborted()
    const p = path as string
    const root = (ctx as { cwd?: string }).cwd ?? process.cwd()
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`)
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`)
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
    // resolve symlink to prevent symlink escape (parent dir + file itself)
    const realRoot = await realpath(root).catch(() => root)
    const realDir = await realpath(dirname(abs)).catch(() => dirname(abs))
    const fileReal = await realpath(abs).catch(() => null)
    const realAbs = fileReal ?? resolve(realDir, basename(abs))
    if (isPathOutsideRoot(realAbs, realRoot))
      throw new Error(`symlink points outside workspace: ${p}`)
    // guard large write — chars vs bytes (emoji/CJK 4x)
    const c = content as string
    if (c.length > LIMITS.WRITE_FILE_MAX_CHARS)
      throw new Error(`content too large: ${c.length} chars (max 5M)`)
    if (Buffer.byteLength(c, "utf8") > LIMITS.WRITE_FILE_MAX_CHARS * 4)
      throw new Error(`content too large: ${Buffer.byteLength(c, "utf8")} bytes > ~20M`)
    // atomic: write tmp (O_EXCL + randomUUID) then rename — anti-hijack & atomic
    await atomicWriteText(realAbs, c)
    const st = await stat(realAbs).catch(() => null)
    const base = `wrote ${realAbs} (${st?.size ?? c.length} bytes)`
    return await appendLspDiagnostics(realAbs, c, base)
  },
}
