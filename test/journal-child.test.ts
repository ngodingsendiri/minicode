// AUDIT #01E — child journal integrity (behavioral, bukan snapshot).
// Aturan pass ini: KUNCI perilaku aktual (termasuk gap), jangan implementasi.
// Gap yang dikunci ditandai GAP P1 → dibalik saat fix mendarat.

import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendMutationIntent,
  appendMutationTerminal,
  attachMutationJournal,
  journalPath,
  loadJournal,
  planRecoveryForSession,
} from "../src/session/journal.ts"
import {
  clearSubAgentSessionFactory,
  delegateTaskTool,
  setSubAgentSessionFactory,
} from "../src/tools/task.ts"

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "mc-jchild-"))
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

// ── 1. absent tanpa referensi → silent, clean (benar) ──

test("child: sesi tanpa jurnal dan tanpa referensi = clean sunyi", async () => {
  const dir = tmpRoot()
  try {
    const plan = await planRecoveryForSession("tak-ada", dir, { persistedTurns: [] })
    expect(plan.clean).toBe(true)
    expect(plan.directive).toBeNull()
  } finally {
    await cleanup(dir)
  }
})

// ── 2. absent + referensi committed → WARNING degraded (FIX P1) ──

test("child: referensi committed tanpa file anak = warning degraded", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pp",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "anak-hilang",
    })
    await appendMutationTerminal("pp", dir, p.id, p.seq, "delegate_task", "committed", {
      note: "anak-hilang",
    })
    const plan = await planRecoveryForSession("pp", dir, { persistedTurns: [] })
    // Bukti parent committed + file tak ada = bukti HILANG (bukan "tak ada").
    expect(plan.warnings.some((w) => w.includes("anak-hilang"))).toBe(true)
    expect(plan.clean).toBe(false)
  } finally {
    await cleanup(dir)
  }
})

// ── 3. child korup → quarantine + warn ──

test("child: jurnal anak korup → karantina + warn ber-id", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pc",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "ckor",
    })
    await appendMutationTerminal("pc", dir, p.id, p.seq, "delegate_task", "committed", {
      note: "ckor",
    })
    await appendMutationIntent({
      session: "ckor",
      tool: "edit",
      cwd: dir,
      paths: ["a"],
      childOf: "pc",
    })
    const cpath = journalPath("ckor", dir)
    await writeFile(cpath, `${readFileSync(cpath, "utf8")}BARIS-RUSAK\n`)
    const plan = await planRecoveryForSession("pc", dir, { persistedTurns: [] })
    expect(plan.warnings.some((w) => w.includes("ckor"))).toBe(true)
  } finally {
    await cleanup(dir)
  }
})

// ── 4. child unreadable → warning keras (FIX P1) ──

test("child: jurnal anak unreadable = warning keras", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pu",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "cUnread",
    })
    await appendMutationTerminal("pu", dir, p.id, p.seq, "delegate_task", "committed", {
      note: "cUnread",
    })
    // Simulasi unreadable deterministik lintas-OS: path file diganti direktori.
    await rm(journalPath("cUnread", dir), { force: true }).catch(() => {})
    await mkdir(journalPath("cUnread", dir), { recursive: true })
    const plan = await planRecoveryForSession("pu", dir, { persistedTurns: [] })
    expect(plan.clean).toBe(false)
    expect(plan.warnings.some((w) => w.includes("cUnread"))).toBe(true)
  } finally {
    await cleanup(dir)
  }
})

// ── 5. child valid committed → stitch spurios (GAP P1 noise, dikunci) ──

