// Marker turn-aktif: tulis saat mulai, hapus saat settle, deteksi yatim
// (mati tak wajar) saat startup berikutnya. Hermetic tmpdir; pid mati dari
// proses sungguhan yang sudah exit (bukan angka karangan).
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkStaleTurn,
  clearStaleTurn,
  clearTurnActive,
  formatStaleNotice,
  isPidAlive,
  markTurnActive,
} from "../src/session/turn-marker.ts"

function tmpRoot(): string {
  const dir = join(tmpdir(), `minicode-marker-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

async function deadPid(): Promise<number> {
  const proc = Bun.spawn(["bun", "-e", ""], { stdout: "ignore", stderr: "ignore" })
  await proc.exited
  return proc.pid
}

describe("turn-marker: lifecycle", () => {
  test("mark → ada; clear milik sendiri → hilang; clear milik orang → utuh", () => {
    const dir = tmpRoot()
    try {
      markTurnActive(dir, "saya")
      expect(existsSync(join(dir, ".minicode", "turn.active.json"))).toBe(true)
      clearTurnActive(dir, "orang-lain")
      expect(existsSync(join(dir, ".minicode", "turn.active.json"))).toBe(true)
      clearTurnActive(dir, "saya")
      expect(existsSync(join(dir, ".minicode", "turn.active.json"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("isPidAlive: sendiri hidup; mati/yatim/negatif mati", async () => {
    expect(isPidAlive(process.pid)).toBe(true)
    expect(isPidAlive(await deadPid())).toBe(false)
    expect(isPidAlive(0)).toBe(false)
    expect(isPidAlive(-5)).toBe(false)
    expect(isPidAlive(1.5)).toBe(false)
  })

  test("checkStaleTurn: kosong/sama/hidup → null; yatim → info + format", async () => {
    const dir = tmpRoot()
    try {
      expect(checkStaleTurn(dir, "baru")).toBeNull()
      markTurnActive(dir, "lama-mati")
      // Timpa pid dengan yang pasti mati (proses sendiri jelas hidup).
      const { writeFileSync, readFileSync } = await import("node:fs")
      const p = join(dir, ".minicode", "turn.active.json")
      const m = JSON.parse(readFileSync(p, "utf8"))
      m.pid = await deadPid()
      m.startedAt = Date.now() - 125000
      writeFileSync(p, JSON.stringify(m))
      const stale = checkStaleTurn(dir, "baru")
      expect(stale?.sessionId).toBe("lama-mati")
      const note = formatStaleNotice(stale!)
      expect(note).toContain("lama-mati")
      expect(note).toContain("2m05s")
      expect(note).toContain("/resume")
      clearStaleTurn(dir, "baru")
      expect(checkStaleTurn(dir, "baru")).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("marker milik proses hidup tak dilaporkan + tak dihapus", () => {
    const dir = tmpRoot()
    try {
      markTurnActive(dir, "hidup")
      // Pid = proses test sendiri → hidup.
      expect(checkStaleTurn(dir, "baru")).toBeNull()
      clearStaleTurn(dir, "baru")
      expect(existsSync(join(dir, ".minicode", "turn.active.json"))).toBe(true)
      clearTurnActive(dir, "hidup")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("formatStaleNotice: umur detik dan jam", () => {
    const base = { sessionId: "s", pid: 1 }
    expect(formatStaleNotice({ ...base, startedAt: Date.now() - 5000 })).toContain("5s ago")
    expect(formatStaleNotice({ ...base, startedAt: Date.now() - 3700000 })).toContain("1h01m")
    expect(formatStaleNotice({ ...base, startedAt: Date.now() + 99999 })).toContain("0s ago")
  })
})
