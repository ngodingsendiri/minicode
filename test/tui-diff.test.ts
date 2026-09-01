import { expect, test } from "bun:test"
import { computeLineDiff, renderDiffCard } from "../src/ui/render/diff.ts"
import { stripAnsi } from "../src/ui/render/theme.ts"
import { displayWidth } from "../src/ui/render/width.ts"

test("diff: computeLineDiff identifies added and deleted lines", () => {
  const oldText = "line 1\nline 2\nline 3"
  const newText = "line 1\nline 2 modified\nline 3\nline 4"

  const diff = computeLineDiff(oldText, newText)
  expect(diff.some((d) => d.type === "delete" && d.content === "line 2")).toBe(true)
  expect(diff.some((d) => d.type === "add" && d.content === "line 2 modified")).toBe(true)
  expect(diff.some((d) => d.type === "add" && d.content === "line 4")).toBe(true)
})

test("diff: renderDiffCard formats bordered diff output", () => {
  const oldText = "const a = 1;"
  const newText = "const a = 2;"

  const card = renderDiffCard("src/test.ts", oldText, newText)
  expect(card).toContain("src/test.ts")
  const clean = stripAnsi(card)
  expect(clean).toContain("- const a = 1;")
  expect(clean).toContain("+ const a = 2;")
})

// ── Temuan bug-hunter UI ────────────────────────────────────────────────────

// Baris diff sepanjang baris kode aslinya. Tanpa batas, satu baris 300 karakter
// membungkus sendiri di terminal dan merusak frame TUI yang menghitung tinggi
// per baris.
test("diff: baris panjang dipotong ke lebar terminal", () => {
  const card = renderDiffCard("f.ts", "x", "y".repeat(300), { width: 80 })
  for (const line of stripAnsi(card).split("\n")) {
    expect(displayWidth(line)).toBeLessThanOrEqual(80)
  }
})

test("diff: lebar bisa ditentukan pemanggil", () => {
  const card = renderDiffCard("f.ts", "x", "y".repeat(300), { width: 40 })
  for (const line of stripAnsi(card).split("\n")) {
    expect(displayWidth(line)).toBeLessThanOrEqual(40)
  }
})

test("diff: path panjang juga dipotong", () => {
  const card = renderDiffCard(`src/${"sub/".repeat(50)}a.ts`, "x", "y", { width: 60 })
  const first = stripAnsi(card).split("\n")[0]!
  expect(displayWidth(first)).toBeLessThanOrEqual(60)
})

test("diff: CJK dalam diff dihitung per kolom", () => {
  const card = renderDiffCard("f.ts", "旧", "新".repeat(60), { width: 40 })
  for (const line of stripAnsi(card).split("\n")) {
    expect(displayWidth(line)).toBeLessThanOrEqual(40)
  }
})

test("diff: tanpa perubahan memberi pesan", () => {
  expect(stripAnsi(renderDiffCard("f.ts", "sama", "sama"))).toContain("no changes")
})

test("diff: maxLines membatasi jumlah baris + ringkasan sisa", () => {
  const oldT = Array.from({ length: 40 }, (_, i) => `baris ${i}`).join("\n")
  const newT = Array.from({ length: 40 }, (_, i) => `ubah ${i}`).join("\n")
  const card = stripAnsi(renderDiffCard("f.ts", oldT, newT, { maxLines: 5 }))
  const lines = card.split("\n")
  expect(lines.length).toBeLessThanOrEqual(7) // path + 5 baris + ringkasan
  expect(card).toContain("...")
})

test("diff: berkas kosong tidak melempar", () => {
  for (const [o, n] of [
    ["", ""],
    ["", "baru"],
    ["lama", ""],
    ["\n", "\n\n"],
  ]) {
    expect(() => renderDiffCard("f.ts", o!, n!)).not.toThrow()
  }
})

test("diff: berkas besar tidak kuadratik", () => {
  const n = 2000
  const oldT = Array.from({ length: n }, (_, i) => `baris ${i}`).join("\n")
  const newT = Array.from({ length: n }, (_, i) => (i === n - 1 ? "diubah" : `baris ${i}`)).join(
    "\n",
  )
  const t0 = performance.now()
  computeLineDiff(oldT, newT)
  expect(performance.now() - t0).toBeLessThan(2000)
})
