import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
import {
  callMcpTool,
  extractMcpText,
  getMcpPrompt,
  getMcpServerIds,
  mcpInventory,
  readMcpResource,
} from "../mcp/client.ts"

export const mcpListTool: Tool = {
  name: "mcp_list",
  description:
    "Daftar MCP server yang terhubung beserta tools, resources, dan prompts-nya. Panggil ini dulu sebelum mcp_call / mcp_read / mcp_prompt.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, ctx) {
    ctx.signal.throwIfAborted()
    const inv = mcpInventory()
    if (inv.length === 0)
      return "(tidak ada MCP server terhubung — tambah via minicode config mcp add)"
    const lines: string[] = []
    for (const s of inv) {
      lines.push(
        `# ${s.id} (${s.kind}) — ${s.tools.length} tools, ${s.resources.length} resources, ${s.prompts.length} prompts`,
      )
      for (const t of s.tools)
        lines.push(`  tool     ${t.name}${t.description ? `: ${t.description.slice(0, 110)}` : ""}`)
      for (const r of s.resources)
        lines.push(
          `  resource ${r.uri}${r.name ? ` (${r.name})` : ""}${r.mimeType ? ` [${r.mimeType}]` : ""}`,
        )
      for (const p of s.prompts) {
        const args = (p.arguments ?? []).map((a) => `${a.name}${a.required ? "*" : ""}`).join(", ")
        lines.push(
          `  prompt   ${p.name}${args ? `(${args})` : ""}${p.description ? `: ${p.description.slice(0, 90)}` : ""}`,
        )
      }
    }
    return lines.join("\n")
  },
}

export const mcpCallTool: Tool = {
  name: "mcp_call",
  description:
    "Panggil tool dari MCP server yang terhubung. Parameter: server id, nama tool, dan arguments.",
  parameters: {
    type: "object",
    properties: {
      server: {
        type: "string",
        description: "ID MCP server (lihat dari mcp_list)",
      },
      tool: {
        type: "string",
        description: "Nama tool yang akan dipanggil",
      },
      args: {
        type: "object",
        description: "Arguments untuk tool (object key-value)",
        additionalProperties: true,
      },
    },
    required: ["server", "tool"],
    additionalProperties: false,
  },
  async execute({ server, tool, args }, ctx) {
    const sid = server as string
    const tn = tool as string
    const a = (args as Record<string, unknown>) ?? {}

    ctx.signal.throwIfAborted()

    const ids = getMcpServerIds()
    if (!ids.includes(sid)) {
      return `[mcp] server '${sid}' tidak terhubung. Server terdaftar: ${ids.join(", ") || "(tidak ada)"}`
    }

    try {
      const result = await callMcpTool(sid, tn, a)
      const content = extractMcpText(result)
      return content.slice(0, LIMITS.MCP_OUTPUT_MAX_CHARS)
    } catch (e) {
      return `[mcp] error: ${(e as Error).message}`
    }
  },
}

/** Pesan kesalahan seragam untuk server yang tak terdaftar. */
function notConnected(sid: string): string {
  const ids = getMcpServerIds()
  return `[mcp] server '${sid}' tidak terhubung. Server terdaftar: ${ids.join(", ") || "(tidak ada)"}`
}

export const mcpReadTool: Tool = {
  name: "mcp_read",
  description:
    "Baca resource dari MCP server (spec resources/read). URI diambil dari mcp_list. Read-only.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "ID MCP server" },
      uri: { type: "string", description: "URI resource, mis. file:///x atau db://table" },
    },
    required: ["server", "uri"],
    additionalProperties: false,
  },
  async execute({ server, uri }, ctx) {
    ctx.signal.throwIfAborted()
    const sid = String(server ?? "")
    const u = String(uri ?? "").trim()
    if (!u) throw new Error("uri wajib diisi")
    if (!getMcpServerIds().includes(sid)) return notConnected(sid)
    try {
      const text = await readMcpResource(sid, u)
      if (!text) return `[mcp] resource '${u}' kosong atau tidak mengembalikan teks`
      return text.slice(0, LIMITS.MCP_OUTPUT_MAX_CHARS)
    } catch (e) {
      return `[mcp] error: ${(e as Error).message}`
    }
  },
}

export const mcpPromptTool: Tool = {
  name: "mcp_prompt",
  description:
    "Ambil prompt template dari MCP server (spec prompts/get) — server merender argumennya. Hasilnya teks untuk dipakai sebagai konteks.",
  parameters: {
    type: "object",
    properties: {
      server: { type: "string", description: "ID MCP server" },
      name: { type: "string", description: "Nama prompt (lihat mcp_list)" },
      args: {
        type: "object",
        description: "Argumen prompt (object key-value)",
        additionalProperties: true,
      },
    },
    required: ["server", "name"],
    additionalProperties: false,
  },
  async execute({ server, name, args }, ctx) {
    ctx.signal.throwIfAborted()
    const sid = String(server ?? "")
    const pn = String(name ?? "").trim()
    if (!pn) throw new Error("name wajib diisi")
    if (!getMcpServerIds().includes(sid)) return notConnected(sid)
    try {
      const text = await getMcpPrompt(sid, pn, (args as Record<string, unknown>) ?? {})
      if (!text) return `[mcp] prompt '${pn}' tidak mengembalikan pesan`
      return text.slice(0, LIMITS.MCP_OUTPUT_MAX_CHARS)
    } catch (e) {
      return `[mcp] error: ${(e as Error).message}`
    }
  },
}
