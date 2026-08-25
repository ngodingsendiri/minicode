import { expect, test, afterAll } from "bun:test";
import { purgeExpired, getSessionTtlDays } from "../src/session/persistence.ts";
import { recordCheckpointFromSnapshots, loadCheckpointManifest } from "../src/session/checkpoint.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Database } from "bun:sqlite";

const origTtl = process.env.MINICODE_SESSION_TTL_DAYS;
afterAll(() => {
  if (origTtl === undefined) delete process.env.MINICODE_SESSION_TTL_DAYS;
  else process.env.MINICODE_SESSION_TTL_DAYS = origTtl;
});

test("session ttl: default 30, env override, 0 = forever", () => {
  delete process.env.MINICODE_SESSION_TTL_DAYS;
  expect(getSessionTtlDays()).toBe(30);
  process.env.MINICODE_SESSION_TTL_DAYS = "0";
  expect(getSessionTtlDays()).toBe(0);
  process.env.MINICODE_SESSION_TTL_DAYS = "7";
  expect(getSessionTtlDays()).toBe(7);
  process.env.MINICODE_SESSION_TTL_DAYS = "abc";
  expect(getSessionTtlDays()).toBe(30);
});

test("purgeExpired: menghapus sesi basi, menyimpan yang muda", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "minicode-purge-"));
  // tulis langsung ke DB lokal dengan timestamp lama
  await mkdir(join(tmp, ".minicode"), { recursive: true });
  const db = new Database(resolve(tmp, ".minicode", "sessions.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at INTEGER, cwd TEXT, system TEXT, updated_at INTEGER);
    CREATE TABLE IF NOT EXISTS messages (session_id TEXT, seq INTEGER, role TEXT, content TEXT, toolCalls TEXT, toolCallId TEXT, name TEXT, ts INTEGER, PRIMARY KEY(session_id, seq));
    CREATE TABLE IF NOT EXISTS turns (session_id TEXT, turn_idx INTEGER, usage TEXT, ts INTEGER, PRIMARY KEY(session_id, turn_idx));
  `);
  const now = Date.now();
  db.prepare("INSERT INTO sessions (id, created_at, cwd, system, updated_at) VALUES (?, ?, ?, ?, ?)").run("old-1", now - 40 * 86400000, tmp, "", now - 40 * 86400000);
  db.prepare("INSERT INTO sessions (id, created_at, cwd, system, updated_at) VALUES (?, ?, ?, ?, ?)").run("new-1", now, tmp, "", now);
  process.env.MINICODE_SESSION_TTL_DAYS = "30";
  const removed = purgeExpired(db, now);
  expect(removed).toBe(1);
  const remaining = db.prepare("SELECT id FROM sessions").all() as { id: string }[];
  expect(remaining.map((r) => r.id)).toEqual(["new-1"]);
  db.close();
  // WAL/shm handle terkadang masih terkunci sesaat setelah close di Windows —
  // retry kecil sebelum rm, jangan menjadikan buserror sebagai test failure.
  for (let attempt = 0; attempt < 5; attempt++) {
    try { rmSync(tmp, { recursive: true, force: true }); break; } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

test("checkpoint cap: hanya menyimpan 20 checkpoint terakhir", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "minicode-cpcap-"));
  // record 25 checkpoint
  for (let i = 0; i < 25; i++) {
    await recordCheckpointFromSnapshots("cp-sess", i, [{ path: "a.txt", content: `v${i}` }], `turn ${i}`, tmp);
  }
  const manifest = await loadCheckpointManifest("cp-sess", tmp);
  expect(manifest.checkpoints.length).toBe(20);
  // yang paling akhir harus tetap ada
  expect(manifest.checkpoints[19]!.description).toBe("turn 24");
  rmSync(tmp, { recursive: true, force: true });
});