test("child: committed anak ter-cover transitif bila delegasi finalized", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pn",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "cok",
    })
    await appendMutationTerminal("pn", dir, p.id, p.seq, "delegate_task", "committed", {
      note: "cok",
    })
    const c = await appendMutationIntent({
      session: "cok",
      tool: "edit",
      cwd: dir,
      paths: ["a"],
      childOf: "pn",
    })
    await appendMutationTerminal("cok", dir, c.id, c.seq, "edit", "committed")
    // Finalize parent mencakup record delegasi → anak ter-cover transitif.
    const { appendFinalize, decideRecovery: decide } = await import("../src/session/journal.ts")
    await appendFinalize("pn", dir, p.seq)
    const all = [
      ...(await loadJournal("pn", dir)).records,
      ...(await loadJournal("cok", dir)).records,
    ]
    const dec = decide(all, [9])
    expect(dec.stitched).toHaveLength(0)
    expect(dec.clean).toBe(true)
  } finally {
    await cleanup(dir)
  }
})

test("child: committed anak TANPA finalize parent tetap stitch (benar hilang)", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pn2",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "cok2",
    })
    await appendMutationTerminal("pn2", dir, p.id, p.seq, "delegate_task", "committed", {
      note: "cok2",
    })
    const c = await appendMutationIntent({
      session: "cok2",
      tool: "edit",
      cwd: dir,
      paths: ["a"],
      childOf: "pn2",
    })
    await appendMutationTerminal("cok2", dir, c.id, c.seq, "edit", "committed")
    // Tanpa finalize: cerita delegasi belum durable → stitch benar (aman).
    const { decideRecovery: decide } = await import("../src/session/journal.ts")
    const all = [
      ...(await loadJournal("pn2", dir)).records,
      ...(await loadJournal("cok2", dir)).records,
    ]
    expect(decide(all, []).stitched.some((s) => s.tool === "edit")).toBe(true)
  } finally {
    await cleanup(dir)
  }
})

test("child: turn namespace terisolasi (turn anak tak match turns parent)", async () => {
  const dir = tmpRoot()
  try {
    // Anak committed turn 0; parent turns [0] — angka sama, namespace beda.
    // Tanpa finalize parent, anak WAJIB stitch (isolasi), bukan clean.
    const p = await appendMutationIntent({
      session: "pn3",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "cok3",
    })
    await appendMutationTerminal("pn3", dir, p.id, p.seq, "delegate_task", "committed", {
      note: "cok3",
    })
    const c = await appendMutationIntent({
      session: "cok3",
      tool: "edit",
      cwd: dir,
      turn: 0,
      paths: ["a"],
      childOf: "pn3",
    })
    await appendMutationTerminal("cok3", dir, c.id, c.seq, "edit", "committed")
    const { decideRecovery: decide } = await import("../src/session/journal.ts")
    const all = [
      ...(await loadJournal("pn3", dir)).records,
      ...(await loadJournal("cok3", dir)).records,
    ]
    expect(decide(all, [0]).stitched.some((s) => s.tool === "edit")).toBe(true)
  } finally {
    await cleanup(dir)
  }
})

// ── 6. child cancelled sebelum mutasi → failed directive, tanpa adopsi ──

test("child: batal sebelum mutasi = parent failed, tanpa file anak", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pg",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "ctaklahir",
    })
    await appendMutationTerminal("pg", dir, p.id, p.seq, "delegate_task", "failed")
    const plan = await planRecoveryForSession("pg", dir, { persistedTurns: [] })
    expect(plan.clean).toBe(false)
    expect(plan.directive).toContain("delegate_task")
    expect(existsSync(journalPath("ctaklahir", dir))).toBe(false)
  } finally {
    await cleanup(dir)
  }
})

// ── 7. parent cancel + eksekusi tak jalan: factory tak dipanggil ──

