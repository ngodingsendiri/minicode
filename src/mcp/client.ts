import type { Tool, ToolContext } from "minicore"
import { LIMITS } from "../constants.ts"
import { scrubSecrets } from "../policy/scrub.ts"
import { McpHttpTransport, type McpTransportLike } from "./http-transport.ts"
import { McpTransport } from "./transport.ts"

export interface McpServerConfig {
  id: string
  /** stdio: perintah yang di-spawn. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** Streamable HTTP endpoint. Bila ada, dipakai alih-alih stdio. */
  url?: string
  headers?: Record<string, string>
  allowPrivateHost?: boolean
}

interface McpToolDef {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

const activeConnections = new Map<string, McpConnection>()

class McpConnection {
  /** Transport konkret; tipe union agar `connect` yang berbeda tetap tersalur. */
  private readonly http: McpHttpTransport | null
  private readonly stdio: McpTransport | null
  transport: McpTransportLike
  tools: McpToolDef[] = []
  ready = false

  constructor(public config: McpServerConfig) {
    // Transport dipilih dari bentuk config: `url` → HTTP, else stdio.
    if (config.url) {
      this.http = new McpHttpTransport({
        url: config.url,
        headers: config.headers,
        allowPrivateHost: config.allowPrivateHost,
      })
      this.stdio = null
      this.transport = this.http
    } else {
      this.stdio = new McpTransport()
      this.http = null
      this.transport = this.stdio
    }
  }

  get kind(): "http" | "stdio" {
    return this.http ? "http" : "stdio"
  }

  async connect(): Promise<void> {
    if (this.http) {
      await this.http.connect()
    } else {
      if (!this.config.command) throw new Error("config MCP butuh `command` atau `url`")
      await this.stdio!.connect(this.config.command, this.config.args ?? [], this.config.env ?? {})
    }

    let handshakeOk = false
    // `server/discover` adalah ekstensi non-standar; hanya masuk akal untuk
    // stdio lokal. Server HTTP mengikuti spec → langsung `initialize`.
    if (this.kind === "stdio") {
      try {
        const disc = (await this.transport.request(
          "server/discover",
          {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": { name: "minicode", version: "0.1.0" },
              "io.modelcontextprotocol/clientCapabilities": { tools: {} },
            },
          },
          2_000,
        )) as Record<string, unknown>
        if (disc?.capabilities) handshakeOk = true
      } catch {
        // jatuh ke initialize di bawah
      }
    }
    if (!handshakeOk) {
      await this.transport.request(
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          clientInfo: { name: "minicode", version: "0.1.0" },
        },
        LIMITS.MCP_HANDSHAKE_TIMEOUT_MS,
      )
      // wajib per spec: notification initialized setelah initialize
      this.transport.notify("notifications/initialized", {})
      handshakeOk = true
    }
    if (!handshakeOk) throw new Error("handshake failed")

    const result = (await this.transport.request("tools/list", {})) as Record<string, unknown>
    if (result && Array.isArray(result.tools)) this.tools = result.tools as McpToolDef[]
    this.ready = true
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.transport.request("tools/call", {
      name,
      arguments: args,
    })) as Record<string, unknown>
    if (result && typeof result.isError === "boolean" && result.isError) {
      const content = Array.isArray(result.content)
        ? result.content.map((c: any) => c.text ?? JSON.stringify(c)).join("\n")
        : String(result.content)
      throw new Error(`MCP tool ${name}: ${content}`)
    }
    return result
  }

  wrapTools(serverId: string): Tool[] {
    return this.tools.map((t) => ({
      name: `${serverId}.${t.name}`,
      description: t.description ?? `MCP tool from ${serverId}`,
      parameters: (t.inputSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: true,
      }) as Tool["parameters"],
      async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
        const conn = activeConnections.get(serverId)
        if (!conn) throw new Error(`MCP server ${serverId} not connected`)
        const result = await conn.callTool(t.name, input ?? {})
        const content = extractMcpText(result)
        return scrubSecrets(content).slice(0, LIMITS.MCP_OUTPUT_MAX_CHARS)
      },
    }))
  }

  async close(): Promise<void> {
    await this.transport.close()
  }
}

/** Normalisasi konten tool MCP (string | blok {text} campuran) → teks. */
export function extractMcpText(result: unknown): string {
  if (result == null) return ""
  const r = result as { content?: unknown }
  if (!Array.isArray(r.content)) return String(result)
  return r.content
    .map((c) => {
      if (typeof c === "string") return c
      if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
        return (c as { text: string }).text
      }
      return JSON.stringify(c)
    })
    .join("\n")
}

export async function connectAll(configs: McpServerConfig[]): Promise<Tool[]> {
  const allTools: Tool[] = []

  for (const cfg of configs) {
    if (activeConnections.has(cfg.id)) {
      process.stderr.write(`[mcp] ${cfg.id} already connected\n`)
      continue
    }
    const conn = new McpConnection(cfg)
    try {
      await conn.connect()
      const tools = conn.wrapTools(cfg.id)
      allTools.push(...tools)
      activeConnections.set(cfg.id, conn)
      process.stderr.write(`[mcp] ${cfg.id} connected via ${conn.kind} (${tools.length} tools)\n`)
    } catch (e) {
      process.stderr.write(`[mcp] ${cfg.id} failed: ${(e as Error).message}\n`)
    }
  }

  return allTools
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const conn = activeConnections.get(serverId)
  if (!conn) throw new Error(`MCP server ${serverId} not connected`)
  return conn.callTool(toolName, args)
}

export async function listMcpTools(serverId: string): Promise<McpToolDef[]> {
  const conn = activeConnections.get(serverId)
  if (!conn) throw new Error(`MCP server ${serverId} not connected`)
  return conn.tools
}

export async function closeAll(): Promise<void> {
  for (const [id, conn] of activeConnections) {
    try {
      await conn.close()
    } catch {}
    activeConnections.delete(id)
  }
}

export function getMcpServerIds(): string[] {
  return [...activeConnections.keys()]
}
