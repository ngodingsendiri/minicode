import type { PermissionHandler, ToolCall } from "minicore";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { loadAllowlist, matchAllowlist, promptAsk, saveAllowlist } from "../hooks/index.ts";
import { isPathOutsideRoot, isSensitive } from "./jail.ts";
import { getMcpServerIds } from "../mcp/client.ts";

const READONLY_TOOLS = new Set(["read_file", "glob", "grep", "git_status", "git_diff", "git_log", "read_memory", "mcp_list", "lsp_diagnostics", "lsp_definition", "lsp_references", "lsp_hover", "lsp_symbols"]);

// Tool yang memperbesar serangan / menembus dunia luar: tidak auto-allowed.
// Wajib approval user (prompt) jika TTY, atau ditolak jika non-TTY.
const GATED_TOOLS = new Set(["delegate_task", "mcp_call"]);

const BASH_DENY_RE = [
  /rm\s+[^;|]*-r[f]*\s+[^;|]*(\/\*?|~|(\$HOME|\$\{HOME\})|--no-preserve-root)/i, // rm -rf /, /*, ~, $HOME/${HOME}, --no-preserve-root
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/, // fork bomb :(){ :|:& };:
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
  /:\s*>\s*\/dev\/null.*&/i, // fork bomb variant
  // Hardening v0.2 — interpreter exec / obfuscation / secret exfil
  /\b(?:python|python2|python3|pypy)\s+-c\b/i,
  /\b(?:sh|bash|dash|zsh|ksh)\s+-c\b/i,
  /\b(?:node|perl)\s+-(?:e|pe|ne)\b/i,
  /\bphp\s+-r\b/i,
  /\bruby\s+-e\b/i,
  /(?:^|[;&|]\s*)(?:base64|xxd)[^\n]*\|\s*(?:sh|bash|python|python3|node|perl)\b/i,
  /\bawk\b[^\n]*\bsystem\s*\(/i,
  /\b(?:curl|wget)\b[^\n]*\|\s*(?:python|python3|node|perl|php)\b/i,
  /\bprintenv\b/i,
  /\b(?:cat|less|more|head|tail|type|grep|sed|awk|cut|sort|xargs)\b[^\n]*\s+\.env(?:[^.\w]|$)/i,
];

export type PermissionMode = "auto" | "readonly" | "allow-all" | "ask";

export function createPermissionHandler(opts: { mode?: PermissionMode; root?: string } = {}): PermissionHandler {
  const mode = opts.mode ?? "auto";
  const root = resolve(opts.root ?? cwd());
  let allowlistCache: string[] | null = null;
  async function getAllowlist(): Promise<string[]> {
    if (allowlistCache) return allowlistCache;
    try {
      const l = await loadAllowlist(root);
      allowlistCache = l.allowed;
      return allowlistCache;
    } catch {
      return [];
    }
  }

  // Tool MCP dinamis berformat "serverId.toolName" — hanya valid bila server
  // benar-benar terdaftar. Menutup bypass wildcard `*` lama.
  function isRegisteredMcp(name: string): boolean {
    const dot = name.indexOf(".");
    if (dot === -1) return false;
    return getMcpServerIds().includes(name.slice(0, dot));
  }

  function saveAlways(call: ToolCall): Promise<void> {
    const key = `${call.name}:${JSON.stringify(call.args).slice(0, 200)}`;
    allowlistCache = null;
    return saveAllowlist(key, root).catch(() => {});
  }

  return {
    async check(call: ToolCall): Promise<"allow" | "deny"> {
      if (mode === "allow-all") return "allow";

      // universal file-path jail (applies even to readonly/ask before any allow)
      const earlyArgs = call.args as Record<string, unknown> | null;
      if (call.name === "write_file" || call.name === "edit" || call.name === "read_file") {
        const p = (earlyArgs?.path as string) ?? "";
        if (!p || isPathOutsideRoot(p, root) || isSensitive(p)) return "deny";
      }
      if (call.name.startsWith("lsp_")) {
        const f = (earlyArgs?.file as string) ?? "";
        if (f && (isPathOutsideRoot(f, root) || isSensitive(f))) return "deny";
      }
      // cwd jail for tools that accept cwd
      const cwdArg = (earlyArgs?.cwd as string) ?? "";
      if (cwdArg && (call.name === "bash" || call.name === "glob" || call.name === "grep" || call.name.startsWith("git_"))) {
        if (isPathOutsideRoot(cwdArg, root)) return "deny";
      }

      if (mode === "readonly" && !READONLY_TOOLS.has(call.name)) return "deny";
      if (READONLY_TOOLS.has(call.name)) return "allow";

      // mcp_call/delegate_task belum tentu readonly; MCP dinamis hanya jika terdaftar
      const isGated = GATED_TOOLS.has(call.name) || (call.name.includes(".") && !isRegisteredMcp(call.name));

      if (mode === "ask") {
        const list = await getAllowlist();
        if (matchAllowlist(call, list)) return "allow";
        // still run auto checks to deny dangerous before asking
        if (call.name === "bash") {
          const cmd = (earlyArgs?.cmd as string) ?? "";
          if (!cmd.trim()) return "deny";
          for (const re of BASH_DENY_RE) if (re.test(cmd)) return "deny";
          // permit bash to fall through to prompt
        } else if (isGated) {
          return await promptAskOr(call, () => "deny");
        }
        const ans = await promptAsk(call);
        if (ans === "always") {
          await saveAlways(call);
          return "allow";
        }
        return ans === "allow" ? "allow" : "deny";
      }

      // auto mode
      if (isGated) {
        return await promptAskOr(call, () => "deny");
      }

      // local trusted surface (after jail above): file writes + project memory
      if (call.name === "write_file" || call.name === "edit") return "allow";
      if (call.name === "write_memory" || call.name === "forget_memory") return "allow";

      if (call.name === "bash") {
        const cmd = (earlyArgs?.cmd as string) ?? "";
        if (!cmd.trim()) return "deny";
        for (const re of BASH_DENY_RE) if (re.test(cmd)) return "deny";
        return "allow";
      }

      // default deny unknown tools
      return "deny";
    },
  };

  // auto mode tanpa TTY → tolak; dengan TTY → tanya user (y/n/a)
  async function promptAskOr(call: ToolCall, noTty: () => "deny"): Promise<"allow" | "deny"> {
    if (!process.stdin.isTTY) return noTty();
    const list = await getAllowlist();
    if (matchAllowlist(call, list)) return "allow";
    const ans = await promptAsk(call);
    if (ans === "always") {
      await saveAlways(call);
      return "allow";
    }
    return ans === "allow" ? "allow" : "deny";
  }
}
