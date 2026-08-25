import { expect, test } from "bun:test"
import { createEventBus } from "../../minicore/src/core/events.ts"
import { friendlyError, friendlyFromCategory } from "../cli/errors.ts"
import { createUsageCollector } from "../src/policy/usage.ts"

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
