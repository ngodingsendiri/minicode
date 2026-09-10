// P0-3 redo ordering & recovery pointer correctness (behavioral).
// Aturan: pointer = metadata turunan dari durable evidence (marker jurnal);
// redo tak pernah dianggap committed dari pointer semata.

import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadCheckpointManifest,
  reconcileUndoRedoPointer,
  recordCheckpointFromSnapshots,
  redoLastCheckpoint,
  undoLastCheckpoint,
} from "../src/session/checkpoint.ts"
import {
  branchSession,
  deleteSession,
  loadSession,
  saveSession,
} from "../src/session/persistence.ts"

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "mc-redo-"))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

async function seed2(dir: string, sid: string): Promise<void> {
  // Dua checkpoint files-mode dengan semantik pre/post benar:
  // turn1: pre = tak-ada, post = v1; turn2: pre = v1, post = v2.
  // Undo turn2 → v1; redo turn2 → v2. Bukan repo git (tmp) sehingga jalur
  // snapshots yang dipakai — deterministik.
  writeFileSync(join(dir, "f.txt"), "v1", "utf8")
  await recordCheckpointFromSnapshots(sid, 1, [{ path: "f.txt", content: null }], "turn 1", dir, [
    { path: "f.txt", content: "v1" },
  ])
  writeFileSync(join(dir, "f.txt"), "v2", "utf8")
  await recordCheckpointFromSnapshots(sid, 2, [{ path: "f.txt", content: "v1" }], "turn 2", dir, [
    { path: "f.txt", content: "v2" },
  ])
}

// ── 1. execute sukses + pointer crash → reconcile mengadopsi ──

test("redo: crash apply→save (marker ada, pointer basi) → reconcile adopsi", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r1")
    await undoLastCheckpoint("r1", dir) // idx 1 (turn2). Marker undo newIndex=0.
    const redo = await redoLastCheckpoint("r1", dir) // idx 1 lagi + marker redo.
    expect(redo.success).toBe(true)
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("v2")
    // Simulasi crash apply→save: kembalikan pointer disk ke basi.
    const { saveCheckpointManifest } = await import("../src/session/checkpoint.ts")
    const m = await loadCheckpointManifest("r1", dir)
    m.currentIndex = 0
    await saveCheckpointManifest(m, dir)
    // Resume: marker redo (newIndex=1) vs pointer 0 → adopsi deterministik.
    const rep = await reconcileUndoRedoPointer("r1", dir)
    expect(rep).toMatchObject({ repaired: true, from: 0, to: 1, kind: "redo" })
    expect((await loadCheckpointManifest("r1", dir)).currentIndex).toBe(1)
    // Idempoten: panggil lagi = no-op.
    expect(await reconcileUndoRedoPointer("r1", dir)).toBeNull()
  } finally {
    await cleanup(dir)
  }
})

// ── 2. pointer sukses + crash persistensi lain → tak ada adopsi buta ──

test("redo: tanpa marker (pre-apply crash) → reconcile no-op", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r2")
    // Tak ada operasi undo/redo sama sekali: pointer 1, tanpa marker.
    expect(await reconcileUndoRedoPointer("r2", dir)).toBeNull()
    expect((await loadCheckpointManifest("r2", dir)).currentIndex).toBe(1)
  } finally {
    await cleanup(dir)
  }
})

// ── 3. restart tiap jendela crash ──

test("redo: marker turn-mismatch ditolak (bukan adopsi buta)", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r3")
    // Marker palsu: newIndex valid tetapi turn tak cocok checkpoint.
    const { appendUndoMarker } = await import("../src/session/journal.ts")
    await appendUndoMarker("r3", dir, "redo", 999, { newIndex: 0, files: 1 })
    expect(await reconcileUndoRedoPointer("r3", dir)).toBeNull()
    expect((await loadCheckpointManifest("r3", dir)).currentIndex).toBe(1)
  } finally {
    await cleanup(dir)
  }
})

test("redo: marker indeks-invalid ditolak", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r4")
    const { appendUndoMarker } = await import("../src/session/journal.ts")
    await appendUndoMarker("r4", dir, "redo", 2, { newIndex: 77, files: 1 })
    expect(await reconcileUndoRedoPointer("r4", dir)).toBeNull()
  } finally {
    await cleanup(dir)
  }
})

// ── 4. duplicate redo: restart dua kali → sekali adopsi ──

