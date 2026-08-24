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
];