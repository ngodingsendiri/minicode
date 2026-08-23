import { expect, test } from "bun:test";
import { saveSession, loadSession, deleteSession } from "../src/session/persistence.ts";
import { addMemory, searchHybrid } from "../src/memory/vector.ts";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const tmp = ".tmp-persist";
const tmpDir = resolve(tmp, ".minicode");

test("persistence roundtrip + delete", async () => {
  await mkdir(tmpDir, { recursive: true });
  const id = "t-" + randomUUID().slice(0, 6);
  saveSession(id, tmp, "sys", [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi", toolCalls: [{ id: "c1", name: "echo", args: { x: 1 } }] },
    { role: "tool", toolCallId: "c1", name: "echo", content: "1" },
  ] as never, { turns: 1 });
  const loaded = loadSession(id, tmp);
  expect(loaded?.messages.length).toBe(3);
  expect((loaded?.messages[1] as { toolCalls?: unknown[] }).toolCalls?.length).toBe(1);
  deleteSession(id, tmp);
  expect(loadSession(id, tmp)).toBeNull();
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test("persistence incremental: append-only pada turn ke-2", async () => {
  await mkdir(tmpDir, { recursive: true });
  const id = "i-" + randomUUID().slice(0, 6);
  // turn 1: 2 pesan
  saveSession(id, tmp, "sys", [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
  ] as never, {});
  expect(loadSession(id, tmp)?.messages.length).toBe(2);
  // turn 2: 4 pesan (2 baru + 2 lama)
  saveSession(id, tmp, "sys", [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
  ] as never, {});
  expect(loadSession(id, tmp)?.messages.length).toBe(4);
  // turn 3: 5 pesan (1 baru)
  saveSession(id, tmp, "sys", [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "u3" },
  ] as never, {});
  const loaded = loadSession(id, tmp);
  expect(loaded?.messages.length).toBe(5);
  expect((loaded?.messages[4] as { content: string }).content).toBe("u3");
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test("persistence Uint8Array content disimpan sebagai placeholder", async () => {
  await mkdir(tmpDir, { recursive: true });
  const id = "b-" + randomUUID().slice(0, 6);
  saveSession(id, tmp, "sys", [
    { role: "user", content: new Uint8Array([0, 1, 2, 3]) },
    { role: "assistant", content: "ok" },
  ] as never, {});
  const loaded = loadSession(id, tmp);
  const msg = loaded?.messages[0] as { content: string };
  expect(typeof msg.content).toBe("string");
  expect(msg.content).toMatch(/\[binary: 4 bytes\]/);
  expect((loaded?.messages[1] as { content: string }).content).toBe("ok");
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test("persistence compaction (history menyusut) tulis ulang penuh", async () => {
  await mkdir(tmpDir, { recursive: true });
  const id = "c-" + randomUUID().slice(0, 6);
  // simulate 3 turns
  saveSession(id, tmp, "sys", [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "u3" },
    { role: "assistant", content: "a3" },
  ] as never, {});
  expect(loadSession(id, tmp)?.messages.length).toBe(6);
  // compaction: hanya 2 pesan terakhir
  saveSession(id, tmp, "sys", [
    { role: "user", content: "summary" },
    { role: "user", content: "u3" },
    { role: "assistant", content: "a3" },
  ] as never, {});
  const loaded = loadSession(id, tmp);
  expect(loaded?.messages.length).toBe(3);
  expect((loaded?.messages[0] as { content: string }).content).toBe("summary");
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
});

test("vector hybrid keyword fallback (no embedding key)", async () => {
  const marker = "vec-test-" + randomUUID().slice(0, 6);
  await addMemory(`unique ${marker} content about persistence`, {});
  const hits = await searchHybrid("persistence", {}) as unknown as { text: string; score: number }[];
  expect(hits.some((h) => h.text.includes(marker))).toBe(true);
  expect(hits[0]!.score).toBeGreaterThanOrEqual(0);
  expect(hits[0]!.score).toBeLessThanOrEqual(1);
  // cleanup
  const { Database } = await import("bun:sqlite");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const db = new Database(join(homedir(), ".minicode", "vector.db"));
  db.prepare("DELETE FROM memory WHERE text LIKE ?").run(`%${marker}%`);
  db.close();
});
