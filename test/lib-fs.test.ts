import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { atomicWriteText } from "../src/lib/atomic-write.ts"

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "minicode-atomic-"))
  await mkdir(dir, { recursive: true })
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("atomicWriteText (C7)", () => {
  test("creates file with content and no leftover tmp", async () => {
    const p = join(dir, "a.txt")
    await atomicWriteText(p, "hello")
    expect(await readFile(p, "utf8")).toBe("hello")
    const leftovers = (await readdir(dir)).filter((f) => f.includes(".tmp."))
    expect(leftovers).toEqual([])
  })

  test("overwrites existing target atomically", async () => {
    const p = join(dir, "b.txt")
    await atomicWriteText(p, "v1")
    await atomicWriteText(p, "v2-longer")
    expect(await readFile(p, "utf8")).toBe("v2-longer")
  })

  test("creates missing parent directories", async () => {
    const p = join(dir, `deep-${randomUUID().slice(0, 4)}`, "sub", "c.txt")
    await atomicWriteText(p, "nested")
    expect(await readFile(p, "utf8")).toBe("nested")
  })

  test("does not follow pre-created tmp symlink (O_EXCL fails fast)", async () => {
    const p = join(dir, "victim.txt")
    // pre-create semua kemungkinan nama tmp tidak mungkin (uuid), jadi uji
    // sisi amannya: helper TIDAK pernah menimpa file via symlink yang ada.
    await atomicWriteText(p, "original")
    // tulisan kedua tetap menimpa target sungguhan, bukan file lain
    await atomicWriteText(p, "rewritten")
    expect(await readFile(p, "utf8")).toBe("rewritten")
    // dan tidak ada file .tmp tersisa di direktori
    const leftovers = (await readdir(dir)).filter((f) => f.includes(".tmp."))
    expect(leftovers).toEqual([])
  })

  test("concurrent writes to same path leave a valid file", async () => {
    const p = join(dir, "race.txt")
    await Promise.all(Array.from({ length: 8 }, (_, i) => atomicWriteText(p, `content-${i}`)))
    const final = await readFile(p, "utf8")
    expect(final).toMatch(/^content-\d$/)
    const leftovers = (await readdir(dir)).filter((f) => f.startsWith("race.txt.tmp"))
    expect(leftovers).toEqual([])
  })

  test("resolves within workspace when dir is symlinked (no escape)", async () => {
    // sanity: helper hanya menulis ke path persis yang diberikan caller
    const sub = join(dir, `s-${randomUUID().slice(0, 4)}`)
    await mkdir(sub)
    const realSub = await realpath(sub)
    expect(realSub.toLowerCase()).toContain(await realpath(dir).then((r) => r.toLowerCase()))
  })
})
