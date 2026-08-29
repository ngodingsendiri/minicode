import { expect, test } from "bun:test"
import { createEventBus } from "minicore/core/events.ts"
import { createUsageCollector } from "../src/policy/usage.ts"

test("usage: tracks cache read and write tokens and reduces cost", () => {
  const bus = createEventBus()
  const collector = createUsageCollector(bus, "claude-sonnet-4")

  bus.emit({
    type: "provider:extension",
    kind: "usage",
    data: {
      inputTokens: 10000,
      outputTokens: 500,
      cacheReadTokens: 8000, // 8k tokens read from cache
      cacheWriteTokens: 2000,
    },
  })

  const u = collector.get()
  expect(u.inputTokens).toBe(10000)
  expect(u.outputTokens).toBe(500)
  expect(u.cacheReadTokens).toBe(8000)
  expect(u.cost).toBeDefined()

  // With 8k cache read (at $0.3/M instead of $3/M), cost should be significantly lower:
  // Normal 10k: 10000*3/1M = $0.030
  // Cached: 2000*3/1M ($0.006) + 8000*0.3/1M ($0.0024) + 500*15/1M ($0.0075) = $0.0159
  expect(u.cost!).toBeLessThan(0.025)
})
