// Regresi audit thinking-effort: detectAndSave membangun entri segar tanpa
// reasoningEffort, sehingga /provider add|edit, config add, dan wizard
// menghapus effort yang sudah diatur (balik ke default diam-diam).
// Test memakai fetch mock yang selalu gagal + fallbackModels (hermetic).

import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { clearDetectCache } from "../src/providers/detect.ts"
import { detectAndSave } from "../src/providers/provision.ts"

const globalPath = join(homedir(), ".minicode", "config.json")
const globalBak = `${globalPath}.bak-provision-effort-test`
const hadGlobal = existsSync(globalPath)
if (hadGlobal) renameSync(globalPath, globalBak)
await mkdir(join(homedir(), ".minicode"), { recursive: true }).catch(() => {})
await writeFile(globalPath, JSON.stringify({ providers: [] }), "utf8")

const tmp = mkdtempSync(join(tmpdir(), "minicode-prov-effort-"))

const origFetch = globalThis.fetch
// Jaringan mati total — detectAndSave wajib pakai fallbackModels.
globalThis.fetch = (async () => {
  throw new Error("socket hang up")
}) as unknown as typeof fetch

afterAll(async () => {
  globalThis.fetch = origFetch
  rmSync(tmp, { recursive: true, force: true })
  try {
    if (hadGlobal) renameSync(globalBak, globalPath)
    else rmSync(globalPath, { force: true })
  } catch {}
  clearDetectCache()
})

async function globalProviders(): Promise<
  { id: string; reasoningEffort?: string; models: string[] }[]
> {
  return (JSON.parse(await readFile(globalPath, "utf8")) as { providers: [] }).providers
}

test("detectAndSave mempertahankan reasoningEffort provider yang sudah ada", async () => {
  clearDetectCache()
  await writeFile(
    globalPath,
    JSON.stringify({
      providers: [
        {
          id: "gw",
          baseUrl: "https://gw-effort.example/v1",
          apiKey: "k",
          models: ["m1"],
          reasoningEffort: "high",
        },
      ],
    }),
    "utf8",
  )
  const entry = await detectAndSave("https://gw-effort.example/v1", "k", "gw", {
    global: true,
    fallbackModels: ["fb"],
  })
  expect(entry.reasoningEffort).toBe("high")
  expect(entry.models).toEqual(["fb"])
  const saved = await globalProviders()
  expect(saved.find((p) => p.id === "gw")?.reasoningEffort).toBe("high")
})

test("detectAndSave provider baru tanpa effort tetap tanpa kunci effort", async () => {
  clearDetectCache()
  await writeFile(globalPath, JSON.stringify({ providers: [] }), "utf8")
  const entry = await detectAndSave("https://baru-effort.example/v1", "k", "baru", {
    global: true,
    fallbackModels: ["fb"],
  })
  expect(entry.reasoningEffort).toBeUndefined()
  const saved = await globalProviders()
  expect(saved.find((p) => p.id === "baru")).not.toHaveProperty("reasoningEffort")
})
