// Alur interaktif `runProviderManager`: a (tambah), d (hapus), e (ubah).
//
// Ketiganya sebelumnya tak tersentuh (43% lines) karena memakai
// `askLine`/`askSecret` DI DALAM raw mode yang di-suspend: harness lama hanya
// bisa mengirim keystroke ke listener yang ada saat itu, sementara setiap prompt
// baru memasang listener-nya sendiri setelah yang sebelumnya selesai.
// `tty.answerSequence()` (lihat helpers/tui-harness.ts) menutup celah itu dengan
// menunggu tiap pemasangan listener baru.
//
// Config global di `~/.minicode/config.json` dicadangkan dan dikembalikan:
// `src/config.ts` menghitung path itu saat import, jadi tidak bisa dialihkan
// lewat env dari dalam proses. Pola ini sama dengan `test/sync.test.ts`.

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { runProviderManager } from "../cli/provider-manager.ts"
import { clearDetectCache } from "../src/providers/detect.ts"
import { stripAnsi } from "../src/tui/theme.ts"
import { type FakeTty, installFakeTty, KEY } from "./helpers/tui-harness.ts"

const globalPath = join(homedir(), ".minicode", "config.json")
const globalBak = `${globalPath}.bak-provider-manager-test`
const hadGlobal = existsSync(globalPath)
if (hadGlobal) await rename(globalPath, globalBak).catch(() => {})
await mkdir(join(homedir(), ".minicode"), { recursive: true }).catch(() => {})

const origFetch = globalThis.fetch
/** Deteksi model berhasil dengan dua model. */
const okFetch = (async (url: unknown) => {
  if (String(url).includes("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), {
      status: 200,
    })
  }
  return new Response("nf", { status: 404 })
}) as typeof fetch
/** Semua endpoint gagal â€” memaksa jalur fallback/rollback. */
const failFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch

let tty: FakeTty | undefined
let workspace: string

const tmpRoots: string[] = []

beforeEach(async () => {
  clearDetectCache()
  globalThis.fetch = okFetch
  workspace = mkdtempSync(join(tmpdir(), "minicode-pm-"))
  tmpRoots.push(workspace)
  await mkdir(join(workspace, ".minicode"), { recursive: true })
  await writeFile(globalPath, JSON.stringify({ providers: [] }), "utf8")
})

afterEach(() => {
  tty?.restore()
  tty = undefined
})

afterAll(async () => {
  globalThis.fetch = origFetch
  clearDetectCache()
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true })
  try {
    if (hadGlobal) await rename(globalBak, globalPath)
    else rmSync(globalPath, { force: true })
  } catch {}
})

const localConfigPath = () => join(workspace, ".minicode", "config.json")

async function writeLocalProviders(providers: unknown[]): Promise<void> {
  await writeFile(localConfigPath(), JSON.stringify({ providers }), "utf8")
}

async function readConfig(
  path: string,
): Promise<{ providers: { id: string; models: string[] }[] }> {
  return JSON.parse(await readFile(path, "utf8")) as {
    providers: { id: string; models: string[] }[]
  }
}

const visible = (t: FakeTty): string => stripAnsi(t.all())

interface Manager {
  done: Promise<void>
  /** Tutup manager dan tunggu promisenya selesai. */
  close(): Promise<void>
}

async function openManager(
  opts: { currentModel?: string; setModelOverride?: (m: string) => void } = {},
): Promise<Manager> {
  const t = tty
  if (!t) throw new Error("installFakeTty harus dipanggil lebih dulu")
  const done = runProviderManager({ cwd: workspace, ...opts })
  await t.ready()
  return {
    done,
    async close() {
      await t.send(KEY.esc, 30)
      await done
    },
  }
}

