import type { PermissionHandler, ToolCall } from "minicore";
import { resolve, relative, isAbsolute } from "node:path";
import { cwd } from "node:process";

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

export type PermissionMode = "auto" | "readonly" | "allow-all";

export function createPermissionHandler(opts: { mode?: PermissionMode; root?: string } = {}): PermissionHandler {
  const mode = opts.mode ?? "auto";
  const root = resolve(opts.root ?? cwd());

  return {
    async check(call: ToolCall): Promise<"allow" | "deny"> {
      if (mode === "allow-all") return "allow";
      if (mode === "readonly" && !READONLY_TOOLS.has(call.name)) return "deny";

      // auto mode
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

      if (call.name === "write_memory" || call.name === "forget_memory") return "allow";

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
