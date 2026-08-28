import { expect, test } from "bun:test"
import { applyTheme } from "../src/tui/theme.ts"
import { THEMES } from "../src/tui/themes.ts"

test("themes: 4 presets with all tokens", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    expect(t.success).toBeTruthy()
    expect(t.error).toBeTruthy()
    expect(t.warning).toBeTruthy()
    expect(t.info).toBeTruthy()
    expect(t.accent).toBeTruthy()
    expect(t.muted).toBeTruthy()
    expect(name).toBeTypeOf("string")
  }
})

test("theme: applyTheme switches live", () => {
  expect(applyTheme("mono")).toBe("mono")
  expect(applyTheme("light")).toBe("light")
  expect(applyTheme("bogus")).toBe("dark") // fallback
})
