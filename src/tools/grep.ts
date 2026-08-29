import { spawn, spawnSync } from "node:child_process"
import { readdir, readFile, realpath, stat } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import type { Tool } from "minicore"
import { LIMITS } from "../constants.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"
import { scrubSecrets } from "../policy/scrub.ts"

async function walkGrep(
  dir: string,
  re: RegExp,
  out: string[],
  root: string,
  limit: number,
  signal: AbortSignal,
  includeRe?: RegExp | null,
) {
  if (signal.aborted) throw new Error("aborted")
  if (out.length >= limit) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (out.length >= limit) break
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".git") continue
    const full = join(dir, e.name)
    const rel = relative(root, full).replace(/\\/g, "/")
    if (e.isDirectory()) {
      await walkGrep(full, re, out, root, limit, signal, includeRe)
    } else {
      if (includeRe && !includeRe.test(rel) && !includeRe.test(e.name)) continue
      if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|exe|dll|bin)$/i.test(e.name)) continue
      // symlink file escape check — resolve realpath and jail
      const real = await realpath(full).catch(() => full)
      if (isPathOutsideRoot(real, resolve(root)) || isSensitive(real) || isSensitive(rel)) continue
      // also skip if symlink points outside (already covered) or sensitive
      const st = await stat(real).catch(() => null)
      if (!st || st.size > LIMITS.GREP_FILE_MAX_BYTES) continue
      const text = await readFile(real, "utf8").catch(() => "")
      if (text.includes("\0")) continue
      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0
        if (re.test(lines[i]!)) {
          out.push(
            `${rel}:${i + 1}: ${scrubSecrets(lines[i]!.slice(0, LIMITS.GREP_MATCH_MAX_CHARS))}`,
          )
          if (out.length >= limit) break
        }
      }
    }
  }
}

function includeToRegExp(include: string): RegExp | null {
  if (!include) return null
  let esc = include.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  esc = esc.replace(/\*\*/g, "§§")
  esc = esc.replace(/\*/g, "[^/]*")
  esc = esc.replace(/§§/g, ".*")
  esc = esc.replace(/\?/g, ".")
  return new RegExp("^" + esc + "$")
}

// ── ripgrep ──
// Walker JS di atas butuh ~3,5 s untuk repo 16k LOC karena membaca tiap file
// lewat event loop. `rg` melakukan hal sama dalam puluhan milidetik. Kita pakai
// bila tersedia, tapi fallback tetap dipertahankan supaya tool ini tak pernah
// bergantung pada binary eksternal.
let rgPath: string | null | undefined

export function ripgrepAvailable(): boolean {
  if (rgPath !== undefined) return rgPath !== null
  try {
    const r = spawnSync("rg", ["--version"], { stdio: "ignore", timeout: 3000 })
    rgPath = r.status === 0 ? "rg" : null
  } catch {
    rgPath = null
  }
  return rgPath !== null
}

/** Reset cache deteksi — hanya untuk test. */
export function __resetRipgrepCache(): void {
  rgPath = undefined
}

/**
 * Normalisasi satu baris keluaran `rg --vimgrep`-style (`path:line:col:text`)
 * ke format yang sama dengan walker (`path:line: text`), sekaligus scrub dan
 * cap panjang. Return null bila baris harus dibuang (sensitif / tak terparse).
 * Diekspor untuk test.
 */
