import { describe, expect, test } from "bun:test"
import { deriveProviderId } from "../src/config.ts"

describe("deriveProviderId (5.1 friendly id)", () => {
  test("preset baseUrl → ramah id (no hash)", () => {
    expect(deriveProviderId("https://openrouter.ai/api/v1", [])).toBe("openrouter")
    expect(deriveProviderId("https://api.deepseek.com/v1", [])).toBe("deepseek")
    expect(deriveProviderId("http://localhost:11434/v1", [])).toBe("ollama")
  })
  test("unknown baseUrl → slug, no random suffix", () => {
    const id = deriveProviderId("https://my.gateway.example.com/v1", [])
    expect(id).not.toMatch(/[0-9a-z]{4}$/) // tidak ada hash acak di ekor
    expect(id).toBe("my-gateway-example-com")
  })
  test("explicit id used as-is", () => {
    expect(deriveProviderId("https://x", [], "my-provider")).toBe("my-provider")
  })
  test("collision → numeric suffix ramah", () => {
    expect(deriveProviderId("https://openrouter.ai/api/v1", ["openrouter"])).toBe("openrouter-2")
    expect(deriveProviderId("https://openrouter.ai/api/v1", ["openrouter", "openrouter-2"])).toBe(
      "openrouter-3",
    )
  })
  test("id sliced to 30 chars", () => {
    const long = "a".repeat(40)
    expect(deriveProviderId("https://x", [], long).length).toBe(30)
  })
})