test("child: abort sebelum pool → factory tak jalan, terminal failed", async () => {
  const savedKey = process.env.OPENAI_API_KEY
  const savedAgent = process.env.AGENT_API_KEY
  if (!savedKey && !savedAgent) process.env.OPENAI_API_KEY = "sk-test-hermetic"
  const dir = tmpRoot()
  try {
    let factoryCalls = 0
    setSubAgentSessionFactory(async () => {
      factoryCalls += 1
      return {
        events: { on: () => () => {} },
        run: async () => ({ finalText: "tak tercapai", usage: { steps: 0 } }),
      }
    })
    const c = new AbortController()
    c.abort(new Error("batal-awal"))
    const ctx = { signal: c.signal, emit: () => {}, cwd: dir } as never
    await expect(delegateTaskTool.execute({ prompt: "x" }, ctx)).rejects.toThrow()
    expect(factoryCalls).toBe(0) // anak tak pernah dibuat
  } finally {
    clearSubAgentSessionFactory()
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY
    if (savedAgent === undefined) delete process.env.AGENT_API_KEY
    await cleanup(dir)
  }
})

// ── 8. delegasi konkuren: childId unik + plumbing terisolasi ──

test("child: dua delegasi paralel = id unik + file terpisah", async () => {
  const savedKey = process.env.OPENAI_API_KEY
  const savedAgent = process.env.AGENT_API_KEY
  if (!savedKey && !savedAgent) process.env.OPENAI_API_KEY = "sk-test-hermetic"
  const dir = tmpRoot()
  try {
    const seen: string[] = []
    setSubAgentSessionFactory(async (spec) => {
      if (spec.journal)
        seen.push(`${spec.journal.parentSessionId ?? "?"}:${spec.journal.sessionId}`)
      return {
        events: { on: () => () => {} },
        run: async () => ({ finalText: "ok", usage: { steps: 1 } }),
      }
    })
    const { todoSession } = await import("../src/tools/todo.ts")
    const prevId = todoSession.id
    todoSession.id = "pconc"
    try {
      const ctx = { signal: new AbortController().signal, emit: () => {}, cwd: dir } as never
      await Promise.all([
        delegateTaskTool.execute({ prompt: "a" }, ctx),
        delegateTaskTool.execute({ prompt: "b" }, ctx),
      ])
    } finally {
      todoSession.id = prevId
    }
    expect(seen).toHaveLength(2)
    expect(new Set(seen).size).toBe(2) // childSessionId tak reused
    expect(seen.every((s) => s.startsWith("pconc:sub_"))).toBe(true)
    // Parent journal memuat dua intent ber-childId berbeda (terminal tak
    // membawa childSessionId by-design — tautan hidup di intent).
    const { loadJournal: lj } = await import("../src/session/journal.ts")
    const recs = (await lj("pconc", dir)).records.filter((r) => r.tool === "delegate_task")
    const kids = recs.map((r) => r.childSessionId).filter(Boolean)
    expect(new Set(kids).size).toBe(2)
  } finally {
    clearSubAgentSessionFactory()
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY
    if (savedAgent === undefined) delete process.env.AGENT_API_KEY
    await cleanup(dir)
  }
})

// ── 9. cleanup: sweep parent tak menyentuh file anak; hapus eksplisit ──

test("child: sweep parent + hapus terpisah per file", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({ session: "pcl", tool: "edit", cwd: dir, paths: ["a"] })
    await appendMutationTerminal("pcl", dir, p.id, p.seq, "edit", "committed")
    await appendMutationIntent({
      session: "ccl",
      tool: "edit",
      cwd: dir,
      paths: ["b"],
      childOf: "pcl",
    })
    const { finalizeJournal, loadJournal: lj } = await import("../src/session/journal.ts")
    await finalizeJournal("pcl", dir)
    // File anak utuh (sweep parent berlingkup file parent saja).
    expect((await lj("ccl", dir)).records).toHaveLength(1)
    const { deleteJournalFile } = await import("../src/session/journal.ts")
    deleteJournalFile("ccl", dir)
    await Bun.sleep(100)
    expect(existsSync(journalPath("ccl", dir))).toBe(false)
    expect(existsSync(journalPath("pcl", dir))).toBe(true)
  } finally {
    await cleanup(dir)
  }
})

// ── 10. attach membuat file kosong (eager; FIX P1 atas lazy) ──

