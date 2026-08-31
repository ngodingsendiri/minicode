import type { Tool } from "#minicore"
import type { MinicodeConfig } from "../config.ts"
import { configureServers as lspConfigure } from "../lsp/client.ts"
import { connectAll as mcpConnectAll } from "../mcp/client.ts"
import { allTools, withMcpTools } from "../tools/index.ts"

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function setupToolLayer(cfg: MinicodeConfig): Promise<{ sessionTools: Tool[] }> {
  let sessionTools: Tool[] = allTools
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
