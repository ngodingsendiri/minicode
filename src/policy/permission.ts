import { resolve } from "node:path"
import { cwd } from "node:process"
import type { PermissionHandler, ToolCall } from "minicore"
import { loadAllowlist, matchAllowlist, promptAsk, saveAllowlist } from "../hooks/index.ts"
import { inspectBashCommand } from "./bash-guard.ts"
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
  "todo_read",
  "mcp_list",
  "lsp_diagnostics",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_symbols",
  "lsp_workspace_symbols",
])

// Tool yang menulis state internal minicode (bukan file workspace) — aman
// di semua mode kecuali readonly/plan. `bash_kill` menghentikan proses yang
// dimulai agent sendiri, jadi tidak menambah permukaan serangan.
const INTERNAL_WRITE_TOOLS = new Set([
  "write_memory",
  "forget_memory",
  "todo_write",
  "bash_output",
  "bash_kill",
])

const FILE_WRITE_TOOLS = new Set(["write_file", "edit", "apply_patch"])

// Subset INTERNAL_WRITE_TOOLS yang juga tidak perlu prompt di mode `ask`.
// `write_memory`/`forget_memory` TIDAK termasuk: itu menulis MEMORY.md yang
// persisten lintas sesi, jadi user berhak menyetujuinya.
const NO_PROMPT_TOOLS = new Set(["todo_write", "bash_output", "bash_kill"])

// Tool yang memperbesar serangan / menembus dunia luar: tidak auto-allowed.
const GATED_TOOLS = new Set(["delegate_task", "mcp_call"])

// Denylist bash kini di src/policy/bash-guard.ts — pemeriksaan dilakukan pada
// bentuk TERNORMALISASI (quote dibuang, variabel sederhana disubstitusi), bukan
// string mentah. Regex-atas-string-mentah yang lama trivially dilewati oleh
// `cat .e""nv`, `X=.env; cat $X`, `p=python3; $p -c 1`, dan `node --eval`.

// Perintah yang dianggap aman di mode `allowlist` — mode paling ketat, dipakai
// saat menjalankan task tak terpercaya. Isinya sengaja **read-only + build**:
// operasi tulis (`rm`, `mv`, `cp`, `mkdir`) TIDAK di sini, karena tujuan mode
// ini memang menahan efek samping. Agent yang butuh menulis file punya
// `write_file`/`edit` yang ter-jail, bukan shell.
//
// Perhatikan: allowlist diperiksa SETELAH bash-guard, jadi `cat *` di sini
// tidak berarti `cat .env` lolos — guard menolaknya lebih dulu. Pola di sini
// soal "bentuk perintah apa yang boleh", bukan "target apa yang boleh".
const DEFAULT_BASH_ALLOWLIST = [
  "git status*",
  "git diff*",
  "git log*",
  "git branch*",
  "git show*",
  "bun test*",
  "bun x tsc*",
  "bun run *",
  "npm run *",
  "npm exec *",
  "npx *",
  "echo *",
  "ls*",
  "dir*",
  "pwd",
  "cat *",
  "head *",
  "tail *",
  "wc *",
  "grep *",
  "rg *",
  "find *",
  "which *",
  "node --version",
  "bun --version",
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
    return inspectBashCommand(cmd).denied
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
      if (FILE_WRITE_TOOLS.has(call.name)) return "allow"
      if (INTERNAL_WRITE_TOOLS.has(call.name)) return "allow"
      return READONLY_TOOLS.has(call.name) ? "allow" : "deny"
    },
    ask: async (call, args) => {
      if (READONLY_TOOLS.has(call.name)) return "allow"
      // Bookkeeping internal tidak menyentuh workspace: todo list dan kontrol
      // job yang izinnya sudah diberikan saat `bash` dijalankan. Meminta
      // konfirmasi untuk ini hanya melelahkan tanpa menambah keamanan.
      if (NO_PROMPT_TOOLS.has(call.name)) return "allow"
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
      if (FILE_WRITE_TOOLS.has(call.name)) return "allow"
      if (INTERNAL_WRITE_TOOLS.has(call.name)) return "allow"
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
    // Kontrol mode saat runtime (Shift+Tab di TUI). Sebelumnya kedua method ini
    // hanya ada di type-cast tanpa implementasi, sehingga pemanggilnya no-op /
    // TypeError dan mode permission tidak pernah benar-benar berubah.
    __setMode(m: PermissionMode): void {
      state.mode = m
      allowlistCache = null
    },
    __getMode(): PermissionMode {
      return state.mode
    },
  }
  return returned as unknown as PermissionHandler & {
    __setMode(m: PermissionMode): void
    __getMode(): PermissionMode
  }

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
