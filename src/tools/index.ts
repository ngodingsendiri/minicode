export { bashTool } from "./bash.ts"
export { editTool } from "./edit.ts"
export { gitDiffTool, gitLogTool, gitStatusTool } from "./git.ts"
export { globTool } from "./glob.ts"
export { grepTool } from "./grep.ts"
export {
  lspDefinitionTool,
  lspDiagnosticsTool,
  lspHoverTool,
  lspReferencesTool,
  lspSymbolsTool,
  lspWorkspaceSymbolsTool,
} from "./lsp.ts"
export { mcpCallTool, mcpListTool } from "./mcp_call.ts"
export { forgetMemoryTool, readMemoryTool, writeMemoryTool } from "./memory.ts"
export { applyPatchTool } from "./patch.ts"
export { readFileTool } from "./read_file.ts"
export { delegateTaskTool } from "./task.ts"
export { webFetchTool } from "./web_fetch.ts"
export { writeFileTool } from "./write_file.ts"

import type { Tool } from "minicore"
import { bashTool } from "./bash.ts"
import { editTool } from "./edit.ts"
import { gitDiffTool, gitLogTool, gitStatusTool } from "./git.ts"
import { globTool } from "./glob.ts"
import { grepTool } from "./grep.ts"
import {
  lspDefinitionTool,
  lspDiagnosticsTool,
  lspHoverTool,
  lspReferencesTool,
  lspSymbolsTool,
  lspWorkspaceSymbolsTool,
} from "./lsp.ts"
import { mcpCallTool, mcpListTool } from "./mcp_call.ts"
import { forgetMemoryTool, readMemoryTool, writeMemoryTool } from "./memory.ts"
import { applyPatchTool } from "./patch.ts"
import { readFileTool } from "./read_file.ts"
import { delegateTaskTool } from "./task.ts"
import { webFetchTool } from "./web_fetch.ts"
import { writeFileTool } from "./write_file.ts"

export const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editTool,
  applyPatchTool,
  globTool,
  grepTool,
  bashTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  webFetchTool,
  readMemoryTool,
  writeMemoryTool,
  forgetMemoryTool,
  delegateTaskTool,
  mcpListTool,
  mcpCallTool,
  lspDiagnosticsTool,
  lspDefinitionTool,
  lspReferencesTool,
  lspHoverTool,
  lspSymbolsTool,
  lspWorkspaceSymbolsTool,
]

// MCP server tools (prefixed "serverid.toolname") di-append runtime via connectAll()
export function withMcpTools(base: Tool[], mcpTools: Tool[]): Tool[] {
  const seen = new Set(base.map((t) => t.name))
  return [...base, ...mcpTools.filter((t) => !seen.has(t.name))]
}
