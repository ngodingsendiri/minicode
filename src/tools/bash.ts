import type { Tool } from "minicore";
import { spawn } from "node:child_process";

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
    const timeout = timeoutMs ?? 30_000;
    return await new Promise((resolve, reject) => {
      const p = spawn(cmd, { shell: true, cwd, signal: ctx.signal });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => {
        const text = (out + (err ? "\n[stderr]\n"+err : "")).trim();
        if (code !== 0) resolve(`exit ${code}\n${text.slice(0, 20000)}`);
        else resolve(text.slice(0, 20000));
      });
      const t = setTimeout(() => p.kill("SIGTERM"), timeout);
      ctx.signal.addEventListener("abort", () => { clearTimeout(t); p.kill("SIGTERM"); }, { once: true });
      p.on("close", () => clearTimeout(t));
    });
  },
};
