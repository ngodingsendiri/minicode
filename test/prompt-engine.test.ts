import { expect, test } from "bun:test";
import { createState, applyKey, buildRenderSpec, decodeKeys, MAX_VISIBLE } from "../cli/prompt-engine.ts";

const cmds = ["/help", "/providers", "/provider-add", "/provider-remove", "/models", "/model", "/undo", "/redo", "/cost", "/sessions"];
const hints = (l: string): string[] => (l.startsWith("/") ? cmds.filter((c) => c.startsWith(l)) : []);

test("createState: empty defaults", () => {
  const s = createState();
  expect(s).toEqual({ line: "", sel: -1, menuOpen: false });
});

test("char '/' opens menu, other chars don't", () => {
  let r = applyKey(createState(), { type: "char", ch: "/" }, hints);
  expect(r.state.menuOpen).toBe(true);
  expect(r.state.sel).toBe(-1);
  expect(r.action).toBe("render");

  r = applyKey(createState(), { type: "char", ch: "h" }, hints);
  expect(r.state.menuOpen).toBe(false);
});

test("backspace closes menu when line no longer starts with /", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "/" }, hints).state;
  s = applyKey(s, { type: "char", ch: "h" }, hints).state;
  s = applyKey(s, { type: "backspace" }, hints).state;
  expect(s.line).toBe("/");
  expect(s.menuOpen).toBe(true);
  // backspace remaining '/' closes
  s = applyKey(s, { type: "backspace" }, hints).state;
  expect(s.line).toBe("");
  expect(s.menuOpen).toBe(false);
});

test("up/down wraps selection", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "/" }, hints).state;
  s = applyKey(s, { type: "down" }, hints).state;
  expect(s.sel).toBe(0);
  s = applyKey(s, { type: "down" }, hints).state;
  expect(s.sel).toBe(1);
  s = applyKey(s, { type: "down" }, hints).state;
  expect(s.sel).toBe(2);
  // wrap to end
  s = applyKey(s, { type: "up" }, hints).state;
  expect(s.sel).toBe(1);
  // up from 0 wraps to last
  s = applyKey(s, { type: "up" }, hints).state;
  s = applyKey(s, { type: "up" }, hints).state;
  expect(s.sel).toBe(cmds.length - 1);
  s = applyKey(s, { type: "down" }, hints).state;
  expect(s.sel).toBe(0);
});

test("tab picks selected item and closes menu", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "/" }, hints).state;
  s = applyKey(s, { type: "char", ch: "m" }, hints).state;
  expect(s.menuOpen).toBe(true);
  const r = applyKey(s, { type: "tab" }, hints);
  expect(r.state.line).toBe(cmds[4]!); // /models first match for "/m"
  expect(r.state.menuOpen).toBe(false);
});

test("enter picks selected item, submits", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "/" }, hints).state;
  s = applyKey(s, { type: "down" }, hints).state; // sel=0 → /help
  const r = applyKey(s, { type: "enter" }, hints);
  expect(r.action).toBe("submit");
  expect(r.state.line).toBe("/help");
});

test("enter on plain text submits as-is", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "h" }, hints).state;
  s = applyKey(s, { type: "char", ch: "i" }, hints).state;
  const r = applyKey(s, { type: "enter" }, hints);
  expect(r.action).toBe("submit");
  expect(r.state.line).toBe("hi");
});

test("enter with menu open but no matching row → keeps line but submits", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "/" }, hints).state;
  s = applyKey(s, { type: "char", ch: "z" }, hints).state; // no match
  const r = applyKey(s, { type: "enter" }, hints);
  expect(r.action).toBe("submit");
  expect(r.state.line).toBe("/z");
});

test("esc closes menu without changing line", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "/" }, hints).state;
  s = applyKey(s, { type: "down" }, hints).state;
  const r = applyKey(s, { type: "esc" }, hints);
  expect(r.state.menuOpen).toBe(false);
  expect(r.state.line).toBe("/");
  expect(r.state.sel).toBe(-1);
});

test("esc on closed menu → no-op", () => {
  const r = applyKey(createState(), { type: "esc" }, hints);
  expect(r.action).toBe("none");
});

test("ctrl-c and ctrl-d cancel", () => {
  expect(applyKey(createState(), { type: "ctrl-c" }, hints).action).toBe("cancel");
  expect(applyKey(createState(), { type: "ctrl-d" }, hints).action).toBe("cancel");
});

test("char on empty line keeps menu closed for normal text", () => {
  let s = applyKey(createState(), { type: "char", ch: "a" }, hints).state;
  expect(s.menuOpen).toBe(false);
  s = applyKey(s, { type: "char", ch: "/" }, hints).state;
  expect(s.menuOpen).toBe(false); // "a/" does not open menu
});

