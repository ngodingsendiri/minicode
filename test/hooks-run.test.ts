import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, expect, test } from "bun:test"
import { findRunHooks } from "../src/hooks/run.ts"

const dir = join(tmpdir(), `minicode-hooks-test-${process.pid}`)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("findRunHooks: discover pre/post *.js di .minicode/hooks lokal", () => {
  const hooks = join(dir, ".minicode", "hooks")
  mkdirSync(hooks, { recursive: true })
  writeFileSync(join(hooks, "pre-run.js"), "// pre")
  writeFileSync(join(hooks, "post-deploy.js"), "// post")
  writeFileSync(join(hooks, "notes.txt"), "ignore me")

  const found = findRunHooks(dir)
  expect(found.pre.some((f) => f.endsWith("pre-run.js"))).toBe(true)
  expect(found.post.some((f) => f.endsWith("post-deploy.js"))).toBe(true)
  expect(found.pre.length + found.post.length).toBe(2)
})

test("findRunHooks: tanpa dir → kosong", () => {
  const found = findRunHooks(join(dir, "nonexistent"))
  expect(found.pre.length).toBe(0)
  expect(found.post.length).toBe(0)
})
