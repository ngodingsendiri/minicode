// Test REPL linier (cli/repl.ts) — loop askLine + dispatch, lewat fake TTY.
// runRepl tidak pernah return sendiri: ia diakhiri process.exit(0). Di test,
// process.exit diganti pelempar sentinel supaya `await runRepl(...)` bisa
// di-assert tanpa mematikan runner.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runRepl } from "../cli/repl.ts"
import type { CliSession } from "../cli/setup.ts"
import { setCompactMode } from "../src/ui/render/detail.ts"
import { setReasoningVisible } from "../src/ui/render/reasoning.ts"
import { stripAnsi } from "../src/ui/render/theme.ts"
import { createFakeBus, type FakeTty, installFakeTty, KEY } from "./helpers/tui-harness.ts"

class ExitSentinel extends Error {
  code: number | undefined
  constructor(code?: number) {
    super("exit")
    this.code = code
  }
}

let tty: FakeTty | undefined
let origExit: typeof process.exit

beforeEach(() => {
  origExit = process.exit
  process.exit = ((code?: number) => {
    throw new ExitSentinel(code)
  }) as never
})

afterEach(() => {
  process.exit = origExit
  tty?.restore()
  tty = undefined
  setCompactMode(false)
  setReasoningVisible(false)
})

interface Harness {
  ctx: CliSession
  ran: string[] // prompt yang masuk runPromptWithVerify
  closed: boolean
  mode: string // mode terakhir yang diterima permissions.setMode
}

function makeHarness(
  opts: {
    budget?: number
    cost?: number
    skills?: { name: string; description: string; body: string }[]
  } = {},
): Harness {
  const h: Harness = { ctx: undefined as unknown as CliSession, ran: [], closed: false, mode: "" }
  const usageRow = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: opts.cost ?? 0,
  }
  const skills = (opts.skills ?? []).map((s) => ({
    name: s.name,
    description: s.description,
    body: s.body,
    path: `virtual:${s.name}.md`,
  }))
  const ctx = {
    session: { events: createFakeBus(), state: { history: [], turnCount: 0, stepCount: 0 } },
    cfg: { providers: [{ id: "prov", providerHint: "openai", models: ["m1"] }] },
    cwd: process.cwd(),
    sessionId: "sess-1",
    modelRef: { current: "prov::m1" },
    effectiveInitialModel: "prov::m1",
    effectiveTimeoutMs: 1000,
    permissionMode: "auto",
    sessionTools: [],
    allLoadedSkills: skills,
    usage: {
      get: () => usageRow,
      getSession: () => usageRow,
      reset: () => {},
      modelUsed: () => ({}),
    },
    budget: opts.budget,
    detachSimple: () => {},
    persistCurrent: async () => {},
    runPromptWithVerify: async (prompt: string) => {
      h.ran.push(prompt)
    },
    permissions: {
      getMode: () => "auto",
      setMode: (m: string) => {
        h.mode = m
      },
    },
    close: async () => {
      h.closed = true
    },
  }
  h.ctx = ctx as unknown as CliSession
  return h
}

const visible = (t: FakeTty): string => stripAnsi(t.combined())

// Kirim baris ke prompt REPL. Tunggu sampai listener askLine (dipasang saat
// raw mode) benar-benar ada dan stabil — selama turn berjalan REPL memakai
// listener non-raw sementara, dan keystroke yang dikirim saat itu hilang.
async function waitForPrompt(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let stable = 0
  for (;;) {
    if (tty!.promptListeners() >= 1) {
      stable++
      if (stable >= 3) return
    } else {
      stable = 0
    }
    if (Date.now() > deadline) throw new Error("REPL tidak kembali ke prompt")
    await new Promise((r) => setTimeout(r, 10))
  }
}

async function typeLine(line: string): Promise<void> {
  await waitForPrompt()
  await tty!.send(`${line}\r`, 25)
}

// Rejection sentinel exit harus tertangani SEJAK AWAL — kalau baru dipasang
// lewat expect(p).rejects setelah keystroke, bun sudah mencatatnya sebagai
// unhandledRejection dan test gagal apa pun assertion-nya.
function start(h: Harness): Promise<void> {
  const p = runRepl(h.ctx)
  p.catch(() => {})
  return p
}

