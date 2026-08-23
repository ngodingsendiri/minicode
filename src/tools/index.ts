export { readFileTool } from "./read_file.ts";
export { writeFileTool } from "./write_file.ts";
export { editTool } from "./edit.ts";
export { globTool } from "./glob.ts";
export { grepTool } from "./grep.ts";
export { bashTool } from "./bash.ts";
export { gitStatusTool, gitDiffTool, gitLogTool } from "./git.ts";
export { readMemoryTool, writeMemoryTool, forgetMemoryTool } from "./memory.ts";
export { delegateTaskTool } from "./task.ts";
export { mcpCallTool, mcpListTool } from "./mcp_call.ts";
export { lspDiagnosticsTool, lspDefinitionTool, lspReferencesTool, lspHoverTool, lspSymbolsTool } from "./lsp.ts";

import { readFileTool } from "./read_file.ts";
import { writeFileTool } from "./write_file.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { bashTool } from "./bash.ts";
import { gitStatusTool, gitDiffTool, gitLogTool } from "./git.ts";
import { readMemoryTool, writeMemoryTool, forgetMemoryTool } from "./memory.ts";
import { delegateTaskTool } from "./task.ts";
import { mcpCallTool, mcpListTool } from "./mcp_call.ts";
import { lspDiagnosticsTool, lspDefinitionTool, lspReferencesTool, lspHoverTool, lspSymbolsTool } from "./lsp.ts";
import type { Tool } from "minicore";

export const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
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
];

// MCP server tools (prefixed "serverid.toolname") di-append runtime via connectAll()
export function withMcpTools(base: Tool[], mcpTools: Tool[]): Tool[] {
  const seen = new Set(base.map((t) => t.name));
  return [...base, ...mcpTools.filter((t) => !seen.has(t.name))];
}