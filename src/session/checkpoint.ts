import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { LIMITS } from "../constants.ts"
import { atomicWriteText } from "../lib/atomic-write.ts"
import { isPathOutsideRoot } from "../policy/jail.ts"
import { restoreTree, snapshotTree } from "./shadow-git.ts"

const MAX_CHECKPOINTS = 20

export interface FileSnapshot {
  path: string // relative path
  content: string | null // null means file was deleted/didn't exist
}

export interface Checkpoint {
  id: string
  turn: number
  timestamp: string
  description: string
  snapshots: FileSnapshot[] // pre-edit state (untuk /undo)
  redoSnapshots?: FileSnapshot[] // post-edit state (untuk /redo)
  /** Tree git pre-turn (mode shadow-git). Bila ada, snapshots dibiarkan kosong. */
  treeBefore?: string
  /** Tree git post-turn (mode shadow-git) untuk /redo. */
  treeAfter?: string
}

export interface CheckpointManifest {
  sessionId: string
  currentIndex: number // pointer in history
  checkpoints: Checkpoint[]
}

function getCheckpointDir(sessionId: string, cwd: string = process.cwd()): string {
  return resolve(cwd, ".minicode", "checkpoints", sessionId)
}

function getManifestPath(sessionId: string, cwd: string = process.cwd()): string {
  return join(getCheckpointDir(sessionId, cwd), "manifest.json")
}

export async function loadCheckpointManifest(
  sessionId: string,
  cwd?: string,
): Promise<CheckpointManifest> {
  const path = getManifestPath(sessionId, cwd)
  try {
    const raw = await readFile(path, "utf8")
    return JSON.parse(raw) as CheckpointManifest
  } catch (e) {
    // manifest hilang = kondisi normal utk sesi baru; manifest KORUP = data
    // riwayat checkpoint hilang diam-diam — minimal beri tahu user.
    const code = (e as NodeJS.ErrnoException).code
    if (code !== "ENOENT") {
      process.stderr.write(
        `[warn] checkpoint: manifest unreadable (${(e as Error).message}) — starting empty\n`,
      )
    }
    return { sessionId, currentIndex: -1, checkpoints: [] }
  }
}

export async function saveCheckpointManifest(
  manifest: CheckpointManifest,
  cwd?: string,
): Promise<void> {
  const dir = getCheckpointDir(manifest.sessionId, cwd)
  await mkdir(dir, { recursive: true }).catch(() => {})
  const path = getManifestPath(manifest.sessionId, cwd)
  await atomicWriteText(path, JSON.stringify(manifest, null, 2))
}

export async function captureFileSnapshot(
  filePath: string,
  cwd: string = process.cwd(),
): Promise<FileSnapshot> {
  const rel = relative(cwd, filePath).replace(/\\/g, "/")
  const abs = resolve(cwd, filePath)
  try {
    const content = await readFile(abs, "utf8")
    return { path: rel, content }
  } catch {
    return { path: rel, content: null }
  }
}

// Snapshot seluruh workspace (maks `limit` file) — menangkap perubahan apa pun
// termasuk bash/git (bukan cuma edit/write_file). Dipakai /undo per turn.
async function walkFiles(root: string, rel: string, out: string[], limit: number): Promise<void> {
  if (out.length >= limit) return
  const dir = rel ? join(root, rel) : root
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (out.length >= limit) break
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === ".git") continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) await walkFiles(root, r, out, limit)
    else out.push(r)
  }
}

export async function snapshotWorkspace(
  cwd: string = process.cwd(),
  limit = 200,
): Promise<FileSnapshot[]> {
  // Try git dirty files first for efficiency on large workspaces
  try {
    const { spawnSync } = await import("node:child_process")
    const r = spawnSync("git", ["status", "--porcelain"], { cwd, timeout: 2000, encoding: "utf8" })
    if (r.status === 0 && r.stdout) {
      const dirty = r.stdout
        .split("\n")
        .map((l: string) => l.slice(3).trim())
        .filter(Boolean)
        .slice(0, limit)
      if (dirty.length > 0) {
        const snaps: FileSnapshot[] = []
        for (const f of dirty) snaps.push(await captureFileSnapshot(resolve(cwd, f), cwd))
        return snaps
      }
    }
  } catch {}
  const files: string[] = []
  await walkFiles(cwd, "", files, limit)
  const snaps: FileSnapshot[] = []
  for (const f of files) {
    snaps.push(await captureFileSnapshot(resolve(cwd, f), cwd))
  }
  return snaps
}

