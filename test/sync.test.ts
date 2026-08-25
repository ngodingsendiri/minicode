import { expect, test, afterAll } from "bun:test";
import { refreshProviderModels } from "../src/config.ts";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "minicode-sync-"));
const localCwd = resolve(tmp, "proj");
await mkdir(join(localCwd, ".minicode"), { recursive: true });
const localConfig = join(localCwd, ".minicode", "config.json");

// stub fetch untuk deteksi
const origFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown) => {
  const u = String(url);
  if (u.includes("/models")) {
    return new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }), { status: 200 });
  }
  return new Response("nf", { status: 404 });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = origFetch;
  rmSync(tmp, { recursive: true, force: true });
});

test("sync: refreshProviderModels updates config models (local)", async () => {
  await writeFile(localConfig, JSON.stringify({ providers: [{ id: "gw", baseUrl: "https://gw.example/v1", apiKey: "k", models: ["old-only"] }] }));
  const results = await refreshProviderModels({ global: false, cwd: localCwd });
  expect(results.length).toBe(1);
  expect(results[0]).toEqual({ id: "gw", from: 1, to: 2 });
  const cfg = JSON.parse(await readFile(localConfig, "utf8"));
  expect(cfg.providers[0].models).toEqual(["model-a", "model-b"]);
  expect(cfg.providers[0].apiKey).toBe("k"); // secrets intak
});
