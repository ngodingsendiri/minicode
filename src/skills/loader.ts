import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface Skill {
  name: string;
  description: string;
  body: string; // prompt template
  path: string;
}

const GLOBAL_SKILLS = join(homedir(), ".minicode", "skills");
const LOCAL_SKILLS = ".minicode/skills";

function parseFrontmatter(txt: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  let body = txt;
  if (txt.startsWith("---")) {
    const end = txt.indexOf("---", 3);
    if (end !== -1) {
      for (const line of txt.slice(3, end).split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      body = txt.slice(end + 3).trim();
    }
  }
  return { meta, body };
}

async function loadDir(dir: string, out: Skill[]) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const path = join(dir, e.name);
    const txt = await readFile(path, "utf8").catch(() => "");
    if (!txt.trim()) continue;
    const { meta, body } = parseFrontmatter(txt);
    out.push({
      name: meta.name ?? e.name.replace(/\.md$/, ""),
      description: meta.description ?? body.split("\n")[0]?.slice(0, 100) ?? "",
      body,
      path,
    });
  }
}

export async function loadSkills(cwd = process.cwd()): Promise<Skill[]> {
  const skills: Skill[] = [];
  await loadDir(GLOBAL_SKILLS, skills);
  await loadDir(resolve(cwd, LOCAL_SKILLS), skills);
  // local overrides global by name
  const map = new Map<string, Skill>();
  for (const s of skills) map.set(s.name, s);
  return [...map.values()];
}

export async function renderSkill(skill: Skill, args: string): Promise<string> {
  return skill.body.replace(/\{\{args\}\}/g, args).replace(/\{\{args\}\}/g, args);
}

export async function findSkill(name: string, cwd = process.cwd()): Promise<Skill | undefined> {
  const all = await loadSkills(cwd);
  return all.find((s) => s.name === name || s.name === name.replace(/^\//, ""));
}

export function skillsToSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  return `\n# Available skills (use via /name or ask)\n${skills.map((s) => `- /${s.name}: ${s.description}`).join("\n")}`;
}
