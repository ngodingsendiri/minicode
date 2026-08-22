import { expect, test } from "bun:test";
import { createPermissionHandler } from "../src/policy/permission.ts";

test("ask mode without TTY denies", async () => {
  const h = createPermissionHandler({ mode: "ask" });
  // in test, stdin.isTTY is false, so promptAsk returns deny
  const r = await h.check({ id: "1", name: "bash", args: { cmd: "echo hi" } } as never, {} as never);
  expect(r).toBe("deny");
});

test("ask allows readonly without prompt", async () => {
  const h = createPermissionHandler({ mode: "ask" });
  const r = await h.check({ id: "1", name: "read_file", args: { path: "a.txt" } } as never, {} as never);
  expect(r).toBe("allow");
});

test("auto allows write_memory", async () => {
  const h = createPermissionHandler({ mode: "auto" });
  const r = await h.check({ id: "1", name: "write_memory", args: { text: "hi" } } as never, {} as never);
  expect(r).toBe("allow");
});
