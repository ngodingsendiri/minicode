import { expect, test } from "bun:test";
import { computeLineDiff, renderDiffCard } from "../src/tui/diff.ts";
import { stripAnsi } from "../src/tui/theme.ts";

test("diff: computeLineDiff identifies added and deleted lines", () => {
  const oldText = "line 1\nline 2\nline 3";
  const newText = "line 1\nline 2 modified\nline 3\nline 4";

  const diff = computeLineDiff(oldText, newText);
  expect(diff.some((d) => d.type === "delete" && d.content === "line 2")).toBe(true);
  expect(diff.some((d) => d.type === "add" && d.content === "line 2 modified")).toBe(true);
  expect(diff.some((d) => d.type === "add" && d.content === "line 4")).toBe(true);
});

test("diff: renderDiffCard formats bordered diff output", () => {
  const oldText = "const a = 1;";
  const newText = "const a = 2;";

  const card = renderDiffCard("src/test.ts", oldText, newText);
  expect(card).toContain("src/test.ts");
  const clean = stripAnsi(card);
  expect(clean).toContain("- const a = 1;");
  expect(clean).toContain("+ const a = 2;");
});
