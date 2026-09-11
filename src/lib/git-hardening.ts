import { spawnSync } from "node:child_process"
import { resolveTrustedExecutable } from "./trusted-exec.ts"

// Hardening argv untuk SEMUA pemanggilan git minicode (audit #10 P0).
//
// Model ancaman: direktori repo yang dibuka bisa membawa `.git/config`
// (hooksPath, fsmonitor, pager, filter/diff drivers) + `.git/hooks/*` +
// `.gitattributes`. Tanpa netralisasi, operasi git rutin (bahkan read-only
// seperti `status`/`diff`) mengeksekusi perintah repo: clean/smudge filters,
// textconv/diff.external, fsmonitor, hooks commit, pager.
//
// Aturan pemakaian:
// - GIT_SAFE_BASE di semua pemanggilan (tanpa kecuali).
// - GIT_NO_DIFF_DRIVERS di diff/log yang menampilkan konten.
// - gitFilterNeutralizers HANYA untuk plumbing internal (shadow
//   snapshot/restore) yang wajib byte-exact + tanpa eksekusi — JANGAN untuk
//   index user (LFS/semantik clean milik user, lihat git.ts).

/** Netralisasi universal: tanpa hooks, tanpa fsmonitor, tanpa pager. */
export const GIT_SAFE_BASE: readonly string[] = [
  "--no-pager",
  "-c",
  "core.hooksPath=/nonexistent-minicode-nohooks",
  "-c",
  "core.fsmonitor=",
]

/** Netralisasi driver konten untuk diff/log (tanpa eksekusi repo). */
export const GIT_NO_DIFF_DRIVERS: readonly string[] = ["--no-ext-diff", "--no-textconv"]

const DRIVER_RE = /^filter\.([A-Za-z0-9_.-]+)\.(?:clean|smudge)\b/

/**
 * Bangun override `-c filter.<d>.clean=cat -c filter.<d>.smudge=cat` untuk
 * semua driver clean/smudge yang TERKONFIGURASI. `cat` = identitas byte
 * (snapshot/restore tetap konsisten) tanpa mengeksekusi perintah repo.
 * Discovery via `git config` (plumbing baca murni: tanpa hook/filter/pager).
 */
export async function gitFilterNeutralizers(cwd: string): Promise<string[]> {
  try {
    const r = spawnSync(
      resolveTrustedExecutable("git"),
      ["config", "--get-regexp", "^filter\\..*\\.(clean|smudge)$"],
      { cwd, encoding: "utf8", timeout: 10_000 },
    )
    if (r.status !== 0 || !r.stdout) return []
    const drivers = new Set<string>()
    for (const line of r.stdout.split("\n")) {
      const m = DRIVER_RE.exec(line.trim())
      if (m?.[1]) drivers.add(m[1])
    }
    const out: string[] = []
    for (const d of [...drivers].sort()) {
      out.push("-c", `filter.${d}.clean=cat`, "-c", `filter.${d}.smudge=cat`)
    }
    return out
  } catch {
    return []
  }
}
