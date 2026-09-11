import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { refreshProviderModels } from "../src/providers/provision.ts"

const globalPath = join(homedir(), ".minicode", "config.json")
const globalBak = `${globalPath}.bak-sync-test`
const hadGlobal = existsSync(globalPath)
if (hadGlobal) await rename(globalPath, globalBak).catch(() => {})
await mkdir(join(homedir(), ".minicode"), { recursive: true }).catch(() => {})
// ensure global is empty during this test suite
await writeFile(globalPath, JSON.stringify({ providers: [] }), "utf8").catch(() => {})

const tmp = mkdtempSync(join(tmpdir(), "minicode-sync-"))
const localCwd = resolve(tmp, "proj")
await mkdir(join(localCwd, ".minicode"), { recursive: true })
const localConfig = join(localCwd, ".minicode", "config.json")

// stub fetch untuk deteksi
const origFetch = globalThis.fetch
globalThis.fetch = (async (url: unknown) => {
  const u = String(url)
  if (u.includes("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), {
      status: 200,
    })
  }
  return new Response("nf", { status: 404 })
}) as typeof fetch

afterAll(async () => {
  globalThis.fetch = origFetch
  rmSync(tmp, { recursive: true, force: true })
  // restore global config
  try {
    if (hadGlobal) {
      await rename(globalBak, globalPath)
    } else {
      rmSync(globalPath, { force: true })
    }
  } catch {}
  const { clearDetectCache } = await import("../src/providers/detect.ts")
  clearDetectCache()
})

test("sync: refreshProviderModels updates config models (local)", async () => {
  await writeFile(
    localConfig,
    JSON.stringify({
      providers: [
        { id: "gw", baseUrl: "https://gw.example/v1", apiKey: "k", models: ["old-only"] },
      ],
    }),
  )
  const { updated, failed } = await refreshProviderModels({ cwd: localCwd, allowLocal: true })
  expect(failed).toEqual([])
  expect(updated.length).toBe(1)
  expect(updated[0]).toEqual({ id: "gw", from: 1, to: 2 })
  const cfg = JSON.parse(await readFile(localConfig, "utf8"))
  expect(cfg.providers[0].models).toEqual(["model-a", "model-b"])
  expect(cfg.providers[0].apiKey).toBe("k") // secrets intak
})

test("sync: provider DI LOCAL tetap terupdate tanpa flag global eksplisit", async () => {
  const { clearDetectCache } = await import("../src/providers/detect.ts")
  clearDetectCache() // pastikan tidak kena cache 30 menit dari test 1
  // Simulasi bug: user simpan provider di local tapi /sync tanpa global flag
  const cfgBefore = JSON.parse(await readFile(localConfig, "utf8"))
  expect(cfgBefore.providers[0].models).toEqual(["model-a", "model-b"])
  // update stub jadi 3 model
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url)
    if (u.includes("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] }), {
        status: 200,
      })
    }
    return new Response("nf", { status: 404 })
  }) as typeof fetch
  const { updated, failed } = await refreshProviderModels({ cwd: localCwd, allowLocal: true })
  expect(failed).toEqual([])
  expect(updated.length).toBe(1)
  expect(updated[0]).toEqual({ id: "gw", from: 2, to: 3 })
  const cfg = JSON.parse(await readFile(localConfig, "utf8"))
  expect(cfg.providers[0].models).toEqual(["m1", "m2", "m3"])
})

test("sync: tanpa provider di merge → hasil kosong tanpa throw", async () => {
  const { clearDetectCache } = await import("../src/providers/detect.ts")
  clearDetectCache()
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch
  const empty = resolve(mkdtempSync(join(tmpdir(), "minicode-sync-empty-")), "nope")
  const res = await refreshProviderModels({ cwd: empty, allowLocal: true })
  expect(res).toEqual({ updated: [], failed: [] })
})

test("sync: provider unreachable tercatat di failed, bukan hasil kosong", async () => {
  const { clearDetectCache } = await import("../src/providers/detect.ts")
  clearDetectCache()
  // fetch selalu throw (jaringan mati) — bedakan dari "tak ada provider".
  globalThis.fetch = (async () => {
    throw new Error("socket hang up")
  }) as unknown as typeof fetch
  await writeFile(
    localConfig,
    JSON.stringify({
      providers: [{ id: "down", baseUrl: "https://down.example/v1", apiKey: "k", models: ["m"] }],
    }),
  )
  const { updated, failed } = await refreshProviderModels({ cwd: localCwd, allowLocal: true })
  expect(updated).toEqual([])
  expect(failed.length).toBe(1)
  expect(failed[0]?.id).toBe("down")
})
