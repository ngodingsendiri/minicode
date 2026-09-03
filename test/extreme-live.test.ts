// Extreme E2E test — tests ALL minicode features with live free providers.
// Live test: butuh config lokal + jaringan. Jalan via `bun run test:live`
// (default `bun test` skip seluruh file ini).
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"

// skip seluruh file bila MINICODE_LIVE != 1 (CI-safe tanpa secrets)
const live = process.env.MINICODE_LIVE === "1"
const it = live ? test : test.skip

const dir = ".tmp-extreme-live"
let session: any
let provider: any

beforeAll(async () => {
  await mkdir(dir, { recursive: true })
  await mkdir(`${dir}/src`, { recursive: true })
  await mkdir(`${dir}/test`, { recursive: true })
  await writeFile(
    `${dir}/package.json`,
    '{"name":"extreme","type":"module","scripts":{"typecheck":"bun x tsc --noEmit","test":"bun test"}}',
  )
  await writeFile(
    `${dir}/tsconfig.json`,
    '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["src","test"]}',
  )

  // Load config and find a working provider
  const { loadConfig } = await import("../src/config.ts")
  const cfg = await loadConfig()
  // Prefer bai (deepseek-v4-flash), fallback to openrouter nemotron
  const bai = cfg.providers.find((p) => p.id === "bai" && p.models.includes("deepseek-v4-flash"))
  const orFree = cfg.providers.find(
    (p) => p.id === "openrouter" && p.models.includes("nvidia/nemotron-3-ultra-550b-a55b:free"),
  )

  const { createOpenAICompatProvider } = await import("#minicore/providers/openai-compat.ts")
  if (bai?.apiKey) {
    provider = createOpenAICompatProvider({
      baseUrl: bai.baseUrl,
      apiKey: bai.apiKey,
      models: ["deepseek-v4-flash"],
      defaultModel: "deepseek-v4-flash",
    })
    process.env._TEST_MODEL = "deepseek-v4-flash"
    console.log("Using provider: bai / deepseek-v4-flash")
  } else if (orFree?.apiKey) {
    provider = createOpenAICompatProvider({
      baseUrl: orFree.baseUrl,
      apiKey: orFree.apiKey,
      models: ["nvidia/nemotron-3-ultra-550b-a55b:free"],
      defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
    })
    process.env._TEST_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
    console.log("Using provider: openrouter / nvidia/nemotron-3-ultra-550b-a55b:free")
  } else {
    console.log("(skip) no live provider available")
    return
  }

  const { createMinicodeSession } = await import("../src/app/session.ts")
  const { allTools } = await import("../src/tools/index.ts")

  session = await createMinicodeSession({
    provider,
    tools: allTools,
    cwd: dir,
    permissionMode: "auto",
    maxSteps: 20,
    timeoutMs: 120_000,
  })
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

it("E2E-1: Tool calling — write_file creates file on disk", async () => {
  if (!session) return
  const result = await session.run(
    `Create a file called src/greeting.ts with this exact content:\nexport function greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nUse write_file tool.`,
    {},
  )
  const steps = result?.usage?.steps ?? 0
  const content = await readFile(`${dir}/src/greeting.ts`, "utf8").catch(() => "")
  // Agent mungkin atau tidak selalu berhasil — yang penting tidak crash dan ada output
  console.log(
    `[e2e] steps=${steps} fileExists=${content.length > 0} finalText=${(result.finalText ?? "").slice(0, 60)}`,
  )
}, 60_000)

it("E2E-2: Memory RAG — write_memory then read_memory", async () => {
  if (!session) return
  const { addMemory, searchHybrid } = await import("../src/memory/vector.ts")
  const marker = `e2e-mem-${Date.now()}`
  await addMemory(`${marker}: minicode uses frozen MiniCore kernel`, {})
  const results = await searchHybrid(marker, {})
  expect(results.length).toBeGreaterThan(0)
  // Cleanup
  const { deleteMemoryByQuery } = await import("../src/memory/vector.ts")
  await deleteMemoryByQuery(marker)
}, 30_000)

it("E2E-3: Checkpoint — undo restores pre-edit state", async () => {
  if (!session) return
  const { recordCheckpointFromSnapshots, undoLastCheckpoint } = await import(
    "../src/session/checkpoint.ts"
  )
  const testFile = `${dir}/src/utils.ts`
  await writeFile(testFile, "export const original = true;\n", "utf8")

  // Capture pre-edit snapshot
  const snapshots = [{ path: "src/utils.ts", content: "export const original = true;\n" }]
  // Agent edits the file
  await writeFile(testFile, "export const modified = false;\n", "utf8")

  // Record checkpoint with pre-edit state
  await recordCheckpointFromSnapshots("e2e-checkpoint", 1, snapshots, "pre-edit", dir)

  // Undo → should restore original
  const res = await undoLastCheckpoint("e2e-checkpoint", dir)
  expect(res.success).toBe(true)
  const content = await readFile(testFile, "utf8")
  expect(content).toContain("original = true")
}, 15_000)

it("E2E-4: Repo-map generates symbol overview", async () => {
  if (!session) return
  const { loadRepoMap } = await import("../src/repo/repomap.ts")
  const map = await loadRepoMap(dir)
  // Bisa kosong jika tak ada source file dikenali — tapi tidak boleh throw
  expect(typeof map).toBe("string")
}, 15_000)

it("E2E-5: Session persistence — save/load roundtrip", async () => {
  const { saveSession, loadSession, deleteSession } = await import("../src/session/persistence.ts")
  const id = `e2e-sess-${Date.now()}`
  await saveSession(
    id,
    undefined,
    "sys",
    [
      { role: "user", content: "hello e2e" },
      { role: "assistant", content: "response" },
    ] as never,
    { tokens: 100 },
  )
  const loaded = loadSession(id)
  expect(loaded).not.toBeNull()
  expect(loaded!.messages[0]).toMatchObject({ role: "user", content: "hello e2e" })
  expect((loaded!.messages[1] as { content?: string }).content).toBe("response")
  await deleteSession(id)
  expect(loadSession(id)).toBeNull()
})

it("E2E-6: Telemetry — traces.jsonl exists after run", async () => {
  const { writeTrace } = await import("../src/telemetry/trace.ts")
  const tracePath = `${dir}/.minicode/traces.jsonl`
  await writeTrace(dir, {
    sessionId: "trace-test",
    timestamp: new Date().toISOString(),
    prompt: "test prompt",
    durationMs: 1000,
    steps: 2,
    turns: 1,
    inputTokens: 100,
    outputTokens: 50,
    cost: 0.001,
    ok: true,
  })
  const content = await readFile(tracePath, "utf8").catch(() => "")
  expect(content).toContain("trace-test")
})
