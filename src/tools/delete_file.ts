import { randomUUID } from "node:crypto"
import { mkdir, realpath, rename, stat } from "node:fs/promises"
import { basename, isAbsolute, join, resolve } from "node:path"
import type { Tool } from "#minicore"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"

export const deleteFileTool: Tool = {
  name: "delete_file",
  description: "Delete a file (soft-delete to .trash/ with undo via move). Use for removing files.",
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
    // soft-delete: pindah ke .trash/<uuid>-<basename>
    const trashDir = join(root, ".trash")
    await mkdir(trashDir, { recursive: true, mode: 0o700 }).catch(() => {})
    const dest = join(trashDir, `${randomUUID().slice(0, 8)}-${basename(abs)}`)
    await rename(abs, dest)
    return `deleted ${p} -> ${dest} (soft-delete, restore via move_file if needed)`
  },
}
