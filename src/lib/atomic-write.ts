import { randomUUID } from "node:crypto"
import { type FileHandle, chmod, mkdir, open, rename, unlink } from "node:fs/promises"
import { dirname } from "node:path"

/**
 * Tulis file secara atomic + tahan hijack:
 * - nama tmp memakai randomUUID → tidak dapat diprediksi attacker
 * - flag "wx" (O_EXCL) gagal bila tmp sudah ada (mis. symlink pre-create)
 * - mode 0o600 best-effort sebelum rename (Windows: no-op, aman diabaikan)
 * - rename(tmp→target) atomic per POSIX; di Windows libuv memakai
 *   MOVEFILE_REPLACE_EXISTING sehingga menimpa target lama.
 */
export async function atomicWriteText(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  for (let attempt = 0; attempt < 2; attempt++) {
    const entropy = attempt === 0 ? 8 : 16
    const tmp = `${path}.tmp.${process.pid}.${randomUUID().slice(0, entropy)}`
    let fh: FileHandle | undefined
    try {
      fh = await open(tmp, "wx", 0o600)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST" && attempt === 0) continue
      throw e
    }
    try {
      await fh.writeFile(data, "utf8")
      await chmod(tmp, 0o600).catch(() => {})
      // Windows: rename menimpa target yang baru saja ditulis penulis lain
      // bisa EPERM/EBUSY/EACCES sesaat (lock AV / replace window) → backoff.
      let lastErr: unknown
      for (let r = 0; r < 5; r++) {
        try {
          await rename(tmp, path)
          lastErr = undefined
          break
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code
          if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
            lastErr = e
            await new Promise((res) => setTimeout(res, 5 * (r + 1)))
          } else throw e
        }
      }
      if (lastErr) throw lastErr
      return
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    } finally {
      await fh.close().catch(() => {})
    }
  }
  throw new Error(`atomic write failed after retries: ${path}`)
}