describe("REPL linier: siklus dasar", () => {
  test("prompt biasa menjalankan turn, /exit menutup sesi", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await typeLine("halo")
    expect(h.ran).toEqual(["halo"])
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
    expect(h.closed).toBe(true)
    expect(visible(tty)).toContain("Sampai jumpa")
  })

  test("Ctrl+C dua kali beruntun saat idle keluar", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await waitForPrompt()
    await tty.send(KEY.ctrlC, 25)
    expect(visible(tty)).toContain("^C")
    await waitForPrompt()
    await tty.send(KEY.ctrlC, 25)
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
    expect(h.closed).toBe(true)
    expect(h.ran).toEqual([])
  })

  test("baris kosong tidak dihitung sebagai cancel", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await typeLine("") // Enter pada baris kosong
    await typeLine("")
    // REPL masih hidup: prompt baru muncul, /exit tetap berfungsi.
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
    expect(visible(tty)).not.toContain("^C")
  })

  test("builtin /status mengalir langsung ke scrollback", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await typeLine("/status")
    const out = visible(tty)
    expect(out).toContain("Session sess-1")
    expect(out).toContain("prov::m1")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("perintah tak dikenal memberi pesan, bukan senyap", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await typeLine("/xyz")
    expect(visible(tty)).toContain("Unknown command: xyz")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("dropdown '/' menawarkan builtin + perintah driver", async () => {
    tty = installFakeTty()
    const h = makeHarness({ skills: [{ name: "revu", description: "d", body: "b" }] })
    const p = start(h)
    await waitForPrompt()
    tty.clear()
    await tty.send("/", 25)
    let out = visible(tty)
    expect(out).toContain("/help")
    expect(out).toContain("/mode")
    expect(out).toContain("/compact")
    // Setelah mengetik lebih jauh, skill ikut tampil di grup sendiri.
    await tty.send("revu", 25)
    out = visible(tty)
    expect(out).toContain("/revu")
    // Kosongkan baris (ctrl+u) sebelum /exit — karakter yang dikirim via
    // tty.send APPEND ke baris yang sedang diedit.
    await tty.send(KEY.ctrlU, 25)
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("skill /nama menjalankan render hasilnya sebagai turn", async () => {
    tty = installFakeTty()
    const h = makeHarness({ skills: [{ name: "revu", description: "d", body: "isi {{args}}" }] })
    const p = start(h)
    await typeLine("/revu review")
    expect(h.ran).toEqual(["isi review"])
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })
})

describe("REPL linier: interupsi busy", () => {
  test("Ctrl+C saat turn berjalan membatalkan, REPL lanjut", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    // Emulasi kernel: session.run menolak saat signal di-abort.
    let busy = false
    ;(h.ctx as { runPromptWithVerify: unknown }).runPromptWithVerify = (
      prompt: string,
      signal?: AbortSignal,
    ) => {
      h.ran.push(prompt)
      busy = true
      return new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 5000)
        signal?.addEventListener("abort", () => {
          clearTimeout(t)
          reject(new Error("aborted"))
        })
      })
    }
    const p = start(h)
    await typeLine("kerja berat")
    // Tunggu turn benar-benar berjalan, lalu potong dengan Ctrl+C mentah.
    while (!busy) await new Promise((r) => setTimeout(r, 5))
    await tty.send("\x03", 30)
    expect(visible(tty)).toContain("(stopped)")
    // REPL masih hidup setelah pembatalan.
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
    expect(h.ran).toEqual(["kerja berat"])
  })
})

describe("REPL linier: mode & toggle", () => {
  test("Shift+Tab cycle mode dan mengubah prefix prompt", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await waitForPrompt()
    tty.clear()
    await tty.send(KEY.shiftTab, 25)
    expect(h.mode).toBe("ask") // auto -> ask
    const out = visible(tty)
    expect(out).toContain("mode: ask")
    expect(out).toContain("ask ›")
    await waitForPrompt()
    await tty.send(KEY.ctrlC, 20)
    await waitForPrompt()
    await tty.send(KEY.ctrlC, 20)
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("/mode [nama] memilih mode eksplisit", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await typeLine("/mode plan")
    expect(h.mode).toBe("plan")
    expect(visible(tty)).toContain("mode: plan")
    await typeLine("/mode entah")
    expect(visible(tty)).toContain("mode tak dikenal: entah")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("/compact toggle mode ringkas", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await typeLine("/compact")
    expect(visible(tty)).toContain("compact")
    await typeLine("/compact off")
    expect(visible(tty)).toContain("expanded")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("Ctrl+T toggle reasoning lewat onKey", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await waitForPrompt()
    await tty.send(KEY.ctrlT, 25)
    expect(visible(tty)).toContain("reasoning: on")
    await waitForPrompt()
    await tty.send(KEY.ctrlT, 25)
    expect(visible(tty)).toContain("reasoning: off")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("Ctrl+O toggle compact lewat onKey", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    const p = start(h)
    await waitForPrompt()
    await tty.send(KEY.ctrlO, 25)
    expect(visible(tty)).toContain("tool call: compact")
    await waitForPrompt()
    await tty.send(KEY.ctrlO, 25)
    expect(visible(tty)).toContain("tool call: expanded")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })

  test("/sessions tanpa sesi terdaftar tidak menanyakan pilihan", async () => {
    tty = installFakeTty()
    const h = makeHarness()
    // cwd diarahkan ke workspace dgn .minicode lokal — DB lokal kosong,
    // terlepas dari isi ~/.minicode/sessions.sqlite di mesin test.
    const ws = mkdtempSync(join(tmpdir(), "minicode-repl-nosess-"))
    mkdirSync(join(ws, ".minicode"), { recursive: true })
    ;(h.ctx as { cwd: string }).cwd = ws
    const p = start(h)
    await typeLine("/sessions")
    // listSessions tidak menemukan sesi → tidak ada prompt resume menggantung.
    const out = visible(tty)
    expect(out).toContain("No sessions")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
    // DB sqlite lokal masih terbuka di Windows (EBUSY) — biarkan OS membersihkan tmp.
    try {
      rmSync(ws, { recursive: true, force: true })
    } catch {}
  })
})

describe("REPL linier: budget", () => {
  test("lewat batas menolak prompt baru, slash tetap jalan", async () => {
    tty = installFakeTty()
    const h = makeHarness({ budget: 0.1, cost: 0.2 })
    const p = start(h)
    await typeLine("prompt mahal")
    const out = visible(tty)
    expect(out).toContain("[budget]")
    expect(out).toContain("rejected")
    expect(h.ran).toEqual([])
    // Slash command tidak ikut diblokir.
    await typeLine("/status")
    expect(visible(tty)).toContain("Session sess-1")
    await typeLine("/exit")
    await expect(p).rejects.toBeInstanceOf(ExitSentinel)
  })
})
