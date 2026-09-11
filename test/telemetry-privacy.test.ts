// Audit #10 — Telemetry / Privacy / Data Leakage.
//
// Setiap test di sini mengunci sink kebocoran yang TERBUKTI via reproducer
// (lihat laporan audit #10): redaction header/URL/env yang lolos scrubber,
// serta residual traces + shadow-git refs yang bertahan setelah deleteSession.
// Bila test gagal di kode lama, ia menguji yang dikiranya (Prinsip 3 PLAN.md).
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scrubSecrets } from "../src/policy/scrub.ts"
import {
  purgeSessionTraces,
  summarizeArgs,
  writeStepTrace,
  writeTrace,
} from "../src/telemetry/trace.ts"
import { friendlyFromCategory } from "../src/ui/render/errors.ts"

setDefaultTimeout(60_000)

let dir = ""
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  dir = ""
})

async function freshTmp(prefix: string): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), prefix))
  // .minicode lokal DULU agar resolveDbPath (sessions/vector) tak jatuh ke
  // HOME asli (insiden audit #13: DB global ikut ditulis test).
  await mkdir(join(dir, ".minicode"), { recursive: true }).catch(() => {})
  return dir
}

function baseTrace(sessionId: string, prompt = "hello") {
  return {
    sessionId,
    timestamp: new Date().toISOString(),
    prompt,
    durationMs: 10,
    steps: 1,
    turns: 1,
    inputTokens: 1,
    outputTokens: 1,
    ok: true,
  }
}

describe("audit #10: jalur telemetry lokal-only (tanpa egress)", () => {
  test("write/purge/delete + scrub tanpa satu pun fetch keluar", async () => {
    const cwd = await freshTmp("minicode-priv-offline-")
    const realFetch = globalThis.fetch
    let calls = 0
    // @ts-expect-error — stub bukti: jalur ini tak boleh menyentuh jaringan
    globalThis.fetch = async () => {
      calls++
      throw new Error("network blocked (audit #10)")
    }
    try {
      await writeTrace(cwd, { ...baseTrace("s-off", "secret doang") })
      await writeStepTrace(cwd, {
        sessionId: "s-off",
        timestamp: new Date().toISOString(),
        kind: "tool",
        step: 0,
        tool: "bash",
        ok: true,
        args: "cmd=echo hi",
      })
      expect(await purgeSessionTraces("s-off", cwd)).toBe(2)
      const { saveSession, deleteSession } = await import("../src/session/persistence.ts")
      await saveSession("s-off", cwd, "sys", [{ role: "user", content: "x" }], null)
      await deleteSession("s-off", cwd)
      expect(scrubSecrets("Authorization: Bearer SECRET123")).not.toContain("SECRET123")
      expect(summarizeArgs({ cmd: "echo hi" })).toBe("cmd=echo hi")
    } finally {
      globalThis.fetch = realFetch
    }
    expect(calls).toBe(0)
  })
})