describe.serial("provider-manager: tambah (a)", () => {
  test("preset + scope local menyimpan provider ke config lokal", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    // "0" = preset pertama (OpenAI), "sk-1" = API key, "n" = simpan lokal.
    const seq = tty.answerSequence(["0", "sk-1", "n"])
    await tty.send("a")
    await seq
    const out = visible(tty)
    expect(out).toContain("Add provider")
    expect(out).toContain("saved")
    const cfg = await readConfig(localConfigPath())
    expect(cfg.providers).toHaveLength(1)
    expect(cfg.providers[0]?.id).toBe("openai")
    expect(cfg.providers[0]?.models).toEqual(["model-a", "model-b"])
    // Global tetap kosong â€” scope dihormati.
    expect((await readConfig(globalPath)).providers).toHaveLength(0)
    await mgr.close()
  })

  test("scope global (jawaban Y) menyimpan ke ~/.minicode", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["0", "sk-1", "y"])
    await tty.send("a")
    await seq
    expect((await readConfig(globalPath)).providers).toHaveLength(1)
    await mgr.close()
  })

  test("URL kustom dipakai apa adanya", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    // Indeks setelah preset terakhir = opsi "Base URL kustom".
    const { GATEWAY_PRESETS } = await import("../src/providers/presets.ts")
    const seq = tty.answerSequence([
      String(GATEWAY_PRESETS.length),
      "https://gw.contoh/v1",
      "sk-2",
      "n",
    ])
    await tty.send("a")
    await seq
    const cfg = JSON.parse(await readFile(localConfigPath(), "utf8")) as {
      providers: { baseUrl: string }[]
    }
    expect(cfg.providers[0]?.baseUrl).toBe("https://gw.contoh/v1")
    await mgr.close()
  })

  test("URL kustom kosong -> pesan wajib diisi, tidak ada yang saved", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const { GATEWAY_PRESETS } = await import("../src/providers/presets.ts")
    const seq = tty.answerSequence([String(GATEWAY_PRESETS.length), ""])
    await tty.send("a")
    await seq
    expect(visible(tty)).toContain("Base URL is required")
    expect(existsSync(localConfigPath())).toBe(false)
    await mgr.close()
  })

  test("API key kosong -> pesan wajib diisi, tidak ada yang saved", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["0", ""])
    await tty.send("a")
    await seq
    expect(visible(tty)).toContain("API key is required")
    expect(existsSync(localConfigPath())).toBe(false)
    await mgr.close()
  })

  test("Ctrl+C pada askSecret membatalkan dialog TANPA mematikan sesi", async () => {
    // Regresi: askSecret dulu memanggil process.exit(130) di sini. Karena
    // provider-manager adalah dialog di dalam REPL, itu mematikan seluruh sesi
    // (beserta riwayatnya) hanya karena user salah ketik API key.
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    let epoch = tty.listenerEpoch()
    epoch = await tty.waitForNewListener(epoch - 1) // listener manager sudah ada
    const seq = (async () => {
      const afterPick = await tty.waitForNewListener(tty.listenerEpoch())
      await tty.send("0\r")
      await tty.waitForNewListener(afterPick)
      await tty.send(KEY.ctrlC, 30)
    })()
    await tty.send("a")
    await seq
    expect(visible(tty)).toContain("API key is required")
    // Manager masih hidup: Esc masih bisa menutupnya (kalau proses mati, ini
    // tidak akan pernah selesai).
    await mgr.close()
  })

  test("pilihan nomor di luar daftar -> 'Unknown selection'", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["999"])
    await tty.send("a")
    await seq
    expect(visible(tty)).toContain("Unknown selection")
    await mgr.close()
  })

  test("deteksi model gagal dilaporkan, bukan dilempar ke atas", async () => {
    globalThis.fetch = failFetch
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    // Preset punya fallbackModels, jadi provider TETAP saved â€” yang diuji
    // adalah tidak ada exception yang keluar dari dialog.
    const seq = tty.answerSequence(["0", "sk-3", "n"])
    await tty.send("a")
    await seq
    expect(tty.failures()).toEqual([])
    await mgr.close()
  })
})

