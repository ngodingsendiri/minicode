import { realpathSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"

// Satu sumber untuk aturan sandbox path — dipakai permission layer + setiap tool
// (defense-in-depth). File .env / .git/config / node_modules dianggap sensitif.
// v0.2.0: tambah .ssh, .aws, .npmrc, .netrc, .git/credentials, private keys, .kube.
export const SENSITIVE_RE =
  /(?:^|[/\\])(?:\.env(?:\.|$|[/\\])|\.git[/\\](?:config|credentials)|\.ssh[/\\]|\.aws[/\\]|\.npmrc(?:\.|$|[/\\])|\.netrc(?:\.|$|[/\\])|\.kube[/\\]|id_(?:rsa|ecdsa|ed25519|dsa)(?:\.(?:pub|ppk))?$)|node_modules|\.(?:pem|key|p12)$/i

export function isSensitive(p: string): boolean {
  return SENSITIVE_RE.test(p)
}

export function isPathOutsideRoot(p: string, root: string): boolean {
  if (!p) return false
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
  const rel = relative(root, abs)
  if (!rel) return false // same directory
  if (isAbsolute(rel)) return true // different drive on Windows
  return (
    rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || rel.startsWith("..\\")
  )
}

export function isCwdOutsideRoot(cwd: string, root: string): boolean {
  try {
    const realCwd = realpathSync(resolve(root, cwd))
    const realRoot = realpathSync(resolve(root))
    return isPathOutsideRoot(realCwd, realRoot)
  } catch {
    // if realpath fails (ENOENT), fallback to logical check (treated as outside to be safe if non-existent)
    return isPathOutsideRoot(cwd, root)
  }
}