test("redo: adopsi ganda idempoten", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r5")
    await undoLastCheckpoint("r5", dir)
    await redoLastCheckpoint("r5", dir)
    const m = await loadCheckpointManifest("r5", dir)
    m.currentIndex = 0
    const { saveCheckpointManifest } = await import("../src/session/checkpoint.ts")
    await saveCheckpointManifest(m, dir)
    expect((await reconcileUndoRedoPointer("r5", dir))?.repaired).toBe(true)
    expect(await reconcileUndoRedoPointer("r5", dir)).toBeNull()
    expect(await reconcileUndoRedoPointer("r5", dir)).toBeNull()
  } finally {
    await cleanup(dir)
  }
})

// ── 5. undo → redo penuh: file + pointer konsisten ──

test("redo: siklus undo→redo→restart konsisten file dan pointer", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r6")
    expect((await undoLastCheckpoint("r6", dir)).success).toBe(true)
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("v1")
    expect((await redoLastCheckpoint("r6", dir)).success).toBe(true)
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("v2")
    // Restart: sudah konvergen → no-op, dan redo berikut tepat sasaran.
    expect(await reconcileUndoRedoPointer("r6", dir)).toBeNull()
    const m = await loadCheckpointManifest("r6", dir)
    expect(m.currentIndex).toBe(1)
    // Tak ada yang bisa di-redo lagi (deterministik, bukan duplikat).
    expect((await redoLastCheckpoint("r6", dir)).success).toBe(false)
  } finally {
    await cleanup(dir)
  }
})

// ── 6. redo setelah session restart: target dari manifest ──

test("redo: target tunggal dari manifest, bukan sumber lain", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r7")
    await undoLastCheckpoint("r7", dir)
    // "Restart": muat ulang manifest dari disk, redo sekali.
    const m1 = await loadCheckpointManifest("r7", dir)
    expect(m1.currentIndex).toBe(0)
    const redo = await redoLastCheckpoint("r7", dir)
    expect(redo.success).toBe(true)
    expect((await loadCheckpointManifest("r7", dir)).currentIndex).toBe(1)
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("v2")
  } finally {
    await cleanup(dir)
  }
})

// ── 7. stale/deleted session ──

test("redo: sesi terhapus tak punya pointer basi", async () => {
  const dir = tmpRoot()
  try {
    await mkdir(join(dir, ".minicode"), { recursive: true })
    await saveSession("r8", dir, undefined, [{ role: "user", content: "hi" }], undefined)
    await seed2(dir, "r8")
    await deleteSession("r8", dir)
    // DB hilang + manifes ikut terhapus (lifecycle) → redo deterministik gagal.
    expect(loadSession("r8", dir)).toBeNull()
    expect(existsSync(join(dir, ".minicode", "checkpoints", "r8"))).toBe(false)
    expect((await redoLastCheckpoint("r8", dir)).success).toBe(false)
    expect(await reconcileUndoRedoPointer("r8", dir)).toBeNull()
  } finally {
    await cleanup(dir)
  }
})

test("redo: branch tak mewarisi pointer (tanpa checkpoint ikut)", async () => {
  const dir = tmpRoot()
  try {
    await mkdir(join(dir, ".minicode"), { recursive: true })
    await saveSession("r9a", dir, undefined, [{ role: "user", content: "hi" }], undefined)
    await seed2(dir, "r9a")
    await branchSession("r9a", "r9b", dir)
    // History ikut, manifes tidak → cabang mulai tanpa redo target.
    expect(loadSession("r9b", dir)?.messages.length).toBe(1)
    expect((await loadCheckpointManifest("r9b", dir)).checkpoints).toHaveLength(0)
    expect((await redoLastCheckpoint("r9b", dir)).success).toBe(false)
  } finally {
    await cleanup(dir)
  }
})

// ── 8. parent/child nomor turn sama: redo milik parent ──

test("redo: turn anak tak terbaca sebagai target parent", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r10") // turns [1,2], pointer 1
    await undoLastCheckpoint("r10", dir) // pointer 0
    await redoLastCheckpoint("r10", dir) // pointer 1 + marker redo
    // Jurnal anak (sesi lain) punya turn 1 juga — namespace terisolasi.
    const { appendMutationIntent, appendMutationTerminal } = await import(
      "../src/session/journal.ts"
    )
    const c = await appendMutationIntent({
      session: "r10-anak",
      tool: "edit",
      cwd: dir,
      turn: 1,
      paths: ["x"],
    })
    await appendMutationTerminal("r10-anak", dir, c.id, c.seq, "edit", "committed")
    // Crash-sim: pointer parent kembali basi.
    const m = await loadCheckpointManifest("r10", dir)
    m.currentIndex = 0
    const { saveCheckpointManifest } = await import("../src/session/checkpoint.ts")
    await saveCheckpointManifest(m, dir)
    // Marker redo parent valid → adopsi parent, anak diabaikan.
    const rep = await reconcileUndoRedoPointer("r10", dir)
    expect(rep).toMatchObject({ repaired: true, to: 1, kind: "redo" })
    expect((await loadCheckpointManifest("r10", dir)).currentIndex).toBe(1)
  } finally {
    await cleanup(dir)
  }
})

