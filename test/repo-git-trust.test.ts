// Audit #13 chain 6 — repo git jahat vs jalur git minicode.
//
// Fakta yang dibuktikan via reproducer (lihat laporan audit #13):
// - `git diff`/`git add` MENTAH mengeksekusi diff.external/textconv/clean
//   repo (stock-git semantics; pelaku: bash tool / terminal).
// - Tool git_status/git_diff/git_log minicode TIDAK mengeksekusi apa pun dari
//   repo (GIT_SAFE_BASE + GIT_NO_DIFF_DRIVERS + neutralisasi filter).
// Test ini mengunci batas AMAN; jalur mentah didokumentasikan sebagai residual
// (arahan seleksi via deskripsi tool, bukan larangan yang memutus clone/push).
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gitDiffTool, gitLogTool, gitStatusTool } from "../src/tools/git.ts"

setDefaultTimeout(60_000)

const gitAvailable =
  spawnSync("git", ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0

const has = (p: string): Promise<boolean> =>
  access(p)
    .then(() => true)
    .catch(() => false)

/** Repo dengan SELURUH pemicu eksekusi repo-side: fsmonitor, diff.external,
 * textconv, clean filter, editor, pager. Tiap test memakai marker sendiri.
 * PENTING: konfigurasi jahat dipasang SETELAH commit awal + marker setup
 * dibersihkan — `git add` mentah saat setup MEMANG mengeksekusi clean filter
 * (stock-git semantics); yang diuji adalah tool minicode, bukan setup. */
async function evilRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "evilrepo-"))
  const git = (args: string[], extra?: object) =>
    spawnSync("git", args, { cwd: dir, stdio: "ignore", timeout: 15000, ...(extra ?? {}) })
  git(["init", "-q"])
  git(["config", "user.email", "t@example.com"])
  git(["config", "user.name", "t"])
  git(["config", "commit.gpgsign", "false"])
  await writeFile(join(dir, "a.bin"), "v1-content\n", "utf8")
  git(["add", "-A"])
  git(["commit", "-qm", "init"])
  await writeFile(join(dir, "a.bin"), "v2-content\n", "utf8")
  await writeFile(join(dir, ".gitattributes"), "*.bin diff=evil filter=evil\n", "utf8")
  const m = (n: string) => join(dir, n).replace(/\\/g, "/")
  // fsmonitor: dicoba spawn di hampir tiap perintah (butuh payload executable;
  // di sini mustahil-jalan agar test hermetik — yang diuji tool menahan diri).
  git(["config", "core.fsmonitor", "minicode-nonexistent-fsmonitor-xyz"])
  git(["config", "diff.external", `echo DIFFLIB > "${m("PWNED-ext.txt")}"`])
  git(["config", "diff.evil.textconv", `echo TEXTCONV > "${m("PWNED-tc.txt")}"`])
  git(["config", "filter.evil.clean", `echo CLEANF > "${m("PWNED-clean.txt")}"`])
  git(["config", "filter.evil.smudge", `echo SMUDGEF > "${m("PWNED-smudge.txt")}"`])
  git(["config", "core.editor", `echo EDITORF > "${m("PWNED-editor.txt")}"`])
  git(["config", "core.pager", `echo PAGERF > "${m("PWNED-pager.txt")}"`])
  // Bersihkan marker yang mungkin dibuat setup mentah di atas.
  for (const n of ALL) await rm(join(dir, n), { force: true }).catch(() => {})
  return dir
}

async function noMarkers(dir: string, names: string[]): Promise<string[]> {
  const fired: string[] = []
  for (const n of names) {
    if (await has(join(dir, n))) fired.push(n)
  }
  return fired
}

const ALL = [
  "PWNED-ext.txt",
  "PWNED-tc.txt",
  "PWNED-clean.txt",
  "PWNED-smudge.txt",
  "PWNED-editor.txt",
  "PWNED-pager.txt",
]

const ctxFor = (dir: string) => ({ cwd: dir, signal: AbortSignal.timeout(30000) }) as never

describe.skipIf(!gitAvailable)("audit #13: tool git tak mengeksekusi kode repo", () => {
  let dir = ""
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    dir = ""
  })

  test("git_status: status+stat+log tanpa eksekusi repo", async () => {
    dir = await evilRepo()
    await gitStatusTool.execute({}, ctxFor(dir))
    expect(await noMarkers(dir, ALL)).toEqual([])
  })

  test("git_diff: full diff tanpa textconv/external/clean", async () => {
    dir = await evilRepo()
    const out = (await gitDiffTool.execute({}, ctxFor(dir))) as string
    expect(out).toContain("v2-content")
    expect(await noMarkers(dir, ALL)).toEqual([])
  })

  test("git_diff staged: tanpa eksekusi repo", async () => {
    dir = await evilRepo()
    await gitDiffTool.execute({ staged: true }, ctxFor(dir))
    expect(await noMarkers(dir, ALL)).toEqual([])
  })

  test("git_log: tanpa pager repo", async () => {
    dir = await evilRepo()
    const out = (await gitLogTool.execute({ limit: 5 }, ctxFor(dir))) as string
    expect(out).toContain("init")
    expect(await noMarkers(dir, ALL)).toEqual([])
  })

  test("deskripsi mengarahkan menjauhi git mentah (lever seleksi #12)", async () => {
    const { bashTool } = await import("../src/tools/bash.ts")
    expect(bashTool.description).toMatch(/git_status|git_diff/)
    expect(gitDiffTool.description).toMatch(/hardened/i)
    expect(gitStatusTool.description).toMatch(/hardened/i)
  })
})
