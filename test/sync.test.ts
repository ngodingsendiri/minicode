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
  const results = await refreshProviderModels({ cwd: localCwd });
  expect(results.length).toBe(1);
  expect(results[0]).toEqual({ id: "gw", from: 1, to: 2 });
  const cfg = JSON.parse(await readFile(localConfig, "utf8"));
  expect(cfg.providers[0].models).toEqual(["model-a", "model-b"]);
  expect(cfg.providers[0].apiKey).toBe("k"); // secrets intak
});

test("sync: provider DI LOCAL tetap terupdate tanpa flag global eksplisit", async () => {
  const { clearDetectCache } = await import("../src/providers/detect.ts");
  clearDetectCache(); // pastikan tidak kena cache 30 menit dari test 1
  // Simulasi bug: user simpan provider di local tapi /sync tanpa global flag
  const cfgBefore = JSON.parse(await readFile(localConfig, "utf8"));
  expect(cfgBefore.providers[0].models).toEqual(["model-a", "model-b"]);
  // update stub jadi 3 model
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    if (u.includes("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] }), { status: 200 });
    }
    return new Response("nf", { status: 404 });
  }) as typeof fetch;
  const results = await refreshProviderModels({ cwd: localCwd });
  expect(results.length).toBe(1);
  expect(results[0]).toEqual({ id: "gw", from: 2, to: 3 });
  const cfg = JSON.parse(await readFile(localConfig, "utf8"));
  expect(cfg.providers[0].models).toEqual(["m1", "m2", "m3"]);
});

test("sync: tanpa provider di merge → hasil kosong tanpa throw", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  const empty = resolve(mkdtempSync(join(tmpdir(), "minicode-sync-empty-")), "nope");
  const results = await refreshProviderModels({ cwd: empty });
  expect(results).toEqual([]);
});
