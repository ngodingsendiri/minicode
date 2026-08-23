import { readFile, appendFile, mkdir, stat } from "node:fs/promises";
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

const MAX_MEMORY_FILE_BYTES = 200_000;

export async function appendMemory(text: string, cwd = process.cwd()): Promise<string> {
  const path = resolve(cwd, LOCAL_MEM);
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  const entry = `- ${new Date().toISOString().slice(0, 10)} ${text.trim().slice(0, 1000)}\n`;
  // atomic append — no read+write race
  await appendFile(path, entry, "utf8").catch(async () => {
    // fallback if file not exists
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, entry, "utf8");
  });
  // size guard: truncate oldest if too large (keep last 150k)
  try {
    const st = await stat(path);
    if (st.size > MAX_MEMORY_FILE_BYTES) {
      const txt = await readFile(path, "utf8");
      const keep = txt.slice(-150_000);
      const cut = keep.indexOf("\n");
      await import("node:fs/promises").then((m) => m.writeFile(path, cut >= 0 ? keep.slice(cut + 1) : keep, "utf8"));
    }
  } catch {}
  return path;
}

export async function readMemoryFile(cwd = process.cwd()): Promise<string> {
  return await loadMemoryFiles(cwd);
}
