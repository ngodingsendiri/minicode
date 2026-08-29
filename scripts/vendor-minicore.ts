#!/usr/bin/env bun
// Sinkronkan kernel minicore ke vendor/minicore/ supaya `bun install` jalan
// tanpa clone sibling ../minicore.
//
// Kenapa vendor dan bukan npm? Publish ke registry butuh kredensial dan tidak
// bisa dibatalkan; vendor bersifat lokal, reversible, dan membuat repo ini
// self-contained hari ini. Kalau minicore nanti terbit di npm, cukup ganti
// dependency dan hapus direktori ini.
//
// Sumber kebenaran tetap ../minicore. Script ini menolak menimpa bila sumber
// tidak ada, dan `--check` memverifikasi vendor tidak tertinggal (dipakai CI).
//
// Usage:
//   bun scripts/vendor-minicore.ts          # sync dari ../minicore
//   bun scripts/vendor-minicore.ts --check  # exit 1 bila beda / tidak sinkron

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "..")
// Nama direktori, BUKAN spesifier import. Jangan pakai prefix "#" di sini —
// itu hanya untuk subpath imports di package.json.
const source = resolve(repoRoot, "..", "minicore")
const target = resolve(repoRoot, "vendor", "minicore")
const checkOnly = process.argv.includes("--check")

// Hanya yang dibutuhkan runtime + fixture test yang dipakai test minicode.
// Test/docs/experiments minicore lainnya tetap di repo asal.
const INCLUDE_DIRS = ["src"]
const INCLUDE_FILES = ["package.json", "LICENSE", "test/fakes.ts"]

function listFiles(dir: string, base: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, base, out)
    else out.push(relative(base, full).replace(/\\/g, "/"))
  }
  return out
}

function collect(root: string): string[] {
  const files: string[] = []
  for (const d of INCLUDE_DIRS) files.push(...listFiles(join(root, d), root))
  for (const f of INCLUDE_FILES) if (existsSync(join(root, f))) files.push(f)
  return files.sort()
}

function hashOf(root: string, files: string[]): string {
  const h = createHash("sha256")
  for (const f of files) {
    h.update(f)
    h.update("\0")
    const p = join(root, f)
    h.update(existsSync(p) ? readFileSync(p) : Buffer.alloc(0))
    h.update("\0")
  }
  return h.digest("hex").slice(0, 16)
}

const vendorFiles = collect(target)

if (!existsSync(source)) {
  // Tanpa sibling kita tidak bisa sync — tapi vendor yang sudah ada tetap sah.
  if (vendorFiles.length > 0) {
    console.log(
      `[vendor] ../minicore tidak ada — memakai vendor/minicore yang sudah ada (${vendorFiles.length} file, ${hashOf(target, vendorFiles)})`,
    )
    process.exit(0)
  }
  console.error("[vendor] ../minicore tidak ada DAN vendor/minicore kosong — tidak bisa lanjut")
  process.exit(1)
}

const sourceFiles = collect(source)
if (sourceFiles.length === 0) {
  console.error(`[vendor] tidak ada file untuk disalin dari ${source}`)
  process.exit(1)
}

const sourceHash = hashOf(source, sourceFiles)
const vendorHash = hashOf(target, vendorFiles)

if (checkOnly) {
  const sameSet =
    sourceFiles.length === vendorFiles.length && sourceFiles.every((f, i) => f === vendorFiles[i])
  if (sameSet && sourceHash === vendorHash) {
    console.log(`[vendor] sinkron (${sourceFiles.length} file, ${sourceHash})`)
    process.exit(0)
  }
  console.error(
    `[vendor] TIDAK sinkron — source ${sourceFiles.length}/${sourceHash} vs vendor ${vendorFiles.length}/${vendorHash}`,
  )
  console.error("[vendor] jalankan: bun run vendor:minicore")
  process.exit(1)
}

let written = 0
for (const f of sourceFiles) {
  const from = join(source, f)
  const to = join(target, f)
  const next = readFileSync(from)
  if (existsSync(to) && statSync(to).size === next.length && readFileSync(to).equals(next)) continue
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, next)
  written++
}

// Jejak asal supaya jelas vendor ini turunan commit mana.
const head = (() => {
  try {
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process")
    const r = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" })
    return r.status === 0 ? r.stdout.trim() : "unknown"
  } catch {
    return "unknown"
  }
})()
writeFileSync(
  join(target, "VENDOR.md"),
  [
    "# vendor/minicore — JANGAN EDIT MANUAL",
    "",
    "Salinan kernel MiniCore agar `bun install` tidak membutuhkan clone sibling",
    "`../minicore`. Sumber kebenaran tetap repo minicore.",
    "",
    `- source commit: \`${head}\``,
    `- files: ${sourceFiles.length}`,
    `- hash: \`${hashOf(source, sourceFiles)}\``,
    "",
    "Perbarui dengan `bun run vendor:minicore` (butuh `../minicore`).",
    "CI memverifikasi kesinkronan lewat `bun run vendor:check`.",
    "",
  ].join("\n"),
)

console.log(
  `[vendor] ${written} file diperbarui dari ${source} (${sourceFiles.length} total, ${sourceHash})`,
)
