import { randomUUID } from "node:crypto"
import { chmod, type FileHandle, mkdir, open, rename, unlink } from "node:fs/promises"
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
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }).catch(() => {})
  for (let attempt = 0; attempt < 2; attempt++) {
    const entropy = 16
    const tmp = `${path}.tmp.${process.pid}.${randomUUID().slice(0, entropy)}`
    let fh: FileHandle | undefined
    try {
      fh = await open(tmp, "wx", 0o600)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST" && attempt === 0) continue
      throw e
    }
    try {
      // Bun Windows: `FileHandle.writeFile` kadang nge-hit kWriteMonkeyPatchDefense
      // bila `node:fs/promises` ke-import bareng `bun:sqlite` di top-level.
      // Fallback ke `Bun.write` (tidak pakai FileHandle) bila kena itu.
      try {
        await fh.writeFile(data, "utf8")
      } catch (e) {
        const msg = String((e as Error)?.message ?? "")
        if (msg.includes("kWriteMonkeyPatchDefense") || msg.includes("kWrite")) {
          await fh.close().catch(() => {})
          fh = undefined as unknown as FileHandle
          await Bun.write(tmp, data)
          // re-open untuk sync/chmod path yang sama — atau skip bila Bun.write sudah flush
          try {
            await chmod(tmp, 0o600).catch(() => {})
          } catch {}
          let lastErr2: unknown
          for (let r = 0; r < 8; r++) {
            try {
              await rename(tmp, path)
              lastErr2 = undefined
              break
            } catch (ee) {
              const code = (ee as NodeJS.ErrnoException).code
              if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
                lastErr2 = ee
                await new Promise((res) => setTimeout(res, Math.min(10 * 2 ** r, 100)))
              } else throw ee
            }
          }
          if (lastErr2) throw lastErr2
          return
        }
        throw e
      }
      await fh.sync().catch(() => {})
      await chmod(tmp, 0o600).catch(() => {})
      // Windows: rename menimpa target yang baru saja ditulis penulis lain
      // bisa EPERM/EBUSY/EACCES sesaat (lock AV / replace window) → backoff.
      let lastErr: unknown
      for (let r = 0; r < 8; r++) {
        try {
          await rename(tmp, path)
          lastErr = undefined
          break
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code
          if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
            lastErr = e
            await new Promise((res) => setTimeout(res, Math.min(10 * 2 ** r, 100)))
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
