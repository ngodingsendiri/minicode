import { resolve } from "node:path"
import { cwd } from "node:process"
import type { PermissionHandler, ToolCall } from "minicore"
import { loadAllowlist, matchAllowlist, promptAsk, saveAllowlist } from "../hooks/index.ts"
import { isCwdOutsideRoot, isRealPathOutsideRoot, isSensitive } from "./jail.ts"

export type PermissionMode = "auto" | "readonly" | "plan" | "allow-all" | "ask" | "allowlist"

const READONLY_TOOLS = new Set([
  "read_file",
  "glob",
  "grep",
  "git_status",
  "git_diff",
  "git_log",
  "web_fetch",
  "read_memory",
  "mcp_list",
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_symbols",
  "lsp_workspace_symbols",
])

// Tool yang memperbesar serangan / menembus dunia luar: tidak auto-allowed.
const GATED_TOOLS = new Set(["delegate_task", "mcp_call"])

const BASH_DENY_RE = [
  /rm\s+[^;|]*-r[f]*\s+[^;|]*(\/\*?|~|(\$HOME|\$\{HOME\})|--no-preserve-root)/i,
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;/,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\bshred\b/i,
  /\btruncate\b/i,
  /\bmv\s+[^;|]*\s+\/(?:etc|boot|usr|lib)\b/i,
  /\bsudo\b.*\brm\b/i,
  /\bcurl\b.*\|\s*sh/i,
  /\bwget\b.*\|\s*sh/i,
  /\bcurl\b.*\|\s*bash/i,
  /\bwget\b.*\|\s*bash/i,
  /\bpowershell\b.*-EncodedCommand/i,
  />\s*\/dev\/sda/i,
  />\s*\/dev\/nvme/i,
  /:\s*>\s*\/dev\/null.*&/i,
  /\b(?:python|python2|python3|pypy)\s+-c\b/i,
  /\b(?:sh|bash|dash|zsh|ksh)\s+-c\b/i,
  /\b(?:node|perl)\s+-(?:e|pe|ne)\b/i,
  /\bphp\s+-r\b/i,
  /\bruby\s+-e\b/i,
  /(?:^|[;&|]\s*)(?:base64|xxd)[^\n]*\|\s*(?:sh|bash|python|python3|node|perl)\b/i,
  /\bawk\b[^\n]*\bsystem\s*\(/i,
  /\b(?:curl|wget)\b[^\n]*\|\s*(?:python|python3|node|perl|php)\b/i,
  /\bprintenv\b/i,
  /\b(?:cat|less|more|head|tail|type|grep|sed|awk|cut|sort|xargs)\b[^\n]*\.env/i,
  // Windows destructive / credential exfiltration
  /\bdel\b.*\/[sfaq]/i,
  /\brmdir\b.*\/s/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\b(?:Get-Content|type)\b[^\n]*\.env/i,
  /\[System\.IO\.File\]::ReadAllText/i,
  /\b(?:Invoke-Expression|iex)\b/i,
  /\bInvoke-WebRequest\b.*\|\s*iex/i,
]

const DEFAULT_BASH_ALLOWLIST = [
  "git status*",
  "git diff*",
  "git log*",
  "git branch*",
  "bun test*",
  "bun x tsc*",
  "npm run *",
  "npm exec *",
  "npx *",
  "bun run *",
  "echo *",
  "ls*",
  "cat *",
]

// 6.4 — npm exec / npx hanya di-allow bila arg "known-good": tak ada
// ekspansi shell ($/backtick) atau redirection (< >). Chaining ;|& sudah
// diblokir oleh matchBashAllowlist (pattern tak mengandungnya).
function npmNpxSafe(cmd: string): boolean {
  return !/[`$<>]/.test(cmd)
}

function matchBashAllowlist(cmd: string, pattern: string): boolean {
  // prevent shell chaining bypass: if cmd contains ; & | and pattern does not explicitly allow them, deny
  const trimmed = cmd.trim()
  if (/[;&|]/.test(trimmed) && !/[;&|]/.test(pattern)) return false
  const re = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    "i",
  )
  return re.test(trimmed)
}

export function createPermissionHandler(
  opts: { mode?: PermissionMode; root?: string } = {},
): PermissionHandler {
  const state = { mode: (opts.mode ?? "auto") as PermissionMode }
  const root = resolve(opts.root ?? cwd())
  let allowlistCache: string[] | null = null
  // bash allowlist di-cache sekali (bukan baca env tiap panggilan)
  const envRaw = process.env.MINICODE_BASH_ALLOWLIST
  const bashAllowlist = envRaw
    ? envRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_BASH_ALLOWLIST

  async function getAllowlist(): Promise<string[]> {
    if (allowlistCache) return allowlistCache
    try {
      const l = await loadAllowlist(root)
      allowlistCache = l.allowed
      return allowlistCache
    } catch {
      return []
    }
  }

  function isGated(name: string): boolean {
    // Semua tool bertitik (MCP — terdaftar maupun tidak) = gated. Server jahat
    // tidak boleh mendapat auto-allow hanya karena namanya terdaftar.
    return GATED_TOOLS.has(name) || name.includes(".")
  }

  function bashDenied(cmd: string): boolean {
    for (const re of BASH_DENY_RE) if (re.test(cmd)) return true
    return false
  }

  function saveAlways(call: ToolCall): Promise<void> {
    const key = `${call.name}:${JSON.stringify(call.args).slice(0, 200)}`
    allowlistCache = null
    return saveAllowlist(key, root).catch(() => {})
  }

  // data-driven: tiap mode = satu fungsi keputusan (tanpa cabang saling tumpang tindih)
  const handlers: Record<
    PermissionMode,
    (call: ToolCall, args: Record<string, unknown> | null) => Promise<"allow" | "deny">
  > = {
    "allow-all": async () => "allow",
    readonly: async (call) => (READONLY_TOOLS.has(call.name) ? "allow" : "deny"),
    plan: async (call) => (READONLY_TOOLS.has(call.name) ? "allow" : "deny"),
    allowlist: async (call, args) => {
      if (call.name === "bash") {
        const cmd = (args?.cmd as string) ?? ""
        if (!cmd.trim() || bashDenied(cmd)) return "deny"
        const matched = bashAllowlist.filter((pat) => matchBashAllowlist(cmd, pat))
        if (matched.length === 0) return "deny"
        if (matched.some((p) => /^(npx|npm exec)\b/i.test(p)) && !npmNpxSafe(cmd)) return "deny"
        return "allow"
      }
      if (isGated(call.name)) return "deny"
      if (call.name === "write_file" || call.name === "edit" || call.name === "apply_patch")
        return "allow"
      if (call.name === "write_memory" || call.name === "forget_memory") return "allow"
      return READONLY_TOOLS.has(call.name) ? "allow" : "deny"
    },
    ask: async (call, args) => {
      if (READONLY_TOOLS.has(call.name)) return "allow"
      const list = await getAllowlist()
      if (matchAllowlist(call, list)) return "allow"
      if (call.name === "bash") {
        const cmd = (args?.cmd as string) ?? ""
        if (!cmd.trim() || bashDenied(cmd)) return "deny"
      } else if (isGated(call.name)) {
        return await promptAskOr(call, () => "deny")
      }
      const ans = await promptAsk(call)
      if (ans === "always") {
        await saveAlways(call)
        return "allow"
      }
      return ans === "allow" ? "allow" : "deny"
    },
    auto: async (call, args) => {
      if (READONLY_TOOLS.has(call.name)) return "allow"
      if (isGated(call.name)) return await promptAskOr(call, () => "deny")
      if (call.name === "write_file" || call.name === "edit" || call.name === "apply_patch")
        return "allow"
      if (call.name === "write_memory" || call.name === "forget_memory") return "allow"
      if (call.name === "bash") {
        const cmd = (args?.cmd as string) ?? ""
        if (!cmd.trim() || bashDenied(cmd)) return "deny"
        return "allow"
      }
      return "deny"
    },
  }

  const returned = {
    async check(call: ToolCall, _deps?: unknown): Promise<"allow" | "deny"> {
      const earlyArgs = call.args as Record<string, unknown> | null

      // universal file-path jail — harus sebelum allow-all (defense-in-depth)
      // realpath-based: symlink keluar workspace tetap tertangkap walau --allow-all
      if (
        call.name === "write_file" ||
        call.name === "edit" ||
        call.name === "apply_patch" ||
        call.name === "read_file"
      ) {
        const p = (earlyArgs?.path as string) ?? ""
        if (!p || isRealPathOutsideRoot(p, root) || isSensitive(p)) return "deny"
      }
      if (call.name.startsWith("lsp_")) {
        const f = (earlyArgs?.file as string) ?? ""
        if (f && (isRealPathOutsideRoot(f, root) || isSensitive(f))) return "deny"
      }
      const cwdArg = (earlyArgs?.cwd as string) ?? ""
      if (
        cwdArg &&
        (call.name === "bash" ||
          call.name === "glob" ||
          call.name === "grep" ||
          call.name.startsWith("git_"))
      ) {
        if (isCwdOutsideRoot(cwdArg, root) || isRealPathOutsideRoot(cwdArg, root)) return "deny"
      }

      const mode = state.mode
      if (mode === "allow-all") return "allow"

      return handlers[state.mode](call, earlyArgs)
    },
  }
  const handle = returned as unknown as PermissionHandler & {
    __setMode(m: PermissionMode): void
    __getMode(): PermissionMode
  }
  return handle

  async function promptAskOr(call: ToolCall, noTty: () => "deny"): Promise<"allow" | "deny"> {
    if (!process.stdin.isTTY) return noTty()
    const list = await getAllowlist()
    if (matchAllowlist(call, list)) return "allow"
    const ans = await promptAsk(call)
    if (ans === "always") {
      await saveAlways(call)
      return "allow"
    }
    return ans === "allow" ? "allow" : "deny"
  }
}
