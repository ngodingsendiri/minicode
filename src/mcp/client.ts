import type { Tool, ToolContext } from "minicore"
import { scrubSecrets } from "../policy/scrub.ts"
import { McpTransport } from "./transport.ts"

export interface McpServerConfig {
  id: string
  command: string
  args: string[]
  env?: Record<string, string>
}

interface McpToolDef {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

const activeConnections = new Map<string, McpConnection>()

class McpConnection {
  transport = new McpTransport()
  tools: McpToolDef[] = []
  ready = false

  constructor(public config: McpServerConfig) {}

  async connect(): Promise<void> {
    await this.transport.connect(this.config.command, this.config.args, this.config.env ?? {})

    let handshakeOk = false
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
      try {
        await this.transport.request(
          "initialize",
          {
            protocolVersion: "2026-07-28",
            capabilities: { tools: {} },
            clientInfo: { name: "minicode", version: "0.1.0" },
          },
          3_000,
        )
        // wajib per spec: notification initialized setelah initialize
        this.transport.notify("notifications/initialized", {})
        handshakeOk = true
      } catch {
        throw new Error("handshake failed")
      }
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
        const content = Array.isArray((result as any)?.content)
          ? (result as any).content.map((c: any) => c.text ?? JSON.stringify(c)).join("\n")
          : String(result)
        return scrubSecrets(content).slice(0, 100_000)
      },
    }))
  }

  async close(): Promise<void> {
    await this.transport.close()
  }
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
      process.stderr.write(`[mcp] ${cfg.id} connected (${tools.length} tools)\n`)
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
