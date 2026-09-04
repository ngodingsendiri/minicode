import { realpath, rename, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import type { Tool } from "#minicore"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"

export const moveFileTool: Tool = {
  name: "move_file",
  description:
    "Move/rename a file within workspace (atomic rename). Supports moving to new directory (auto-creates parents).",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "source path relative to cwd" },
      to: { type: "string", description: "destination path relative to cwd" },
    },
    required: ["from", "to"],
    additionalProperties: false,
  },
  async execute({ from, to }, ctx) {
    ctx.signal.throwIfAborted()
    const root = (ctx as { cwd?: string }).cwd ?? process.cwd()
    const f = from as string
    const t = to as string
    if (isPathOutsideRoot(f, root) || isPathOutsideRoot(t, root))
      throw new Error(`path outside workspace: ${f} -> ${t}`)
    if (isSensitive(f) || isSensitive(t)) throw new Error(`blocked sensitive file`)
    const absFrom = isAbsolute(f) ? resolve(f) : resolve(root, f)
    const absTo = isAbsolute(t) ? resolve(t) : resolve(root, t)
    const realFrom = await realpath(absFrom).catch(() => null)
    if (!realFrom) throw new Error(`source not found: ${f}`)
    if (isPathOutsideRoot(realFrom, await realpath(root).catch(() => root)))
      throw new Error(`symlink points outside workspace: ${f}`)
    const st = await stat(realFrom).catch(() => null)
    if (!st) throw new Error(`source not found: ${f}`)
    const realRoot = await realpath(root).catch(() => root)
    const realToDir = await realpath(dirname(absTo)).catch(() => dirname(absTo))
    const realTo = resolve(realToDir, basename(absTo))
    if (isPathOutsideRoot(realTo, realRoot)) throw new Error(`destination outside workspace: ${t}`)
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dirname(absTo), { recursive: true, mode: 0o700 }).catch(() => {})
    await rename(absFrom, absTo)
    return `moved ${f} -> ${t}`
  },
}
