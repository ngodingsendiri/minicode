import type { Tool } from "minicore"
import { LIMITS } from "../constants.ts"
import { callMcpTool, extractMcpText, getMcpServerIds, listMcpTools } from "../mcp/client.ts"

export const mcpListTool: Tool = {
  name: "mcp_list",
  description:
    "Daftar MCP server yang terhubung beserta tool-nya. Panggil ini dulu sebelum mcp_call.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(_input, ctx) {
    ctx.signal.throwIfAborted()
    const ids = getMcpServerIds()
    if (ids.length === 0)
      return "(tidak ada MCP server terhubung — tambah via minicode config mcp add)"
    const lines: string[] = []
    for (const id of ids) {
      const tools = await listMcpTools(id)
      lines.push(`# ${id} (${tools.length} tools)`)
      for (const t of tools)
        lines.push(`  - ${t.name}${t.description ? `: ${t.description.slice(0, 120)}` : ""}`)
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
