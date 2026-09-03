import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

/**
 * Satu sumber lokasi DB lokal/global (dipakai sessions.db & vector.db):
 * - bila <cwd>/.minicode/<filename> sudah ada → pakai itu
 * - bila direktori <cwd>/.minicode ada (DB belum dibuat) → pakai lokal
 * - selain itu → global ~/.minicode/<filename>
 */
export function resolveDbPath(filename: string, cwd?: string): string {
  if (filename.includes("/") || filename.includes("\\") || filename.includes(".."))
    throw new Error(`invalid filename: ${filename}`)
  const baseCwd = cwd ?? process.cwd()
  const local = resolve(baseCwd, ".minicode", filename)
  const localDir = resolve(baseCwd, ".minicode")
  if (existsSync(local)) return local
  if (existsSync(localDir)) {
    try {
      mkdirSync(localDir, { recursive: true, mode: 0o700 })
    } catch {}
    return local
  }
  const global = join(homedir(), ".minicode", filename)
  try {
    mkdirSync(join(global, ".."), { recursive: true, mode: 0o700 })
  } catch {}
  return global
}
