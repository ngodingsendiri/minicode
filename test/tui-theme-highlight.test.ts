import { expect, test } from "bun:test";
import { c, stripAnsi, glyphs, box } from "../src/tui/theme.ts";
import { highlightCode, formatCodeBlock } from "../src/tui/highlight.ts";
import { decorateMarkdown } from "../src/tui/markdown.ts";

test("markdown: decorates code fences with labeled separators", () => {
  const md = "intro\n```typescript\nconst x = 1;\n```\noutro";
  const out = decorateMarkdown(md);
  expect(out).toContain("─── typescript ───");
  expect(out).toContain("─── end ───");
  expect(out).not.toContain("```");
});

test("markdown: plain text without fences unchanged", () => {
  expect(decorateMarkdown("just text")).toBe("just text");
});

test("theme: stripAnsi removes escape codes cleanly", () => {
  const colored = c.cyan(c.bold("hello world"));
  expect(stripAnsi(colored)).toBe("hello world");
});

test("theme: glyphs and box contain valid characters", () => {
  expect(glyphs.sparkle).toBeDefined();
  expect(box.topLeft).toBeDefined();
  expect(box.horizontal).toBeDefined();
});

test("highlight: TypeScript keywords and strings", () => {
  const code = `const greeting = "hello";\nfunction test() { return 42; }`;
  const highlighted = highlightCode(code, "typescript");
  expect(stripAnsi(highlighted)).toBe(code);
  expect(highlighted).toContain("\x1b[");
});

test("highlight: Python code and comments", () => {
  const code = `def calculate():\n    # inline comment\n    return 100`;
  const highlighted = highlightCode(code, "python");
  expect(stripAnsi(highlighted)).toBe(code);
});

test("highlight: JSON strings, keys and numbers", () => {
  const code = `{\n  "name": "minicode",\n  "version": 1,\n  "active": true\n}`;
  const highlighted = highlightCode(code, "json");
  expect(stripAnsi(highlighted)).toBe(code);
});

test("highlight: formatCodeBlock creates bordered frame", () => {
  const block = formatCodeBlock("const x = 1;", "ts");
  expect(block).toContain("ts");
  expect(stripAnsi(block)).toContain("const x = 1;");
  expect(stripAnsi(block)).toContain("1 │ const x = 1;");
});
