# Arsitektur Minicode

> Coding agent minimal di atas kernel beku MiniCore. Ramping, clean, profesional — tidak menambah primitive, hanya layer agencode.

**Versi:** 0.2.0 — agencode produksi: verifier/self-heal, repo-map, secret scrubber, rate limiter, Docker sandbox, apply_patch, resume sejati, telemetry (128 test + bench).
**Prinsip:** `minicore` inti di-freeze — satu-satunya patch yang diizinkan adalah seam **additif backward-compatible** (mis. field opsional `compactAsync` & `initialMessages` di kernel). Semua perbaikan lain sebagai Tool / Policy / Provider di sini.

## Peta Pohon Komponen

```
minicode/
│
├── cli/index.ts — ENTRY POINT (headless / interactive / --tui)
│   ├── cli/args.ts                    # pure arg-parsing (getArg/promptFromArgs/readPrompt) — testable
│   ├── minicode "<prompt>"            → loadConfig → Router → RAG → MCP/LSP → createMinicodeSession → EventBus → persist
│   ├── config add|list|remove|detect       # provider OpenAI/Anthropic hybrid Bearer+x-api-key
│   ├── config mcp add|list|remove          # server lokal stdio
│   ├── config lsp add|list|remove          # language server per ekstensi
│   ├── skills list|show /<name>            # .minicode/skills/*.md
│   ├── mcp serve [--all-tools][--allow-all]# expose minicode sebagai MCP server ke AI lain
│   └── sessions list|export [--jsonl] [--resume <id>]
│
├── src/session.ts — factory sesi
│   ├── buildSystemPrompt(MEMORY.md+AGENTS.md+git ls-files async+MAX 8000, cwd jail)
│   ├── createPermissionHandler(auto|readonly|allow-all|ask)
│   ├── minicodeEstimator chars/4 + estimateImageTokens helper
│   ├── cappedRecovery P2 clone retryAfter ≤30s (no mutasi)
│   └── parallelExecutor order-preserving 8 / write 2 semaphore (fix reorder write→read)
│
├── src/config.ts — ~/.minicode/config.json + .minicode/config.json (merge local→akhir, validasi + atomic tmp+rename + chmod 600)
│   ├── ProviderEntry {id, baseUrl, apiKey, models[], providerHint} — id dedup hash 4char
│   ├── McpServerEntry {id, command, args[], env} — validasi
│   └── LspServerEntry {ext, command, args[], env} — normalizeExt
│
├── src/tools/ — 20 tools
│   ├── read_file.ts   2MB cap, jail + SENSITIVE_RE defense-in-depth
│   ├── write_file.ts  mkdir -p, jail + sensitive block
│   ├── edit.ts        fuzzy 4-level (exact/CRLF/trimmed/indent), jail
│   ├── patch.ts       apply_patch SEARCH/REPLACE multi-hunk (a la Aider), fuzzy match
│   ├── glob.ts / grep.ts  walk ignore .git/node_modules, limit 500, grep include→RegExp, scrub line
│   ├── bash.ts        30s timeout, SIGTERM→SIGKILL(2s), abort-aware, env-strip, Docker sandbox opsional
│   ├── git.ts         git_status/diff/log (spawn + signal, abort)
│   ├── memory.ts      read/write/forget → MEMORY.md(append atomic 200k guard) + vector hybrid cwd-aware + forget tx
│   ├── task.ts        delegate_task (explore=5/plan=15, clamp 1..50, Pool(3), filter memory, error→result, forward execution:started)
│   ├── mcp_call.ts    mcp_list / mcp_call + dynamic server.tool
│   └── lsp.ts         lsp_diagnostics/definition/references/hover/symbols (\b)
│
├── src/providers/
│   ├── anthropic.ts   SSE streaming, pendingTools per-stream, 429→30s, prompt caching ephemeral, cache token usage, baseUrl /v1 normalize, tool_result group
│   ├── detect.ts      GET /models hybrid Bearer + x-api-key, timeout 4s/5s per fetch
│   ├── build.ts       buildProviderList(cfg) — satu sumber bangun provider (hybrid), dipakai CLI+sub-agent
│   └── router.ts      route by model, fallback + substitusi model target, rate limiter, C4 base64 fix
│
├── src/policy/
│   ├── jail.ts        isPathOutsideRoot + isSensitive (SSH/AWS/npmrc/key/pem) — dipakai semua tool
│   ├── permission.ts  READONLY+=mcp_list+lsp_*, denylist 27 regex, GATED delegate_task/mcp_call, wildcard MCP ditutup, cwd jail
│   ├── context.ts     buildSystemPrompt + repo-map (loadRepoMap) + MAX 8000 chars
│   ├── compaction.ts  mechanical sync default + LLM async via compactWithLlm (seam kernel compactAsync)
│   ├── verifier.ts    runVerify + detectVerifyCommand + runWithSelfHeal (3 siklus) + appendLspDiagnostics
│   ├── scrub.ts       secret scrubber (sk-/ghp_/AKIA/PEM/JWT/Bearer/api_key) — read_file/bash/grep
│   ├── ratelimit.ts   token bucket rate limiter (dipakai router)
│   ├── executor.ts    order-preserving 8 / write 2 semaphore + abortError
│   └── usage.ts       cost pricing + cache read/write tokens
│
├── src/repo/repomap.ts — extractSymbols (TS/Py/Go/Rust/Java/C), buildRepoMap, cache .minicode/repomap.json
├── src/sandbox/docker.ts — runInDocker ephemeral (--network none, mem/CPU cap), path mount Windows
├── src/telemetry/trace.ts — .minicode/traces.jsonl (JSON per run)
│
├── src/memory/
│   ├── files.ts       MEMORY.md global+local, appendFile atomic + 200k guard
│   └── vector.ts      vector.db WAL+b busy_timeout, toBlob align-safe, LIMIT 500, embed timeout 3.5s, deleteMemoryByQuery SQL instr, localDir-aware
│
├── src/session/
│   ├── persistence.ts sessions.db WAL+b, persistence incremental, placeholder binary, toolCallId/name (resume sejati)
│   └── checkpoint.ts  pre+post snapshot per turn (undo/redo), jail path, cap 50
│
├── src/mcp/
│   ├── transport.ts   JSON-RPC newline stdio, pending+timeout, killSignal on close only, log JSON invalid
│   ├── client.ts      discover→initialize fallback, tools/list, wrap "{server}.{tool}"
│   └── server.ts      curated tools, permission aktif, isError, ping, parse-error balas {id:null}
│
├── src/lsp/
│   └── client.ts      Content-Length framing, initialize, didOpen/didChange versioned, diagnostics poll, findSymbolPosition \b word-boundary, start-once guard
│
├── src/agents/pool.ts — semaphore 3, queue abort-aware
├── src/hooks/index.ts — allowlist.json, matchAllowlist colon-aware, promptAsk card y/n/a
├── src/skills/loader.ts — frontmatter quote-aware, render {{args}} single replace
│
├── src/tui/
│   ├── renderer.ts    ANSI (default) + diff card + spinner + bash highlight
│   ├── ink.tsx        Ink React (--tui) split-view + token gauge + markdown fence
│   └── theme/diff/highlight/spinner/table/markdown — primitives ANSI
│
├── bench/ — tasks.ts + runner.ts (resolve rate, steps, token, cost; --fake untuk CI)
├── test/ bun:test — 128 test
│
├── .minicode/ (gitignored) — sessions.db / vector.db / allowlist.json / skills / checkpoints / repomap.json / traces.jsonl
│
└── ../minicore/ KERNEL BEKU
    └── src/core/ STATE/MODEL/ACTION/LOOP + EventBus/ContextStore/budget/recovery/compaction + seam compactAsync & initialMessages — 153 test
```

