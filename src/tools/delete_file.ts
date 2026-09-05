import { realpath, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { Tool } from "#minicore"
import { trashFile } from "../lib/trash.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"

export const deleteFileTool: Tool = {
  name: "delete_file",
  description:
    "Delete a file (soft-delete to .minicode/.trash/ with undo via move). Use for removing files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "path file relatif" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute({ path }, ctx) {
    ctx.signal.throwIfAborted()
    const p = path as string
    const root = (ctx as { cwd?: string }).cwd ?? process.cwd()
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`)
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`)
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
    const real = await realpath(abs).catch(() => null)
    if (!real) throw new Error(`file not found: ${p}`)
    if (isPathOutsideRoot(real, await realpath(root).catch(() => root)))
      throw new Error(`symlink points outside workspace: ${p}`)
    const st = await stat(real).catch(() => null)
    if (!st) throw new Error(`file not found: ${p}`)
    if (st.isDirectory()) throw new Error(`path is directory, use bash rm -r: ${p}`)
    // soft-delete ke .minicode/.trash (gitignored, cap 100) — restore via move_file
    const dest = await trashFile(root, abs)
    return `deleted ${p} -> ${dest} (soft-delete, restore via move_file if needed)`
  },
}
