# 🗺️ Arsitektur Minicode

> Coding agent di atas kernel beku MiniCore. Peta komponen ini menggambarkan kondisi
> setelah sesi pengembangan: Ink TUI, isolasi sub-agent, MCP client + server, dan LSP.

## Peta Pohon Komponen

```
minicode/
│
├── cli/index.ts ──────────────── ENTRY POINT (semua mode)
│   ├── minicode "<prompt>"      → agent run
│   │   ├─ loadConfig()          providers + mcpServers + lspServers
│   │   ├─ createRouterProvider()→ LLM routing
│   │   ├─ searchHybrid()        RAG inject ke system prompt
│   │   ├─ loadSession()         resume transkrip lama
│   │   ├─ mcpConnectAll()       connect server eksternal → merge tools
│   │   ├─ lspConfigure()        daftar language server (lazy spawn)
│   │   ├─ createMinicodeSession()
│   │   ├─ attachRenderer() / attachInkRenderer(--tui)
│   │   └─ persistCurrent()      save sqlite tiap turn
│   ├── config add|list|remove|detect
│   ├── config mcp add|list|remove
│   ├── config lsp add|list|remove
│   ├── mcp serve                → serveMcp() [jadi provider utk AI lain]
│   └── sessions list|export
│
├── src/
│   ├── session.ts               factory: kernel session + policy wiring
│   │   ├─ createPermissionHandler(mode: auto|readonly|allow-all|ask)
│   │   ├─ minicodeEstimator     C5 token estimate
│   │   ├─ cappedRecovery        P2 retryAfter ≤ 30s
│   │   └─ parallelExecutor(8, write 2)
│   │
│   ├── session/persistence.ts   sqlite sessions.db (save/load/list/delete)
│   │
│   ├── config.ts                ~/.minicode/config.json + .minicode/config.json
│   │   ├─ ProviderEntry         baseUrl/apiKey/models/providerHint
│   │   ├─ McpServerEntry        id/command/args/env
│   │   └─ LspServerEntry        ext/command/args/env
│   │
│   ├── tools/                   20 TOOLS (di-register ke session)
│   │   ├── index.ts             allTools[] + withMcpTools()
│   │   ├── read_file.ts    2MB cap, path jail
│   │   ├── write_file.ts   mkdir otomatis
│   │   ├── edit.ts         unique oldString match
│   │   ├── glob.ts, grep.ts     pencarian file/regex
│   │   ├── bash.ts         30s timeout
│   │   ├── git.ts          status/diff/log
│   │   ├── memory.ts       read/write/forget → hybrid RAG
│   │   ├── task.ts         ★ delegate_task → sub-agent isolasi
│   │   │     ├─ Pool(3) concurrency + AbortSignal chain
│   │   │     ├─ maxSteps clamp 1..50 (explore=5, plan=15)
│   │   │     ├─ filter write_memory/forget_memory (memory isolation)
│   │   │     └─ error → tool result (bukan crash)
│   │   ├── mcp_call.ts     mcp_list + mcp_call (dinamis)
│   │   └── lsp.ts          lsp_diagnostics/definition/references/hover/symbols
│   │
│   ├── providers/
│   │   ├── anthropic.ts    SSE streaming, per-stream pendingTools, error map
│   │   ├── detect.ts       GET /models hybrid Bearer + x-api-key
│   │   └── router.ts       route by model, fallback rate_limit/server,
│   │                       C4 Uint8Array→base64, P2 cap retryAfter
│   │
│   ├── policy/
│   │   ├── permission.ts   READONLY set, denylist bash (rm -rf/, fork bomb...),
│   │   │                   path jail, .env deny, ask+allowlist mode
│   │   ├── context.ts      buildSystemPrompt (MEMORY.md + AGENTS.md + git ls-files)
│   │   ├── compaction.ts   LLM Tier-2 deepseek, fallback mechanical
│   │   ├── executor.ts     parallel reads(8)/writes(2), split batch
│   │   └── usage.ts        cost tracking per model pricing
│   │
│   ├── memory/
│   │   ├── files.ts        MEMORY.md global + project (append/read)
│   │   └── vector.ts       sqlite vector.db, embedding-3-small,
│   │                       searchHybrid = 0.7 vector + 0.3 keyword
│   │
│   ├── mcp/                ★ MODEL CONTEXT PROTOCOL
│   │   ├── transport.ts    JSON-RPC newline-delimited via stdio,
│   │   │                   pending map + timeout, kill-signal on close
│   │   ├── client.ts       handshake discover→initialize fallback,
│   │   │                   notifications/initialized, wrap tools "{server}.{tool}"
│   │   └── server.ts       minicode JADI server: curated tools,
│   │                       permission tetap aktif, isError protocol
│   │
│   ├── lsp/                ★ LANGUAGE SERVER PROTOCOL
│   │   └── client.ts       framing Content-Length, initialize handshake,
│   │                       didOpen/didChange versioned, diagnostics collector,
│   │                       start-once guard, registry per-extensi
│   │
│   ├── agents/
│   │   └── pool.ts         semaphore async, queue abort-aware
│   │
│   ├── hooks/
│   │   └── index.ts        allowlist.json, promptAsk y/n/a, matchAllowlist glob
│   │
│   └── tui/
│       ├── renderer.ts     ANSI dasar (default)
│       └── ink.tsx         React Ink TUI (--tui): status bar, step/turn counter,
│                           usage badge, compact badge, fallback try/catch
│
├── test/                   bun:test
│   ├── smoke.test.ts       kernel integration
│   ├── tools.test.ts       fs tools + permission matrix
│   ├── providers.test.ts   anthropic 429/context map, router fallback/C4/P2
│   └── hooks.test.ts       ask-mode, readonly, allow write_memory
│
├── docs/
│   └── ARCHITECTURE.md     ← file ini
│
├── .minicode/              runtime lokal (gitignored)
│   ├── sessions.db         riwayat chat
│   └── vector.db           embeddings memori
│
└── ../minicore/            KERNEL BEKU (tidak boleh disentuh)
    └── src/core/           STATE/MODEL/ACTION/LOOP, EventBus, ContextStore,
                            executor, budget, recovery, compaction — 148 tests
```

