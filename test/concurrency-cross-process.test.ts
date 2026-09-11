// AUDIT #09 — Concurrency lintas proses: batas yang jujur.
//
// Aturan: klaim lintas-proses HANYA yang dibuktikan dua proses nyata
// (subprocess, bukan promise bersama). Yang tak didukung DINYATAKAN
// (unsupported/best-effort), bukan diuji seolah aman.

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SRC = new URL("../src/", import.meta.url).href.replace(/\/$/, "")

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "mc-concx-"))
  mkdirSync(join(dir, ".minicode"), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {}
}

interface ProcResult {
  code: number | null
  out: string
  err: string
}

// Worker generik. argv: [exec, mode, dir, arg, SRC, n].
// (Terverifikasi: `bun -e code aa bb` → argv [exec, aa, bb].)
const WORKER = `
const mode = process.argv[1];
const dir = process.argv[2];
const arg = process.argv[3];
const SRC = process.argv[4];
if (mode === "jseq") {
  const J = await import(SRC + "/session/journal.ts");
  const n = Number(process.argv[5]);
  for (let i = 0; i < n; i++) {
    await J.appendMutationIntent({ session: arg, tool: "write_file", cwd: dir, paths: ["f.txt"], turn: 0 });
  }
  console.log("done");
} else if (mode === "cfgwrite") {
  const { saveProvider } = await import(SRC + "/providers/provision.ts");
  await saveProvider({ id: arg, baseUrl: "https://x.example", apiKey: "k", models: ["m"] }, { global: false, cwd: dir });
  console.log("done");
} else if (mode === "sesswrite") {
  const { saveSession } = await import(SRC + "/session/persistence.ts");
  await saveSession(arg, dir, undefined, [{ role: "user", content: "dari-" + arg }], { turn: 0 });
  console.log("done");
} else if (mode === "sessread") {
  const { loadSession } = await import(SRC + "/session/persistence.ts");
  const s = loadSession(arg, dir);
  console.log(JSON.stringify({ n: s?.messages.length ?? -1, c: s?.messages[0] }));
} else {
  console.log("unknown-mode");
}
`

async function runWorker(
  dir: string,
  mode: string,
  arg: string,
  extra: string[] = [],
): Promise<ProcResult> {
  const proc = Bun.spawn([process.execPath, "-e", WORKER, mode, dir, arg, SRC, ...extra], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const trimmed = out.trim()
  if (trimmed !== "done" && !out.includes('"n":')) {
    // Subprocess gagal: stderr adalah satu-satunya petunjuk — cetak agar
    // kegagalan flaky dapat didiagnosis, bukan ditebak.
    process.stderr.write(`[worker] code=${code} err=${err.trim().slice(0, 600)}\n`)
  }
  return { code, out: trimmed, err: err.trim() }
}

// ── §29 Jurnal sekuensial lintas proses: seq berlanjut ──

test("§29 dua proses sekuensial: 10+10 append → seq 0..19 unik", async () => {
  const dir = tmpRoot()
  try {
    const r1 = await runWorker(dir, "jseq", "xs", ["10"])
    expect(r1.out).toBe("done")
    const r2 = await runWorker(dir, "jseq", "xs", ["10"])
    expect(r2.out).toBe("done")
    const { loadJournal } = await import("../src/session/journal.ts")
    const { records } = await loadJournal("xs", dir)
    const seqs = records.map((r) => r.seq).sort((a, b) => a - b)
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i))
  } finally {
    cleanup(dir)
  }
}, 30000)

// ── §8/§29 Jurnal konkuren lintas proses: baris utuh (didukung) ──

test("§29 dua proses konkuren ×20 append: semua baris JSON valid", async () => {
  const dir = tmpRoot()
  try {
    const [a, b] = await Promise.all([
      runWorker(dir, "jseq", "xc", ["20"]),
      runWorker(dir, "jseq", "xc", ["20"]),
    ])
    expect(a.out).toBe("done")
    expect(b.out).toBe("done")
    const lines = readFileSync(join(dir, ".minicode", "journal-xc.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
    // O_APPEND antar proses: tak ada baris robek/campur. Keunikan seq
    // SENGAJA tak diassert — lock in-memory bukan lock lintas proses
    // (dinyatakan unsupported, lihat laporan #09 §29).
    expect(lines).toHaveLength(40)
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow()
  } finally {
    cleanup(dir)
  }
}, 30000)

// ── §30 Config konkuren lintas proses: atomik, last-wins terdokumentasi ──

test("§30 dua proses tulis config bersamaan: berkas selalu parse", async () => {
  const dir = tmpRoot()
  try {
    const [a, b] = await Promise.all([
      runWorker(dir, "cfgwrite", "xa"),
      runWorker(dir, "cfgwrite", "xb"),
    ])
    expect(a.out).toBe("done")
    expect(b.out).toBe("done")
    // rename atomik: pembaca tak pernah melihat JSON separuh. Isi =
    // last-wins (terdokumentasi, bukan CAS) — minimal satu pemenang ada.
    const cfg = JSON.parse(readFileSync(join(dir, ".minicode", "config.json"), "utf8")) as {
      providers: { id: string }[]
    }
    const ids = cfg.providers.map((p) => p.id)
    expect(ids.includes("xa") || ids.includes("xb")).toBe(true)
  } finally {
    cleanup(dir)
  }
}, 30000)

// ── §26/§32 Sesi: dua proses, id beda + baca sama ──

test("§32 dua proses tulis sesi beda: keduanya utuh", async () => {
  const dir = tmpRoot()
  try {
    const [a, b] = await Promise.all([
      runWorker(dir, "sesswrite", "sa"),
      runWorker(dir, "sesswrite", "sb"),
    ])
    expect(a.out).toBe("done")
    expect(b.out).toBe("done")
    const { loadSession } = await import("../src/session/persistence.ts")
    expect(JSON.stringify(loadSession("sa", dir)?.messages[0])).toContain("dari-sa")
    expect(JSON.stringify(loadSession("sb", dir)?.messages[0])).toContain("dari-sb")
  } finally {
    cleanup(dir)
  }
}, 30000)

test("§32 dua proses baca sesi sama: isi identik", async () => {
  const dir = tmpRoot()
  try {
    const w = await runWorker(dir, "sesswrite", "sr")
    expect(w.out).toBe("done")
    const [a, b] = await Promise.all([
      runWorker(dir, "sessread", "sr"),
      runWorker(dir, "sessread", "sr"),
    ])
    expect(JSON.parse(a.out)).toEqual(JSON.parse(b.out))
    expect(JSON.parse(a.out).n).toBe(1)
  } finally {
    cleanup(dir)
  }
}, 30000)
