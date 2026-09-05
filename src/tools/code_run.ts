import { spawn } from "node:child_process"
import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
import { sanitizeSpawnEnv, scrubSecrets } from "../policy/scrub.ts"

// code_run: jalankan snippet python/node TANPA shell (spawn langsung dengan
// argv) — versi lama merangkai `node -e ${JSON.stringify(code)}` lewat
// `shell:true`, sehingga `$(...)`/backtick di dalam kode dieksekusi shell
// SEBELUM interpreter (injeksi). Direct spawn menutup itu; isolasi proses
// tetap digate MINICODE_SANDBOX seperti sebelumnya.
export const codeRunTool: Tool = {
  name: "code_run",
  description:
    "Run a code snippet (python -c / node -e) inside the sandboxed bash. Requires MINICODE_SANDBOX=os|docker; otherwise use bash tool.",
  parameters: {
    type: "object",
    properties: {
      lang: { type: "string", enum: ["python", "node"], description: "runtime" },
      code: { type: "string", description: "snippet to run" },
      timeout: { type: "number", description: "ms, default 10000" },
    },
    required: ["lang", "code"],
    additionalProperties: false,
  },
  async execute({ lang, code, timeout }, ctx) {
    ctx.signal.throwIfAborted()
    const sandbox = process.env.MINICODE_SANDBOX ?? ""
    if (sandbox !== "os" && sandbox !== "docker" && sandbox !== "bwrap" && sandbox !== "seatbelt") {
      throw new Error(
        `code_run requires MINICODE_SANDBOX=os|docker (current: ${sandbox || "none"})`,
      )
    }
    const root = (ctx as { cwd?: string }).cwd ?? process.cwd()
    const timeoutMs =
      typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0 ? timeout : 10000
    const bin = lang === "python" ? "python3" : process.execPath
    const args = lang === "python" ? ["-c", code as string] : ["-e", code as string]
    return await new Promise<string>((resolveOut, reject) => {
      let p: ReturnType<typeof spawn>
      try {
        p = spawn(bin, args, {
          cwd: root,
          env: sanitizeSpawnEnv(process.env),
          stdio: ["ignore", "pipe", "pipe"],
          // tanpa shell:true — argv diteruskan verbatim, $()/backtick tak dieksekusi
          detached: process.platform !== "win32",
        })
      } catch (e) {
        reject(e)
        return
      }
      let out = ""
      const cap = LIMITS.BASH_OUTPUT_MAX_CHARS
      const push = (d: Buffer) => {
        if (out.length < cap) out += d.toString().slice(0, Math.max(0, cap - out.length))
      }
      p.stdout?.on("data", push)
      p.stderr?.on("data", (d: Buffer) => {
        if (out.length < cap) out += d.toString().slice(0, Math.max(0, cap - out.length))
      })
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        fn()
      }
      const killTimerHolder: { t?: ReturnType<typeof setTimeout> } = {}
      const killTree = () => {
        try {
          if (process.platform === "win32" && p.pid !== undefined) {
            const { spawnSync } =
              require("node:child_process") as typeof import("node:child_process")
            const r = spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], {
              stdio: "ignore",
            })
            if (r.status === 0) return
          } else if (p.pid !== undefined) {
            try {
              process.kill(-p.pid, "SIGKILL")
              return
            } catch {}
          }
        } catch {}
        try {
          p.kill("SIGKILL")
        } catch {}
      }
      const t = setTimeout(() => {
        if (process.platform === "win32") killTree()
        else p.kill("SIGTERM")
        killTimerHolder.t = setTimeout(killTree, 2000)
      }, timeoutMs)
      ctx.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t)
          if (killTimerHolder.t) clearTimeout(killTimerHolder.t)
          killTree()
        },
        { once: true },
      )
      p.on("error", (e) => {
        clearTimeout(t)
        finish(() => reject(e))
      })
      p.on("close", (code) => {
        clearTimeout(t)
        if (killTimerHolder.t) clearTimeout(killTimerHolder.t)
        const text = scrubSecrets(out.trim())
        if (code !== 0) finish(() => resolveOut(`exit ${code}\n${text}`))
        else finish(() => resolveOut(text))
      })
    })
  },
}