## Alur Data

```
prompt → CLI → Router(provider terbaik) → Kernel LOOP ⇄ Tools(fs/bash/git/memory/mcp/lsp/sub-agent)
                ↓ stream events                                    ↓ hasil terobservasi
         Ink/ANSI renderer ← EventBus                        ContextStore (auto-compaction)
```

## Layer Guard Keamanan (berlapis)

```
PermissionHandler (denylist/jail/.env) → validateArgs (JSON schema kernel) → executor (write serial) → tool execute
```

## Mode CLI

| Perintah | Fungsi |
|----------|--------|
| `minicode "prompt" [--tui] [--interactive]` | Jalankan agent |
| `minicode config add/list/remove/detect` | Kelola LLM provider |
| `minicode config mcp add/list/remove` | Daftarkan MCP server eksternal |
| `minicode config lsp add/list/remove` | Daftarkan language server |
| `minicode mcp serve [--all-tools] [--allow-all]` | Expose minicode sebagai MCP server |
| `minicode sessions list/export` | Riwayat sesi |

## Isolasi Sub-Agent (`delegate_task`)

1. **ContextStore** — session baru, history terpisah dari parent
2. **Signal** — `ctx.signal` parent diteruskan ke Pool queue & `session.run()` (cancel merambat)
3. **Budget** — `maxSteps` clamp 1..50; default explore=5, plan=15
4. **Memory** — `write_memory`/`forget_memory` difilter (tidak polusi vector DB global)
5. **Error** — gagal provider/run dikembalikan sebagai tool result `[sub-agent error] ...`
6. **Concurrency** — Pool(3); antrean reject saat signal abort

## Known Limitations

1. Verifikasi runtime penuh butuh `bun` (CI: `bun install --frozen-lockfile && bun test`)
2. `findSymbolPosition` LSP pakai first-occurrence teks — bisa nyasar komentar/import
3. MCP server v1: hanya tools (belum resources/prompts/batch)
4. Cleanup async via `process.on("exit")` tidak dijamin selesai — exit path normal sudah `await` eksplisit