// ── 9. committed evidence + stale pointer → adopsi, bukan stitch ──

test("redo: marker menutup jendela pointer-basi tanpa stitch palsu", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r11")
    await undoLastCheckpoint("r11", dir)
    const redo = await redoLastCheckpoint("r11", dir)
    expect(redo.success).toBe(true)
    // Crash-sim: pointer kembali basi.
    const m = await loadCheckpointManifest("r11", dir)
    m.currentIndex = 0
    const { saveCheckpointManifest } = await import("../src/session/checkpoint.ts")
    await saveCheckpointManifest(m, dir)
    // Resume: reconcile (bukan stitch jurnal) yang menutupnya.
    const rep = await reconcileUndoRedoPointer("r11", dir)
    expect(rep?.repaired).toBe(true)
    const { loadJournal, decideRecovery } = await import("../src/session/journal.ts")
    const plan = decideRecovery((await loadJournal("r11", dir)).records, [])
    // Marker redo turn 2 menekan stitch committed turn ≤2 (efek dipulihkan).
    expect(plan.stitched).toHaveLength(0)
  } finally {
    await cleanup(dir)
  }
})

// ── 10. pending/failed + redo request: redo file tetap jalan ──

test("redo: pending jurnal tak memblokir operasi file redo", async () => {
  const dir = tmpRoot()
  try {
    await seed2(dir, "r12")
    await undoLastCheckpoint("r12", dir)
    const { appendMutationIntent } = await import("../src/session/journal.ts")
    await appendMutationIntent({ session: "r12", tool: "bash", cwd: dir })
    // Redo adalah operasi file deterministik — pending jurnal lain tak
    // menghalangi; keputusannya di tangan pemanggil, bukan lock global.
    const redo = await redoLastCheckpoint("r12", dir)
    expect(redo.success).toBe(true)
    expect(readFileSync(join(dir, "f.txt"), "utf8")).toBe("v2")
  } finally {
    await cleanup(dir)
  }
})

// ── 11. redo-suppress: committed ter-cover redo marker → tanpa stitch ──

test("decide: redo marker menekan stitch turn yang dipulihkan", async () => {
  const {
    appendMutationIntent: append,
    appendMutationTerminal: term,
    appendUndoMarker: mark,
    decideRecovery: decide,
  } = await import("../src/session/journal.ts")
  const dir = tmpRoot()
  try {
    const r = await append({ session: "rs", tool: "edit", cwd: dir, turn: 3, paths: ["a"] })
    await term("rs", dir, r.id, r.seq, "edit", "committed")
    await mark("rs", dir, "redo", 3)
    const { loadJournal: lj } = await import("../src/session/journal.ts")
    const plan = decide((await lj("rs", dir)).records, [])
    expect(plan.stitched).toHaveLength(0)
    expect(plan.clean).toBe(true)
  } finally {
    await cleanup(dir)
  }
})

// ── 12. undo-after: warning jujur, bukan stitch salah ──

test("decide: undo sesudah commit = warning, bukan stitch", async () => {
  const {
    appendMutationIntent: append,
    appendMutationTerminal: term,
    appendUndoMarker: mark,
    decideRecovery: decide,
  } = await import("../src/session/journal.ts")
  const dir = tmpRoot()
  try {
    const r = await append({ session: "ru", tool: "edit", cwd: dir, turn: 5, paths: ["a"] })
    await term("ru", dir, r.id, r.seq, "edit", "committed")
    await mark("ru", dir, "undo", 2)
    const { loadJournal: lj } = await import("../src/session/journal.ts")
    const plan = decide((await lj("ru", dir)).records, [])
    expect(plan.stitched).toHaveLength(0)
    expect(plan.warnings.some((w) => w.includes("di-undo"))).toBe(true)
  } finally {
    await cleanup(dir)
  }
})
