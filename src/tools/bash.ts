import { spawn } from "node:child_process"
import type { Tool } from "minicore"
import { LIMITS } from "../constants.ts"
import { isCwdOutsideRoot, isPathOutsideRoot } from "../policy/jail.ts"
// re-export untuk backward compat (helper kini terpusat di policy/scrub)
export { SECRET_ENV_RE, sanitizeSpawnEnv, stripSecretsEnv } from "../policy/scrub.ts"
import { sanitizeSpawnEnv, scrubSecrets } from "../policy/scrub.ts"
import { dockerAvailable, runInDocker } from "../sandbox/docker.ts"

export const bashTool: Tool = {
  name: "bash",
  description: "Run a shell command (timeout 30s)",
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
    const c = cwd as string | undefined
    if (c && (isCwdOutsideRoot(c, process.cwd()) || isPathOutsideRoot(c, process.cwd())))
      throw new Error(`cwd outside workspace: ${c}`)
    const timeout = timeoutMs ?? LIMITS.BASH_DEFAULT_TIMEOUT_MS

    // Docker sandbox mode — run in ephemeral isolated container
    if (process.env.MINICODE_SANDBOX === "docker") {
      if (dockerAvailable()) {
        const res = await runInDocker(cmd as string, c ?? process.cwd(), {
          timeoutMs: timeout,
          env: sanitizeSpawnEnv(process.env) as Record<string, string>,
        })
        const text = scrubSecrets(res.output)
        if (res.code !== 0 && res.code !== null) return `exit ${res.code}\n${text.slice(0, 20000)}`
        return text.slice(0, 20000)
      }
      process.stderr.write(
        "[warn] MINICODE_SANDBOX=docker but docker unavailable — falling back to direct execution\n",
      )
    }

    return await new Promise((resolve, reject) => {
      const p = spawn(cmd as string, {
        shell: true,
        cwd: c,
        env: sanitizeSpawnEnv(process.env),
        signal: ctx.signal,
      })
      // Cap buffer SAAT streaming (bukan hanya slice di akhir) — command dengan
      // output raksasa (yes / cat file 1GB) tidak boleh membawa proses ke OOM.
      const OUT_CAP = LIMITS.BASH_OUTPUT_MAX_CHARS
      let out = "",
        err = ""
      let truncated = false
      const appendCapped = (target: "out" | "err", d: Buffer | string): void => {
        const s = typeof d === "string" ? d : d.toString()
        const cur = target === "out" ? out : err
        if (cur.length >= OUT_CAP) {
          truncated = true
          return
        }
        const room = OUT_CAP - cur.length
        if (s.length > room) truncated = true
        const piece = s.slice(0, Math.max(0, room))
        if (target === "out") out += piece
        else err += piece
      }
      p.stdout.on("data", (d) => appendCapped("out", d))
      p.stderr.on("data", (d) => appendCapped("err", d))
      p.on("error", reject)
      p.on("close", (code) => {
        const marker = truncated ? "\n… [output truncated]" : ""
        const text = scrubSecrets((out + (err ? "\n[stderr]\n" + err : "")).trim())
        if (code !== 0) resolve(`exit ${code}${marker}\n${text.slice(0, 20000)}`)
        else resolve((text.slice(0, 20000)) + marker)
      })
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const t = setTimeout(() => {
        p.kill("SIGTERM")
        killTimer = setTimeout(() => {
          try {
            p.kill("SIGKILL")
          } catch {}
        }, 2000)
      }, timeout)
      ctx.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t)
          if (killTimer) clearTimeout(killTimer)
          p.kill("SIGTERM")
          killTimer = setTimeout(() => {
            try {
              p.kill("SIGKILL")
            } catch {}
          }, 1000)
        },
        { once: true },
      )
      p.on("close", () => {
        clearTimeout(t)
        if (killTimer) clearTimeout(killTimer)
      })
    })
  },
}
