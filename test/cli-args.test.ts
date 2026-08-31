import { expect, test } from "bun:test"
import { getArg, promptFromArgs } from "../cli/args.ts"

test("getArg returns value after flag", () => {
  expect(getArg(["refactor", "--cwd", "src"], "--cwd")).toBe("src")
  expect(getArg(["refactor", "--cwd"], "--cwd")).toBeUndefined()
  expect(getArg(["refactor"], "--cwd")).toBeUndefined()
})

test("promptFromArgs removes boolean flags", () => {
  expect(promptFromArgs(["refactor", "src", "--verbose"])).toBe("refactor src")
  expect(promptFromArgs(["refactor", "--allow-all", "--plan"])).toBe("refactor")
  expect(promptFromArgs([])).toBe("")
})

// `--tui` dan `--ui` dihapus: keduanya diparse dan diteruskan tapi tidak pernah
// dibaca. Flag tak dikenal dibiarkan sebagai kata prompt (perilaku lama).
// getArg sengaja tetap generik — ia mencari nama apa pun, bukan hanya yang dikenal.
test("flag yang sudah dihapus tidak lagi disaring dari prompt", () => {
  expect(promptFromArgs(["refactor", "--tui"])).toBe("refactor --tui")
  expect(promptFromArgs(["refactor", "--ui", "full"])).toBe("refactor --ui full")
})

test("-v/--version dikenali sebagai flag, bukan prompt", () => {
  expect(promptFromArgs(["--version"])).toBe("")
  expect(promptFromArgs(["-v"])).toBe("")
})

test("promptFromArgs removes value flags + their values", () => {
  expect(promptFromArgs(["--cwd", "src", "refactor", "help"])).toBe("refactor help")
  expect(promptFromArgs(["build", "--model", "gpt-4o-mini", "--timeout", "1000"])).toBe("build")
  expect(promptFromArgs(["refactor", "--max-steps", "5"])).toBe("refactor")
})

test("promptFromArgs keeps prompt words resembling negative numbers", () => {
  expect(promptFromArgs(["-123", "x"])).toBe("-123 x")
})

// ── C12 regressions ──────────────────────────────────────────────────────────

test("--verify is a known boolean flag, not prompt text", () => {
  expect(promptFromArgs(["fix bugs", "--verify"])).toBe("fix bugs")
  expect(promptFromArgs(["--verify", "fix bugs"])).toBe("fix bugs")
})

test("supports --flag=value form in prompt filtering", () => {
  expect(promptFromArgs(["hi", "--model=gpt-4o", "--cwd=src"])).toBe("hi")
})

test("getArg supports --flag=value form", () => {
  expect(getArg(["run", "--model=gpt-4o"], "--model")).toBe("gpt-4o")
  expect(getArg(["run", "--budget=5"], "--budget")).toBe("5")
  expect(getArg(["run", "--model="], "--model")).toBeUndefined()
})

test("repeated value flags are all filtered from the prompt", () => {
  expect(promptFromArgs(["--cwd", "a", "--cwd", "b", "do it"])).toBe("do it")
  // last occurrence wins (konsisten dgn getArg baru)
  expect(getArg(["--cwd", "a", "--cwd", "b"], "--cwd")).toBe("b")
})

// Regresi: `exec` dulu menyaring prompt dengan `a !== getArg("--model")`, yang
// hanya membuang NILAI dari dua flag. Nilai flag lain ikut terkirim ke model:
// `exec "tes" --provider gorouter --timeout 60000` benar-benar mengirim
// "tes gorouter 60000", dan model membalas menebak-nebak soal "gorouter".
test("nilai SEMUA value flag dibuang dari prompt, bukan hanya --model/--cwd", () => {
  expect(
    promptFromArgs([
      "ulangi",
      "persis",
      "--provider",
      "gorouter",
      "--session",
      "uji",
      "--timeout",
      "60000",
      "--ratelimit",
      "10",
      "--budget",
      "5",
      "--sandbox",
      "docker",
      "--max-steps",
      "3",
      "--context-window",
      "8000",
      "--resume",
      "abc",
    ]),
  ).toBe("ulangi persis")
})

test("flag khusus exec (--json, --output-format, --prompt) tidak masuk prompt", () => {
  expect(promptFromArgs(["tes", "--json"])).toBe("tes")
  expect(promptFromArgs(["tes", "--output-format", "json"])).toBe("tes")
  expect(promptFromArgs(["tes", "--output-format=json"])).toBe("tes")
  expect(promptFromArgs(["--prompt", "dari-flag"])).toBe("")
})

test("bentuk --flag=value juga dibuang untuk semua value flag", () => {
  expect(promptFromArgs(["kerjakan", "--provider=gorouter", "--timeout=1000"])).toBe("kerjakan")
})
