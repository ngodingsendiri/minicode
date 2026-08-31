#!/usr/bin/env bun
// Coverage gate agregat.
//
// Kenapa tidak `bunfig.toml` `coverageThreshold`? Bun mengevaluasi threshold
// itu PER FILE, bukan agregat — dengan 0.01 pun run tetap gagal karena ada file
// 0% (mis. src/sandbox/os.ts yang hanya jalan di Linux/macOS). Gate agregat
// harus dihitung dari baris "All files" pada tabel coverage.
//
// Sebelumnya CI memberi label "Test with coverage (threshold 80)" padahal
// `bun test --coverage` tanpa konfigurasi apa pun selalu lulus — gate-nya fiksi.
// Script ini menjadikannya nyata.
//
// Usage: bun scripts/coverage-gate.ts [--lines N] [--funcs N]

import { spawnSync } from "node:child_process"

function getArg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}

// Baseline terukur setelah penambahan test lapisan UI (harness fake-TTY untuk
// askLine/picker + handler subcommand): 79,26% funcs /
// 82,13% lines. Ambil sedikit di bawah supaya CI tidak flaky, lalu naikkan
// bertahap. Riwayat: 0.7.0 = 71,95%/76,76%.
// Baseline baru setelah test anti-frozen runtime, highlight adversarial,
// provider-manager flows, dan CLI subprocess: 82,36% funcs / 84,16% lines.
// Ambil sedikit di bawah hasil terukur agar gate tetap tahan flake, tetapi
// naik dari baseline lama supaya coverage tidak bisa mundur diam-diam.
const MIN_LINES = getArg("--lines", 83)
const MIN_FUNCS = getArg("--funcs", 81)

const res = spawnSync("bun", ["test", "--coverage"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
})
const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`

if (res.status !== 0 && !/\d+ pass/.test(output)) {
  process.stderr.write(output.slice(-4000))
  console.error("[coverage-gate] test run failed")
  process.exit(1)
}

const failCount = Number(/(\d+) fail/.exec(output)?.[1] ?? "0")
if (failCount > 0) {
  console.error(`[coverage-gate] ${failCount} test failing — gate tidak dievaluasi`)
  process.exit(1)
}

// "All files                     |   71.95 |   76.76 |"
const row = /^\s*All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/m.exec(output)
if (!row) {
  console.error("[coverage-gate] baris 'All files' tidak ditemukan di output coverage")
  process.exit(1)
}
const funcs = Number(row[1])
const lines = Number(row[2])

const okFuncs = funcs >= MIN_FUNCS
const okLines = lines >= MIN_LINES
console.log(
  `[coverage-gate] funcs ${funcs.toFixed(2)}% (min ${MIN_FUNCS}) · lines ${lines.toFixed(2)}% (min ${MIN_LINES})`,
)
if (okFuncs && okLines) process.exit(0)
if (!okFuncs) console.error(`[coverage-gate] FAIL funcs ${funcs.toFixed(2)}% < ${MIN_FUNCS}%`)
if (!okLines) console.error(`[coverage-gate] FAIL lines ${lines.toFixed(2)}% < ${MIN_LINES}%`)
process.exit(1)
