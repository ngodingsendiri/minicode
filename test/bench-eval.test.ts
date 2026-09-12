// Eval memory diferensial: task follow-convention hanya lolos bila agen
// membaca fakta seed — verify murni file (tanpa LLM), hermetic tmpdir.
import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BENCH_TASKS } from "../bench/tasks.ts"

const task = BENCH_TASKS.find((t) => t.id === "follow-convention")!

test("follow-convention: seedMemory ada dan prompt tak membocorkan jawaban", () => {
  expect(task.seedMemory).toBeTruthy()
  expect(task.prompt.toLowerCase()).not.toContain("salam")
  expect(task.seedMemory!).toContain("salam")
})

test("follow-convention: verify lolos bila konvensi diikuti, gagal bila tidak", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minicode-eval-"))
  try {
    await writeFile(
      join(dir, "greet.ts"),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture kode TS, bukan template
      "export function salam(name: string): string {\n  return `salam, ${name}!`;\n}\n",
      "utf8",
    )
    const ok = await task.verify(dir)
    expect(ok.passed).toBe(true)
    await writeFile(
      join(dir, "greet.ts"),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture kode TS, bukan template
      "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
      "utf8",
    )
    const bad = await task.verify(dir)
    expect(bad.passed).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

test("follow-convention: setup sediakan greet.ts kosong", async () => {
  const dir = await task.setup()
  try {
    const txt = await readFile(join(dir, "greet.ts"), "utf8")
    expect(txt).toBe("")
  } finally {
    await task.cleanup(dir)
  }
})