test("child: attach membuat file kosong (eager creation)", async () => {
  const dir = tmpRoot()
  try {
    const handlers = new Map<string, ((e: never) => void)[]>()
    attachMutationJournal(
      {
        events: {
          on: (t: string, h: (e: never) => void) => {
            handlers.set(t, [...(handlers.get(t) ?? []), h])
            return () => {}
          },
        },
      } as never,
      { sessionId: "clazy", cwd: dir, childOf: "pp" },
    )
    // Eager create-if-absent: file ada + kosong (EMPTY ≠ ABSENT).
    const t0 = Date.now()
    while (!existsSync(journalPath("clazy", dir)) && Date.now() - t0 < 5000) await Bun.sleep(25)
    expect(existsSync(journalPath("clazy", dir))).toBe(true)
    const { loadJournal: lj } = await import("../src/session/journal.ts")
    const loaded = await lj("clazy", dir)
    expect(loaded.status).toBe("empty")
    expect(loaded.records).toHaveLength(0)
  } finally {
    await cleanup(dir)
  }
})

// ── 11. anak valid + parent absent: jurnal anak self-sufficient ──

test("child: jurnal anak terbaca mandiri tanpa record parent", async () => {
  const dir = tmpRoot()
  try {
    const c = await appendMutationIntent({
      session: "cmand",
      tool: "bash",
      cwd: dir,
      childOf: "p???",
    })
    const loaded = await loadJournal("cmand", dir)
    expect(loaded.records).toHaveLength(1)
    expect(loaded.records[0]!.childOf).toBe("p???")
    // …tetapi resume parent tak akan menemukannya tanpa referensi (discovery
    // hanya via childSessionId parent) — keterbatasan observability P2.
    const plan = await planRecoveryForSession("p???", dir, { persistedTurns: [] })
    expect(plan.clean).toBe(true)
    void c
  } finally {
    await cleanup(dir)
  }
})

// ── 12. parent failed + child pending: keduanya direktif, tanpa adopsi ──

test("child: parent failed + anak pending = dua-duanya verifikasi", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pf",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "cf",
    })
    await appendMutationTerminal("pf", dir, p.id, p.seq, "delegate_task", "failed")
    await appendMutationIntent({
      session: "cf",
      tool: "write_file",
      cwd: dir,
      paths: ["z.txt"],
      childOf: "pf",
    })
    const { decideRecovery: decide2 } = await import("../src/session/journal.ts")
    const all2 = [
      ...(await loadJournal("pf", dir)).records,
      ...(await loadJournal("cf", dir)).records,
    ]
    const dec2 = decide2(all2, [])
    expect(dec2.clean).toBe(false)
    expect(dec2.directive).toContain("delegate_task")
    expect(dec2.directive).toContain("z.txt")
    // Tak ada adopsi sukses anak ke narasi parent, tak ada stitch palsu.
    expect(dec2.stitched).toHaveLength(0)
  } finally {
    await cleanup(dir)
  }
})

// ── 13. empty + parent committed → sunyi (normal, bukan anomali) ──

test("child: jurnal kosong + delegasi committed = sunyi", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pe",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "cempty",
    })
    await appendMutationTerminal("pe", dir, p.id, p.seq, "delegate_task", "committed", {
      note: "cempty",
    })
    // Anak terpasang (file ada) tetapi nol mutasi.
    const handlers = new Map<string, ((e: never) => void)[]>()
    attachMutationJournal(
      {
        events: {
          on: (t: string, h: (e: never) => void) => {
            handlers.set(t, [...(handlers.get(t) ?? []), h])
            return () => {}
          },
        },
      } as never,
      { sessionId: "cempty", cwd: dir, childOf: "pe" },
    )
    const t0 = Date.now()
    while (!existsSync(journalPath("cempty", dir)) && Date.now() - t0 < 5000) await Bun.sleep(25)
    const { loadJournal: lj2 } = await import("../src/session/journal.ts")
    expect((await lj2("cempty", dir)).status).toBe("empty")
    const plan = await planRecoveryForSession("pe", dir, { persistedTurns: [] })
    // Parent committed tanpa turn → stitch parent (benar); anak: sunyi total.
    expect(plan.warnings.some((w) => w.includes("cempty"))).toBe(false)
    expect(plan.directive).not.toContain("cempty")
  } finally {
    await cleanup(dir)
  }
})

