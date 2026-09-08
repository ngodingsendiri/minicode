import { describe, expect, test } from "bun:test"
import { runAudit } from "../bench/harness-audit.ts"

// P1.4 — audit harness deterministik: gagal di sini = regresi kebijakan,
// bukan flake model. Dijalankan juga via `bun run audit:harness`.
describe("harness P1.4: audit suite", () => {
  test("semua cek safety/guard/budget hijau, struktur laporan utuh", async () => {
    const rep = await runAudit(process.cwd())
    expect(rep.failed).toBe(0)
    expect(rep.passed).toBeGreaterThan(40)
    const ids = new Set(rep.checks.map((c) => c.id))
    expect(ids.has("safety/allow-all/delete-.env")).toBe(true)
    expect(ids.has("guard/bypass-rate")).toBe(true)
    expect(ids.has("budget/fail-closed")).toBe(true)
    expect(ids.has("scope/explore-tanpa-bash")).toBe(true)
    expect([...ids].some((i) => i.startsWith("fake/"))).toBe(true)
  })

  test("bypass-rate guard = 0", async () => {
    const rep = await runAudit(process.cwd())
    const b = rep.checks.find((c) => c.id === "guard/bypass-rate")
    expect(b?.passed).toBe(true)
    expect(b?.detail).toContain("bypassRate=0.000")
  })
})
