import type { Tool } from "#minicore"
import type { MinicodeConfig } from "../config.ts"
import { configureServers as lspConfigure } from "../lsp/client.ts"
import { connectAll as mcpConnectAll } from "../mcp/client.ts"
import { allTools, withMcpTools } from "../tools/index.ts"
import { EXPLORE_TOOL_NAMES } from "../tools/task.ts"

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export type ToolScope = "full" | "explore"

export async function setupToolLayer(
  cfg: MinicodeConfig,
  scope: ToolScope = "full",
): Promise<{ sessionTools: Tool[] }> {
  let sessionTools: Tool[] = allTools
  // Harness-P2: scope explore = subset read-only (sama seperti sub-agen).
  // MCP runtime ikut terpotong (nama bertitik tak ada di daftar) — least privilege.
  if (scope === "explore")
    sessionTools = allTools.filter((t) => EXPLORE_TOOL_NAMES.includes(t.name))
  try {
    if (cfg.mcpServers?.length) {
      const mcpTools = await mcpConnectAll(cfg.mcpServers)
      if (mcpTools.length) sessionTools = withMcpTools(allTools, mcpTools)
    }
  } catch (e) {
    process.stderr.write(`[mcp] init failed: ${errMsg(e)}\n`)
  }
  try {
    if (cfg.lspServers?.length) lspConfigure(cfg.lspServers)
  } catch (e) {
    process.stderr.write(`[lsp] init failed: ${errMsg(e)}\n`)
  }
  return { sessionTools }
}
