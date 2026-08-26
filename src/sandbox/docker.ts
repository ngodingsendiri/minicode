import { spawn, spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { sanitizeSpawnEnv } from "../policy/scrub.ts"

let dockerOk: boolean | null = null

// Cek docker CLI tersedia (cache hasilnya).
export function dockerAvailable(): boolean {
  if (dockerOk !== null) return dockerOk
  try {
    const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
      timeout: 5000,
    })
    dockerOk = r.status === 0
  } catch {
    dockerOk = false
  }
  return dockerOk
}

// Konversi path workspace untuk -v mount. Windows: C:\x → //c/x (Docker Desktop / MSYS).
function workspaceMount(cwd: string): string {
  const abs = resolve(cwd)
  if (process.platform === "win32") {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(abs)
    if (m) return `//${m[1]!.toLowerCase()}/${m[2]!.replace(/\\/g, "/")}`
  }
  return abs
}

export interface DockerRunOptions {
  image?: string
  network?: "none" | "bridge"
  memory?: string
  cpus?: number
  env?: Record<string, string>
  timeoutMs?: number
}

// Run command di dalam container ephemeral, terisolasi (--network none,
// memori/CPU cap), mount workspace read-write. Return { code, output }.
export function runInDocker(
  command: string,
  cwd: string,
  opts: DockerRunOptions = {},
): Promise<{ code: number | null; output: string }> {
  const image = opts.image ?? process.env.MINICODE_SANDBOX_IMAGE ?? "node:22-alpine"
  const mount = workspaceMount(cwd)
  const args = [
    "run",
    "--rm",
    "-i",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "32",
    "--tmpfs",
    "/tmp",
    "-v",
    `${mount}:${mount}`,
    "-w",
    mount,
    "--network",
    "none",
    "--memory",
    opts.memory ?? process.env.MINICODE_SANDBOX_MEMORY ?? "512m",
    "--cpus",
    String(opts.cpus ?? 1),
    "--user",
    "1000:1000",
    image,
    "sh",
    "-c",
    command,
  ]

  return new Promise((resolveResult) => {
    // env selalu disanitasi dari hasil merge final — secret (API_KEY/TOKEN/...)
    // tidak pernah diwarisi container walau caller lupa strip.
    const p = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: sanitizeSpawnEnv(process.env, opts.env),
    })
    let out = "",
      err = ""
    p.stdout.on("data", (d) => (out += d))
    p.stderr.on("data", (d) => (err += d))
    const timeout = opts.timeoutMs ?? 30_000
    const t = setTimeout(() => p.kill("SIGKILL"), timeout)
    p.on("error", (e) => {
      clearTimeout(t)
      resolveResult({ code: null, output: `[docker] ${e.message}` })
    })
    p.on("close", (code) => {
      clearTimeout(t)
      const output = (out + (err ? `\n[stderr]\n${err}` : "")).trim()
      resolveResult({ code, output })
    })
  })
}
