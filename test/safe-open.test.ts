// safe-open + trash: unit hermetic (tanpa privilege symlink kecuali 1 test
// yang skip bila EPERM — pola yang sama seperti tool-toctou).

import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assertSafeWriteTarget, safeReadFile, safeStat } from "../src/lib/safe-open.ts"
import { trashDir, trashFile } from "../src/lib/trash.ts"

function makeRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "minicode-safe-"))
  return d
}

function canSymlink(): boolean {
  const d = makeRoot()
  try {
    writeFileSync(join(d, "t.txt"), "x")
    symlinkSync(join(d, "t.txt"), join(d, "l.txt"))
    return true
  } catch {
    return false
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

test("safeReadFile: dalam root terbaca, luar root ditolak", async () => {
  const w = makeRoot()
  const o = makeRoot()
  try {
    writeFileSync(join(w, "a.txt"), "hello")
    writeFileSync(join(o, "secret.txt"), "shh")
    expect(await safeReadFile(join(w, "a.txt"), w)).toBe("hello")
    let threw = ""
    try {
      await safeReadFile(join(o, "secret.txt"), w)
    } catch (e) {
      threw = (e as Error).message
    }
    expect(threw).toContain("outside workspace")
  } finally {
    rmSync(w, { recursive: true, force: true })
    rmSync(o, { recursive: true, force: true })
  }
})

test("safeStat: mengembalikan stat file dalam root", async () => {
  const w = makeRoot()
  try {
    writeFileSync(join(w, "a.txt"), "12345")
    const st = await safeStat(join(w, "a.txt"), w)
    expect(st.size).toBe(5)
  } finally {
    rmSync(w, { recursive: true, force: true })
  }
})

test("assertSafeWriteTarget: parent luar ditolak, symlink ditolak, normal lolos", async () => {
  const w = makeRoot()
  const o = makeRoot()
  try {
    // parent di luar root
    let threw = ""
    try {
      await assertSafeWriteTarget(join(o, "x.txt"), w)
    } catch (e) {
      threw = (e as Error).message
    }
    expect(threw).toContain("parent outside workspace")
    // target normal lolos dan mengembalikan path absolut
    writeFileSync(join(w, "ada.txt"), "x")
    expect(await assertSafeWriteTarget(join(w, "ada.txt"), w)).toContain("ada.txt")
    expect(await assertSafeWriteTarget(join(w, "baru.txt"), w)).toContain("baru.txt")
    // symlink sebagai target tulis langsung ditolak (cegah overwrite keluar)
    if (canSymlink()) {
      writeFileSync(join(o, "secret.txt"), "shh")
      symlinkSync(join(o, "secret.txt"), join(w, "link.txt"))
      threw = ""
      try {
        await assertSafeWriteTarget(join(w, "link.txt"), w)
      } catch (e) {
        threw = (e as Error).message
      }
      expect(threw.length).toBeGreaterThan(0)
    }
  } finally {
    rmSync(w, { recursive: true, force: true })
    rmSync(o, { recursive: true, force: true })
  }
})

test("trash: file pindah ke .minicode/.trash dan bisa dibaca balik", async () => {
  const w = makeRoot()
  try {
    writeFileSync(join(w, "hapus.txt"), "isi-penting")
    const dest = await trashFile(w, join(w, "hapus.txt"))
    expect(dest.startsWith(trashDir(w))).toBe(true)
    expect(await readFile(dest, "utf8")).toBe("isi-penting")
    // asli sudah tidak ada
    let gone = false
    try {
      await readFile(join(w, "hapus.txt"), "utf8")
    } catch {
      gone = true
    }
    expect(gone).toBe(true)
  } finally {
    rmSync(w, { recursive: true, force: true })
  }
})

test("trashDir: di bawah root/.minicode/.trash", () => {
  expect(trashDir("/repo")).toBe(join("/repo", ".minicode", ".trash"))
  expect(trashDir("/repo")).not.toContain("..")
})

test("trash: prune menjaga maksimal 100 file terbaru", async () => {
  const w = makeRoot()
  try {
    // 105 file: prune berjalan tiap trashFile (best-effort, async) — beri
    // jeda mtime berbeda agar urutan deterministik.
    for (let i = 0; i < 105; i++) {
      writeFileSync(join(w, `f-${String(i).padStart(3, "0")}.txt`), `isi-${i}`)
      await trashFile(w, join(w, `f-${String(i).padStart(3, "0")}.txt`))
    }
    const { readdir } = await import("node:fs/promises")
    const entries = await readdir(trashDir(w))
    expect(entries.length).toBeLessThanOrEqual(100)
    expect(entries.length).toBeGreaterThan(90)
  } finally {
    rmSync(w, { recursive: true, force: true })
  }
})
