import type { Tool } from "minicore";
import { spawn } from "node:child_process";
import { resolve, relative, isAbsolute, sep } from "node:path";

function isOutsideRoot(p: string, root: string): boolean {
  if (!p) return false;
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (!rel) return false;
  if (isAbsolute(rel)) return true;
  return rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || rel.startsWith("..\\");
}

export const bashTool: Tool = {
  name: "bash",
  description: "Jalankan shell command (timeout 30s)",
  parameters: {
    type: "object",
    properties: {
      cmd: { type: "string" },
      cwd: { type: "string" },
      timeoutMs: { type: "number" },
    },
    required: ["cmd"],
    additionalProperties: false,
  },
  async execute({ cmd, cwd, timeoutMs }, ctx) {
    const c = cwd as string | undefined;
    if (c && isOutsideRoot(c, process.cwd())) throw new Error(`cwd outside workspace: ${c}`);
    const timeout = timeoutMs ?? 30_000;
    return await new Promise((resolve, reject) => {
      const p = spawn(cmd as string, { shell: true, cwd: c, signal: ctx.signal });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => {
        const text = (out + (err ? "\n[stderr]\n"+err : "")).trim();
        if (code !== 0) resolve(`exit ${code}\n${text.slice(0, 20000)}`);
        else resolve(text.slice(0, 20000));
      });
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const t = setTimeout(() => {
        p.kill("SIGTERM");
        killTimer = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 2000);
      }, timeout);
      ctx.signal.addEventListener("abort", () => {
        clearTimeout(t);
        if (killTimer) clearTimeout(killTimer);
        p.kill("SIGTERM");
        killTimer = setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 1000);
      }, { once: true });
      p.on("close", () => {
        clearTimeout(t);
        if (killTimer) clearTimeout(killTimer);
      });
    });
  },
};
