// P13 P1 branchSession: fork sesi (history + turns) ke id baru tanpa
// menyentuh sumber — "coba dua arah dari titik yang sama".

import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  branchSession,
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
} from "../src/session/persistence.ts"

async function makeCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "minicode-branch-"))
  const { mkdir } = await import("node:fs/promises")
  await mkdir(join(dir, ".minicode"), { recursive: true })
  return dir
}

const msgs = [
  { role: "user", content: "buatkan server" },
  { role: "assistant", content: "baik, ini rencananya" },
]

test("branch: menyalin messages + turns, sumber utuh", async () => {
  const cwd = await makeCwd()
  try {
    await saveSession("src-1", cwd, "sys", msgs, { turns: 1 })
    const n = await branchSession("src-1", "dst-1", cwd)
    expect(n).toBe(2)
    const dst = loadSession("dst-1", cwd)
    expect(dst?.messages.length).toBe(2)
    expect(dst?.messages[0]).toMatchObject({ role: "user", content: "buatkan server" })
    expect(dst?.system).toBe("sys")
    expect(dst?.turnCount).toBe(1)
    // sumber tidak berubah
    const src = loadSession("src-1", cwd)
    expect(src?.messages.length).toBe(2)
    // cabang tercatat di daftar sesi
    expect(listSessions(cwd).map((s) => s.id)).toContain("dst-1")
    await deleteSession("dst-1", cwd)
    expect(loadSession("dst-1", cwd)).toBeNull()
    expect(loadSession("src-1", cwd)?.messages.length).toBe(2)
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {})
  }
})

test("branch: sumber hilang → throw; id aneh ditolak", async () => {
  const cwd = await makeCwd()
  try {
    let threw = ""
    try {
      await branchSession("tidak-ada", "dst-x", cwd)
    } catch (e) {
      threw = (e as Error).message
    }
    expect(threw).toContain("not found")
    threw = ""
    try {
      await branchSession("tidak-ada", "../evil", cwd)
    } catch (e) {
      threw = (e as Error).message
    }
    expect(threw).toContain("invalid branch")
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {})
  }
})