describe("audit #10: scrubSecrets menutup celah header/URL/env", () => {
  test("Bearer spasi pendek + Authorization penuh disamarkan", () => {
    expect(scrubSecrets("Authorization: Bearer SECRET123")).toContain("[REDACTED]")
    expect(scrubSecrets("Authorization: Bearer SECRET123")).not.toContain("SECRET123")
    expect(scrubSecrets("key Bearer abcdefghij end")).toContain("[REDACTED]")
  })

  test("X-Api-Key pendek + Cookie session disamarkan", () => {
    expect(scrubSecrets("X-Api-Key: SECRET456")).not.toContain("SECRET456")
    expect(scrubSecrets("Cookie: session=SECRET789")).not.toContain("SECRET789")
    expect(scrubSecrets("sessionid=SECRET789")).not.toContain("SECRET789")
  })

  test("identifier session* + konstanta kode tak ikut disamarkan (anti-overredaksi)", () => {
    // Audit #11 §18: pola insensitif menyamarkan `sessionId: string` milik
    // output tool sendiri — identifier camelCase bukan kredensial.
    expect(scrubSecrets("sessionId: string")).toBe("sessionId: string")
    expect(scrubSecrets("session = await get()")).toBe("session = await get()")
    expect(scrubSecrets("const TOKENS = {")).toBe("const TOKENS = {")
  })

  test("anotasi kode + SQL + identifier tak ikut disamarkan (audit #11 §18)", () => {
    // Tanpa guard nilai, scrub membutakan model yang membaca kode: `apiKey:
    // string` → [REDACTED], SQL `session_id = ?` → [REDACTED].
    expect(scrubSecrets("apiKey: string")).toBe("apiKey: string")
    expect(scrubSecrets("const apiKey = getArg('--apiKey')")).toBe(
      "const apiKey = getArg('--apiKey')",
    )
    expect(scrubSecrets("WHERE session_id = ?")).toBe("WHERE session_id = ?")
    expect(scrubSecrets('secret = graphemes.join("")')).toBe('secret = graphemes.join("")')
    expect(scrubSecrets("DEFAULT_TOKENS = 128_000")).toBe("DEFAULT_TOKENS = 128_000")
    expect(scrubSecrets("PASSWORD=$2b$12$abcdefghijklmnopqrstuu")).not.toContain("$2b$12$")
  })

  test("query-param kredensial pendek disamarkan, nama param tetap", () => {
    const out = scrubSecrets("https://example.test/x?api_key=SECRET123&token=ABC456")
    expect(out).not.toContain("SECRET123")
    expect(out).not.toContain("ABC456")
    expect(out).toContain("api_key=[REDACTED]")
    expect(out).toContain("token=[REDACTED]")
  })

  test("baris env-dump NAME=VALUE disamarkan", () => {
    expect(scrubSecrets("MINICODE_TEST_SECRET=SECRET12345")).not.toContain("SECRET12345")
    expect(scrubSecrets("password=SECRET123")).not.toContain("SECRET123")
  })

  test("prosa normal + referensi env tak ikut disamarkan", () => {
    expect(scrubSecrets("just normal code: const x = 1;")).toBe("just normal code: const x = 1;")
    expect(scrubSecrets("const key = process.env.OPENAI_API_KEY;")).toBe(
      "const key = process.env.OPENAI_API_KEY;",
    )
    expect(scrubSecrets("Bearer token")).toBe("Bearer token")
  })
})

describe("audit #10: summarizeArgs metadata-saja + ter-scrub", () => {
  test("cmd/query/url pendek disamarkan, isi penuh dibuang", () => {
    expect(summarizeArgs({ cmd: "curl -H 'Authorization: Bearer SECRET123' x" })).not.toContain(
      "SECRET123",
    )
    expect(summarizeArgs({ url: "https://example.test/x?api_key=SECRET123" })).toContain(
      "api_key=[REDACTED]",
    )
    // `content`/`code` SENGAJA bukan kunci ringkasan (bisa megabyte + secret)
    expect(summarizeArgs({ path: "a.txt", content: "TOOL_SECRET_67890" })).toBe("path=a.txt")
  })
})

describe("audit #10: error tampil tak membocorkan kredensial", () => {
  test("Authorization: Bearer utuh hilang seluruhnya", () => {
    const f = friendlyFromCategory("unknown", "Authorization: Bearer SECRET123")
    expect(f.message).not.toContain("SECRET123")
    expect(f.message).toContain("[redacted]")
  })

  test("Bearer spasi + Cookie session disamarkan; identifier utuh", () => {
    expect(friendlyFromCategory("unknown", "Bearer SECRET123").message).not.toContain("SECRET123")
    expect(friendlyFromCategory("unknown", "Cookie: session=SECRET789").message).not.toContain(
      "SECRET789",
    )
    expect(friendlyFromCategory("unknown", "sessionid=SECRET789").message).not.toContain(
      "SECRET789",
    )
    expect(friendlyFromCategory("unknown", "sessionId: string").message).toContain(
      "sessionId: string",
    )
    expect(friendlyFromCategory("unknown", "token: string").message).toContain("token: string")
  })

  test("perilaku lama tetap: token= disamarkan, pesan normal utuh", () => {
    const f = friendlyFromCategory("server", '{"error":{"message":"denied for token=SEKRET-1"}}')
    expect(f.message).not.toContain("SEKRET-1")
    expect(friendlyFromCategory("unknown", "socket hang up").message).toContain("socket hang up")
  })
})

describe("audit #10: trace error ter-scrub sebelum persist", () => {
  test("bearer pendek di error tak mencapai traces.jsonl", async () => {
    const cwd = await freshTmp("minicode-priv-err-")
    await writeTrace(cwd, {
      ...baseTrace("s-err"),
      ok: false,
      error: "fetch 401: Authorization: Bearer SECRET123",
    })
    const txt = await readFile(join(cwd, ".minicode", "traces.jsonl"), "utf8")
    expect(txt).not.toContain("SECRET123")
    expect(txt).toContain("[REDACTED]")
  })
})

