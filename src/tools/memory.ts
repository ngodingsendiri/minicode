import type { Tool } from "#minicore"
import { appendMemory, readMemoryFile } from "../memory/files.ts"
import { addMemory, deleteMemoryByQuery, searchHybrid } from "../memory/vector.ts"

export const readMemoryTool: Tool = {
  name: "read_memory",
  description: "Baca memory project + vector RAG hybrid (keyword+vector).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "query for search, empty = read all of MEMORY.md" },
      topK: { type: "number" },
    },
    required: [],
    additionalProperties: false,
  },
  async execute({ query, topK }, ctx) {
    ctx.signal.throwIfAborted()
    const cwd = (ctx as { cwd?: string }).cwd ?? process.cwd()
    if (!query || !(query as string).trim()) {
      const txt = await readMemoryFile(cwd)
      return txt || "(no MEMORY.md)"
    }
    const q = query as string
    // hybrid search — use cwd + try embedding via env (consistent with cli RAG)
    let hits: { text: string; score: number; createdAt: number }[] = []
    try {
      const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1"
      const apiKey =
        process.env.OPENAI_API_KEY ??
        process.env.DEEPSEEK_API_KEY ??
        process.env.AGENT_API_KEY ??
        ""
      hits = await searchHybrid(q, {
        topK: (topK as number) ?? 5,
        cwd,
        ...(apiKey ? { baseUrl, apiKey } : {}),
      })
    } catch (e) {
      process.stderr.write(`[warn] memory vector fallback keyword-only: ${(e as Error).message}\n`)
      hits = await searchHybrid(q, { topK: (topK as number) ?? 5, cwd })
    }
    const file = await readMemoryFile(cwd)
    const kw = file
      .split("\n")
      .filter((l) => l.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5)
      .join("\n")
    const fmtDate = (ts: number): string => {
      try {
        return new Date(ts).toISOString().slice(0, 10)
      } catch {
        return "?"
      }
    }
    let out = ""
    if (hits.length)
      out += `vector hits:\n${hits.map((h) => `- ${h.text.slice(0, 300)} (${h.score.toFixed(2)}, ${fmtDate(h.createdAt)})`).join("\n")}\n`
    if (kw) out += `\nfile hits:\n${kw}`
    return out.trim() || "(no memory)"
  },
}

export const writeMemoryTool: Tool = {
  name: "write_memory",
  description: "Write to MEMORY.md + vector store (allow write, permitted directly).",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "memori baru, ringkas 1-2 kalimat" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute({ text }, ctx) {
    ctx.signal.throwIfAborted()
    const t = text as string
    if (!t.trim()) throw new Error("text empty")
    const cwd = (ctx as { cwd?: string }).cwd ?? process.cwd()
    const path = await appendMemory(t, cwd)
    // also add to vector (hybrid) — pass cwd so local vector.db is used
    try {
      const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1"
      const apiKey =
        process.env.DEEPSEEK_API_KEY ??
        process.env.OPENAI_API_KEY ??
        process.env.AGENT_API_KEY ??
        ""
      if (apiKey) await addMemory(t, { baseUrl, apiKey, cwd })
      else await addMemory(t, { cwd })
    } catch (e) {
      process.stderr.write(`[warn] memory vector embedding failed: ${(e as Error).message}\n`)
      // fallback keyword-only
      try {
        await addMemory(t, { cwd })
      } catch (e2) {
        process.stderr.write(
          `[warn] memory keyword-only fallback failed: ${(e2 as Error).message}\n`,
        )
      }
    }
    return `saved to ${path}: ${t.slice(0, 100)}`
  },
}

export const forgetMemoryTool: Tool = {
  name: "forget_memory",
  description: "Delete memories matching the query from the vector store.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  async execute({ query }, ctx) {
    ctx.signal.throwIfAborted()
    const q = query as string
    if (!q.trim()) throw new Error("query empty")
    const cwd = (ctx as { cwd?: string }).cwd ?? process.cwd()
    const del = await deleteMemoryByQuery(q, cwd)
    return `deleted ${del} memories matching "${query}"`
  },
}
