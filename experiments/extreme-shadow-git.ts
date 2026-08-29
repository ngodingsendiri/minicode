#!/usr/bin/env bun
// EKSPERIMEN EKSTREM 2 — stress & konkurensi checkpoint shadow-git.
//
// Test unit membuktikan shadow-git benar pada kasus kecil. Yang belum terjawab:
// apakah ia tetap benar dan tetap cepat saat (a) repo besar, (b) beberapa sesi
// menulis snapshot bersamaan, (c) restore dijalankan saat file sedang berubah,
// (d) nama file ekstrem (unicode, spasi, panjang).
//
// Yang diukur, bukan diasumsikan:
//   - waktu snapshot vs jumlah file (apakah benar O(delta) atau O(workspace))
//   - ukuran manifest (harus tetap konstan — hanya SHA)
//   - korektness undo setelah operasi campur (tulis/hapus/rename/nested)
//   - apakah index sementara antar-sesi paralel saling menimpa
//
// Usage: bun experiments/extreme-shadow-git.ts [--files N] [--sessions N]

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  beginTurnSnapshot,
  loadCheckpointManifest,
  recordCheckpointFromTrees,
  redoLastCheckpoint,
  undoLastCheckpoint,
} from "../src/session/checkpoint.ts"
import { listShadowRefs, restoreTree, snapshotTree } from "../src/session/shadow-git.ts"

const arg = (name: string, def: number): number => {
  const i = process.argv.indexOf(name)
  if (i === -1) return def
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : def
}
const FILE_COUNT = arg("--files", 2000)
const SESSIONS = arg("--sessions", 6)

// Repo uji di dalam workspace: shadow-git menjail cwd, dan `.tmp-*` di-gitignore.
const root = join(process.cwd(), `.tmp-extreme-sg-${Date.now().toString(36)}`)
const git = (a: string[]) => spawnSync("git", a, { cwd: root, encoding: "utf8", timeout: 60_000 })

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++
    console.log(`  ok    ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`)
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}
const ms = (t: number) => `${Date.now() - t}ms`

function setup(): void {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  git(["init", "-q"])
  git(["config", "user.email", "t@example.com"])
  git(["config", "user.name", "t"])
  git(["config", "commit.gpgsign", "false"])
  writeFileSync(join(root, ".gitignore"), "ignored/\n*.log\n")
  mkdirSync(join(root, "ignored"), { recursive: true })
  writeFileSync(join(root, "ignored", "secret.txt"), "jangan-tersentuh")
}

