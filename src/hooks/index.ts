import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type { ToolCall } from "minicore/core/types.ts"
import { c } from "../tui/theme.ts"

export interface Allowlist {
  allowed: string[] // entries like "bash:echo hi" or "write_file:.tmp/*"
}

const GLOBAL_ALLOW = join(homedir(), ".minicode", "allowlist.json")
const LOCAL_ALLOW = ".minicode/allowlist.json"

export async function loadAllowlist(cwd?: string): Promise<Allowlist> {
  let globalList: Allowlist = { allowed: [] }
  let localList: Allowlist = { allowed: [] }
  try {
    const txt = await readFile(GLOBAL_ALLOW, "utf8")
    const parsed = JSON.parse(txt) as Allowlist
    if (Array.isArray(parsed.allowed)) globalList = parsed
  } catch {}
  try {
    const path = resolve(cwd ?? process.cwd(), LOCAL_ALLOW)
    const txt = await readFile(path, "utf8")
    const parsed = JSON.parse(txt) as Allowlist
    if (Array.isArray(parsed.allowed)) localList = parsed
  } catch {}
  // merge global+local, dedup
  const merged = new Set<string>([...globalList.allowed, ...localList.allowed])
  return { allowed: [...merged] }
}

export async function saveAllowlist(entry: string, cwd?: string, opts: { global?: boolean } = {}) {
  const path = opts.global ? GLOBAL_ALLOW : resolve(cwd ?? process.cwd(), LOCAL_ALLOW)
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  let list: Allowlist = { allowed: [] }
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Allowlist
    if (Array.isArray(parsed.allowed)) list = parsed
  } catch {}
  if (!list.allowed.includes(entry)) list.allowed.push(entry)
  const tmp = `${path}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(list, null, 2), "utf8")
  try {
    await chmod(tmp, 0o600)
  } catch {}
  await rename(tmp, path)
  try {
    await chmod(path, 0o600)
  } catch {}
}

export function matchAllowlist(call: ToolCall, allowlist: string[]): boolean {
  const key = `${call.name}:${JSON.stringify(call.args).slice(0, 200)}`
  return allowlist.some((pat) => {
    const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$")
    if (pat.includes(":")) return re.test(key)
    return re.test(call.name) || re.test(key)
  })
}

export async function promptAsk(call: ToolCall): Promise<"allow" | "deny" | "always"> {
  if (!process.stdin.isTTY) return "deny"

  const { createInterface } = await import("node:readline")
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  const toolName = call.name
  const args = (call.args ?? {}) as Record<string, unknown>

  let actionSummary = ""
  if (args.command) actionSummary = `Command: ${String(args.command).slice(0, 100)}`
  else if (args.path) actionSummary = `File: ${String(args.path)}`
  else if (args.query) actionSummary = `Query: ${String(args.query)}`
  else actionSummary = `Args: ${JSON.stringify(args).slice(0, 100)}`

  process.stdout.write(`\n${c.warning(c.bold("Permission required"))}\n`)
  process.stdout.write(`  ${c.bold("Tool:")} ${c.info(toolName)}\n`)
  process.stdout.write(`  ${actionSummary}\n`)

  const promptText = `${c.bold("[y]")} Allow once  ${c.bold("[a]")} Always  ${c.bold("[n]")} Deny: `
  const ans: string = await new Promise((resolve) => rl.question(promptText, resolve))
  rl.close()

  const a = ans.trim().toLowerCase()
  if (a === "a" || a === "always") return "always"
  if (a === "y" || a === "yes") return "allow"
  return "deny"
}
