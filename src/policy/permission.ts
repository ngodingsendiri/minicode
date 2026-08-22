import type { PermissionHandler, ToolCall } from "minicore";
import { resolve, relative, isAbsolute } from "node:path";
import { cwd } from "node:process";
import { loadAllowlist, matchAllowlist, promptAsk, saveAllowlist } from "../hooks/index.ts";

const READONLY_TOOLS = new Set(["read_file", "glob", "grep", "git_status", "git_diff", "git_log", "read_memory"]);

const BASH_DENY_RE = [
  /rm\s+-rf\s+(\/|~|\$HOME)/i,
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;/, // fork bomb :(){ :|:& };:
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+777\b/i,
  /\bcurl\b.*\|\s*sh/i,
  /\bwget\b.*\|\s*sh/i,
  /\bpowershell\b.*-EncodedCommand/i,
  />\s*\/dev\/sda/i,
];

function isPathOutsideRoot(p: string, root: string): boolean {
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  return rel.startsWith("..") || isAbsolute(rel) && rel.includes("..");
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
      if (mode === "readonly" && !READONLY_TOOLS.has(call.name)) return "deny";

      // ask mode: check allowlist first, then prompt for non-readonly
      if (mode === "ask" && !READONLY_TOOLS.has(call.name)) {
        const list = await getAllowlist();
        if (matchAllowlist(call, list)) return "allow";
        // still run auto checks to deny dangerous before asking
        const args = call.args as Record<string, unknown> | null;
        if (call.name === "write_file" || call.name === "edit" || call.name === "read_file") {
          const p = (args?.path as string) ?? "";
          if (!p || isPathOutsideRoot(p, root) || /\.env\b|\.git\/config|node_modules/.test(p)) return "deny";
        }
        if (call.name === "bash") {
          const cmd = (args?.cmd as string) ?? "";
          if (!cmd.trim()) return "deny";
          for (const re of BASH_DENY_RE) if (re.test(cmd)) return "deny";
          const c = (args?.cwd as string) ?? root;
          if (isPathOutsideRoot(c, root)) return "deny";
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

      const args = call.args as Record<string, unknown> | null;

      // path jail for file tools
      if (call.name === "write_file" || call.name === "edit" || call.name === "read_file") {
        const p = (args?.path as string) ?? "";
        if (!p) return "deny";
        // reject absolute paths outside root and traversal
        if (isPathOutsideRoot(p, root)) return "deny";
        // reject writing to sensitive files
        if (/\.env\b|\.git\/config|node_modules/.test(p)) return "deny";
        return "allow";
      }

      if (call.name === "write_memory" || call.name === "forget_memory" || call.name === "delegate_task") return "allow";

      if (call.name === "bash") {
        const cmd = (args?.cmd as string) ?? "";
        if (!cmd.trim()) return "deny";
        for (const re of BASH_DENY_RE) if (re.test(cmd)) return "deny";
        // cwd jail
        const c = (args?.cwd as string) ?? root;
        if (isPathOutsideRoot(c, root)) return "deny";
        return "allow";
      }

      // default deny unknown tools
      return "deny";
    },
  };
}
