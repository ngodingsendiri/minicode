import { appendFile, mkdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { LIMITS } from "../constants.ts"
import { isPathOutsideRoot } from "../policy/jail.ts"
import { scrubSecrets } from "../policy/scrub.ts"

function tildePath(p: string): string {
  const home = homedir()
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p
}

const GLOBAL_MEM = join(homedir(), ".minicode", "MEMORY.md")
const LOCAL_MEM = ".minicode/MEMORY.md"
const ROOT_MEM = "MEMORY.md"
// Claude-like hierarchy extensions
const CLAUDE_MEM = "CLAUDE.md"

export async function loadMemoryFiles(cwd = process.cwd()): Promise<string> {
  const parts: string[] = []
  // Hierarchy: global → local → root → CLAUDE compat → rules/
  const candidates = [
    GLOBAL_MEM,
    resolve(cwd, LOCAL_MEM),
    resolve(cwd, ROOT_MEM),
    resolve(cwd, CLAUDE_MEM),
  ]
  for (const p of candidates) {
    try {
      const txt = await readFile(p, "utf8")
      if (txt.trim()) parts.push(`# ${tildePath(p)}\n${scrubSecrets(txt.slice(0, 6000))}`)
    } catch {}
  }
  // Load .minicode/rules/*.md (Kiro steering style)
  try {
    const { readdir } = await import("node:fs/promises")
    const rulesDir = resolve(cwd, ".minicode/rules")
    const entries = await readdir(rulesDir).catch(() => [] as string[])
    // entries may be string[] or Dirent — handle both
    const files: string[] =
      Array.isArray(entries) && typeof entries[0] === "string"
        ? (entries as string[]).filter((f) => f.endsWith(".md")).slice(0, 10)
        : (entries as unknown as import("node:fs").Dirent[])
            .filter((e) => e.isFile() && e.name.endsWith(".md"))
            .map((e) => e.name)
            .slice(0, 10)
    for (const f of files) {
      try {
        const full = join(rulesDir, f as string)
        if (isPathOutsideRoot(full, cwd)) continue
        const txt = await readFile(full, "utf8")
        if (txt.trim()) parts.push(`# rules/${f}\n${scrubSecrets(txt.slice(0, 3000))}`)
      } catch {}
    }
  } catch {}
  return parts.join("\n\n")
}

const MAX_MEMORY_FILE_BYTES = LIMITS.MEMORY_FILE_MAX_BYTES

export async function appendMemory(text: string, cwd = process.cwd()): Promise<string> {
  const path = resolve(cwd, LOCAL_MEM)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }).catch(() => {})
  const clean = scrubSecrets(text.trim().slice(0, 1000))
  const entry = `- ${new Date().toISOString().slice(0, 10)} ${clean}\n`
  // atomic append — no read+write race
  await appendFile(path, entry, "utf8").catch(async () => {
    // fallback if file not exists
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, entry, "utf8")
  })
  // size guard: truncate oldest if too large (keep last 150k)
  try {
    const st = await stat(path)
    if (st.size > MAX_MEMORY_FILE_BYTES) {
      const txt = await readFile(path, "utf8")
      const keep = txt.slice(-LIMITS.MEMORY_TRUNCATE_KEEP_BYTES)
      const cut = keep.indexOf("\n")
      await import("node:fs/promises").then((m) =>
        m.writeFile(path, cut >= 0 ? keep.slice(cut + 1) : keep, "utf8"),
      )
    }
  } catch {}
  return path
}

export async function readMemoryFile(cwd = process.cwd()): Promise<string> {
  return await loadMemoryFiles(cwd)
}
