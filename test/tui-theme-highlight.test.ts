import { expect, test } from "bun:test";
import { c, stripAnsi, glyphs } from "../src/tui/theme.ts";
import { highlightCode } from "../src/tui/highlight.ts";
import { decorateMarkdown } from "../src/tui/markdown.ts";

test("theme: stripAnsi removes escape codes cleanly", () => {
  const colored = c.info(c.bold("hello world"));
  expect(stripAnsi(colored)).toBe("hello world");
});

test("theme: glyphs contain valid characters", () => {
  expect(glyphs.check).toBeDefined();
  expect(glyphs.cross).toBeDefined();
});

test("highlight: TypeScript keywords and strings", () => {
  const code = `const greeting = "hello";\nfunction test() { return 42; }`;
  const highlighted = highlightCode(code, "typescript");
  // Content must be preserved exactly (colors may be stripped in non-TTY)
  expect(stripAnsi(highlighted)).toBe(code);
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

test("markdown: decorates code fences with indentation", () => {
  const md = "intro\n```typescript\nconst x = 1;\n```\noutro";
  const out = decorateMarkdown(md);
  expect(out).not.toContain("```");
  expect(out).toContain("const x = 1;");
});

test("markdown: plain text without fences unchanged", () => {
  expect(decorateMarkdown("just text")).toBe("just text");
});