// ── Shadow-git: jalur utama bila cwd adalah repo git ──
//
// Menyimpan SHA tree alih-alih isi file. Biayanya O(delta) bukan
// O(ukuran workspace), tanpa cap jumlah file, dan tidak menyentuh index/HEAD
// user. Fallback ke snapshot manual di bawah tetap ada untuk non-repo.

/**
 * Ambil snapshot pre-turn. Return penanda mode yang dipakai supaya pemanggil
 * tahu apakah perlu mengumpulkan snapshot file manual.
 */
export async function beginTurnSnapshot(
  sessionId: string,
  cwd: string = process.cwd(),
): Promise<{ mode: "git"; tree: string } | { mode: "files"; snapshots: FileSnapshot[] }> {
  const shadow = await snapshotTree(cwd, sessionId, "pre")
  if (shadow) return { mode: "git", tree: shadow.tree }
  return { mode: "files", snapshots: await snapshotWorkspace(cwd, LIMITS.WORKSPACE_SNAPSHOT_LIMIT) }
}

/** Rekam checkpoint dari tree git pre/post turn. */
export async function recordCheckpointFromTrees(
  sessionId: string,
  turn: number,
  treeBefore: string,
  treeAfter: string | undefined,
  description: string,
  cwd: string = process.cwd(),
): Promise<Checkpoint | null> {
  // Tak ada perubahan → tak ada yang perlu di-undo. Ini juga mencegah manifest
  // dipenuhi checkpoint kosong dari turn yang hanya membaca.
  if (treeAfter && treeAfter === treeBefore) return null
  const manifest = await loadCheckpointManifest(sessionId, cwd)
  const cp: Checkpoint = {
    id: `cp_${Date.now()}_${randomUUID().slice(0, 6)}`,
    turn,
    timestamp: new Date().toISOString(),
    description,
    snapshots: [],
    treeBefore,
    ...(treeAfter ? { treeAfter } : {}),
  }
  if (manifest.currentIndex < manifest.checkpoints.length - 1) {
    manifest.checkpoints = manifest.checkpoints.slice(0, manifest.currentIndex + 1)
  }
  manifest.checkpoints.push(cp)
  if (manifest.checkpoints.length > MAX_CHECKPOINTS) {
    manifest.checkpoints = manifest.checkpoints.slice(-MAX_CHECKPOINTS)
  }
  manifest.currentIndex = manifest.checkpoints.length - 1
  await saveCheckpointManifest(manifest, cwd)
  return cp
}

export async function recordCheckpoint(
  sessionId: string,
  turn: number,
  filePaths: string[],
  description: string = "",
  cwd: string = process.cwd(),
): Promise<Checkpoint> {
  const snapshots: FileSnapshot[] = []
  for (const fp of filePaths) {
    snapshots.push(await captureFileSnapshot(fp, cwd))
  }
  const cp = await recordCheckpointFromSnapshots(sessionId, turn, snapshots, description, cwd)
  if (!cp) throw new Error("no files to checkpoint")
  return cp
}

