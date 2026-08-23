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
    // find closing --- at start of line (avoid body "---" hr)
    const end = txt.indexOf("\n---", 3);
    if (end !== -1) {
      const closeEnd = end + 4; // \n--- + \n?
      for (const line of txt.slice(3, end).split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf(":");
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          let val = trimmed.slice(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          meta[key] = val;
        }
      }
      body = txt.slice(closeEnd).trim();
      // strip leading --- line leftover
      if (body.startsWith("---")) body = body.slice(3).trim();
    }
  }
  return { meta, body };
}

async function loadDir(dir: string, out: Skill[]) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      // recursive 1-level deep for nested skills
      await loadDir(full, out);
      continue;
    }
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const txt = await readFile(full, "utf8").catch(() => "");
    if (!txt.trim()) continue;
    const { meta, body } = parseFrontmatter(txt);
    const rawName = meta.name ?? e.name.replace(/\.md$/, "");
    const name = rawName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    out.push({
      name: name || rawName,
      description: meta.description ?? body.split("\n")[0]?.slice(0, 100) ?? "",
      body,
      path: full,
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
  return skill.body.replace(/\{\{args\}\}/g, args).replace(/\$ARGUMENTS/g, args);
}

export async function findSkill(name: string, cwd = process.cwd()): Promise<Skill | undefined> {
  const all = await loadSkills(cwd);
  return all.find((s) => s.name === name || s.name === name.replace(/^\//, ""));
}

export function skillsToSystemPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  return `\n# Available skills (use via /name or ask)\n${skills.map((s) => `- /${s.name}: ${s.description}`).join("\n")}`;
}