async function main(): Promise<void> {
  console.log(`\n=== EXTREME SHADOW-GIT ===\nrepo: ${root}\n`)
  setup()

  // ── 1. skala: snapshot repo besar ──
  console.log(`[1] skala — ${FILE_COUNT} file`)
  const dirs = ["src", "src/deep", "src/deep/deeper", "pkg", "docs"]
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true })
  for (let i = 0; i < FILE_COUNT; i++) {
    const d = dirs[i % dirs.length]!
    writeFileSync(join(root, d, `f${i}.ts`), `export const v${i} = ${i}\n`)
  }
  git(["add", "-A"])
  git(["commit", "-qm", "bulk"])

  let t = Date.now()
  const base = await snapshotTree(root, "skala", "pre")
  const snapMs = Date.now() - t
  check(`snapshot ${FILE_COUNT} file`, base !== null, base ? `${snapMs}ms` : "null")
  console.log(`        snapshot penuh: ${snapMs}ms`)

  // Ubah SATU file lalu snapshot lagi: bila O(delta), waktunya tak jauh berbeda
  // dari snapshot penuh (git add -A tetap men-stat semua file, tapi menulis
  // object hanya untuk yang berubah).
  await writeFile(join(root, "src", "f0.ts"), "export const v0 = 999\n")
  t = Date.now()
  const after = await snapshotTree(root, "skala", "post")
  const deltaMs = Date.now() - t
  console.log(`        snapshot setelah 1 perubahan: ${deltaMs}ms`)
  check("tree berubah setelah 1 file diubah", base!.tree !== after!.tree)

  await recordCheckpointFromTrees("skala", 1, base!.tree, after!.tree, "turn", root)
  const manifestPath = join(root, ".minicode", "checkpoints", "skala", "manifest.json")
  const manifestSize = readFileSync(manifestPath, "utf8").length
  console.log(`        ukuran manifest: ${manifestSize} byte`)
  check("manifest tetap kecil meski repo besar", manifestSize < 2000, `${manifestSize}B`)

  t = Date.now()
  const undo = await undoLastCheckpoint("skala", root)
  console.log(`        undo: ${ms(t)}`)
  check("undo sukses", undo.success)
  check(
    "undo memulihkan isi file",
    (await readFile(join(root, "src", "f0.ts"), "utf8")).includes("v0 = 0"),
  )
  check("undo hanya menyentuh file yang berubah", undo.restoredFiles.length <= 2, `${undo.restoredFiles.length} entri`)

  // ── 2. operasi campur: tulis + hapus + rename + nested baru ──
  console.log("\n[2] operasi campur")
  // File dibagikan round-robin ke `dirs`, jadi indeks yang habis dibagi
  // dirs.length berada di "src". Pakai itu supaya path-nya pasti ada.
  const inSrcA = "src/f5.ts"
  const inSrcB = "src/f10.ts"
  const inPkg = "pkg/f3.ts"
  const pre2 = await snapshotTree(root, "campur", "pre")
  await writeFile(join(root, inSrcA), "diubah\n")
  await rm(join(root, inSrcB))
  await mkdir(join(root, "baru", "nested"), { recursive: true })
  await writeFile(join(root, "baru", "nested", "x.ts"), "baru\n")
  git(["mv", inPkg, "pkg/f3-renamed.ts"])
  const post2 = await snapshotTree(root, "campur", "post")
  await recordCheckpointFromTrees("campur", 1, pre2!.tree, post2!.tree, "campur", root)

  const u2 = await undoLastCheckpoint("campur", root)
  check("undo campur sukses", u2.success)
  check("modifikasi dipulihkan", (await readFile(join(root, inSrcA), "utf8")).includes("v5"))
  check("file terhapus dipulihkan", existsSync(join(root, inSrcB)))
  check("file baru dihapus", !existsSync(join(root, "baru", "nested", "x.ts")))
  check("rename dibalik", existsSync(join(root, inPkg)))
  check("rename target dihapus", !existsSync(join(root, "pkg", "f3-renamed.ts")))

  const r2 = await redoLastCheckpoint("campur", root)
  check("redo sukses", r2.success)
  check(
    "redo mengembalikan modifikasi",
    (await readFile(join(root, inSrcA), "utf8")).includes("diubah"),
  )
  check("redo menghapus lagi file yang dihapus", !existsSync(join(root, inSrcB)))

  // ── 3. konkurensi: beberapa sesi snapshot bersamaan ──
  // Index sementara memakai nama unik per sesi+timestamp. Bila unik-nya tak
  // cukup, dua sesi akan saling menimpa dan tree-nya salah.
  console.log(`\n[3] konkurensi — ${SESSIONS} sesi paralel`)
  await writeFile(join(root, "src", "shared.ts"), "v-awal\n")
  t = Date.now()
  const results = await Promise.all(
    Array.from({ length: SESSIONS }, (_, i) => snapshotTree(root, `sesi-${i}`, "pre")),
  )
  console.log(`        ${SESSIONS} snapshot paralel: ${ms(t)}`)
  check("semua snapshot paralel berhasil", results.every((r) => r !== null))
  const trees = new Set(results.map((r) => r?.tree))
  check("semua menghasilkan tree yang sama (state identik)", trees.size === 1, `${trees.size} tree unik`)

  const refs = await listShadowRefs(root)
  const sessionRefs = refs.filter((r) => /sesi-\d/.test(r.ref))
  check(`ref terpisah per sesi (${sessionRefs.length}/${SESSIONS})`, sessionRefs.length === SESSIONS)

  // Tidak ada file index yatim yang tertinggal di .git
  const gitDirFiles = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: root,
    encoding: "utf8",
  }).stdout.trim()
  const leftovers = spawnSync(
    process.platform === "win32" ? "cmd" : "sh",
    process.platform === "win32"
      ? ["/c", `dir /b "${gitDirFiles.replace(/\//g, "\\")}\\minicode-*" 2>nul`]
      : ["-c", `ls -1 "${gitDirFiles}"/minicode-* 2>/dev/null || true`],
    { encoding: "utf8" },
  ).stdout.trim()
  check("tidak ada index sementara yatim di .git", leftovers === "", leftovers.slice(0, 120))

  // ── 4. restore bersamaan dengan penulisan ──
  // Bukan untuk membuktikan atomicity (memang tidak dijamin), tapi memastikan
  // restore tidak crash / meninggalkan file setengah tertulis.
  console.log("\n[4] restore saat file berubah")
  const pre4 = await snapshotTree(root, "race", "pre")
  await writeFile(join(root, "src", "race.ts"), "asal\n")
  const post4 = await snapshotTree(root, "race", "post")
  await recordCheckpointFromTrees("race", 1, pre4!.tree, post4!.tree, "race", root)

  let raceError: string | null = null
  const writer = (async () => {
    for (let i = 0; i < 60; i++) {
      await writeFile(join(root, "src", `noise${i % 5}.ts`), `n${i}\n`).catch(() => {})
      await Bun.sleep(1)
    }
  })()
  try {
    await restoreTree(root, pre4!.tree)
  } catch (e) {
    raceError = (e as Error).message
  }
  await writer
  check("restore tidak crash saat ada penulisan bersamaan", raceError === null, raceError ?? "")
  check("repo masih sehat setelah race", git(["status", "--porcelain"]).status === 0)

  // ── 5. nama file ekstrem ──
  console.log("\n[5] nama file ekstrem")
  const weird = [
    "spasi di nama.ts",
    "unicode-日本語-файл.ts",
    "emoji-🚀.ts",
    "-dash-awal.ts",
    "titik.banyak.sekali.ts",
    `panjang-${"x".repeat(120)}.ts`,
  ]
  const pre5 = await snapshotTree(root, "weird", "pre")
  let created = 0
  for (const name of weird) {
    try {
      await writeFile(join(root, name), "isi\n")
      created++
    } catch {
      // beberapa nama tak valid di filesystem tertentu — bukan kegagalan guard
    }
  }
  const post5 = await snapshotTree(root, "weird", "post")
  check(`snapshot dengan ${created} nama ekstrem`, post5 !== null)
  await recordCheckpointFromTrees("weird", 1, pre5!.tree, post5!.tree, "weird", root)
  const u5 = await undoLastCheckpoint("weird", root)
  check("undo menghapus semua file bernama ekstrem", u5.success && weird.every((n) => !existsSync(join(root, n))))

  // ── 6. .gitignore dihormati di kedua arah ──
  console.log("\n[6] .gitignore")
  const pre6 = await snapshotTree(root, "ign", "pre")
  await writeFile(join(root, "ignored", "secret.txt"), "diubah-user")
  await writeFile(join(root, "app.log"), "log baru")
  await writeFile(join(root, "src", "tracked.ts"), "berubah\n")
  const post6 = await snapshotTree(root, "ign", "post")
  await recordCheckpointFromTrees("ign", 1, pre6!.tree, post6!.tree, "ign", root)
  await undoLastCheckpoint("ign", root)
  check(
    "file ber-.gitignore TIDAK disentuh undo",
    (await readFile(join(root, "ignored", "secret.txt"), "utf8")) === "diubah-user",
  )
  check("*.log juga tidak disentuh", existsSync(join(root, "app.log")))

  // ── 7. cap manifest ──
  console.log("\n[7] cap manifest 20 checkpoint")
  for (let i = 0; i < 25; i++) {
    const p = await snapshotTree(root, "cap", `pre-${i}`)
    await writeFile(join(root, "src", "cap.ts"), `v${i}\n`)
    const q = await snapshotTree(root, "cap", `post-${i}`)
    await recordCheckpointFromTrees("cap", i, p!.tree, q!.tree, `turn ${i}`, root)
  }
  const capManifest = await loadCheckpointManifest("cap", root)
  check("manifest di-cap 20", capManifest.checkpoints.length === 20, `${capManifest.checkpoints.length}`)
  check("checkpoint terakhir dipertahankan", capManifest.checkpoints.at(-1)?.description === "turn 24")

  // ── 8. HEAD & index user tak tersentuh sepanjang eksperimen ──
  console.log("\n[8] integritas repo user")
  const headBefore = git(["rev-parse", "HEAD"]).stdout.trim()
  const p8 = await snapshotTree(root, "integritas", "pre")
  await writeFile(join(root, "src", "int.ts"), "x\n")
  await restoreTree(root, p8!.tree)
  check("HEAD tidak berubah", git(["rev-parse", "HEAD"]).stdout.trim() === headBefore)
  const log = git(["log", "--oneline", "--all"]).stdout
  check("ref shadow tidak muncul di git log --all", !log.includes("minicode"))
  check("git branch bersih", !git(["branch", "-a"]).stdout.includes("minicode"))
  // beginTurnSnapshot harus memilih mode git di repo
  const mode = await beginTurnSnapshot("mode-check", root)
  check("beginTurnSnapshot memilih mode git", mode.mode === "git")

  // ── ringkasan ──
  console.log(`\n=== HASIL ===\npass ${pass} · fail ${fail}`)
  if (failures.length) {
    console.log("\nkegagalan:")
    for (const f of failures) console.log(`  - ${f}`)
  }
  rmSync(root, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
}

try {
  await main()
} catch (e) {
  console.error(`\nFATAL: ${(e as Error).message}\n${(e as Error).stack}`)
  rmSync(root, { recursive: true, force: true })
  process.exit(1)
}
