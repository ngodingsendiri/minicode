import { spawn } from "node:child_process"
import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
import { isCwdOutsideRoot, isPathOutsideRoot } from "../policy/jail.ts"

function runGit(args: string[], cwd: string | undefined, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, {
      cwd,
      // Timeout dari LIMITS, bukan hardcode: `git_commit` menjalankan beberapa
      // operasi berurutan (rev-parse → add → commit → log), dan di mesin yang
      // sibuk (mis. CI menjalankan test dengan coverage) spawn git bisa jauh
      // lebih lambat dari batas 8s yang dulu dipakai — kegagalannya muncul
      // sebagai flake, bukan bug nyata.
      signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITS.GIT_TIMEOUT_MS)]),
    })
    let out = "",
      err = ""
    p.stdout.on("data", (d) => (out += d))
    p.stderr.on("data", (d) => (err += d))
    p.on("error", reject)
    p.on("close", (code) => {
      const text = (out + (err ? "\n" + err : "")).trim()
      if (code !== 0 && !text) reject(new Error(`git ${args.join(" ")} exit ${code}`))
      else resolve(text || `(exit ${code})`)
    })
    signal.addEventListener("abort", () => p.kill("SIGTERM"), { once: true })
  })
}

/** cwd tool harus di dalam workspace — sama seperti bash/glob/grep. */
function assertCwd(cwd: string | undefined): void {
  if (!cwd) return
  if (isCwdOutsideRoot(cwd, process.cwd()) || isPathOutsideRoot(cwd, process.cwd())) {
    throw new Error(`cwd outside workspace: ${cwd}`)
  }
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
    const c = cwd as string | undefined
    assertCwd(c)
    const [a, b, d] = await Promise.all([
      runGit(["status", "--porcelain"], c, ctx.signal),
      runGit(["diff", "--stat"], c, ctx.signal),
      runGit(["log", "--oneline", "-10"], c, ctx.signal),
    ])
    return `status:\n${a || "(clean)"}\n\ndiff --stat:\n${b || "(no diff)"}\n\nlog -10:\n${d || "(no log)"}`
  },
}

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
    assertCwd(cwd as string | undefined)
    const args = staged ? ["diff", "--staged"] : ["diff"]
    return await runGit(args, cwd as string | undefined, ctx.signal)
  },
}

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
    assertCwd(cwd as string | undefined)
    const n = String(Math.min(Math.max((limit as number) ?? 20, 1), 100))
    return await runGit(["log", "--oneline", `-${n}`], cwd as string | undefined, ctx.signal)
  },
}

// ── Tool tulis ──
//
// `git_commit` di-GATE di permission layer (setara `delegate_task`/`mcp_call`):
// commit mengubah riwayat yang dibagikan, jadi butuh persetujuan sekali per
// pemakaian di mode `auto`, dan ditolak di `readonly`/`plan`/`allowlist`.
//
// Yang SENGAJA tidak disediakan: `push`, `reset --hard`, `rebase`, `checkout`,
// `branch -D`, `stash drop`, dan amend. Semuanya sulit dibalikkan atau
// mempengaruhi remote/repo orang lain — agent tidak perlu itu untuk
// menyelesaikan task, dan menyediakannya memindahkan risiko besar ke tangan
// yang tidak bisa menilai konteksnya.

/** Nama file di argumen `paths` harus di dalam workspace. */
function assertPaths(paths: unknown, cwd: string | undefined): string[] {
  if (paths == null) return []
  if (!Array.isArray(paths)) throw new Error("paths harus array string")
  const root = cwd ?? process.cwd()
  const out: string[] = []
  for (const p of paths) {
    if (typeof p !== "string" || !p.trim()) continue
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`)
    out.push(p)
  }
  return out
}

export const gitCommitTool: Tool = {
  name: "git_commit",
  description:
    "Buat commit git. Stage path tertentu (paths) atau semua perubahan yang dilacak (all:true). Tidak mendukung push/amend/reset — itu di luar wewenang agent.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "pesan commit (baris pertama = subjek)" },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "file yang di-stage; kosongkan bila memakai all",
      },
      all: {
        type: "boolean",
        description: "stage semua file yang SUDAH dilacak git (setara git commit -a)",
      },
      cwd: { type: "string" },
    },
    required: ["message"],
    additionalProperties: false,
  },
  async execute({ message, paths, all, cwd }, ctx) {
    ctx.signal.throwIfAborted()
    const c = cwd as string | undefined
    assertCwd(c)
    const msg = String(message ?? "").trim()
    if (!msg) throw new Error("message wajib diisi")
    if (msg.length > 4000) throw new Error("message terlalu panjang (max 4000 char)")

    const files = assertPaths(paths, c)
    if (files.length === 0 && all !== true) {
      throw new Error("beri `paths` (file spesifik) atau `all: true` — commit kosong tidak berguna")
    }

    // Repo check dulu supaya errornya jelas, bukan "exit 128".
    const inside = await runGit(["rev-parse", "--is-inside-work-tree"], c, ctx.signal).catch(
      () => "",
    )
    if (!inside.startsWith("true")) throw new Error("bukan repo git (git rev-parse gagal)")

    if (files.length > 0) {
      // `--` memisahkan path dari opsi: nama file bernama `-f` tak jadi flag.
      await runGit(["add", "--", ...files], c, ctx.signal)
    }

    // `-m` dengan pesan sebagai satu argumen: tak ada shell yang menginterpretasi
    // isinya, jadi backtick/`$()` di pesan commit tidak dieksekusi.
    const args = ["commit", "-m", msg]
    if (files.length === 0 && all === true) args.push("-a")

    const out = await runGit(args, c, ctx.signal)
    // `git commit` keluar non-zero saat tak ada perubahan; runGit sudah
    // meneruskan teksnya, jadi model membaca alasan sebenarnya.
    if (/nothing to commit|no changes added/i.test(out)) {
      return `tidak ada yang di-commit:\n${out}`
    }
    const head = await runGit(["log", "--oneline", "-1"], c, ctx.signal).catch(() => "")
    return `${out}${head ? `\n\nHEAD: ${head}` : ""}`
  },
}
