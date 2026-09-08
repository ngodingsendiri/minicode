// minicode doctor: diagnosis lokal tanpa jaringan — exit 0 + skema JSON stabil.

import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildDoctorReport, renderDoctorText } from "../cli/commands/doctor.ts"
import { promptAskText } from "../src/ui/approval/prompt.ts"

const repoRoot = resolve(import.meta.dir, "..")
const entry = join(repoRoot, "cli", "index.ts")

function run(args: string[]) {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1" },
  })
  return { code: r.status ?? -1, stdout: r.stdout ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

test("doctor: teks memuat semua bagian", () => {
  const r = run(["doctor"])
  expect(r.code).toBe(0)
  for (const part of ["runtime", "providers", "pricing", "memory", "sandbox", "config"]) {
    expect(r.out).toContain(part)
  }
})

test("doctor --json: skema stabil untuk skrip", () => {
  const r = run(["doctor", "--json"])
  expect(r.code).toBe(0)
  const j = JSON.parse(r.stdout) as Record<string, unknown>
  for (const k of [
    "bun",
    "platform",
    "providers",
    "providerModels",
    "pricing",
    "memoryRows",
    "sandboxOs",
    "sandboxDocker",
    "fallbackNote",
    "configGlobal",
    "configLocal",
    "hardening",
  ]) {
    expect(k in j).toBe(true)
  }
  expect(typeof j.sandboxOs).toBe("string")
})

test("buildDoctorReport: in-process, tanpa jaringan, fallback jujur", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minicode-doctor-"))
  try {
    const r = await buildDoctorReport(dir)
    expect(typeof r.providers).toBe("number")
    expect(typeof r.memoryRows).toBe("number")
    expect(typeof r.pricing.stale).toBe("boolean")
    // Mesin ini tanpa sandbox OS/docker → catatan fallback wajib ada.
    if (r.sandboxOs === "none" && !r.sandboxDocker) {
      expect(r.fallbackNote).toContain("allowlist")
    }
    expect(r.configLocal).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

test("promptAskText: non-TTY → null (tak boleh gantung di CI)", async () => {
  if (!process.stdin.isTTY) {
    expect(await promptAskText("lanjut?", ["ya", "tidak"])).toBeNull()
  }
})

test("renderDoctorText: semua bagian tampil + cabang warn", () => {
  const base = {
    bun: "v9",
    platform: "linux",
    providers: 2,
    providerModels: 5,
    pricing: { models: 10, ageH: 2 as number | null, stale: false },
    memoryRows: 7,
    sandboxOs: "bwrap",
    sandboxDocker: false,
    fallbackNote: "sandbox available",
    configGlobal: true,
    configLocal: false,
    hardening: { bashGuard: true, jail: true, scrub: true, perms: true },
  }
  const ok = renderDoctorText(base)
  for (const part of ["runtime", "providers", "pricing", "memory", "sandbox", "config"]) {
    expect(ok).toContain(part)
  }
  expect(ok).toContain("age 2h")
  // Cabang kosong: tanpa provider, tanpa pricing, stale.
  const empty = renderDoctorText({
    ...base,
    providers: 0,
    providerModels: 0,
    pricing: { models: 0, ageH: null, stale: true },
  })
  expect(empty).toContain("wizard or config add")
  expect(empty).toContain("never synced")
  // Provider ada tapi 0 models = warn spesifik, bukan ok.
  const nomodel = renderDoctorText({ ...base, providers: 1, providerModels: 0 })
  expect(nomodel).toContain("no models")
  const stale = renderDoctorText({ ...base, pricing: { models: 3, ageH: 99, stale: true } })
  expect(stale).toContain("stale")
})
