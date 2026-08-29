import { readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"

const MAX_INJECT = 2_000

/** Ambil @mentions dari line → ganti dengan blok konteks file. */
export function parseMentions(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(/@([^\s]+)/g)) {
    const p = m[1]!
    if (p.startsWith(".") && !p.startsWith("./")) continue // @.env dsb
    out.push(p)
  }
  return out
}

export async function resolveMentionContent(
  raw: string,
  cwd: string,
): Promise<{ ok: true; content: string } | { ok: false; reason: string }> {
  const abs = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw)
  if (isPathOutsideRoot(abs, cwd) || isSensitive(abs))
    return { ok: false, reason: "ditolak (jail)" }
  try {
    const txt = await readFile(abs, "utf8")
    const rel = relative(cwd, abs).replace(/\\/g, "/")
    const body = txt.length > MAX_INJECT ? txt.slice(0, MAX_INJECT) + "\n… (truncated)" : txt
    return { ok: true, content: `\n[file: ${rel}]\n${body}\n[/file]\n` }
  } catch {
    return { ok: false, reason: "file tidak ditemukan" }
  }
}

export async function expandMentions(
  line: string,
  cwd: string,
): Promise<{ prompt: string; notes: string[] }> {
  const notes: string[] = []
  let prompt = line
  for (const p of parseMentions(line)) {
    const r = await resolveMentionContent(p, cwd)
    if (r.ok) prompt = prompt.replace(`@${p}`, r.content)
    else notes.push(`@${p}: ${r.reason}`)
  }
  return { prompt, notes }
}
