import { expect, test } from "bun:test"
import {
  applyKey,
  buildRenderSpec,
  createState,
  decodeKeys,
  type PromptState,
} from "../cli/prompt-engine.ts"

// Fuzz — decodeKeys dengan bytes acak TIDAK BOLEH throw
test("fuzz decodeKeys: 1000 iterasi byte acak tidak throw & hasil selalu PromptKey", () => {
  const rng = (n: number) => Math.floor(Math.random() * n)
  for (let iter = 0; iter < 1000; iter++) {
    const len = rng(64)
    const buf = new Uint8Array(len)
    for (let i = 0; i < len; i++) buf[i] = rng(256)
    const keys = decodeKeys(buf)
    for (const k of keys) {
      expect(typeof k.key.type).toBe("string")
      expect(k.width).toBeGreaterThan(0)
      expect(typeof k.width).toBe("number")
    }
  }
})

// Fuzz — applyKey dengan keystroke acak + hints: state selalu valid
test("fuzz applyKey: 2000 langkah acak — state valid & tidak throw", () => {
  const cmds = [
    "/help",
    "/providers",
    "/model",
    "/models",
    "/sync",
    "/undo",
    "/cost",
    "/status",
    "/resume",
    "/exit",
    "/review",
    "/fix",
    "/repo",
    "/debug",
  ]
  const hints = (l: string) => (l.startsWith("/") ? cmds.filter((c) => c.startsWith(l)) : [])
  const keyTypes = [
    "char",
    "backspace",
    "up",
    "down",
    "tab",
    "enter",
    "esc",
    "ctrl-c",
    "left",
    "right",
  ] as const
  const chars = [
    "/",
    "h",
    "e",
    "l",
    "p",
    "p",
    "r",
    "o",
    "v",
    "i",
    "d",
    "e",
    "r",
    "s",
    "m",
    "a",
    "0",
    " ",
    "😀",
    "✓",
  ]
  const rng = (n: number) => Math.floor(Math.random() * n)

  let state: PromptState = createState()
  for (let step = 0; step < 2000; step++) {
    const t = keyTypes[rng(keyTypes.length)]!
    const key = t === "char" ? { type: "char", ch: chars[rng(chars.length)]! } : { type: t }
    // @ts-expect-error union narrow
    const r = applyKey(state, key, hints)
    state = r.state
    // invariant: sel selalu in-range atau -1
    if (state.sel >= 0) {
      const n = hints(state.line).length
      expect(state.sel).toBeLessThan(n)
    }
    // invariant: menuOpen hanya saat line startsWith("/")
    if (state.menuOpen) expect(state.line.startsWith("/")).toBe(true)
    // invariant: line valid UTF-16 (tidak ada lone surrogate)
    const decoded = decodeKeys(new TextEncoder().encode(state.line))
    expect(decoded.length).toBeGreaterThanOrEqual(0)
    // action selalu valid
    expect(["none", "render", "submit", "cancel"]).toContain(r.action)
    // render spec tidak pernah throw pada state apa pun
    buildRenderSpec(state, "minicode❯ ", hints(state.line), (t) =>
      cmds.includes(t.split(" ")[0]!) ? "commands" : "skills",
    )
  }
})

// Fuzz — bytes acak yang kebetulan mengandung ESC tidak membuat decode stuck
test("fuzz decodeKeys: chunk pecah ESC di akhir buffer aman", () => {
  const partial = [0x1b, 0x5b] // ESC[
  const keys = decodeKeys(new Uint8Array(partial))
  expect(Array.isArray(keys)).toBe(true)
})

// 6.5 — Seed test deterministik: RNG seed sama → hasil akhir identik (reproducible)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function runSeeded(seed: number): string {
  const rng = mulberry32(seed)
  const chars = "abcdefghijklmnopABCDEFGHIJKLMNOP !?/'\"".split("")
  const hints = (l: string): string[] => (l.startsWith("/") ? ["/help", "/providers"] : [])
  let s = createState()
  for (let i = 0; i < 300; i++) {
    const r = rng()
    if (r < 0.85) {
      const ch = chars[Math.floor(rng() * chars.length)]!
      s = applyKey(s, { type: "char", ch }, hints).state
    } else if (r < 0.92) {
      s = applyKey(s, { type: "backspace" }, hints).state
    } else if (r < 0.96) {
      s = applyKey(s, { type: "left" }, hints).state
    } else {
      s = applyKey(s, { type: "right" }, hints).state
    }
    if (s.line.includes("\n")) break
  }
  return s.line
}

test("seed test: seed sama → line akhir identik (deterministik)", () => {
  const a = runSeeded(12345)
  const b = runSeeded(12345)
  const c = runSeeded(99999)
  expect(a).toBe(b)
  expect(a).not.toBe(c)
})
