import { expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editTool } from "../src/tools/edit.ts"
import { readImageTool } from "../src/tools/read_image.ts"

// Live prove hardening untuk read_image + edit (bukan hanya read_file).
// Pola sama dengan tool-toctou.test.ts: swapper inside↔outside 1000×, 0 lolos.

function symlinkPrivilege(): boolean {
  const d = mkdtempSync(join(tmpdir(), "live-priv-"))
  try {
    writeFileSync(join(d, "t.txt"), "x")
    symlinkSync(join(d, "t.txt"), join(d, "l.txt"))
    unlinkSync(join(d, "l.txt"))
    return true
  } catch {
    return false
  } finally {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {}
  }
}

const canSymlink = symlinkPrivilege()
const it = canSymlink ? test : test.skip
const mkctx = (cwd: string) => ({ cwd, signal: new AbortController().signal }) as never

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
)

it("live-toctou: read_image internal tetap terbaca", async () => {
  const w = mkdtempSync(join(tmpdir(), "live-img-in-"))
  try {
    mkdirSync(join(w, ".minicode"), { recursive: true })
    writeFileSync(join(w, "target.png"), PNG_1X1)
    symlinkSync(join(w, "target.png"), join(w, "link.png"))
    const r = (await readImageTool.execute({ path: "link.png" }, mkctx(w))) as string
    expect(r).toContain("data:image/png;base64,")
  } finally {
    try {
      rmSync(w, { recursive: true, force: true })
    } catch {}
  }
})

it("live-toctou: read_image luar ditolak", async () => {
  const w = mkdtempSync(join(tmpdir(), "live-img-out-"))
  const o = mkdtempSync(join(tmpdir(), "live-img-sec-"))
  try {
    mkdirSync(join(w, ".minicode"), { recursive: true })
    writeFileSync(join(w, "target.png"), PNG_1X1)
    writeFileSync(join(o, "secret.png"), Buffer.from("SECRET"))
    symlinkSync(join(o, "secret.png"), join(w, "link.png"))
    let leaked = false
    try {
      const r = (await readImageTool.execute({ path: "link.png" }, mkctx(w))) as string
      if (r.includes("SECRET")) leaked = true
    } catch {}
    expect(leaked).toBe(false)
  } finally {
    try {
      rmSync(w, { recursive: true, force: true })
      rmSync(o, { recursive: true, force: true })
    } catch {}
  }
})

it("live-toctou: edit internal tetap bisa, luar ditolak", async () => {
  const w = mkdtempSync(join(tmpdir(), "live-edit-"))
  const o = mkdtempSync(join(tmpdir(), "live-edit-sec-"))
  try {
    mkdirSync(join(w, ".minicode"), { recursive: true })
    writeFileSync(join(w, "target.txt"), "hello world")
    writeFileSync(join(o, "secret.txt"), "SECRET")
    symlinkSync(join(w, "target.txt"), join(w, "link.txt"))
    const r = (await editTool.execute(
      { path: "link.txt", oldString: "hello", newString: "hi" },
      mkctx(w),
    )) as string
    expect(r).toContain("edited")
    expect(readFileSync(join(w, "target.txt"), "utf8")).toContain("hi world")
    // luar
    try {
      unlinkSync(join(w, "link.txt"))
    } catch {}
    symlinkSync(join(o, "secret.txt"), join(w, "link2.txt"))
    let leaked = false
    try {
      await editTool.execute({ path: "link2.txt", oldString: "SECRET", newString: "X" }, mkctx(w))
      leaked = true
    } catch (e) {
      expect(String((e as Error).message)).toMatch(/outside|symlink|not found/i)
    }
    expect(leaked).toBe(false)
  } finally {
    try {
      rmSync(w, { recursive: true, force: true })
      rmSync(o, { recursive: true, force: true })
    } catch {}
  }
})

it("live-toctou: swapper read_image 500× 0 lolos", async () => {
  const w = mkdtempSync(join(tmpdir(), "live-swap-img-"))
  const o = mkdtempSync(join(tmpdir(), "live-swap-img-out-"))
  const link = join(w, "link.png")
  try {
    mkdirSync(join(w, ".minicode"), { recursive: true })
    writeFileSync(join(w, "target.png"), PNG_1X1)
    writeFileSync(join(o, "secret.png"), Buffer.from("SECRETIMG"))
    let stop = false
    let toInside = true
    const swapper = (async () => {
      while (!stop) {
        try {
          unlinkSync(link)
        } catch {}
        try {
          symlinkSync(toInside ? join(w, "target.png") : join(o, "secret.png"), link)
        } catch {}
        toInside = !toInside
        await new Promise<void>((r) => setImmediate(r))
      }
    })()
    let leaks = 0
    for (let i = 0; i < 500; i++) {
      try {
        const r = (await readImageTool.execute({ path: "link.png" }, mkctx(w))) as string
        if (r.includes("SECRETIMG")) leaks++
      } catch {}
    }
    stop = true
    await swapper.catch(() => {})
    expect(leaks).toBe(0)
  } finally {
    try {
      rmSync(w, { recursive: true, force: true })
      rmSync(o, { recursive: true, force: true })
    } catch {}
  }
})