## Alur Data

```
prompt → CLI (config+skills+RAG+resume) → Router → Kernel LOOP ⇄ Tools
                ↓                                           ↓
         EventBus → ANSI / Ink TUI                  ContextStore (compaction)
                ↓
           sessions.db (persist tiap turn)
```

## Layer Guard (berlapis)

```
PermissionHandler (denylist+SENSITIVE_RE+jail+cwd) → validateArgs (kernel) → executor (order-preserving 8 / write 2 semaphore) → tool defense-in-depth → execute
```

`read_file/write_file/edit` punya jail ganda: `permission.ts` + di dalam tool sendiri. `bash` → `SIGTERM` lalu `SIGKILL` 2 detik. `grep` include filter + `glob` ignore `.git`.

## Mode CLI

| Perintah | Fungsi |
|---|---|
| `minicode "prompt" [--tui] [--interactive] [--ask] [--allow-all]` | Jalankan agent |
| `minicode config add --baseUrl --apiKey [--id]` | Tambah provider (auto detect `GET /models`) |
| `minicode config mcp add <id> --command --args` | Daftarkan MCP lokal |
| `minicode config lsp add <ext> --command` | Daftarkan LSP per ekstensi |
| `minicode mcp serve [--all-tools]` | Jadi MCP server |
| `minicode skills list|show` | Lihat skill `/nama` |
| `minicode sessions list|export <id> [--jsonl]` | Riwayat |

