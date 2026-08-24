import type { Tool } from "minicore";
import { spawn } from "node:child_process";
import { isPathOutsideRoot } from "../policy/jail.ts";
import { scrubSecrets } from "../policy/scrub.ts";
import { runInDocker, dockerAvailable } from "../sandbox/docker.ts";

const SECRET_ENV_RE = /(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|DEEPSEEK|ANTHROPIC|OPENAI|AGENT_[A-Z_]*KEY)/i;

// jangan biarkan shell membaca kredensial dari env — kurangi eksfiltrasi rahasia
function stripSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (SECRET_ENV_RE.test(k)) continue;
    out[k] = v;
  }
  return out;
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
    if (c && isPathOutsideRoot(c, process.cwd())) throw new Error(`cwd outside workspace: ${c}`);
    const timeout = timeoutMs ?? 30_000;

    // Docker sandbox mode — jalankan di container ephemeral, terisolasi
    if (process.env.MINICODE_SANDBOX === "docker") {
      if (dockerAvailable()) {
        const res = await runInDocker(cmd as string, c ?? process.cwd(), { timeoutMs: timeout });
        const text = scrubSecrets(res.output);
        if (res.code !== 0 && res.code !== null) return `exit ${res.code}\n${text.slice(0, 20000)}`;
        return text.slice(0, 20000);
      }
      // fallback: docker tidak tersedia → jalan langsung (dengan peringatan diam)
    }

    return await new Promise((resolve, reject) => {
      const p = spawn(cmd as string, { shell: true, cwd: c, env: stripSecrets(process.env), signal: ctx.signal });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => {
        const text = scrubSecrets((out + (err ? "\n[stderr]\n"+err : "")).trim());
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
