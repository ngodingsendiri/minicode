import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import type { Tool } from "minicore"
import { LIMITS } from "../constants.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"
import { scrubSecrets } from "../policy/scrub.ts"

async function walkGrep(
  dir: string,
  re: RegExp,
  out: string[],
  root: string,
  limit: number,
  signal: AbortSignal,
  includeRe?: RegExp | null,
) {
  if (signal.aborted) throw new Error("aborted")
  if (out.length >= limit) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (out.length >= limit) break
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".git") continue
    const full = join(dir, e.name)
    const rel = relative(root, full).replace(/\\/g, "/")
    if (e.isDirectory()) {
      await walkGrep(full, re, out, root, limit, signal, includeRe)
    } else {
      if (includeRe && !includeRe.test(rel) && !includeRe.test(e.name)) continue
      if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|exe|dll|bin)$/i.test(e.name)) continue
      // symlink file escape check — resolve realpath and jail
      const real = await realpath(full).catch(() => full)
      if (isPathOutsideRoot(real, resolve(root)) || isSensitive(real) || isSensitive(rel)) continue
      // also skip if symlink points outside (already covered) or sensitive
      const st = await stat(real).catch(() => null)
      if (!st || st.size > 1_000_000) continue
      const text = await readFile(real, "utf8").catch(() => "")
      if (text.includes("\0")) continue
      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        if (re.test(lines[i]!)) {
          out.push(`${rel}:${i + 1}: ${scrubSecrets(lines[i]!.slice(0, 300))}`)
          if (out.length >= limit) break
        }
      }
    }
  }
}

function includeToRegExp(include: string): RegExp | null {
  if (!include) return null
  let esc = include.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  esc = esc.replace(/\*\*/g, "§§")
  esc = esc.replace(/\*/g, "[^/]*")
  esc = esc.replace(/§§/g, ".*")
  esc = esc.replace(/\?/g, ".")
  return new RegExp("^" + esc + "$")
}

export const grepTool: Tool = {
  name: "grep",
  description: "Search regex di file (ripgrep-like). Mengembalikan file:line: content.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "regex, mis log.*Error" },
      cwd: { type: "string", description: "root dir default '.'" },
      include: { type: "string", description: "filter file glob, mis *.ts" },
      limit: { type: "number" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute({ pattern, cwd, include, limit }, ctx) {
    const root = (cwd as string) ?? "."
    if (isPathOutsideRoot(root, process.cwd())) throw new Error(`cwd outside workspace: ${root}`)
    const lim = Math.min(
      Math.max((limit as number) ?? LIMITS.SEARCH_DEFAULT_LIMIT, 1),
      LIMITS.SEARCH_MAX_LIMIT,
    )
    let re: RegExp
    try {
      re = new RegExp(pattern as string)
    } catch (e) {
      throw new Error(`invalid regex: ${(e as Error).message}`)
    }
    const incRe = include ? includeToRegExp(include as string) : null
    const out: string[] = []
    await walkGrep(root, re, out, root, lim, ctx.signal, incRe)
    if (out.length === 0)
      return `no matches for /${pattern}/ in ${root}${include ? ` (include ${include})` : ""}`
    return out.join("\n")
  },
}
