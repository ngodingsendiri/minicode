import { describe, expect, test } from "bun:test"
import { healthMap, providerOfTrace } from "../cli/commands/providers.ts"
import type { MinicodeConfig } from "../src/config.ts"

const cfg = {
  providers: [
    { id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "x", models: ["gpt-4o"] },
    { id: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "y", models: ["claude-sonnet-4"] },
  ],
} as unknown as MinicodeConfig

describe("providerOfTrace", () => {
  test("provider::model → provider id", () => {
    expect(providerOfTrace(cfg, { model: "openai::gpt-4o" })).toBe("openai")
  })
  test("bare model → matching provider by models list", () => {
    expect(providerOfTrace(cfg, { model: "gpt-4o" })).toBe("openai")
    expect(providerOfTrace(cfg, { model: "claude-sonnet-4" })).toBe("anthropic")
  })
  test("unknown model → undefined", () => {
    expect(providerOfTrace(cfg, { model: "gpt-5" })).toBeUndefined()
  })
})

describe("healthMap", () => {
  test("last run per provider with status + newest timestamp wins", () => {
    const traces = [
      { model: "openai::gpt-4o", ok: true, timestamp: "2026-08-01T00:00:00Z" },
      { model: "anthropic::claude-sonnet-4", ok: false, timestamp: "2026-08-02T00:00:00Z" },
      { model: "openai::gpt-4o", ok: true, timestamp: "2026-08-03T00:00:00Z" },
    ]
    const h = healthMap(cfg, traces)
    expect(h.get("openai")?.ok).toBe(true)
    expect(h.get("openai")?.ts).toBe("2026-08-03T00:00:00Z")
    expect(h.get("anthropic")?.ok).toBe(false)
  })
  test("no matching trace → empty map", () => {
    expect(healthMap(cfg, [{ model: "gpt-5", ok: true }]).size).toBe(0)
  })
})
