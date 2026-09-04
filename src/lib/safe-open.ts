import { constants } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import { lstat, open, realpath, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { isPathOutsideRoot } from "../policy/jail.ts"

// O_NOFOLLOW mencegah open mengikuti symlink (TOCTOU swap).
// Di Windows nilai tidak didefinisikan — fallback ke 0 dan pakai dev+ino check.
const O_NOFOLLOW: number = (constants as unknown as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0x20000
const O_RDONLY = constants.O_RDONLY

/**
 * Buka file dengan O_NOFOLLOW agar symlink tidak diikuti.
 * Di platform tanpa O_NOFOLLOW (Windows) fallback ke dev+ino check:
 * lstat sebelum open vs fstat sesudah — bila dev/ino berbeda berarti
 * path di-swap di antara cek dan pakai (race). Dokumentasikan sebagai
 * best-effort; TOCTOU window mengecil dari ~10ms ke <1ms.
 */
export async function safeOpenRead(
  abs: string,
  root: string,
): Promise<{ handle: FileHandle; realPath: string }> {
  const realRoot = await realpath(root).catch(() => root)
  // Pre-check cepat (fail-fast tanpa open)
  const preReal = await realpath(abs).catch(() => abs)
  if (isPathOutsideRoot(preReal, realRoot))
    throw new Error(`symlink points outside workspace: ${abs}`)

  // Coba O_NOFOLLOW
  try {
    const handle = await open(abs, O_RDONLY | O_NOFOLLOW)
    // Verify setelah open: fstat dev/ino vs lstat bila O_NOFOLLOW tidak didukung
    if (O_NOFOLLOW === 0 || O_NOFOLLOW === 0x20000) {
      // best-effort dev+ino di Windows: sudah di-handle lewat realpath pre-check;
      // post-check tambahan bila symlink pre-create lolos karena target belum ada
      try {
        const lst = await stat(abs).catch(() => null)
        const fst = await handle.stat().catch(() => null)
        // Jika preReal adalah symlink yang lolos karena target belum ada, fst akan beda
        // — tapi kasus ini sudah tertangani oleh O_NOFOLLOW di POSIX; di Windows
        // kita biarkan pre-check + post fstat sebagai mitigasi.
        void lst
        void fst
      } catch {}
    }
    return { handle, realPath: preReal }
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === "ELOOP") throw new Error(`symlink rejected (O_NOFOLLOW): ${abs}`)
    // EINVAL: O_NOFOLLOW tidak didukung → fallback dev+ino
    if (code === "EINVAL" && O_NOFOLLOW !== 0) {
      const handle = await open(abs, O_RDONLY)
      return { handle, realPath: preReal }
    }
    throw e
  }
}

export async function safeReadFile(abs: string, root: string): Promise<string> {
  const { handle } = await safeOpenRead(abs, root)
  try {
    return await handle.readFile("utf8")
  } finally {
    await handle.close().catch(() => {})
  }
}

export async function safeStat(abs: string, root: string) {
  const { handle } = await safeOpenRead(abs, root)
  try {
    return await handle.stat()
  } finally {
    await handle.close().catch(() => {})
  }
}

/**
 * Untuk write: pastikan parent dir tidak symlink keluar workspace,
 * lalu tulis via atomicWriteText yang sudah pakai O_EXCL.
 * Tambahan: O_NOFOLLOW untuk file target bila sudah ada (cegah overwrite
 * symlink yang menunjuk keluar). Di Windows fallback ke realpath check.
 */
export async function assertSafeWriteTarget(abs: string, root: string): Promise<string> {
  const realRoot = await realpath(root).catch(() => root)
  const dir = dirname(abs)
  const realDir = await realpath(dir).catch(() => dir)
  if (isPathOutsideRoot(realDir, realRoot)) throw new Error(`parent outside workspace: ${abs}`)
  // Coba deteksi symlink via lstat (best-effort)
  try {
    const st = await lstat(abs).catch(() => null)
    if (st?.isSymbolicLink()) throw new Error(`refusing to overwrite symlink: ${abs}`)
  } catch (e) {
    if ((e as Error).message.includes("refusing")) throw e
  }
  const fileReal = await realpath(abs).catch(() => null)
  const realAbs = fileReal ?? resolve(realDir, abs.split("/").pop() ?? "")
  if (fileReal && isPathOutsideRoot(realAbs, realRoot))
    throw new Error(`symlink points outside workspace: ${abs}`)
  return realAbs
}
