import { readFile, realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
import { atomicWriteText } from "../lib/atomic-write.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"
import { flexibleMatch } from "./edit.ts"

// Apply SEARCH/REPLACE block (a la Aider) ke file. Search block harus match
// tepat sekali (dengan toleransi fuzzy). Bisa multiple patches.
export const applyPatchTool: Tool = {
  name: "apply_patch",
  description:
    "Apply SEARCH/REPLACE block(s) to file. Each search must match exactly once. Supports multiple patches in one call.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "path file relatif terhadap cwd" },
      patches: {
        type: "array",
        description: "Array of {search, replace} blocks. Diterapkan berurutan di konten yang sama.",
        items: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description: "blok kode yang akan diganti (match persis atau fuzzy)",
            },
            replace: { type: "string", description: "blok kode baru" },
          },
          required: ["search", "replace"],
          additionalProperties: false,
        },
      },
    },
    required: ["path", "patches"],
    additionalProperties: false,
  },
  async execute({ path, patches }, ctx) {
    ctx.signal.throwIfAborted()
    const p = path as string
    const root = process.cwd()
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`)
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`)
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
    const realDir = await realpath(dirname(abs)).catch(() => dirname(abs))
    const fileReal = await realpath(abs).catch(() => null)
    const realAbs = fileReal ?? resolve(realDir, basename(abs))
    if (isPathOutsideRoot(realAbs, root)) throw new Error(`symlink points outside workspace: ${p}`)
    const st = await stat(realAbs).catch(() => null)
    if (!st) throw new Error(`file not found: ${p}`)
    if (st.size > LIMITS.READ_FILE_MAX_BYTES) throw new Error(`file too large: ${p} (${st.size})`)

    let content = await readFile(realAbs, "utf8")
    const patchList = patches as { search: string; replace: string }[]
    const applied: string[] = []

    for (let i = 0; i < patchList.length; i++) {
      ctx.signal.throwIfAborted()
      const { search: oldS, replace: newS } = patchList[i]!
      if (oldS === newS) {
        applied.push(`[${i}] skipped: oldString == newString`)
        continue
      }
      const match = flexibleMatch(content, oldS)
      if (!match) throw new Error(`patch[${i}]: search block not found in ${p}`)
      // ensure uniqueness (exact/crlf mode only)
      if (match.mode === "exact" || match.mode === "crlf") {
        const second = flexibleMatch(content.slice(match.end), oldS)
        if (second && (second.mode === "exact" || second.mode === "crlf")) {
          throw new Error(
            `patch[${i}]: search block found multiple times in ${p} — provide more context`,
          )
        }
      }
      content = content.slice(0, match.start) + newS + content.slice(match.end)
      const note = match.mode !== "exact" ? ` (${match.mode} match)` : ""
      applied.push(`[${i}] replaced ${oldS.length} → ${newS.length} chars${note}`)
    }

    if (content.length > LIMITS.WRITE_FILE_MAX_CHARS)
      throw new Error(`result too large: ${content.length} chars (max 5M)`)

    await atomicWriteText(realAbs, content)

    return `applied ${applied.length} patch(es) to ${realAbs}:\n${applied.join("\n")}`
  },
}
