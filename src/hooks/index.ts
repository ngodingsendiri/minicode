import type { ToolCall, ToolResult } from "../../../minicore/src/core/types.ts";
import { readFile, writeFile, mkdir, chmod, rename } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";

export interface Hooks {
  beforeTool?(call: ToolCall): Promise<"allow" | "deny" | undefined>;
  afterTool?(call: ToolCall, result: ToolResult): Promise<void>;
}

export interface Allowlist {
  allowed: string[]; // entries like "bash:echo hi" or "write_file:.tmp/*"
}

const GLOBAL_ALLOW = join(homedir(), ".minicode", "allowlist.json");
const LOCAL_ALLOW = ".minicode/allowlist.json";

export async function loadAllowlist(cwd?: string): Promise<Allowlist> {
  let globalList: Allowlist = { allowed: [] };
  let localList: Allowlist = { allowed: [] };
  try {
    const txt = await readFile(GLOBAL_ALLOW, "utf8");
    const parsed = JSON.parse(txt) as Allowlist;
    if (Array.isArray(parsed.allowed)) globalList = parsed;
  } catch {}
  try {
    const path = resolve(cwd ?? process.cwd(), LOCAL_ALLOW);
    const txt = await readFile(path, "utf8");
    const parsed = JSON.parse(txt) as Allowlist;
    if (Array.isArray(parsed.allowed)) localList = parsed;
  } catch {}
  // merge global+local, dedup
  const merged = new Set<string>([...globalList.allowed, ...localList.allowed]);
  return { allowed: [...merged] };
}

export async function saveAllowlist(entry: string, cwd?: string, opts: { global?: boolean } = {}) {
  const path = opts.global ? GLOBAL_ALLOW : resolve(cwd ?? process.cwd(), LOCAL_ALLOW);
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  let list: Allowlist = { allowed: [] };
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Allowlist;
    if (Array.isArray(parsed.allowed)) list = parsed;
  } catch {}
  if (!list.allowed.includes(entry)) list.allowed.push(entry);
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  try { await chmod(tmp, 0o600); } catch {}
  await rename(tmp, path);
  try { await chmod(path, 0o600); } catch {}
}

export function matchAllowlist(call: ToolCall, allowlist: string[]): boolean {
  const key = `${call.name}:${JSON.stringify(call.args).slice(0, 200)}`;
  return allowlist.some((pat) => {
    const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    if (pat.includes(":")) return re.test(key);
    return re.test(call.name) || re.test(key);
  });
}

export function createHooks(opts: { cwd?: string; hooks?: Hooks } = {}): Hooks & { allowlist: Allowlist } {
  let allowlist: Allowlist = { allowed: [] };
  // load async but keep sync for now — caller can await loadAllowlist separately
  return {
    allowlist,
    async beforeTool(call: ToolCall) {
      if (opts.hooks?.beforeTool) {
        const r = await opts.hooks.beforeTool(call);
        if (r) return r;
      }
      return undefined;
    },
    async afterTool(call: ToolCall, result: ToolResult) {
      if (opts.hooks?.afterTool) await opts.hooks.afterTool(call, result);
    },
  } as Hooks & { allowlist: Allowlist };
}

export async function promptAsk(call: ToolCall): Promise<"allow" | "deny" | "always"> {
  if (!process.stdin.isTTY) return "deny";
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const q = `${call.name} ${JSON.stringify(call.args).slice(0, 120)} — allow? [y/n/a] `;
  const ans: string = await new Promise((resolve) => rl.question(q, resolve));
  rl.close();
  const a = ans.trim().toLowerCase();
  if (a === "a" || a === "always") return "always";
  if (a === "y" || a === "yes") return "allow";
  return "deny";
}