// Rekam checkpoint dari snapshot yang SUDAH ditangkap. `snapshots` = pre-edit
// (untuk /undo); `redoSnapshots` opsional = post-edit (untuk /redo).
export async function recordCheckpointFromSnapshots(
  sessionId: string,
  turn: number,
  snapshots: FileSnapshot[],
  description: string = "",
  cwd: string = process.cwd(),
  redoSnapshots?: FileSnapshot[],
): Promise<Checkpoint | null> {
  if (snapshots.length === 0) return null
  const manifest = await loadCheckpointManifest(sessionId, cwd)
  const cp: Checkpoint = {
    id: `cp_${Date.now()}_${randomUUID().slice(0, 6)}`,
    turn,
    timestamp: new Date().toISOString(),
    description,
    snapshots,
    ...(redoSnapshots?.length ? { redoSnapshots } : {}),
  }

  // Truncate any redo branches if new action is taken
  if (manifest.currentIndex < manifest.checkpoints.length - 1) {
    manifest.checkpoints = manifest.checkpoints.slice(0, manifest.currentIndex + 1)
  }

  manifest.checkpoints.push(cp)
  // Cap manifest agar tidak membengkak tanpa batas (keep N terakhir)
  if (manifest.checkpoints.length > MAX_CHECKPOINTS) {
    manifest.checkpoints = manifest.checkpoints.slice(-MAX_CHECKPOINTS)
  }
  manifest.currentIndex = manifest.checkpoints.length - 1

  await saveCheckpointManifest(manifest, cwd)
  return cp
}

// Terapkan snapshot dengan jail path: path di luar workspace dilewati.
async function applySnapshots(snapshots: FileSnapshot[], cwd: string): Promise<string[]> {
  const root = resolve(cwd)
  const applied: string[] = []
  for (const snap of snapshots) {
    const absPath = resolve(root, snap.path)
    if (isPathOutsideRoot(absPath, root)) {
      applied.push(`${snap.path} (skipped: outside workspace)`)
      continue
    }
    if (snap.content === null) {
      if (existsSync(absPath)) {
        await rm(absPath, { force: true }).catch(() => {})
        applied.push(`${snap.path} (removed)`)
      }
    } else {
      await atomicWriteText(absPath, snap.content)
      applied.push(`${snap.path} (restored)`)
    }
  }
  return applied
}

/** Terapkan satu checkpoint: tree git bila ada, else snapshot file. */
async function applyCheckpoint(
  cp: Checkpoint,
  direction: "undo" | "redo",
  cwd: string,
): Promise<string[]> {
  const tree = direction === "undo" ? cp.treeBefore : (cp.treeAfter ?? cp.treeBefore)
  if (tree) {
    const res = await restoreTree(cwd, tree)
    return [...res.applied, ...res.skipped.map((s) => `${s} (skipped)`)]
  }
  const snaps = direction === "undo" ? cp.snapshots : (cp.redoSnapshots ?? cp.snapshots)
  return applySnapshots(snaps, cwd)
}

export async function undoLastCheckpoint(
  sessionId: string,
  cwd: string = process.cwd(),
): Promise<{ success: boolean; restoredFiles: string[]; message: string }> {
  const manifest = await loadCheckpointManifest(sessionId, cwd)
  if (manifest.currentIndex < 0 || manifest.checkpoints.length === 0) {
    return { success: false, restoredFiles: [], message: "no checkpoints to undo" }
  }

  const targetCp = manifest.checkpoints[manifest.currentIndex]!
  const restoredFiles = await applyCheckpoint(targetCp, "undo", cwd)

  manifest.currentIndex -= 1
  await saveCheckpointManifest(manifest, cwd)

  return {
    success: true,
    restoredFiles,
    message: `undid checkpoint ${targetCp.id} (turn ${targetCp.turn})`,
  }
}

export async function redoLastCheckpoint(
  sessionId: string,
  cwd: string = process.cwd(),
): Promise<{ success: boolean; reappliedFiles: string[]; message: string }> {
  const manifest = await loadCheckpointManifest(sessionId, cwd)
  if (manifest.currentIndex >= manifest.checkpoints.length - 1) {
    return { success: false, reappliedFiles: [], message: "no undone checkpoints to redo" }
  }

  manifest.currentIndex += 1
  const targetCp = manifest.checkpoints[manifest.currentIndex]!
  const reappliedFiles = await applyCheckpoint(targetCp, "redo", cwd)

  await saveCheckpointManifest(manifest, cwd)

  return {
    success: true,
    reappliedFiles,
    message: `redid checkpoint ${targetCp.id} (turn ${targetCp.turn})`,
  }
}
