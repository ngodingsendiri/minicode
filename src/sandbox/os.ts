import { spawn, spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { LIMITS } from "../constants.ts"
import { sanitizeSpawnEnv } from "../policy/scrub.ts"

let osSandboxOk: boolean | null = null
let osSandboxType: "seatbelt" | "bwrap" | "none" | null = null

function detectOsSandbox(): { available: boolean; type: "seatbelt" | "bwrap" | "none" } {
  if (osSandboxOk !== null) return { available: osSandboxOk, type: osSandboxType! }
  if (process.platform === "darwin") {
    // seatbelt via sandbox-exec (macOS). Check availability
    try {
      const r = spawnSync("sandbox-exec", ["-h"], { stdio: "ignore", timeout: 2000 })
      // sandbox-exec returns 0 or 64 with usage, consider available if binary exists
      const ok = r.error === undefined
      osSandboxOk = ok
      osSandboxType = ok ? "seatbelt" : "none"
      return { available: ok, type: osSandboxType }
    } catch {
      osSandboxOk = false
      osSandboxType = "none"
      return { available: false, type: "none" }
    }
  }
  if (process.platform === "linux") {
    try {
      const r = spawnSync("bwrap", ["--version"], { stdio: "ignore", timeout: 2000 })
      const ok = r.status === 0
      osSandboxOk = ok
      osSandboxType = ok ? "bwrap" : "none"
      return { available: ok, type: osSandboxType }
    } catch {
      osSandboxOk = false
      osSandboxType = "none"
      return { available: false, type: "none" }
    }
  }
  osSandboxOk = false
  osSandboxType = "none"
  return { available: false, type: "none" }
}

export function osSandboxAvailable(): boolean {
  return detectOsSandbox().available
}

export function osSandboxTypeName(): string {
  return detectOsSandbox().type
}

export interface OsSandboxOptions {
  env?: Record<string, string>
  timeoutMs?: number
  network?: "none" | "bridge"
}

// Seatbelt profile minimal (deny network, restrict writes outside cwd)
// bwrap: bubblewrap with --ro-bind / --bind cwd, --unshare-net, --die-with-parent
export function runInOsSandbox(
  command: string,
  cwd: string,
  opts: OsSandboxOptions = {},
): Promise<{ code: number | null; output: string }> {
  const { available, type } = detectOsSandbox()
  if (!available) {
    return Promise.resolve({
      code: null,
      output: "[os-sandbox] not available on this platform — fallback required",
    })
  }
  const abs = resolve(cwd)
  const sanitizedEnv = sanitizeSpawnEnv(process.env, opts.env) as Record<string, string>
  const timeout = opts.timeoutMs ?? LIMITS.DOCKER_TIMEOUT_MS

  if (type === "seatbelt") {
    // macOS seatbelt - simple deny network profile
    const profile = `(version 1)
(deny default)
(allow process-exec)
(allow file-read* file-write* (subpath "${abs}"))
(allow file-read* (subpath "/usr") (subpath "/bin") (subpath "/private/tmp"))
(allow sysctl-read)
(deny network*)
`
    // Use sandbox-exec with inline profile via stdin? sandbox-exec needs file, write tmp
    const args = ["-p", profile, "sh", "-c", command]
    return runSpawn("sandbox-exec", args, abs, sanitizedEnv, timeout)
  }
  if (type === "bwrap") {
    const args = [
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      abs,
      abs,
      "--chdir",
      abs,
      "--unshare-net",
      "--die-with-parent",
      "--cap-drop",
      "ALL",
      "sh",
      "-c",
      command,
    ]
    // best-effort: if network bridge requested, omit --unshare-net
    if (opts.network === "bridge") {
      const idx = args.indexOf("--unshare-net")
      if (idx !== -1) args.splice(idx, 1)
    }
    return runSpawn("bwrap", args, abs, sanitizedEnv, timeout)
  }
  return Promise.resolve({ code: null, output: "[os-sandbox] unknown type" })
}

function runSpawn(
  bin: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveResult) => {
    const p = spawn(bin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const OUT_CAP = LIMITS.DOCKER_OUTPUT_MAX_CHARS
    let out = ""
    let err = ""
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
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs)
    p.on("error", (e) => {
      clearTimeout(t)
      resolveResult({ code: null, output: `[os-sandbox] ${e.message}` })
    })
    p.on("close", (code) => {
      clearTimeout(t)
      const marker = truncated ? "\n… [output truncated]" : ""
      const output = (out + (err ? `\n[stderr]\n${err}` : "")).trim() + marker
      resolveResult({ code, output })
    })
  })
}
