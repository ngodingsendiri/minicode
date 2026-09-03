// P2 Memory/RAG: MMR/diversitas, chunking, stats, trace memoryHits.
// Hermetic: tiap test pakai tmp cwd + .minicode/ agar vector.db lokal.

import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRagLayer } from "../src/app/rag-layer.ts"
import { LIMITS } from "../src/constants.ts"
import { resolveDbPath } from "../src/lib/db-path.ts"
import { addMemory, getMemoryStats, searchHybrid, splitMemoryChunks } from "../src/memory/vector.ts"
import { writeTrace } from "../src/telemetry/trace.ts"

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "minicode-mem-p2-"))
  await mkdir(join(dir, ".minicode"), { recursive: true })
  return dir
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

function openLocal(dir: string): Database {
  return new Database(resolveDbPath("vector.db", dir))
}

test("P2 limits terdokumentasi di LIMITS", () => {
  expect(LIMITS.MEMORY_MMR_LAMBDA).toBe(0.7)
  expect(LIMITS.MEMORY_DEDUP_COSINE).toBe(0.92)
  expect(LIMITS.MEMORY_MMR_CANDIDATES).toBe(50)
  expect(LIMITS.MEMORY_CHUNK_CHARS).toBe(2000)
  expect(LIMITS.MEMORY_CHUNK_OVERLAP).toBe(200)
})

test("P2.2 splitMemoryChunks: pendek utuh, panjang overlap", () => {
  expect(splitMemoryChunks("abc")).toEqual(["abc"])
  expect(splitMemoryChunks("x".repeat(2000))).toHaveLength(1)
  const chunks = splitMemoryChunks("y".repeat(4500))
  expect(chunks.length).toBe(3)
  for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000)
  // overlap: akhir chunk-1 = awal chunk-2
  expect(chunks[1]!.slice(0, 200)).toBe(chunks[0]!.slice(-200))
})

test("P2.2 chunk berbagi parent id + return parent", async () => {
  const cwd = await makeCwd()
  try {
    const marker = `chunk-${randomUUID().slice(0, 6)}`
    const parentId = await addMemory(`${marker} ${"z".repeat(4500)}`, { cwd })
    const db = openLocal(cwd)
    try {
      const rows = db.prepare(`SELECT id, parent FROM memory WHERE parent = ?`).all(parentId) as {
        id: string
        parent: string
      }[]
      expect(rows.length).toBe(3)
      expect(rows[0]!.id).toBe(parentId)
      // single-write tetap satu baris
      const solo = await addMemory(`solo ${randomUUID().slice(0, 6)}`, { cwd })
      const one = db.prepare(`SELECT count(*) as c FROM memory WHERE parent = ?`).get(solo) as {
        c: number
      } | null
      expect(one?.c).toBe(1)
    } finally {
      db.close()
    }
  } finally {
    await cleanup(cwd)
  }
})

test("P2.1 MMR: skor seri → topik beda ikut masuk, bukan parafrase", async () => {
  const cwd = await makeCwd()
  try {
    const uniq = randomUUID().slice(0, 6)
    // Query satu token → SEMUA skor keyword 1.0 (seri); MMR λ yang memutuskan:
    // kandidat ke-2 harus yang paling tak-mirip, bukan parafrase. Topik beda
    // ditulis PALING DULU agar urutan resensi (tanpa MMR) justru menyingkirkannya.
    await addMemory(`rotate postgres credentials quarterly ${uniq}`, { cwd })
    await Bun.sleep(5)
    await addMemory(`deploy service with bun runtime ${uniq}`, { cwd })
    await Bun.sleep(5)
    await addMemory(`deploy service using bun runtime ${uniq}`, { cwd })
    const hits = await searchHybrid(uniq, { cwd, topK: 2 })
    expect(hits).toHaveLength(2)
    const texts = hits.map((h) => h.text)
    // tanpa MMR: 2 teratas = 2 parafrase deploy; dengan MMR: postgres ikut masuk
    expect(texts.some((t) => t.includes("postgres"))).toBe(true)
    expect(texts.filter((t) => t.includes("deploy service")).length).toBeLessThanOrEqual(1)
    // hit membawa createdAt untuk display tanggal
    for (const h of hits) expect(typeof h.createdAt).toBe("number")
  } finally {
    await cleanup(cwd)
  }
})

test("P2.1 display membawa score + tanggal", async () => {
  const cwd = await makeCwd()
  try {
    const marker = `disp-${randomUUID().slice(0, 6)}`
    await addMemory(`unique ${marker} display date check`, { cwd })
    const { systemExtra, memoryHits } = await createRagLayer({
      cfg: { providers: [] } as never,
      prompt: marker,
      cwd,
    })
    // tanpa provider → jalur keyword-only, tetap ada hit + tanggal
    expect(memoryHits).toBeGreaterThan(0)
    expect(systemExtra).toContain(marker)
    expect(systemExtra).toMatch(/score \d+\.\d+, \d{4}-\d{2}-\d{2}/)
  } finally {
    await cleanup(cwd)
  }
})

test("P2.3 createRagLayer lapor memoryHits=0 bila tidak ada hit", async () => {
  const cwd = await makeCwd()
  try {
    const r = await createRagLayer({
      cfg: { providers: [] } as never,
      prompt: `tak-ada-${randomUUID()}`,
      cwd,
    })
    expect(r.memoryHits).toBe(0)
    expect(r.systemExtra).toBeUndefined()
  } finally {
    await cleanup(cwd)
  }
})

test("P2.4 getMemoryStats: rows, bytes, models, range", async () => {
  const cwd = await makeCwd()
  try {
    const empty = getMemoryStats(cwd)
    expect(empty.rows).toBe(0)
    expect(empty.oldest).toBeNull()
    await addMemory(`stat one ${randomUUID().slice(0, 6)}`, { cwd })
    await addMemory(`stat two ${randomUUID().slice(0, 6)}`, { cwd })
    const s = getMemoryStats(cwd)
    expect(s.rows).toBe(2)
    expect(s.dbBytes).toBeGreaterThan(0)
    expect(s.models.some((m) => m.model === "(keyword-only)")).toBe(true)
    expect(s.oldest).not.toBeNull()
    expect(s.newest).not.toBeNull()
    expect(s.newest! >= s.oldest!).toBe(true)
  } finally {
    await cleanup(cwd)
  }
})

test("P2.3 trace menyimpan memoryHits", async () => {
  const cwd = await makeCwd()
  try {
    await writeTrace(cwd, {
      sessionId: "s",
      timestamp: new Date().toISOString(),
      prompt: "halo",
      durationMs: 1,
      steps: 1,
      turns: 1,
      inputTokens: 1,
      outputTokens: 1,
      ok: true,
      memoryHits: 3,
    })
    const { readFile } = await import("node:fs/promises")
    const line = (await readFile(join(cwd, ".minicode", "traces.jsonl"), "utf8")).trim()
    expect(JSON.parse(line).memoryHits).toBe(3)
  } finally {
    await cleanup(cwd)
  }
})
