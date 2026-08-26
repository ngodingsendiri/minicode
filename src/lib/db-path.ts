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
  const local = resolve(cwd ?? process.cwd(), ".minicode", filename)
  const localDir = resolve(cwd ?? process.cwd(), ".minicode")
  if (existsSync(local)) return local
  if (existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true })
    return local
  }
  const global = join(homedir(), ".minicode", filename)
  mkdirSync(join(global, ".."), { recursive: true })
  return global
}
