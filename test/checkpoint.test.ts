import { expect, test, beforeEach, afterEach } from "bun:test";
import { recordCheckpoint, recordCheckpointFromSnapshots, captureFileSnapshot, snapshotWorkspace, undoLastCheckpoint, redoLastCheckpoint } from "../src/session/checkpoint.ts";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `minicode-cp-test-${Date.now()}`);
const testFile = join(testDir, "test.txt");

beforeEach(async () => {
  await mkdir(testDir, { recursive: true });
  await writeFile(testFile, "initial content", "utf8");
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

test("checkpoint: records snapshot and undos file modifications", async () => {
  const sessionId = "test-cp-sess";

  // Record initial state
  await recordCheckpoint(sessionId, 1, [testFile], "before edit", testDir);

  // Modify file
  await writeFile(testFile, "modified by agent", "utf8");
  expect(await readFile(testFile, "utf8")).toBe("modified by agent");

  // Undo
  const undoRes = await undoLastCheckpoint(sessionId, testDir);
  expect(undoRes.success).toBe(true);
  expect(await readFile(testFile, "utf8")).toBe("initial content");

  // Redo
  const redoRes = await redoLastCheckpoint(sessionId, testDir);
  expect(redoRes.success).toBe(true);
  expect(await readFile(testFile, "utf8")).toBe("initial content");
});

test("checkpoint: recordCheckpointFromSnapshots restores pre-edit state", async () => {
  const sessionId = "test-cp-snap";
  await writeFile(testFile, "initial content", "utf8");
  // capture pre-edit (persis yang dilakukan loop: baca sebelum edit)
  const snap = await captureFileSnapshot(testFile, testDir);
  // agen mengedit
  await writeFile(testFile, "agent edit", "utf8");
  await recordCheckpointFromSnapshots(sessionId, 1, [snap], "pre-edit", testDir);
  // undo → kembali ke state sebelum turn
  const undoRes = await undoLastCheckpoint(sessionId, testDir);
  expect(undoRes.success).toBe(true);
  expect(await readFile(testFile, "utf8")).toBe("initial content");
});

test("checkpoint: redo reapplies post-edit state", async () => {
  const sessionId = "test-cp-redo";
  await writeFile(testFile, "initial", "utf8");
  const pre = await captureFileSnapshot(testFile, testDir); // pre-edit
  await writeFile(testFile, "agent edit", "utf8");
  const post = await captureFileSnapshot(testFile, testDir); // post-edit
  await recordCheckpointFromSnapshots(sessionId, 1, [pre], "turn", testDir, [post]);

  await undoLastCheckpoint(sessionId, testDir);
  expect(await readFile(testFile, "utf8")).toBe("initial");

  await redoLastCheckpoint(sessionId, testDir);
  expect(await readFile(testFile, "utf8")).toBe("agent edit");
});

test("checkpoint: undo skips paths outside workspace (jail)", async () => {
  const sessionId = "test-cp-jail";
  const outside = join(testDir, "..", `outside-${Date.now()}.txt`);
  await writeFile(outside, "sensitive", "utf8");
  await recordCheckpointFromSnapshots(sessionId, 1, [{ path: relative(testDir, outside), content: "hijacked" }], "turn", testDir);

  const res = await undoLastCheckpoint(sessionId, testDir);
  expect(res.restoredFiles.some((f) => f.includes("skipped"))).toBe(true);
  expect(await readFile(outside, "utf8")).toBe("sensitive"); // tidak tertimpa
  await rm(outside, { force: true }).catch(() => {});
});

test("checkpoint: snapshotWorkspace captures files (bash/git mutations undoable)", async () => {
  await writeFile(join(testDir, "a.ts"), "export const a = 1;\n", "utf8");
  await mkdir(join(testDir, ".minicode"), { recursive: true });
  await writeFile(join(testDir, ".minicode", "ignore-me.txt"), "ignored", "utf8");
  const snaps = await snapshotWorkspace(testDir, 200);
  expect(snaps.some((s) => s.path === "a.ts")).toBe(true);
  // .minicode (dot dir) dilewati
  expect(snaps.some((s) => s.path.includes("ignore-me"))).toBe(false);
});
