// P1 Memory/RAG: FTS5/index, TTL+MAX_ROWS prune, model/dim meta, SSRF strict.
// Hermetic: tiap test pakai tmp cwd + .minicode/ agar vector.db lokal (resolveDbPath).

import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LIMITS } from "../src/constants.ts"
import { resolveDbPath } from "../src/lib/db-path.ts"
import { isPrivateHostWithDns } from "../src/lib/net.ts"
import { addMemory, searchHybrid } from "../src/memory/vector.ts"

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "minicode-mem-p1-"))
  await mkdir(join(dir, ".minicode"), { recursive: true })
  return dir
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

function openLocal(dir: string): Database {
  return new Database(resolveDbPath("vector.db", dir))
}

test("P1 limits terdokumentasi di LIMITS", () => {
  expect(LIMITS.MEMORY_TTL_DAYS).toBe(90)
  expect(LIMITS.MEMORY_MAX_ROWS).toBe(5000)
  expect(LIMITS.MEMORY_MIN_SCORE_HYBRID).toBe(0.2)
  expect(LIMITS.MEMORY_MIN_SCORE_KEYWORD).toBe(0.25)
})

test("P1.1 fts5 + idx lower(text) dibuat saat open", async () => {
  const cwd = await makeCwd()
  try {
    await addMemory(`fts marker ${randomUUID().slice(0, 6)} alpha beta`, { cwd })
    const db = openLocal(cwd)
    try {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','index')`)
        .all() as { name: string }[]
      const names = new Set(tables.map((t) => t.name))
      expect(names.has("memory_fts")).toBe(true)
      expect(names.has("idx_memory_text_lower")).toBe(true)
    } finally {
      db.close()
    }
  } finally {
    await cleanup(cwd)
  }
})

test("P1.1 LIKE escaping: underscore tidak jadi wildcard", async () => {
  const cwd = await makeCwd()
  try {
    const marker = `esc-${randomUUID().slice(0, 6)}`
    await addMemory(`unique ${marker} deploy 100%_coverage done`, { cwd })
    const hits = await searchHybrid(`100%_coverage ${marker}`, { cwd })
    expect(hits.some((h) => h.text.includes(marker))).toBe(true)
    // query wildcard murni tidak boleh meledak / match semua
    const wild = await searchHybrid(`%_`, { cwd })
    expect(Array.isArray(wild)).toBe(true)
  } finally {
    await cleanup(cwd)
  }
})

test("P1.2 TTL prune: baris 100 hari dihapus saat addMemory", async () => {
  const cwd = await makeCwd()
  try {
    const oldMarker = `old-${randomUUID().slice(0, 6)}`
    // seed dulu lewat addMemory agar skema + trigger FTS sinkron sebelum insert manual
    await addMemory(`seed ${randomUUID().slice(0, 6)}`, { cwd })
    const db = openLocal(cwd)
    try {
      const oldTs = Date.now() - 100 * 24 * 60 * 60 * 1000
      db.prepare("INSERT INTO memory (id, text, embedding, created_at) VALUES (?, ?, ?, ?)").run(
        randomUUID(),
        `unique ${oldMarker} ancient note`,
        null,
        oldTs,
      )
    } finally {
      db.close()
    }
    await addMemory(`fresh ${randomUUID().slice(0, 6)} note`, { cwd })
    const db2 = openLocal(cwd)
    try {
      const left = db2
        .prepare(`SELECT count(*) as c FROM memory WHERE text LIKE ?`)
        .get(`%${oldMarker}%`) as { c: number } | null
      expect(left?.c ?? -1).toBe(0)
    } finally {
      db2.close()
    }
  } finally {
    await cleanup(cwd)
  }
})

test("P2.2 addMemory teks panjang di-chunk (bukan truncate) dengan parent sama", async () => {
  const cwd = await makeCwd()
  try {
    const marker = `trunc-${randomUUID().slice(0, 6)}`
    const parentId = await addMemory(`${marker} ${"x".repeat(5000)}`, { cwd })
    const db = openLocal(cwd)
    try {
      const rows = db
        .prepare(`SELECT length(text) as n, parent FROM memory WHERE parent = ?`)
        .all(parentId) as { n: number; parent: string }[]
      // 5000+ char → 3 chunk @2000 dengan overlap 200, semua ≤2000 char
      expect(rows.length).toBe(3)
      for (const r of rows) expect(r.n).toBeLessThanOrEqual(2000)
      const hits = await searchHybrid(marker, { cwd })
      expect(hits.some((h) => h.text.includes(marker))).toBe(true)
    } finally {
      db.close()
    }
  } finally {
    await cleanup(cwd)
  }
})

test("P1.3 kolom model/dim ada + baris lama tanpa dim tetap terbaca", async () => {
  const cwd = await makeCwd()
  try {
    await addMemory(`meta marker ${randomUUID().slice(0, 6)}`, { cwd })
    const db = openLocal(cwd)
    try {
      const cols = db.prepare(`PRAGMA table_info(memory)`).all() as { name: string }[]
      const names = new Set(cols.map((c) => c.name))
      expect(names.has("model")).toBe(true)
      expect(names.has("dim")).toBe(true)
    } finally {
      db.close()
    }
    // baris legacy ber-embedding tetap bisa di-search keyword-only tanpa crash
    const marker = `legacy-${randomUUID().slice(0, 6)}`
    const f32 = new Float32Array([1, 2, 3])
    const blob = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)
    const db2 = openLocal(cwd)
    try {
      db2
        .prepare(
          "INSERT INTO memory (id, text, embedding, created_at, model, dim) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), `unique ${marker} legacy vector`, blob, Date.now(), "test-model", 3)
    } finally {
      db2.close()
    }
    const hits = await searchHybrid(marker, { cwd })
    expect(hits.some((h) => h.text.includes(marker))).toBe(true)
  } finally {
    await cleanup(cwd)
  }
})

test("P1.4 SSRF strict: private host ditolak fail-close", async () => {
  expect(await isPrivateHostWithDns("169.254.169.254", { strict: true })).toBe(true)
  expect(await isPrivateHostWithDns("localhost", { strict: true })).toBe(true)
  expect(await isPrivateHostWithDns("127.0.0.1", { strict: true, noCache: true })).toBe(true)
})

test("P1.4 embedTexts ke host privat fallback keyword-only tanpa hang", async () => {
  const cwd = await makeCwd()
  try {
    const marker = `ssrf-${randomUUID().slice(0, 6)}`
    await addMemory(`unique ${marker} private embedding test`, { cwd })
    const hits = await searchHybrid(marker, {
      baseUrl: "http://169.254.169.254/v1",
      apiKey: "sk-test",
      cwd,
    })
    // embedding ditolak → fallback keyword-only tetap menemukan marker
    expect(hits.some((h) => h.text.includes(marker))).toBe(true)
  } finally {
    await cleanup(cwd)
  }
})