// ── 14. absent + parent failed/pending → sunyi ──

test("child: absent + delegasi failed = sunyi (anak boleh tak lahir)", async () => {
  const dir = tmpRoot()
  try {
    const p = await appendMutationIntent({
      session: "pf2",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "ctakada",
    })
    await appendMutationTerminal("pf2", dir, p.id, p.seq, "delegate_task", "failed")
    const plan = await planRecoveryForSession("pf2", dir, { persistedTurns: [] })
    expect(plan.warnings.some((w) => w.includes("ctakada"))).toBe(false)
    expect(plan.directive).toContain("delegate_task") // parent failed tetap direktif
  } finally {
    await cleanup(dir)
  }
})

// ── 15. eager race: N attach paralel → satu file, mutasi seq 0 ──

test("child: attach paralel tak balapan dengan mutasi pertama", async () => {
  const dir = tmpRoot()
  try {
    const mkbus = () => {
      const handlers = new Map<string, ((e: never) => void)[]>()
      return {
        events: {
          on: (t: string, h: (e: never) => void) => {
            handlers.set(t, [...(handlers.get(t) ?? []), h])
            return () => {}
          },
        },
      } as never
    }
    await Promise.all(
      Array.from({ length: 5 }, () => {
        attachMutationJournal(mkbus(), { sessionId: "crace", cwd: dir, childOf: "pp" })
        return Promise.resolve()
      }),
    )
    const { appendMutationIntent: append } = await import("../src/session/journal.ts")
    const r = await append({ session: "crace", tool: "edit", cwd: dir, paths: ["a"] })
    expect(r.seq).toBe(0)
    const { loadJournal: lj3 } = await import("../src/session/journal.ts")
    const loaded = await lj3("crace", dir)
    expect(loaded.status).toBe("valid")
    expect(loaded.records).toHaveLength(1)
  } finally {
    await cleanup(dir)
  }
})

// ── 16. orphan purge: seleksi yatim-tua-tak-dirujuk ──

test("child: findOrphanJournals hanya yatim-tua-tak-dirujuk", async () => {
  const dir = tmpRoot()
  try {
    const { findOrphanJournals } = await import("../src/session/journal.ts")
    const jdir = join(dir, ".minicode")
    await mkdir(jdir, { recursive: true })
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000
    const { utimesSync } = await import("node:fs")
    // yatim tua (pemilik asing, tak dirujuk) → kandidat.
    await appendMutationIntent({ session: "yatim1", tool: "edit", cwd: dir, paths: ["a"] })
    utimesSync(journalPath("yatim1", dir), new Date(old), new Date(old))
    // dirujuk parent hidup → dipertahankan walau tua.
    await appendMutationIntent({
      session: "pref",
      tool: "delegate_task",
      cwd: dir,
      childSessionId: "cdirujuk",
    })
    await appendMutationIntent({
      session: "cdirujuk",
      tool: "edit",
      cwd: dir,
      paths: ["b"],
      childOf: "pref",
    })
    utimesSync(journalPath("cdirujuk", dir), new Date(old), new Date(old))
    // segar → dipertahankan.
    await appendMutationIntent({ session: "yatim2", tool: "edit", cwd: dir, paths: ["c"] })
    const orphans = await findOrphanJournals(jdir, new Set(["pref"]), 30)
    expect(orphans.some((f) => f.includes("yatim1"))).toBe(true)
    expect(orphans.some((f) => f.includes("cdirujuk"))).toBe(false)
    expect(orphans.some((f) => f.includes("yatim2"))).toBe(false)
    expect(orphans.some((f) => f.includes("pref"))).toBe(false)
  } finally {
    await cleanup(dir)
  }
})
