import { expect, test } from "bun:test"
import { createEventBus } from "minicore/core/events.ts"
import { friendlyError, friendlyFromCategory } from "../cli/errors.ts"
import { costFor, createUsageCollector } from "../src/policy/usage.ts"

test("friendlyFromCategory: auth + balance", () => {
  const f = friendlyFromCategory(
    "auth",
    'credits: {"message":"Insufficient balance. Manage billing here: https://opencode.ai/workspace/wrk_123/billing"}',
  )
  expect(f.message).toContain("balance or quota")
  expect(f.fix).toContain("/model")
})

test("friendlyFromCategory: auth without balance → generic auth", () => {
  const f = friendlyFromCategory("auth", "auth failed (401): invalid api key")
  expect(f.message).toContain("Authentication rejected")
})

test("friendlyFromCategory: rate_limit / server / network", () => {
  expect(friendlyFromCategory("rate_limit", "429").message).toContain("Rate limited")
  expect(friendlyFromCategory("server", "500").message).toContain("temporary server error")
  expect(friendlyFromCategory("network", "socket hang up").message).toContain("Network error")
})

test("friendlyFromCategory: invalid_request & context_length", () => {
  expect(friendlyFromCategory("invalid_request", "400 model not found").message).toContain(
    "bad model",
  )
  expect(friendlyFromCategory("context_length_exceeded", "").message).toContain("Context window")
})

test("friendlyFromCategory: unknown extracts JSON message field", () => {
  const f = friendlyFromCategory("unknown", '{"error":{"message":"Some technical detail"}}')
  expect(f.message).toBe("Some technical detail")
  const cut = friendlyFromCategory("unknown", "x".repeat(200))
  expect(cut.message.length).toBeLessThanOrEqual(161)
})

test("friendlyError: AgentError-style strings", () => {
  expect(friendlyError("timeout: run exceeded 600000ms").message).toContain("time limit")
  expect(friendlyError("max_steps_exceeded: 50 steps").message).toContain("Tool-step limit")
  expect(friendlyError("budget exceeded").message.toLowerCase()).toContain("budget")
})

// ── usage collector: effective model dari fallback ──
test("usage: effective-model event changes cost basis", () => {
  const bus = createEventBus()
  const collector = createUsageCollector(bus, "gpt-4o")

  // simulate substitution (router fallback): gpt-4o dipakai, tapi provider
  // hanya punya deepseek-chat → router memilih effective deepseek-chat
  bus.emit({
    type: "provider:extension",
    kind: "effective-model",
    data: { requested: "gpt-4o", effective: "deepseek-chat", provider: "fallback-x" },
  })
  bus.emit({
    type: "provider:extension",
    kind: "usage",
    data: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
  })

  const used = collector.modelUsed()
  expect(used.effective).toBe("deepseek-chat")
  expect(used.provider).toBe("fallback-x")

  const u = collector.get("gpt-4o")
  // deepseek-chat: input 0.14/m, output 0.28/m → 0.14 + 0.28 = 0.42
  expect(u.cost).toBeCloseTo(0.42, 3)
})

test("usage: reset clears effective model", () => {
  const bus = createEventBus()
  const collector = createUsageCollector(bus, "gpt-4o")
  bus.emit({
    type: "provider:extension",
    kind: "effective-model",
    data: { requested: "x", effective: "y", provider: "z" },
  })
  collector.reset()
  expect(collector.modelUsed().effective).toBeUndefined()
})

// ── C18: pricing boundary matching ──────────────────────────────────────────

test("pricing: exact and versioned model names match", () => {
  // exact — gpt-4o $2,50/M input. Tabel lama menulis $5,00 (harga peluncuran
  // Mei 2024, sudah dipotong separuh Agustus 2024), jadi estimasi biaya
  // selama ini 2× terlalu tinggi untuk model ini. Dikoreksi di Fase 4.3.
  expect(costFor("gpt-4o", 1_000_000, 0, 0, 0, false)).toBeCloseTo(2.5, 6)
  // sufiks versi (pemisah -)
  expect(costFor("gpt-4o-2024-11-20", 1_000_000, 0, 0, 0, false)).toBeCloseTo(2.5, 6)
  // prefix provider openrouter + sufiks :free
  expect(costFor("deepseek/deepseek-chat:free", 1_000_000, 0, 0, 0, false)).toBeCloseTo(0.14, 6)
  // longest-key menang: claude-sonnet-4-5, bukan claude-sonnet-4
  expect(costFor("claude-sonnet-4-5", 1_000_000, 0, 0, 0, false)).toBeCloseTo(3, 6)
})

test("pricing: wrapper/lookalike names do NOT match (no substring)", () => {
  expect(costFor("my-gpt-4o-wrapper", 1_000_000, 0, 0, 0, false)).toBeUndefined()
  expect(costFor("gpt-4o1-preview", 1_000_000, 0, 0, 0, false)).toBeUndefined()
  expect(costFor("totally-unknown-model", 1_000_000, 0, 0, 0, false)).toBeUndefined()
})
