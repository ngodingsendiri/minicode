import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

/**
 * Subset jujur .gitignore — nama persis, `*.ext`, prefix `dir/`.
 * Tanpa negasi `!` (didokumentasikan sebagai batas). Dipakai glob/grep
 * agar tidak memuntahkan `node_modules`/`dist` yang tak relevan meski
 * walker sudah skip hard-coded.
 * Pure kecuali load di helper; matcher bisa diuji tanpa FS.
 */
export function compileIgnoreMatchers(patterns: string[]): ((rel: string) => boolean)[] {
  const matchers: ((rel: string) => boolean)[] = []
  for (const raw of patterns) {
    const pat = raw.trim()
    if (!pat || pat.startsWith("#") || pat.startsWith("!")) continue
    const isDir = pat.endsWith("/")
    const core = isDir ? pat.slice(0, -1) : pat
    const hasSlash = core.includes("/")
    const normalized = core.replace(/^\//, "")
    // Build regex via glob simple: * -> [^/]*, ** -> .*
    const escape = (s: string) =>
      s
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".")
    if (hasSlash) {
      // path pattern: cocok terhadap rel path (anchored)
      const re = new RegExp(`^${escape(normalized)}${isDir ? "(?:/.*)?" : ""}$`)
      matchers.push((rel) => re.test(rel))
    } else {
      // basename pattern: cocok bagian mana pun
      const re = new RegExp(`^${escape(normalized)}$`)
      matchers.push((rel) => {
        const parts = rel.split("/")
        if (isDir) return parts.includes(normalized) || re.test(parts[parts.length - 1] ?? "")
        return parts.some((seg) => re.test(seg))
      })
    }
  }
  return matchers
}

export function isIgnored(rel: string, matchers: ((rel: string) => boolean)[]): boolean {
  for (const m of matchers) if (m(rel)) return true
  return false
}

export async function loadIgnoreMatchers(root: string): Promise<((rel: string) => boolean)[]> {
  try {
    const txt = await readFile(resolve(root, ".gitignore"), "utf8")
    const lines = txt.split("\n")
    return compileIgnoreMatchers(lines)
  } catch {
    return []
  }
}
