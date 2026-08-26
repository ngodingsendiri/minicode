import { Database } from "bun:sqlite"
import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { LIMITS } from "../constants.ts"

function dbPath(cwd?: string): string {
  const local = resolve(cwd ?? process.cwd(), ".minicode", "vector.db")
  const localDir = resolve(cwd ?? process.cwd(), ".minicode")
  if (existsSync(local)) return local
  if (existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true })
    return local
  }
  const global = join(homedir(), ".minicode", "vector.db")
  mkdirSync(join(global, ".."), { recursive: true })
  return global
}

const initializedPaths = new Set<string>()

function open(cwd?: string): Database {
  const p = dbPath(cwd)
  const db = new Database(p)
  if (!initializedPaths.has(p)) {
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;`)
    initializedPaths.add(p)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, text TEXT, embedding BLOB, created_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_memory_created ON memory(created_at);
    CREATE INDEX IF NOT EXISTS idx_memory_text ON memory(text);
  `)
  return db
}

function toBlob(vec: number[]): Buffer {
  // copy to avoid byteOffset alignment issues
  const f32 = new Float32Array(vec)
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)
}
function fromBlob(blob: Buffer | Uint8Array): number[] {
  const buf = blob instanceof Uint8Array ? Buffer.from(blob) : (blob as Buffer)
  // ensure 4-byte alignment: copy if misaligned
  if (buf.byteOffset % 4 !== 0) {
    const copy = Buffer.alloc(buf.byteLength)
    buf.copy(copy)
    return Array.from(new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4))
  }
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0,
    na = 0,
    nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9)
}

function keywordScore(query: string, text: string): number {
  const q = query.toLowerCase().split(/\W+/).filter(Boolean)
  const t = text.toLowerCase()
  if (q.length === 0) return 0
  let hits = 0
  for (const w of q) if (t.includes(w)) hits++
  return hits / q.length
}

async function embedTexts(
  baseUrl: string,
  apiKey: string,
  texts: string[],
  model?: string,
): Promise<number[][] | null> {
  if (!apiKey || !baseUrl) return null
  const urls = [
    `${baseUrl.replace(/\/+$/, "")}/embeddings`,
    `${baseUrl.replace(/\/+$/, "")}/v1/embeddings`,
  ]
  const headersList = [
    { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey, "content-type": "application/json" },
    { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    { "x-api-key": apiKey, "content-type": "application/json" },
  ]
  const body = JSON.stringify({
    model: model ?? process.env.MINICODE_EMBED_MODEL ?? "text-embedding-3-small",
    input: texts,
  })
  for (const headers of headersList) {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: headers as Record<string, string>,
          body,
          signal: AbortSignal.timeout(LIMITS.EMBEDDING_TIMEOUT_MS),
        })
        if (!res.ok) continue
        const json = (await res.json()) as { data?: { embedding: number[] }[] }
        if (json.data && Array.isArray(json.data)) return json.data.map((d) => d.embedding)
      } catch (e) {
        // fallback keyword-only tetap berjalan, tapi jangan senyap total
        process.stderr.write(
          `[warn] vector: embedding attempt failed: ${(e as Error).message}\n`,
        )
      }
    }
  }
  return null
}

export function deleteMemoryByQuery(query: string, cwd?: string): number {
  const db = open(cwd)
  try {
    // full scan dulu (SELECT semua lalu filter di JS) → pakai SQL instr() langsung
    const info = db
      .prepare("DELETE FROM memory WHERE instr(lower(text), lower(?)) > 0")
      .run(query.toLowerCase())
    return info.changes
  } finally {
    db.close()
  }
}

export function clearAllMemory(cwd?: string): void {
  const db = open(cwd)
  db.exec("DELETE FROM memory")
  db.exec("VACUUM")
  db.close()
}

export async function addMemory(
  text: string,
  opts: { baseUrl?: string; apiKey?: string; cwd?: string } = {},
) {
  const db = open(opts.cwd)
  const id = randomUUID()
  let embedding: Buffer | null = null
  if (opts.baseUrl && opts.apiKey) {
    const vecs = await embedTexts(opts.baseUrl, opts.apiKey, [text])
    if (vecs && vecs[0]) embedding = toBlob(vecs[0])
  }
  // fallback: store null embedding, will use keyword only
  db.prepare("INSERT INTO memory (id, text, embedding, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    text,
    embedding,
    Date.now(),
  )
  db.close()
  return id
}

export async function searchHybrid(
  query: string,
  opts: {
    baseUrl?: string
    apiKey?: string
    cwd?: string
    topK?: number
    embeddingModel?: string
  } = {},
): Promise<{ text: string; score: number }[]> {
  const db = open(opts.cwd)
  // Hybrid: keyword pre-filter via SQL instr() to retrieve old relevant memories beyond recent 500
  const keywords = query.toLowerCase().split(/\W+/).filter(Boolean).slice(0, 5)
  let rows: { text: string; embedding: Buffer | null }[]
  if (keywords.length > 0) {
    const likeClauses = keywords.map(() => `instr(lower(text), lower(?)) > 0`).join(" OR ")
    const recentRows = db
      .prepare(
        `SELECT text, embedding FROM memory ORDER BY created_at DESC LIMIT ${LIMITS.VECTOR_RECENT_LIMIT}`,
      )
      .all() as { text: string; embedding: Buffer | null }[]
    const keywordRows = db
      .prepare(
        `SELECT text, embedding FROM memory WHERE ${likeClauses} ORDER BY created_at DESC LIMIT ${LIMITS.VECTOR_KEYWORD_LIMIT}`,
      )
      .all(...keywords) as { text: string; embedding: Buffer | null }[]
    const merged = new Map<string, { text: string; embedding: Buffer | null }>()
    for (const r of [...recentRows, ...keywordRows]) if (!merged.has(r.text)) merged.set(r.text, r)
    rows = [...merged.values()].slice(0, LIMITS.VECTOR_SEARCH_LIMIT)
  } else {
    rows = db
      .prepare(
        `SELECT text, embedding FROM memory ORDER BY created_at DESC LIMIT ${LIMITS.VECTOR_SEARCH_LIMIT}`,
      )
      .all() as { text: string; embedding: Buffer | null }[]
  }
  db.close()
  if (rows.length === 0) return []

  let queryVec: number[] | null = null
  if (opts.baseUrl && opts.apiKey) {
    const vecs = await embedTexts(opts.baseUrl, opts.apiKey, [query], opts.embeddingModel)
    if (vecs && vecs[0]) queryVec = vecs[0]
  }

  const scored = rows.map((r) => {
    let vecScore = 0
    if (queryVec && r.embedding) {
      const vec = fromBlob(r.embedding)
      vecScore = cosine(queryVec, vec)
    }
    const kw = keywordScore(query, r.text)
    // hybrid 0.7 vector + 0.3 keyword, if no vector -> keyword only
    const score = queryVec ? vecScore * 0.7 + kw * 0.3 : kw
    return { text: r.text, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, opts.topK ?? 5)
}
