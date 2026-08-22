import type { Tool } from "minicore";
import { addMemory, searchHybrid } from "../memory/vector.ts";
import { appendMemory, readMemoryFile } from "../memory/files.ts";
import { Database } from "bun:sqlite";

export const readMemoryTool: Tool = {
  name: "read_memory",
  description: "Baca memory project + vector RAG hybrid (keyword+vector).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "query untuk search, kosong = baca semua MEMORY.md" },
      topK: { type: "number" },
    },
    required: [],
    additionalProperties: false,
  },
  async execute({ query, topK }, ctx) {
    ctx.signal.throwIfAborted();
    if (!query || !(query as string).trim()) {
      const txt = await readMemoryFile();
      return txt || "(no MEMORY.md)";
    }
    const q = query as string;
    // hybrid search
    const hits = await searchHybrid(q, { topK: (topK as number) ?? 5 });
    const file = await readMemoryFile();
    const kw = file
      .split("\n")
      .filter((l) => l.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5)
      .join("\n");
    let out = "";
    if (hits.length) out += `vector hits:\n${hits.map((h) => `- ${h.text.slice(0, 300)} (${h.score.toFixed(2)})`).join("\n")}\n`;
    if (kw) out += `\nfile hits:\n${kw}`;
    return out.trim() || "(no memory)";
  },
};

export const writeMemoryTool: Tool = {
  name: "write_memory",
  description: "Tulis ke MEMORY.md + vector store (allow write, diizinkan langsung).",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "memori baru, ringkas 1-2 kalimat" } },
    required: ["text"],
    additionalProperties: false,
  },
  async execute({ text }, ctx) {
    ctx.signal.throwIfAborted();
    const t = text as string;
    if (!t.trim()) throw new Error("text empty");
    const path = await appendMemory(t);
    // also add to vector (hybrid) — try to get gateway from env/config
    try {
      const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.deepseek.com/v1";
      const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
      if (apiKey) await addMemory(t, { baseUrl, apiKey });
    } catch {}
    return `saved to ${path}: ${t.slice(0, 100)}`;
  },
};

export const forgetMemoryTool: Tool = {
  name: "forget_memory",
  description: "Hapus memory yang mengandung query dari vector store.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  async execute({ query }, ctx) {
    ctx.signal.throwIfAborted();
    const q = (query as string).toLowerCase();
    const { homedir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const { existsSync } = await import("node:fs");
    const local = resolve(process.cwd(), ".minicode", "vector.db");
    const global = join(homedir(), ".minicode", "vector.db");
    const path = existsSync(local) ? local : global;
    const db = new Database(path);
    const rows = db.prepare("SELECT id, text FROM memory").all() as { id: string; text: string }[];
    let del = 0;
    for (const r of rows) if (r.text.toLowerCase().includes(q)) {
      db.prepare("DELETE FROM memory WHERE id = ?").run(r.id);
      del++;
    }
    db.close();
    return `deleted ${del} memories matching "${query}"`;
  },
};
