import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";

const GLOBAL_MEM = join(homedir(), ".minicode", "MEMORY.md");
const LOCAL_MEM = ".minicode/MEMORY.md";
const ROOT_MEM = "MEMORY.md";

export async function loadMemoryFiles(cwd = process.cwd()): Promise<string> {
  const parts: string[] = [];
  for (const p of [GLOBAL_MEM, resolve(cwd, LOCAL_MEM), resolve(cwd, ROOT_MEM)]) {
    try {
      const txt = await readFile(p, "utf8");
      if (txt.trim()) parts.push(`# ${p}\n${txt.slice(0, 6000)}`);
    } catch {}
  }
  return parts.join("\n\n");
}

export async function appendMemory(text: string, cwd = process.cwd()): Promise<string> {
  const path = resolve(cwd, LOCAL_MEM);
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  const entry = `- ${new Date().toISOString().slice(0, 10)} ${text.trim().slice(0, 1000)}\n`;
  // ensure file
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch {}
  await writeFile(path, existing + entry, "utf8");
  // also add to vector is done by tool
  return path;
}

export async function readMemoryFile(cwd = process.cwd()): Promise<string> {
  return await loadMemoryFiles(cwd);
}
