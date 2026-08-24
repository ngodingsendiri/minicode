import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface BenchTask {
  id: string;
  description: string;
  setup(): Promise<string>;
  prompt: string;
  verify(dir: string): Promise<{ passed: boolean; detail: string }>;
  cleanup(dir: string): Promise<void>;
}

const clean = (dir: string) => rm(dir, { recursive: true, force: true }).catch(() => {});

export const BENCH_TASKS: BenchTask[] = [
  {
    id: "create-function",
    description: "Create a greet() function in a TS file",
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), "minicode-bench-"));
      await writeFile(join(dir, "greet.ts"), "", "utf8");
      return dir;
    },
    prompt: "Create a function `greet(name: string): string` that returns `Hello, <name>!` in greet.ts. Use write_file. Write the full file.",
    async verify(dir) {
      const txt = await readFile(join(dir, "greet.ts"), "utf8").catch(() => "");
      return { passed: /function\s+greet\s*\(/.test(txt) && /Hello/.test(txt), detail: txt.slice(0, 160) };
    },
    cleanup: clean,
  },
  {
    id: "fix-bug",
    description: "Fix a broken sum() (subtracts instead of adds)",
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), "minicode-bench-"));
      await writeFile(join(dir, "sum.ts"), "export function sum(a: number[]): number {\n  let t = 0;\n  for (let i = 0; i < a.length; i++) {\n    t -= a[i]!;\n  }\n  return t;\n}\n", "utf8");
      return dir;
    },
    prompt: "The sum function is wrong (it subtracts). Fix it to add the elements. Edit sum.ts.",
    async verify(dir) {
      const txt = await readFile(join(dir, "sum.ts"), "utf8").catch(() => "");
      return { passed: /t\s*\+=/.test(txt), detail: txt.slice(0, 160) };
    },
    cleanup: clean,
  },
  {
    id: "write-test",
    description: "Write a unit test for an existing function",
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), "minicode-bench-"));
      await writeFile(join(dir, "add.ts"), "export function add(a: number, b: number): number { return a + b; }\n", "utf8");
      return dir;
    },
    prompt: "Write a bun:test unit test for add() in add.test.ts that checks add(2,3) === 5. Use write_file.",
    async verify(dir) {
      const txt = await readFile(join(dir, "add.test.ts"), "utf8").catch(() => "");
      return { passed: /add\s*\(2\s*,\s*3\)|toBe\s*\(\s*5/.test(txt), detail: txt.slice(0, 160) };
    },
    cleanup: clean,
  },
  {
    id: "rename-symbol",
    description: "Rename a function across a file",
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), "minicode-bench-"));
      await writeFile(join(dir, "util.ts"), "export function calcOld(a: number): number { return a * 2; }\nconst res = calcOld(5);\nexport { res };\n", "utf8");
      return dir;
    },
    prompt: "Rename function `calcOld` to `calc` everywhere in util.ts, and update the call site. Use edit.",
    async verify(dir) {
      const txt = await readFile(join(dir, "util.ts"), "utf8").catch(() => "");
      return { passed: /calc\b/.test(txt) && !/calcOld/.test(txt), detail: txt.slice(0, 160) };
    },
    cleanup: clean,
  },
  {
    id: "add-error-handling",
    description: "Add error handling to a fetch wrapper",
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), "minicode-bench-"));
      await writeFile(join(dir, "client.ts"), "export async function getJson(url: string): Promise<unknown> {\n  const res = await fetch(url);\n  return res.json();\n}\n", "utf8");
      return dir;
    },
    prompt: "Add error handling to getJson() in client.ts: throw on !res.ok, wrap in try/catch. Use edit.",
    async verify(dir) {
      const txt = await readFile(join(dir, "client.ts"), "utf8").catch(() => "");
      return { passed: /res\.ok|try\s*\{|catch/.test(txt), detail: txt.slice(0, 160) };
    },
    cleanup: clean,
  },
];

// Dukungan task eksternal (SWE-bench-format): array { id, description, prompt, files: {path, content}[], verify: string[] }.
export interface ExternalTask {
  id: string;
  description?: string;
  prompt: string;
  files: { path: string; content: string }[];
  verify: string[]; // substring yang harus ada di file (atau `!` untuk negatif)
}

export async function loadExternalTasks(path: string): Promise<BenchTask[]> {
  const raw = await readFile(path, "utf8");
  const list = JSON.parse(raw) as ExternalTask[];
  return list.map((t) => ({
    id: t.id,
    description: t.description ?? t.prompt.slice(0, 80),
    async setup() {
      const dir = await mkdtemp(join(tmpdir(), "minicode-bench-"));
      for (const f of t.files) {
        await writeFile(join(dir, f.path), f.content, "utf8");
      }
      return dir;
    },
    prompt: t.prompt,
    async verify(dir) {
      const results: string[] = [];
      for (const v of t.verify) {
        const neg = v.startsWith("!");
        const needle = neg ? v.slice(1) : v;
        let found = false;
        for (const f of t.files) {
          const txt = await readFile(join(dir, f.path), "utf8").catch(() => "");
          if (txt.includes(needle)) { found = true; break; }
        }
        results.push(neg ? `!${needle}=${!found}` : `${needle}=${found}`);
        if ((!neg && !found) || (neg && found)) return { passed: false, detail: results.join(", ") };
      }
      return { passed: true, detail: results.join(", ") };
    },
    cleanup: clean,
  }));
}