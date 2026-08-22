import type { Tool } from "minicore";
import { spawn } from "node:child_process";

function runGit(args: string[], cwd: string | undefined, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd, signal });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      const text = (out + (err ? "\n" + err : "")).trim();
      if (code !== 0 && !text) reject(new Error(`git ${args.join(" ")} exit ${code}`));
      else resolve(text || `(exit ${code})`);
    });
    signal.addEventListener("abort", () => p.kill("SIGTERM"), { once: true });
  });
}

export const gitStatusTool: Tool = {
  name: "git_status",
  description: "git status --porcelain + diff --stat + log --oneline -10",
  parameters: {
    type: "object",
    properties: { cwd: { type: "string" } },
    required: [],
    additionalProperties: false,
  },
  async execute({ cwd }, ctx) {
    const a = await runGit(["status", "--porcelain"], cwd as string | undefined, ctx.signal);
    const b = await runGit(["diff", "--stat"], cwd as string | undefined, ctx.signal);
    const c = await runGit(["log", "--oneline", "-10"], cwd as string | undefined, ctx.signal);
    return `status:\n${a || "(clean)"}\n\ndiff --stat:\n${b || "(no diff)"}\n\nlog -10:\n${c || "(no log)"}`;
  },
};

export const gitDiffTool: Tool = {
  name: "git_diff",
  description: "git diff (unstaged) atau git diff --staged",
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string" },
      staged: { type: "boolean", description: "true = --staged" },
    },
    required: [],
    additionalProperties: false,
  },
  async execute({ cwd, staged }, ctx) {
    const args = staged ? ["diff", "--staged"] : ["diff"];
    return await runGit(args, cwd as string | undefined, ctx.signal);
  },
};

export const gitLogTool: Tool = {
  name: "git_log",
  description: "git log --oneline -n",
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string" },
      limit: { type: "number", description: "jumlah commit, default 20" },
    },
    required: [],
    additionalProperties: false,
  },
  async execute({ cwd, limit }, ctx) {
    const n = String(Math.min(Math.max((limit as number) ?? 20, 1), 100));
    return await runGit(["log", "--oneline", `-${n}`], cwd as string | undefined, ctx.signal);
  },
};
