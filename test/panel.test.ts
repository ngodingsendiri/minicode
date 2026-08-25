import { expect, test } from "bun:test"
import { captureOutput } from "../cli/panel.ts"

test("captureOutput: menangkap console.log & stdout.write jadi baris bersih", async () => {
  const { lines } = await captureOutput(async () => {
    console.log("baris satu")
    process.stdout.write("baris dua\n")
    console.log("  padded   ")
  })
  expect(lines).toContain("baris satu")
  expect(lines).toContain("baris dua")
  expect(lines).toContain("padded")
})

test("captureOutput: strip ANSI escape dari output", async () => {
  const { lines } = await captureOutput(async () => {
    console.log("\x1b[32mhijau\x1b[0m")
  })
  expect(lines[0]).toBe("hijau")
})

test("captureOutput: restore stdout & console.log setelahnya", async () => {
  const before = console.log
  await captureOutput(async () => {
    console.log("x")
  })
  expect(console.log).toBe(before)
})