export function normalizeRgLine(line: string, root: string): string | null {
  // path bisa memuat ':' di Windows (C:\...), jadi cari dua ':' terakhir yang
  // diikuti angka — bukan split(':') naif.
  const m = /^(.*?):(\d+):(\d+):([\s\S]*)$/.exec(line)
  if (!m) return null
  const [, rawPath, lineNo, , text] = m
  const rel = (rawPath ?? "").replace(/\\/g, "/").replace(/^\.\//, "")
  if (!rel) return null
  // Defense-in-depth: rg sudah dibatasi ke cwd, tapi jail tetap diterapkan
  // supaya hasil identik dengan fallback (symlink/sensitive tetap dibuang).
  if (isPathOutsideRoot(rel, resolve(root)) || isSensitive(rel)) return null
  return `${rel}:${lineNo}: ${scrubSecrets((text ?? "").slice(0, LIMITS.GREP_MATCH_MAX_CHARS))}`
}

function runRipgrep(
  pattern: string,
  root: string,
  limit: number,
  signal: AbortSignal,
  include?: string,
): Promise<string[]> {
  const args = [
    "--vimgrep", // path:line:col:text
    "--no-heading",
    "--color=never",
    "--hidden", // tetap perlu --glob !.git di bawah
    "--no-follow", // jangan ikuti symlink (setara jail walker)
    "--max-filesize",
    String(LIMITS.GREP_FILE_MAX_BYTES),
    "--max-count",
    String(limit),
    "--glob",
    "!.git/**",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!.*/**",
  ]
  if (include) args.push("--glob", include)
  args.push("--regexp", pattern, "--", ".")

  return new Promise((resolveOut, reject) => {
    const p = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
    const out: string[] = []
    let buf = ""
    let stderr = ""
    let done = false
    const finish = (fn: () => void) => {
      if (done) return
      done = true
      fn()
    }
    const onAbort = () => {
      p.kill("SIGTERM")
      finish(() => reject(new Error("aborted")))
    }
    if (signal.aborted) {
      p.kill("SIGTERM")
      return reject(new Error("aborted"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    const timer = setTimeout(() => {
      p.kill("SIGTERM")
      finish(() => resolveOut(out)) // kembalikan hasil sebagian, jangan gagal total
    }, LIMITS.GREP_RIPGREP_TIMEOUT_MS)

    p.stdout.on("data", (d: Buffer) => {
      if (out.length >= limit) return
      buf += d.toString()
      let idx = buf.indexOf("\n")
      while (idx >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "")
        buf = buf.slice(idx + 1)
        const norm = normalizeRgLine(line, root)
        if (norm) out.push(norm)
        if (out.length >= limit) {
          p.kill("SIGTERM")
          break
        }
        idx = buf.indexOf("\n")
      }
    })
    p.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 2000) stderr += d.toString()
    })
    p.on("error", (e) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      finish(() => reject(e))
    })
    p.on("close", (code) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      // rg: 0 = ada match, 1 = tak ada match, 2 = error (mis. regex invalid)
      if (code === 2 && out.length === 0) {
        finish(() => reject(new Error(stderr.trim() || "ripgrep failed")))
        return
      }
      finish(() => resolveOut(out))
    })
  })
}

export const grepTool: Tool = {
  name: "grep",
  description:
    "Search regex di file (memakai ripgrep bila tersedia, fallback walker internal). Mengembalikan file:line: content.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "regex, mis log.*Error" },
      cwd: { type: "string", description: "root dir default '.'" },
      include: { type: "string", description: "filter file glob, mis *.ts" },
      limit: { type: "number" },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  async execute({ pattern, cwd, include, limit }, ctx) {
    const root = (cwd as string) ?? "."
    if (isPathOutsideRoot(root, process.cwd())) throw new Error(`cwd outside workspace: ${root}`)
    const lim = Math.min(
      Math.max((limit as number) ?? LIMITS.SEARCH_DEFAULT_LIMIT, 1),
      LIMITS.SEARCH_MAX_LIMIT,
    )
    const pat = pattern as string
    // Validasi regex di JS lebih dulu: pesan errornya jelas dan berlaku untuk
    // kedua jalur. Sintaks yang JS terima praktis selalu diterima rg juga.
    let re: RegExp
    try {
      re = new RegExp(pat)
    } catch (e) {
      throw new Error(`invalid regex: ${(e as Error).message}`)
    }

    const noMatch = () =>
      `no matches for /${pat}/ in ${root}${include ? ` (include ${include})` : ""}`

    if (process.env.MINICODE_GREP_ENGINE !== "js" && ripgrepAvailable()) {
      try {
        const hits = await runRipgrep(pat, root, lim, ctx.signal, include as string | undefined)
        return hits.length === 0 ? noMatch() : hits.join("\n")
      } catch (e) {
        if ((e as Error).message === "aborted") throw e
        // rg gagal (regex flavour berbeda, binary rusak, permission) → fallback
        process.stderr.write(
          `[warn] grep: ripgrep failed (${(e as Error).message}) — fallback JS\n`,
        )
      }
    }

    const incRe = include ? includeToRegExp(include as string) : null
    const out: string[] = []
    await walkGrep(root, re, out, root, lim, ctx.signal, incRe)
    return out.length === 0 ? noMatch() : out.join("\n")
  },
}