test("buildRenderSpec: cap at MAX_VISIBLE with moreCount", () => {
  const s = { line: "/", sel: -1, menuOpen: true };
  const spec = buildRenderSpec(s, "minicode❯ ", hints("/"));
  expect(spec.rows.length).toBeLessThanOrEqual(MAX_VISIBLE);
  expect(spec.moreCount).toBe(spec.rows.length > MAX_VISIBLE ? 0 : Math.max(0, hints("/").length - MAX_VISIBLE));
  expect(spec.inputLine).toBe("minicode❯ /");
});

test("buildRenderSpec: more hint list than visible → moreCount > 0", () => {
  const many = new Array(25).fill("/cmd").map((_, i) => `/cmd${i}`);
  const s = { line: "/", sel: -1, menuOpen: true };
  const spec = buildRenderSpec(s, "p", many);
  expect(spec.rows.length).toBe(MAX_VISIBLE);
  expect(spec.moreCount).toBe(15);
  expect(spec.totalRows).toBe(MAX_VISIBLE + 1);
});

test("buildRenderSpec: selection row marked picked", () => {
  const s = { line: "/", sel: 3, menuOpen: true };
  const spec = buildRenderSpec(s, "p", cmds);
  const picked = spec.rows.filter((r) => r.picked);
  expect(picked.length).toBe(1);
  expect(picked[0]!.text).toBe(cmds[3]!);
});

test("buildRenderSpec: grouped hints → header rows dinamis", () => {
  const s = { line: "/", sel: 0, menuOpen: true };
  const spec = buildRenderSpec(s, "p", ["/help", "/my-skill"], (t) => (t.startsWith("/help") ? "commands" : "skills"));
  expect(spec.rows[0]).toEqual({ kind: "header", text: "COMMANDS", picked: false });
  expect(spec.rows[1]).toMatchObject({ kind: "item", text: "/help" });
  expect(spec.rows[2]).toEqual({ kind: "header", text: "SKILLS", picked: false });
  expect(spec.rows[3]).toMatchObject({ kind: "item", text: "/my-skill" });
  // totalRows menghitung header juga
  expect(spec.totalRows).toBe(4);
});

test("decodeKeys: plain text + enter", () => {
  const keys = decodeKeys(new TextEncoder().encode("ok\n"));
  expect(keys.map((k) => k.key.type)).toEqual(["char", "char", "enter"]);
  expect(keys[0]!.key).toEqual({ type: "char", ch: "o" });
});

test("decodeKeys: arrows & escape", () => {
  const keys = decodeKeys(new TextEncoder().encode("\x1b[A\x1b[B\x1b[C\x1b[D"));
  expect(keys.map((k) => k.key.type)).toEqual(["up", "down", "right", "left"]);
});

test("decodeKeys: backspace, tab, ctrl-c", () => {
  const keys = decodeKeys(new TextEncoder().encode("\x7f\t\u0003\u0004"));
  expect(keys.map((k) => k.key.type)).toEqual(["backspace", "tab", "ctrl-c", "ctrl-d"]);
});

test("decodeKeys: multi-byte UTF-8 emoji decoded correctly", () => {
  const emoji = new TextEncoder().encode("✓");
  const keys = decodeKeys(emoji);
  expect(keys.length).toBe(1);
  expect(keys[0]!.key).toEqual({ type: "char", ch: "✓" });
});

test("decodeKeys: 4-byte emoji char", () => {
  const keys = decodeKeys(new TextEncoder().encode("✅"));
  expect(keys.length).toBe(1);
  expect(keys[0]!.key).toEqual({ type: "char", ch: "✅" });
});

test("decodeKeys: 2-unit surrogate pair emoji (4-byte UTF-8)", () => {
  const keys = decodeKeys(new TextEncoder().encode("😀"));
  expect(keys.length).toBe(1);
  expect(keys[0]!.key).toEqual({ type: "char", ch: "😀" });
});

test("decodeKeys: mixed emoji + text stays intact", () => {
  const keys = decodeKeys(new TextEncoder().encode("halo😀ok\n"));
  const chars = keys.map((k) => (k.key.type === "char" ? k.key.ch : null)).filter(Boolean);
  expect(chars.join("")).toBe("halo😀ok");
  expect(keys[keys.length - 1]!.key.type).toBe("enter");
});

test("applyKey: backspace removes full surrogate pair", () => {
  let s = createState();
  s = applyKey(s, { type: "char", ch: "a" }, hints).state;
  s = applyKey(s, { type: "char", ch: "😀" }, hints).state;
  expect(s.line).toBe("a😀");
  s = applyKey(s, { type: "backspace" }, hints).state;
  expect(s.line).toBe("a");
  // backspace below the emoji: line stays valid UTF-16 (no lone surrogate)
  s = applyKey(s, { type: "char", ch: "😀" }, hints).state;
  const bytes = new TextEncoder().encode(s.line);
  const back = decodeKeys(bytes);
  expect(back.length).toBe(2); // a + 😀
});

test("applyKey: emoji in non-slash line does not open menu", () => {
  const s = applyKey(createState(), { type: "char", ch: "😀" }, hints);
  expect(s.state.menuOpen).toBe(false);
});
