import type { PermissionHandler, ToolCall } from "minicore";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { cwd } from "node:process";
import { loadAllowlist, matchAllowlist, promptAsk, saveAllowlist } from "../hooks/index.ts";

const READONLY_TOOLS = new Set(["read_file", "glob", "grep", "git_status", "git_diff", "git_log", "read_memory", "mcp_list", "lsp_diagnostics", "lsp_definition", "lsp_references", "lsp_hover", "lsp_symbols"]);

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
];

const SENSITIVE_RE = /(^|[\/\\])\.env(\.|$|[\/\\])|\.git[\/\\]config|node_modules/;

function isPathOutsideRoot(p: string, root: string): boolean {
  if (!p) return true;
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (!rel) return false; // same directory
  if (isAbsolute(rel)) return true; // different drive on Windows
  return rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || rel.startsWith("..\\");
}

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

  return {
    async check(call: ToolCall): Promise<"allow" | "deny"> {
      if (mode === "allow-all") return "allow";

      // universal file-path jail (applies even to readonly/ask before any allow)
      const earlyArgs = call.args as Record<string, unknown> | null;
      if (call.name === "write_file" || call.name === "edit" || call.name === "read_file") {
        const p = (earlyArgs?.path as string) ?? "";
        if (!p || isPathOutsideRoot(p, root) || SENSITIVE_RE.test(p)) return "deny";
      }
      if (call.name.startsWith("lsp_")) {
        const f = (earlyArgs?.file as string) ?? "";
        if (f && (isPathOutsideRoot(f, root) || SENSITIVE_RE.test(f))) return "deny";
      }
      // cwd jail for tools that accept cwd
      const cwdArg = (earlyArgs?.cwd as string) ?? "";
      if (cwdArg && (call.name === "bash" || call.name === "glob" || call.name === "grep" || call.name.startsWith("git_"))) {
        if (isPathOutsideRoot(cwdArg, root)) return "deny";
      }

      if (mode === "readonly" && !READONLY_TOOLS.has(call.name)) return "deny";

      // ask mode: check allowlist first, then prompt for non-readonly
      if (mode === "ask" && !READONLY_TOOLS.has(call.name)) {
        const list = await getAllowlist();
        if (matchAllowlist(call, list)) return "allow";
        // still run auto checks to deny dangerous before asking
        if (call.name === "bash") {
          const cmd = (earlyArgs?.cmd as string) ?? "";
          if (!cmd.trim()) return "deny";
          for (const re of BASH_DENY_RE) if (re.test(cmd)) return "deny";
        }
        const ans = await promptAsk(call);
        if (ans === "always") {
          const key = `${call.name}:${JSON.stringify(call.args).slice(0, 200)}`;
          await saveAllowlist(key, root).catch(() => {});
          allowlistCache = null;
          return "allow";
        }
        return ans === "allow" ? "allow" : "deny";
      }

      // auto mode (and ask for readonly already handled)
      if (READONLY_TOOLS.has(call.name)) return "allow";

      const args = earlyArgs;

      // path jail already handled above, just allow file writes after jail
      if (call.name === "write_file" || call.name === "edit") {
        return "allow";
      }

      if (call.name === "write_memory" || call.name === "forget_memory" || call.name === "delegate_task" || call.name === "mcp_list" || call.name === "mcp_call") return "allow";

      if (call.name === "bash") {
        const cmd = (args?.cmd as string) ?? "";
        if (!cmd.trim()) return "deny";
        for (const re of BASH_DENY_RE) if (re.test(cmd)) return "deny";
        return "allow";
      }

      // MCP dynamic tools: "serverId.toolName" (contains dot)
      if (call.name.includes(".")) return "allow";

      // default deny unknown tools
      return "deny";
    },
  };
}
