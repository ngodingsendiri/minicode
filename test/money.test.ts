import { describe, expect, test } from "bun:test"
import { formatUsd } from "../src/tui/money.ts"

// Regresi dari uji live: `--budget 0.001` dicetak `toFixed(2)` menjadi "$0.00",
// sehingga pesan pemutusnya berbunyi "$0.0601 > $0.00 - lewat batas" dan user
// membaca batas nol padahal ia menyetel seperseribu dolar.
describe("formatUsd", () => {
  test("nilai kecil tetap terlihat, tidak dibulatkan jadi $0.00", () => {
    expect(formatUsd(0.001)).toBe("$0.0010")
    expect(formatUsd(0.0601)).toBe("$0.0601")
    expect(formatUsd(0.00005)).toBe("$0.0001")
  })

  test("nol tetap nol", () => {
    expect(formatUsd(0)).toBe("$0.0000")
  })

  test("$1 ke atas memakai dua desimal", () => {
    expect(formatUsd(1)).toBe("$1.00")
    expect(formatUsd(12.5)).toBe("$12.50")
    expect(formatUsd(1234.567)).toBe("$1234.57")
  })

  test("batas persis di $1", () => {
    expect(formatUsd(0.9999)).toBe("$0.9999")
    expect(formatUsd(1.0)).toBe("$1.00")
  })

  test("nilai negatif diformat, bukan dibuang", () => {
    expect(formatUsd(-0.5)).toBe("$-0.5000")
    expect(formatUsd(-2)).toBe("$-2.00")
  })

  test("nilai tak hingga / NaN tidak menghasilkan 'NaN' di UI", () => {
    expect(formatUsd(Number.NaN)).toBe("$?")
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("$?")
  })
})