describe.serial("provider-manager: hapus (d)", () => {
  const oneProvider = [
    { id: "gw", baseUrl: "https://gw.example/v1", apiKey: "k", models: ["m1", "m2", "m3"] },
  ]

  test("konfirmasi 'y' menghapus dari config lokal dan global", async () => {
    await writeLocalProviders(oneProvider)
    await writeFile(globalPath, JSON.stringify({ providers: oneProvider }), "utf8")
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["y"])
    await tty.send("d")
    await seq
    const out = visible(tty)
    // Konfirmasi menyebut DAMPAK: berapa model ikut hilang.
    expect(out).toContain("and 3 models")
    expect(out).toContain("deleted")
    expect((await readConfig(localConfigPath())).providers).toHaveLength(0)
    expect((await readConfig(globalPath)).providers).toHaveLength(0)
    await mgr.close()
  })

  test("konfirmasi 'n' membatalkan â€” provider tetap ada", async () => {
    await writeLocalProviders(oneProvider)
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["n"])
    await tty.send("d")
    await seq
    expect(visible(tty)).toContain("Canceled")
    expect((await readConfig(localConfigPath())).providers).toHaveLength(1)
    await mgr.close()
  })

  test("Enter kosong sama dengan menolak (default N)", async () => {
    await writeLocalProviders(oneProvider)
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence([""])
    await tty.send("d")
    await seq
    expect((await readConfig(localConfigPath())).providers).toHaveLength(1)
    await mgr.close()
  })

  test("menghapus provider yang Provider is active memberi peringatan eksplisit", async () => {
    await writeLocalProviders(oneProvider)
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager({ currentModel: "gw::m1" })
    // Daftar menandai provider aktif sebelum user menekan d.
    expect(visible(tty)).toContain("(active)")
    const seq = tty.answerSequence(["y"])
    await tty.send("d")
    await seq
    const out = visible(tty)
    expect(out).toContain("(active)")
    expect(out).toContain("Provider is active")
    await mgr.close()
  })

  test("daftar kosong: d tidak melakukan apa pun", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    await tty.send("d", 40)
    expect(visible(tty)).not.toContain("Lanjut hapus")
    expect(tty.failures()).toEqual([])
    await mgr.close()
  })
})

describe.serial("provider-manager: ubah (e)", () => {
  test("mengganti baseUrl memicu deteksi ulang", async () => {
    await writeLocalProviders([
      { id: "gw", baseUrl: "https://lama.example/v1", apiKey: "k", models: ["lama"] },
    ])
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["https://baru.example/v1", ""])
    await tty.send("e")
    await seq
    const out = visible(tty)
    expect(out).toContain('Edit provider "gw"')
    expect(out).toContain("updated")
    // Entri updated ditulis ke global (perilaku doEdit: global: true).
    const cfg = JSON.parse(await readFile(globalPath, "utf8")) as {
      providers: { baseUrl: string; models: string[] }[]
    }
    expect(cfg.providers[0]?.baseUrl).toBe("https://baru.example/v1")
    expect(cfg.providers[0]?.models).toEqual(["model-a", "model-b"])
    await mgr.close()
  })

  test("kedua isian dikosongkan -> 'No changes'", async () => {
    await writeLocalProviders([
      { id: "gw", baseUrl: "https://gw.example/v1", apiKey: "k", models: ["m1"] },
    ])
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["", ""])
    await tty.send("e")
    await seq
    expect(visible(tty)).toContain("No changes")
    // Config lokal tidak tersentuh.
    expect((await readConfig(localConfigPath())).providers[0]?.models).toEqual(["m1"])
    await mgr.close()
  })

  test("simpan gagal -> pesan error + rollback dicoba, tanpa exception", async () => {
    // Provider tanpa model + deteksi gagal = saveProvider menolak ("provider
    // Update failed"). Itu satu-satunya jalur di doEdit yang mencapai catch
    // dan rollback.
    globalThis.fetch = failFetch
    await writeLocalProviders([
      { id: "gw", baseUrl: "https://gw.example/v1", apiKey: "k", models: [] },
    ])
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    const seq = tty.answerSequence(["https://baru.example/v1", ""])
    await tty.send("e")
    await seq
    expect(visible(tty)).toContain("updated")
    expect(tty.failures()).toEqual([])
    await mgr.close()
  })

  test("daftar kosong: e tidak melakukan apa pun", async () => {
    tty = installFakeTty({ rows: 24 })
    const mgr = await openManager()
    await tty.send("e", 40)
    expect(visible(tty)).not.toContain("Edit provider")
    await mgr.close()
  })
})

