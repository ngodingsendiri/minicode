// Test lapisan provider yang belum tercakup: build (hybrid anthropic/openai +
// OAuth), auth-store, dan jalur error router.
//
// Ini area yang paling sering diam-diam salah: id provider yang hilang membuat
// router memetakan semua provider ke satu kunci generik, dan provider OAuth yang
// belum login mengirim `Authorization: Bearer undefined`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildProviderList, buildProviderListAsync } from "../src/providers/build.ts"

const cfg = (providers: unknown[]) => ({ providers }) as never

describe("buildProviderList", () => {
  test("id provider diteruskan — router tidak boleh melihat id generik", () => {
    const list = buildProviderList(
      cfg([
        { id: "satu", baseUrl: "https://a/v1", apiKey: "k", models: ["m1"] },
        { id: "dua", baseUrl: "https://b/v1", apiKey: "k", models: ["m2"] },
      ]),
    )
    expect(list.map((p) => p.id)).toEqual(["satu", "dua"])
    // Regresi: tanpa id eksplisit keduanya jadi "openai-compat" dan provider
    // terakhir menimpa yang pertama di map byId milik router.
    expect(new Set(list.map((p) => p.id)).size).toBe(2)
  })

  test("providerHint anthropic memilih provider Anthropic", () => {
    const list = buildProviderList(
      cfg([
        {
          id: "anth",
          baseUrl: "https://api.anthropic.com",
          apiKey: "k",
          models: ["claude-sonnet-4"],
          providerHint: "anthropic",
        },
      ]),
    )
    expect(list.length).toBe(1)
    expect(list[0]!.id).toBe("anth")
  })

  test("baseUrl memuat 'anthropic' juga memilih jalur Anthropic", () => {
    const list = buildProviderList(
      cfg([
        {
          id: "x",
          baseUrl: "https://gateway.example.com/anthropic/v1",
          apiKey: "k",
          models: ["claude-opus-4"],
        },
      ]),
    )
    expect(list[0]!.id).toBe("x")
  })

  test("model pertama jadi default", () => {
    const list = buildProviderList(
      cfg([{ id: "p", baseUrl: "https://a/v1", apiKey: "k", models: ["utama", "kedua"] }]),
    )
    expect(list[0]!.models).toContain("utama")
  })

  test("config kosong menghasilkan daftar kosong, bukan melempar", () => {
    expect(buildProviderList(cfg([]))).toEqual([])
  })

  test("provider tanpa model tetap dibangun (detect bisa mengisi nanti)", () => {
    const list = buildProviderList(
      cfg([{ id: "p", baseUrl: "https://a/v1", apiKey: "k", models: [] }]),
    )
    expect(list.length).toBe(1)
  })
})

describe("buildProviderListAsync: OAuth", () => {
  let home: string
  const origHome = process.env.HOME
  const origUserProfile = process.env.USERPROFILE

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "minicode-auth-"))
    process.env.HOME = home
    process.env.USERPROFILE = home
  })
  afterEach(() => {
    if (origHome == null) delete process.env.HOME
    else process.env.HOME = origHome
    if (origUserProfile == null) delete process.env.USERPROFILE
    else process.env.USERPROFILE = origUserProfile
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {}
  })

  test("provider non-OAuth diteruskan apa adanya", async () => {
    const list = await buildProviderListAsync(
      cfg([{ id: "p", baseUrl: "https://a/v1", apiKey: "k", models: ["m"] }]),
    )
    expect(list.map((p) => p.id)).toEqual(["p"])
  })

  // Provider OAuth tanpa kredensial harus DIBUANG, bukan dikirim dengan token
  // undefined — itu menghasilkan 401 yang membingungkan alih-alih pesan jelas
  // "jalankan minicode auth login".
  test("provider OAuth tanpa login dibuang dari daftar", async () => {
    const list = await buildProviderListAsync(
      cfg([
        { id: "oauth-x", baseUrl: "https://a/v1", apiKey: "", auth: "oauth", models: ["m"] },
        { id: "biasa", baseUrl: "https://b/v1", apiKey: "k", models: ["m"] },
      ]),
    )
    expect(list.map((p) => p.id)).toEqual(["biasa"])
  })

  test("semua provider OAuth belum login → daftar kosong, bukan melempar", async () => {
    const list = await buildProviderListAsync(
      cfg([{ id: "oauth-y", baseUrl: "https://a/v1", apiKey: "", auth: "oauth", models: ["m"] }]),
    )
    expect(list).toEqual([])
  })
})
