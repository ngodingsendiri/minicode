// Kemampuan thinking per KELUARGA model — default universal = omit (tanpa
// param). Knob hanya meaningful untuk keluarga terbukti; sisanya tak pernah
// dikirimi param thinking. Fail-soft menutup sisanya tanpa daftar.
import { describe, expect, test } from "bun:test"
import {
  allowedEfforts,
  type EffortLevel,
  effortOptionsForModel,
  thinkingFamily,
} from "../src/providers/effort.ts"

describe("thinkingFamily", () => {
  test("openai reasoning families", () => {
    expect(thinkingFamily("o3-mini")).toBe("openai-reasoning")
    expect(thinkingFamily("o1-pro-2025-03-19")).toBe("openai-reasoning")
    expect(thinkingFamily("gpt-5.4")).toBe("openai-reasoning")
    expect(thinkingFamily("gpt-5.1-codex-max")).toBe("openai-reasoning")
    expect(thinkingFamily("GPT-6-ASTRA")).toBe("openai-reasoning")
  })
  test("claude legacy vs adaptive vs none", () => {
    expect(thinkingFamily("claude-sonnet-4-5")).toBe("claude-legacy")
    expect(thinkingFamily("claude-opus-4-5")).toBe("claude-legacy")
    expect(thinkingFamily("claude-3-7-sonnet-20250219")).toBe("claude-legacy")
    expect(thinkingFamily("claude-sonnet-4-6")).toBe("claude-adaptive")
    expect(thinkingFamily("claude-opus-4-8")).toBe("claude-adaptive")
    expect(thinkingFamily("claude-opus-5")).toBe("claude-adaptive")
    expect(thinkingFamily("claude-sonnet-5")).toBe("claude-adaptive")
    expect(thinkingFamily("claude-fable-5-1")).toBe("claude-adaptive")
    expect(thinkingFamily("claude-3-5-sonnet-20241022")).toBe("none")
    expect(thinkingFamily("claude-haiku-4-5")).toBe("claude-legacy")
  })
  test("yang lain = none (tak pernah dikirimi param)", () => {
    for (const m of [
      "deepseek-chat",
      "deepseek-reasoner",
      "gemini-2.0-flash",
      "llama3.1",
      "mimo-v2.5-free",
      "nemotron-3.5-lightning-free",
      "gpt-4o-mini",
      "qwen3-coder-plus",
      "kimi-k2.5",
    ]) {
      expect(thinkingFamily(m)).toBe("none")
    }
  })
})

describe("allowedEfforts", () => {
  test("truth table openai: pro=hanya high, lainnya low/med/high", () => {
    const full: EffortLevel[] = ["low", "medium", "high"]
    expect(allowedEfforts("gpt-5-pro-2025-10-06")).toEqual(["high"])
    expect(allowedEfforts("gpt-5.4")).toEqual(full)
    expect(allowedEfforts("o3-mini")).toEqual(full)
  })
  test("claude legacy/adaptive = low/med/high; none = kosong", () => {
    const full: EffortLevel[] = ["low", "medium", "high"]
    expect(allowedEfforts("claude-sonnet-4-5")).toEqual(full)
    expect(allowedEfforts("claude-opus-5")).toEqual(full)
    expect(allowedEfforts("deepseek-chat")).toEqual([])
    expect(allowedEfforts("mimo-v2.5-free")).toEqual([])
  })
  test("effortOptionsForModel selalu diawali default", () => {
    expect(effortOptionsForModel("gpt-5.4")[0]).toBe("default")
    expect(effortOptionsForModel("deepseek-chat")).toEqual(["default"])
  })
})
