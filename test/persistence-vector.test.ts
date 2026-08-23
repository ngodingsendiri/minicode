import { expect, test } from "bun:test";
import { saveSession, loadSession, listSessions, deleteSession } from "../src/session/persistence.ts";
import { addMemory, searchHybrid } from "../src/memory/vector.ts";
import { randomUUID } from "node:crypto";

test("persistence roundtrip + delete", () => {
  const id = "t-" + randomUUID().slice(0, 6);
  saveSession(id, undefined, "sys", [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi", toolCalls: [{ id: "c1", name: "echo", args: { x: 1 } }] },
    { role: "tool", toolCallId: "c1", name: "echo", content: "1" },
  ] as never, { turns: 1 });
  const loaded = loadSession(id);
  expect(loaded?.messages.length).toBe(3);
  expect((loaded?.messages[1] as { toolCalls?: unknown[] }).toolCalls?.length).toBe(1);
  expect(listSessions().some((s) => s.id === id)).toBe(true);
  deleteSession(id);
  expect(loadSession(id)).toBeNull();
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