## Isolasi Sub-Agent

1. **ContextStore baru** — history terpisah
2. **Signal** — `ctx.signal` diteruskan ke Pool & `session.run()`
3. **Budget** `1..50` — `explore=5`, `plan=15`
4. **Memory filter** — `write_memory/forget_memory` dibuang
5. **Error → result** — tidak crash parent
6. **Pool(3)** — queue abort-aware

## Perubahan Penting (audit + hardening — 71 test)

* **Security v0.2** — auto mode perketat: `delegate_task`/`mcp_call` di-gate (prompt TTY / tolak non-TTY), wildcard MCP ditutup (tool dinamis hanya server terdaftar), denylist bash +11 regex (interpreter `-c/-e`, `base64|sh`, `printenv`, baca `.env`), **bash env kredensial di-strip**, jail terpusat `src/policy/jail.ts` + diterapkan juga di `glob`/`grep`
* **Core seam** — kernel minicore dibuka seam additif `compactAsync` (backward-compatible); LLM compaction ter-wire otomatis di loop dengan fallback mechanical
* **Session/Persistence** — WAL + `updated_at` + transaction, persistence **incremental append-only** (fallback rewrite saat history menyusut), content `Uint8Array` → placeholder, `vector` WAL align-safe LIMIT 500, `files` append atomic 200k guard
* **Config** — validasi schema, id dedup hash, merge local→akhir (router default benar), `remove --global/--local`
* **Providers** — router fallback `network` clone-error, anthropic `max_tokens` + usage message_delta, detect timeout 4s, build provider dedup `src/providers/build.ts`
* **Policy** — executor order-preserving (mixed step sequential, pure-read 8×, pure-write cap 2), usage anti double-count + cost dihitung saat get() dengan model efektif, compaction dedup getKeptCount + abort-aware
* **Tools** — grep include RegExp + null-byte skip, glob `{a,b}`, git paralel Promise.all timeout 8s, bash cwd jail + env-sanitize, memory cwd-aware, task event-forward parent (cost tracking) + explore lsp/mcp_list
* **MCP/LSP** — transport circular-safe + backpressure + rl leak + log JSON invalid, parse-error balas `{id:null}` per spec; LSP KIND 26 + formatPos line:char + exit auto-restart + didClose cleanup
* **Hooks** — allowlist merge global+local atomic chmod600
* **Skills** — frontmatter `\n---` safe, recursive dir, slug name, `$ARGUMENTS`
* **CLI** — `--timeout` flag (0=Infinity), RAG all providers, promptArgs knownFlags only, resume cap 2000, readPrompt 500ms, arg-parsing dipecah `cli/args.ts` (testable)
* **TUI** — text cap 20k, args circular-safe, formatError `?? ""`, detach idempotent

## Test Suite

128 test (`bun test` — 128 di minicode + 153 di minicore): busy/abort/timeout/max_steps session + initialMessages seam, persistence incremental + binary placeholder + resume (toolCallId/name), invalid config, router all-fail/clone + model substitution + rate limiter, deny-bypass 23 varian + auto-gate delegate/mcp + sensitive path + wildcard MCP, executor order+cap + abort-no-leak, symlink escape, glob brace + cwd jail, grep include/null, bash cwd jail + env-sanitize, vector roundtrip + SQL delete, pool cap/abort, LSP \b, allowlist merge, skills slug/$ARGUMENTS, formatError, usage double-count + cache cost, EventBus crash-isolation, compactAsync seam, verifier self-heal, repomap, scrub + ratelimit, sandbox (skip tanpa docker), apply_patch, checkpoint undo/redo + jail, cli-args, markdown fence, tui-diff/table/theme.

## Known Limitations

1. Butuh `bun` (`bun install && bun test`). Symlink test skip di Windows tanpa privilege.
2. MCP server v1 hanya `tools` (belum `resources/prompts`).
3. `vector.db` `LIMIT 500` — paging belum untuk memory >5k.
4. Bash security = regex denylist + env-sanitize + secret scrubber + **Docker sandbox opsional** (`--sandbox docker`) — sandbox default masih berbasis regex; pada Windows Docker butuh Docker Desktop + pull image.
5. Repo-map berbasis regex (bukan AST penuh) — akurat untuk simbol level-dasar; LSP `workspace/symbol` sebagai peningkatan berikutnya.
6. Resume sejati sudah ada (initialMessages); snapshot/kompaksi tetap via kernel.
7. Benchmark `bench/runner.ts` butuh provider ber-API-key untuk hasil nyata (`--fake` hanya smoke).
