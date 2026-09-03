// Alur interactive `runModelManager` (jalur /model di REPL): pilih, tambah,
// hapus, navigasi. Sebelumnya nol cakupan karena memakai askLine di dalam
// raw mode yang di-suspend â€” ditutup lewat `tty.answerSequence()` (pola yang
// sama dengan test/provider-manager-flows.test.ts).
//
// Config global di `~/.minicode/config.json` dicadangkan dan dikembalikan:
// `src/config.ts` menghitung path itu saat import, jadi tidak bisa dialihkan
// lewat env dari dalam proses.

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { runModelManager } from "../cli/model-manager.ts"
import { stripAnsi } from "../src/ui/render/theme.ts"
import { type FakeTty, installFakeTty, KEY } from "./helpers/tui-harness.ts"

const globalPath = join(homedir(), ".minicode", "config.json")
const globalBak = `${globalPath}.bak-model-manager-test`
const hadGlobal = existsSync(globalPath)
if (hadGlobal) await rename(globalPath, globalBak).catch(() => {})
await mkdir(join(homedir(), ".minicode"), { recursive: true }).catch(() => {})

let tty: FakeTty | undefined
let workspace: string
let overrideLog: string[] = []

const tmpRoots: string[] = []

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), "minicode-mm-"))
  tmpRoots.push(workspace)
  await mkdir(join(workspace, ".minicode"), { recursive: true })
  const providers = [
    { id: "prov", baseUrl: "https://api.test/v1", apiKey: "k", models: ["m1", "m2"] },
  ]
  await writeFile(
    join(workspace, ".minicode", "config.json"),
    JSON.stringify({ providers }),
    "utf8",
  )
  await writeFile(globalPath, JSON.stringify({ providers }), "utf8")
  overrideLog = []
})

afterEach(() => {
  tty?.restore()
  tty = undefined
})

afterAll(async () => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
  try {
    if (hadGlobal) await rename(globalBak, globalPath)
    else rmSync(globalPath, { force: true })
  } catch {}
})

const localConfigPath = () => join(workspace, ".minicode", "config.json")

async function readConfig(
  path: string,
): Promise<{ providers: { id: string; models: string[] }[] }> {
  return JSON.parse(await readFile(path, "utf8")) as {
    providers: { id: string; models: string[] }[]
  }
}

const visible = () => stripAnsi(tty!.all())

describe("model-manager: non-TTY", () => {
  test("mencetak daftar provider::model tanpa raw mode", async () => {
    tty = installFakeTty({ isTTY: false })
    await runModelManager({ cwd: workspace })
    const out = visible()
    expect(out).toContain("prov::m1")
    expect(out).toContain("prov::m2")
  })
})

describe("model-manager: alur interactive", () => {
  test("render awal menampilkan daftar model + tanda active", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({ cwd: workspace, currentModel: "prov::m2" })
    await tty.ready()
    const out = visible()
    expect(out).toContain("Models")
    expect(out).toContain("prov::m1")
    expect(out).toContain("prov::m2")
    expect(out).toContain("active")
    await tty.send(KEY.esc, 30)
    await p
  }, 30000)

  test("Enter memilih model ter-highlight (setModelOverride dipanggil)", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({
      cwd: workspace,
      currentModel: "prov::m1",
      setModelOverride: (m) => overrideLog.push(m),
    })
    await tty.ready()
    await tty.send(KEY.down, 20) // highlight prov::m2
    await tty.send(KEY.enter, 30)
    await p
    expect(overrideLog).toEqual(["prov::m2"])
  })

  test("a menambah model ke provider via prompt berurutan", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({ cwd: workspace })
    await tty.ready()
    const seq = tty.answerSequence(["prov", "m3"])
    await tty.send("a", 30)
    await seq
    // Model baru harus tersimpan meski output terminal bisa berbeda antar host.
    expect((await readConfig(localConfigPath())).providers[0]?.models).toContain("m3")
    await tty.send(KEY.esc, 30)
    await p
  }, 30000)

  test("a dengan jawaban kosong tidak menambah apa pun", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({ cwd: workspace })
    await tty.ready()
    const seq = tty.answerSequence(["", ""])
    await tty.send("a", 30)
    await seq
    expect((await readConfig(localConfigPath())).providers[0]?.models).not.toContain("m3")
    await tty.send(KEY.esc, 30)
    await p
  })

  test("d menghapus model ter-highlight setelah konfirmasi y", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({ cwd: workspace, currentModel: "prov::m1" })
    await tty.ready()
    const seq = tty.answerSequence(["y"])
    await tty.send("d", 30)
    await seq
    expect((await readConfig(localConfigPath())).providers[0]?.models).not.toContain("m1")
    // Render terakhir tidak lagi menampilkan m1 (hanya m2 yang tersisa).
    const lastRender = visible().split("Models").at(-1) ?? ""
    expect(lastRender).toContain("prov::m2")
    expect(lastRender).not.toContain("prov::m1")
    await tty.send(KEY.esc, 30)
    await p
  })

  test("d dengan jawaban selain y membatalkan penghapusan", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({ cwd: workspace, currentModel: "prov::m1" })
    await tty.ready()
    const seq = tty.answerSequence(["n"])
    await tty.send("d", 30)
    await seq
    expect((await readConfig(localConfigPath())).providers[0]?.models).toContain("m1")
    await tty.send(KEY.esc, 30)
    await p
  })

  test("up/down menjepit di batas daftar", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({ cwd: workspace, currentModel: "prov::m1" })
    await tty.ready()
    tty.clear()
    await tty.send(KEY.up, 20) // sudah di atas: tidak melewati 0
    await tty.send(KEY.enter, 30)
    await p
    expect(overrideLog).toEqual([])
  })

  test("Esc menutup tanpa mengubah model", async () => {
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({
      cwd: workspace,
      setModelOverride: (m) => overrideLog.push(m),
    })
    await tty.ready()
    await tty.send(KEY.esc, 30)
    await p
    expect(overrideLog).toEqual([])
  })
})

describe("model-manager: daftar kosong", () => {
  test("pesan no models & Enter tanpa baris tidak memanggil onSelect", async () => {
    // Config lokal diutamakan — kosongkan keduanya.
    await writeFile(localConfigPath(), JSON.stringify({ providers: [] }), "utf8")
    await writeFile(globalPath, JSON.stringify({ providers: [] }), "utf8")
    tty = installFakeTty({ rows: 24 })
    const p = runModelManager({
      cwd: workspace,
      setModelOverride: (m) => overrideLog.push(m),
    })
    await tty.ready()
    expect(visible()).toContain("No models configured")
    await tty.send(KEY.enter, 30)
    await p
    expect(overrideLog).toEqual([])
  })
})
