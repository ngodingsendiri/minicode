import { expect, test } from "bun:test";

// Subsistem filter `/models [keyword]` & `minicode models --match <substr>`:
// operasi dasar = case-insensitive substring (dipakai di commands.ts/index.ts).
test("models filter: case-insensitive substring", () => {
  const models = ["claude-opus-5", "gemini-3.7-flash", "gpt-5.6-luna"];
  expect(models.filter((m) => m.toLowerCase().includes("gemini"))).toEqual(["gemini-3.7-flash"]);
  expect(models.filter((m) => m.toLowerCase().includes("claude"))).toEqual(["claude-opus-5"]);
  expect(models.filter((m) => m.toLowerCase().includes("sonnet"))).toEqual([]);
  expect(models.filter((m) => m.toLowerCase().includes("5.6"))).toEqual(["gpt-5.6-luna"]);
});