describe.serial("provider-manager: navigasi", () => {
  test("panah bawah memindah seleksi, Enter mengaktifkan model pertama", async () => {
    await writeLocalProviders([
      { id: "satu", baseUrl: "https://a.example/v1", apiKey: "k", models: ["a1"] },
      { id: "dua", baseUrl: "https://b.example/v1", apiKey: "k", models: ["b1"] },
    ])
    tty = installFakeTty({ rows: 24 })
    let picked: string | undefined
    const mgr = await openManager({
      setModelOverride: (m) => {
        picked = m
      },
    })
    await tty.send(KEY.down)
    await tty.send(KEY.enter, 30)
    await mgr.done
    expect(picked).toBe("dua::b1")
  })

  test("panah atas di baris pertama tidak keluar dari batas", async () => {
    await writeLocalProviders([
      { id: "satu", baseUrl: "https://a.example/v1", apiKey: "k", models: ["a1"] },
    ])
    tty = installFakeTty({ rows: 24 })
    let picked: string | undefined
    const mgr = await openManager({
      setModelOverride: (m) => {
        picked = m
      },
    })
    await tty.send(KEY.up)
    await tty.send(KEY.up)
    await tty.send(KEY.enter, 30)
    await mgr.done
    expect(picked).toBe("satu::a1")
  })

  test("Ctrl+C dan Ctrl+D menutup manager seperti Esc", async () => {
    for (const key of [KEY.ctrlC, KEY.ctrlD]) {
      tty?.restore()
      tty = installFakeTty({ rows: 24 })
      const done = runProviderManager({ cwd: workspace })
      await tty.ready()
      await tty.send(key, 30)
      await done
    }
    expect(true).toBe(true)
  })

  test("resize menggambar ulang tanpa melebihi lebar terminal", async () => {
    await writeLocalProviders(
      Array.from({ length: 8 }, (_, i) => ({
        id: `provider-dengan-nama-panjang-${i}`,
        baseUrl: `https://contoh-gateway-yang-panjang-sekali-${i}.example/v1`,
        apiKey: "k",
        models: ["m1"],
      })),
    )
    tty = installFakeTty({ columns: 40, rows: 10 })
    const mgr = await openManager()
    tty.clear()
    tty.resize(30, 8)
    await new Promise((r) => setTimeout(r, 20))
    for (const line of stripAnsi(tty.all()).split("\n")) {
      expect(line.replace(/\s+$/, "").length).toBeLessThanOrEqual(30)
    }
    await mgr.close()
  })

  test("daftar lebih panjang dari layar menampilkan indikator sisa", async () => {
    await writeLocalProviders(
      Array.from({ length: 12 }, (_, i) => ({
        id: `gw${i}`,
        baseUrl: `https://gw${i}.example/v1`,
        apiKey: "k",
        models: ["m1"],
      })),
    )
    // rows 8 -> visibleRows = max(1, min(8-4, 14)) = 4.
    tty = installFakeTty({ columns: 80, rows: 8 })
    const mgr = await openManager()
    expect(visible(tty)).toContain("lagi")
    await mgr.close()
  })
})

describe.serial("provider-manager: non-TTY", () => {
  test("mendaftar provider apa adanya tanpa raw mode", async () => {
    await writeLocalProviders([
      { id: "gw", baseUrl: "https://gw.example/v1", apiKey: "k", models: ["m1", "m2"] },
    ])
    tty = installFakeTty({ isTTY: false })
    await runProviderManager({ cwd: workspace })
    const out = visible(tty)
    expect(out).toContain("gw")
    expect(out).toContain("2 models")
  })
})

// Sanity: workspace benar-benar terisolasi dari repo.
test("workspace test berada di direktori temp, bukan repo", () => {
  expect(resolve(workspace).startsWith(resolve(tmpdir()))).toBe(true)
})