describe("audit #10: atribusi konkuren tetap benar", () => {
  test("10 sesi paralel: marker tak salah atribusi", async () => {
    const cwd = await freshTmp("minicode-priv-attr-")
    const ids = Array.from({ length: 10 }, (_, i) => `sess-${i}`)
    await Promise.all(
      ids.map((id, i) => writeTrace(cwd, { ...baseTrace(id, `PROMPT_MARKER_${i}_UNIQUE`) })),
    )
    const lines = (await readFile(join(cwd, ".minicode", "traces.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
    expect(lines.length).toBe(10)
    for (let i = 0; i < 10; i++) {
      const row = JSON.parse(lines.find((l) => l.includes(`"sessionId":"sess-${i}"`))!) as {
        prompt: string
      }
      expect(row.prompt).toContain(`PROMPT_MARKER_${i}_UNIQUE`)
    }
  })
})

describe("audit #10: deleteSession menghapus owned privacy state", () => {
  test("purgeSessionTraces hanya membuang baris sesi itu", async () => {
    const cwd = await freshTmp("minicode-priv-purge-")
    await writeTrace(cwd, { ...baseTrace("sessA", "PROMPT_SECRET_A") })
    await writeTrace(cwd, { ...baseTrace("sessB", "PROMPT_SECRET_B") })
    await writeStepTrace(cwd, {
      sessionId: "sessA",
      timestamp: new Date().toISOString(),
      kind: "tool",
      step: 0,
      tool: "bash",
      ok: true,
      args: "cmd=echo PROMPT_SECRET_A",
    })
    const removed = await purgeSessionTraces("sessA", cwd)
    expect(removed).toBe(2)
    const traces = await readFile(join(cwd, ".minicode", "traces.jsonl"), "utf8")
    expect(traces).not.toContain("PROMPT_SECRET_A")
    expect(traces).toContain("PROMPT_SECRET_B")
    // step-traces milik A habis → berkas di-unlink, bukan sisa kosong
    await expect(readFile(join(cwd, ".minicode", "step-traces.jsonl"), "utf8")).rejects.toThrow()
  })

  test("deleteSession end-to-end: DB + jurnal + checkpoint + traces bersih", async () => {
    const cwd = await freshTmp("minicode-priv-del-")
    const { saveSession, loadSession, deleteSession } = await import(
      "../src/session/persistence.ts"
    )
    await saveSession("sessA", cwd, "sys", [{ role: "user", content: "PROMPT_SECRET_A" }], null)
    await writeTrace(cwd, { ...baseTrace("sessA", "PROMPT_SECRET_A") })
    const { recordCheckpointFromSnapshots } = await import("../src/session/checkpoint.ts")
    await recordCheckpointFromSnapshots(
      "sessA",
      0,
      [{ path: "a.txt", content: "PROMPT_SECRET_A" }],
      "t",
      cwd,
    )
    await deleteSession("sessA", cwd)
    expect(loadSession("sessA", cwd)).toBeNull()
    const traces = await readFile(join(cwd, ".minicode", "traces.jsonl"), "utf8").catch(() => "")
    expect(traces).not.toContain("PROMPT_SECRET_A")
  })

  const gitAvailable =
    spawnSync("git", ["--version"], { stdio: "ignore", timeout: 5000 }).status === 0

  test.skipIf(!gitAvailable)("deleteSession mem-prune shadow refs sesi itu", async () => {
    const cwd = await freshTmp("minicode-priv-shadow-")
    spawnSync("git", ["init", "-q"], { cwd })
    spawnSync("git", ["config", "user.email", "t@example.com"], { cwd })
    spawnSync("git", ["config", "user.name", "t"], { cwd })
    const { snapshotTree, listShadowRefs } = await import("../src/session/shadow-git.ts")
    const { saveSession, deleteSession } = await import("../src/session/persistence.ts")
    await import("node:fs/promises").then((m) => m.writeFile(join(cwd, "f.txt"), "SHADOW_SECRET_1"))
    const snap = await snapshotTree(cwd, "sessX", "pre")
    expect(snap).not.toBeNull()
    await saveSession("sessX", cwd, "sys", [{ role: "user", content: "x" }], null)
    await deleteSession("sessX", cwd)
    const refs = await listShadowRefs(cwd)
    expect(refs.filter((r) => r.ref.includes("/sessX/"))).toEqual([])
  })
})

describe("audit #10: jurnal tanpa raw secret + memory forget tuntas", () => {
  test("jurnal hanya menyimpan hash argumen, bukan isi", async () => {
    const cwd = await freshTmp("minicode-priv-j-")
    const { appendMutationIntent, loadJournal } = await import("../src/session/journal.ts")
    await appendMutationIntent({
      session: "s",
      tool: "write_file",
      cwd,
      paths: [],
      argsHash: (await import("../src/session/journal.ts")).hashArgs({
        content: "TOOL_SECRET_67890",
      }),
    })
    const loaded = await loadJournal("s", cwd)
    expect(JSON.stringify(loaded.records)).not.toContain("TOOL_SECRET_67890")
    expect(loaded.records[0]!.argsHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test("forget_memory menghapus vector + file (tak retrievable)", async () => {
    // Hermetic PENUH: .minicode lokal dibuat dulu + MINICODE_HOME palsu agar
    // resolveDbPath tak pernah jatuh ke HOME asli (insiden audit #13: resolve
    // sebelum mkdir menulis ke global).
    const prevHome = process.env.MINICODE_HOME
    const fakeHome = await mkdtemp(join(tmpdir(), "minicode-priv-home-"))
    const cwd = await freshTmp("minicode-priv-mem-")
    try {
      const { mkdirSync } = await import("node:fs")
      mkdirSync(join(fakeHome, ".minicode"), { recursive: true })
      mkdirSync(join(cwd, ".minicode"), { recursive: true })
      process.env.MINICODE_HOME = fakeHome
      const { addMemory, searchHybrid } = await import("../src/memory/vector.ts")
      const { appendMemory, deleteMemoryLines, readMemoryFile } = await import(
        "../src/memory/files.ts"
      )
      const marker = `MEMORY_SECRET_${Date.now()}`
      await addMemory(`${marker} unik`, { cwd })
      await appendMemory(`${marker} baris`, cwd)
      expect(JSON.stringify(await searchHybrid(marker, { cwd, topK: 5 }))).toContain(marker)
      const { deleteMemoryByQuery } = await import("../src/memory/vector.ts")
      expect(await deleteMemoryByQuery(marker, cwd)).toBeGreaterThan(0)
      expect(await deleteMemoryLines(marker, cwd)).toBeGreaterThan(0)
      expect(JSON.stringify(await searchHybrid(marker, { cwd, topK: 5 }))).not.toContain(marker)
      expect(await readMemoryFile(cwd)).not.toContain(marker)
    } finally {
      if (prevHome === undefined) delete process.env.MINICODE_HOME
      else process.env.MINICODE_HOME = prevHome
      await rm(fakeHome, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("isolasi cross-project: memori cwd A tak terlihat dari B", async () => {
    const prevHome = process.env.MINICODE_HOME
    const fakeHome = await mkdtemp(join(tmpdir(), "minicode-priv-home-"))
    const cwdA = await mkdtemp(join(tmpdir(), "minicode-priv-pa-"))
    const cwdB = await mkdtemp(join(tmpdir(), "minicode-priv-pb-"))
    try {
      const { mkdirSync } = await import("node:fs")
      mkdirSync(join(fakeHome, ".minicode"), { recursive: true })
      mkdirSync(join(cwdA, ".minicode"), { recursive: true })
      mkdirSync(join(cwdB, ".minicode"), { recursive: true })
      process.env.MINICODE_HOME = fakeHome
      const { addMemory, searchHybrid } = await import("../src/memory/vector.ts")
      const marker = `PROJA_${Date.now()}_UNIQUE`
      await addMemory(`${marker} rahasia`, { cwd: cwdA })
      // Kontrol positif: A melihat miliknya sendiri.
      expect(JSON.stringify(await searchHybrid(marker, { cwd: cwdA, topK: 5 }))).toContain(marker)
      const hitsB = await searchHybrid(marker, { cwd: cwdB, topK: 5 })
      expect(JSON.stringify(hitsB)).not.toContain(marker)
    } finally {
      if (prevHome === undefined) delete process.env.MINICODE_HOME
      else process.env.MINICODE_HOME = prevHome
      await rm(cwdA, { recursive: true, force: true }).catch(() => {})
      await rm(cwdB, { recursive: true, force: true }).catch(() => {})
      await rm(fakeHome, { recursive: true, force: true }).catch(() => {})
    }
  })
})
