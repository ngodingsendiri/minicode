import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { atomicWriteText } from "../lib/atomic-write.ts"
import { isPathOutsideRoot } from "../policy/jail.ts"

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
  } catch {
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
      await mkdir(dirname(absPath), { recursive: true }).catch(() => {})
      await writeFile(absPath, snap.content, "utf8")
      applied.push(`${snap.path} (restored)`)
    }
  }
  return applied
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
  const restoredFiles = await applySnapshots(targetCp.snapshots, cwd)

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
  // redo memakai state post-edit bila tersedia; fallback ke pre-edit (backward compat)
  const reappliedFiles = await applySnapshots(targetCp.redoSnapshots ?? targetCp.snapshots, cwd)

  await saveCheckpointManifest(manifest, cwd)

  return {
    success: true,
    reappliedFiles,
    message: `redid checkpoint ${targetCp.id} (turn ${targetCp.turn})`,
  }
}
