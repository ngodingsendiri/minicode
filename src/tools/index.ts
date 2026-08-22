export { readFileTool } from "./read_file.ts";
export { writeFileTool } from "./write_file.ts";
export { editTool } from "./edit.ts";
export { globTool } from "./glob.ts";
export { grepTool } from "./grep.ts";
export { bashTool } from "./bash.ts";
export { gitStatusTool, gitDiffTool, gitLogTool } from "./git.ts";

import { readFileTool } from "./read_file.ts";
import { writeFileTool } from "./write_file.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { bashTool } from "./bash.ts";
import { gitStatusTool, gitDiffTool, gitLogTool } from "./git.ts";
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
];
