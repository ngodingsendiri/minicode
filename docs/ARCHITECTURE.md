# Arsitektur Minicode

> Coding agent minimal di atas kernel beku MiniCore. Ramping, clean, profesional — tidak menambah primitive, hanya layer agencode.

**Principle:** `minicore` core is frozen — only **additive backward-compatible** seams are allowed (optional `compactAsync` & `initialMessages`). Everything else as Tool / Policy / Provider here.

> Angka yang bisa dihitung mesin (jumlah test, tool, coverage) tidak ditulis di dokumen ini. Jalankan `bun test`, `bun run gate:coverage`, atau:
> `bun -e "import {allTools} from './src/tools/index.ts'; console.log(allTools.length)"`.
> Riwayat per versi: [CHANGELOG.md](../CHANGELOG.md). Roadmap aktif: [PLAN_V4.md](PLAN_V4.md).

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
│   ├── createPermissionHandler(auto|readonly|plan|allowlist|allow-all|ask)
│   ├── onPermissions seam → PermissionControl {setMode,getMode} untuk Shift+Tab di TUI
│   ├── minicodeEstimator chars/4 + estimateImageTokens helper
│   ├── cappedRecovery P2 clone retryAfter ≤30s (no mutasi)
│   └── parallelExecutor order-preserving (cap di src/constants.ts; fix reorder write→read)
│
├── src/config.ts — ~/.minicode/config.json + .minicode/config.json (merge local→akhir, validasi + atomic tmp+rename + chmod 600)
│   ├── ProviderEntry {id, baseUrl, apiKey, models[], providerHint} — id dedup hash 4char
│   ├── McpServerEntry {id, command, args[], env} — validasi
│   └── LspServerEntry {ext, command, args[], env} — normalizeExt
│
├── src/tools/ — daftar pasti di src/tools/index.ts (allTools)
│   ├── read_file.ts   nomor baris + offset/limit (paging file besar), 2MB cap non-paged, jail + SENSITIVE_RE
│   ├── write_file.ts  mkdir -p, jail + sensitive block
│   ├── edit.ts        fuzzy 4-level (exact/CRLF/trimmed/indent) + hashline, jail
│   ├── patch.ts       apply_patch SEARCH/REPLACE multi-hunk (a la Aider), fuzzy match
│   ├── glob.ts        walk ignore .git/node_modules, limit 500, brace {a,b}
│   ├── grep.ts        ripgrep bila ada di PATH (--vimgrep, jail per-baris) + fallback walker; MINICODE_GREP_ENGINE=js
│   ├── bash.ts        30s timeout, SIGTERM→SIGKILL(2s), abort-aware, env-strip, progres streaming,
│   │                  background:true → bash_output/bash_kill (cap job, reap, kill saat CLI exit), sandbox docker/os
│   ├── todo.ts        todo_write/todo_read — rencana per sesi di .minicode/todos/<id>.json (atomic)
│   ├── git.ts         git_status/diff/log (spawn + signal, abort)
│   ├── memory.ts      read/write/forget → MEMORY.md(append atomic 200k guard) + vector hybrid cwd-aware + forget tx
│   ├── task.ts        delegate_task (explore=5/plan=15, clamp 1..50, Pool(3), filter memory+todo_write+bash job, error→result)
│   ├── mcp_call.ts    mcp_list / mcp_call + dynamic server.tool
│   └── lsp.ts         lsp_diagnostics/definition/references/hover/symbols/workspace_symbols (\b)
│
├── vendor/minicore/ — KERNEL HASIL SYNC (jangan edit langsung)
│   └── di-sync dari ../minicore via scripts/vendor-minicore.ts; CI gate `vendor:check`
│
├── src/providers/
│   ├── anthropic.ts   SSE streaming, pendingTools per-stream, 429→30s, prompt caching ephemeral, cache token usage, baseUrl /v1 normalize, tool_result group
│   ├── detect.ts      GET /models hybrid Bearer + x-api-key, timeout 2.5s/attempt global 6s (LIMITS)
│   ├── build.ts       buildProviderList(cfg) — satu sumber bangun provider (hybrid), dipakai CLI+sub-agent
│   └── router.ts      route by model, fallback + substitusi model target, rate limiter, C4 base64 fix
│
├── src/policy/
│   ├── jail.ts        isPathOutsideRoot + isSensitive (SSH/AWS/npmrc/key/pem) — dipakai semua tool
│   ├── bash-guard.ts  inspectBashCommand — NORMALISASI dulu (stripQuotes + inlineSimpleVars)
│   │                  lalu periksa: menutup kelas bypass (quote-split, indirection var,
│   │                  flag panjang, env dump, upload-exfil, process-sub, rm destruktif)
│   ├── sandbox-policy.ts resolveSandbox — OS sandbox otomatis; tanpa isolasi → downgrade allowlist
│   ├── permission.ts  READONLY (+todo_read/mcp_list/lsp_*), INTERNAL_WRITE (todo_write/bash_output/bash_kill),
│   │                  FILE_WRITE, GATED delegate_task/mcp_call + semua nama bertitik,
│   │                  __setMode/__getMode (implementasi nyata, dipakai Shift+Tab), cwd jail
│   ├── context.ts     buildSystemPrompt + repo-map (loadRepoMap) + MAX 8000 chars
│   ├── compaction.ts  mechanical sync default + LLM async via compactWithLlm (seam kernel compactAsync)
│   ├── verifier.ts    runVerify + detectVerifyCommand + runWithSelfHeal (3 siklus) + appendLspDiagnostics
│   ├── scrub.ts       secret scrubber teks + SECRET_ENV_RE berbasis kata-kunci kredensial
│   │                  (nama vendor telanjang tak lagi memakan GITHUB_WORKSPACE dsb)
│   ├── ratelimit.ts   token bucket rate limiter (dipakai router)
│   ├── executor.ts    order-preserving; WRITE_TOOLS (path-lock) vs EXCLUSIVE_TOOLS (bash/memory/todo) + abortError
│   └── usage.ts       cost pricing + cache read/write tokens
│
├── src/repo/repomap.ts — extractSymbols (TS/Py/Go/Rust/Java/C), buildRepoMap, cache .minicode/repomap.json
├── src/sandbox/docker.ts — runInDocker ephemeral (--network none, mem/CPU cap), path mount Windows
├── src/sandbox/os.ts — bubblewrap (Linux) / seatbelt (macOS); tidak tersedia di win32
├── src/telemetry/trace.ts — .minicode/traces.jsonl (JSON per run)
│
├── src/memory/
│   ├── files.ts       MEMORY.md global+local, appendFile atomic + 200k guard
│   └── vector.ts      vector.db WAL+b busy_timeout, toBlob align-safe, LIMIT 500, embed timeout 3.5s, deleteMemoryByQuery SQL instr, localDir-aware
│
├── src/session/
│   ├── persistence.ts sessions.db WAL+b, persistence incremental, placeholder binary, toolCallId/name (resume sejati)
│   └── checkpoint.ts  pre+post snapshot per turn (undo/redo), jail path, cap 20, applySnapshots atomicWriteText
│
├── src/mcp/
│   ├── transport.ts   JSON-RPC newline stdio, pending+timeout, killSignal on close only, log JSON invalid
│   ├── client.ts      discover→initialize fallback, tools/list, wrap "{server}.{tool}" — stdio saja
│   └── server.ts      curated tools + resources/prompts, permission aktif, isError, ping, parse-error balas {id:null}
│
├── src/lsp/
│   └── client.ts      Content-Length framing, initialize, didOpen/didChange versioned, diagnostics poll, findSymbolPosition \b word-boundary, start-once guard
│
├── src/agents/pool.ts — semaphore 3, queue abort-aware
├── src/hooks/index.ts — allowlist.json, matchAllowlist colon-aware, promptAsk card y/n/a
├── src/skills/loader.ts — frontmatter quote-aware, render {{args}} single replace
│
├── src/tui/
│   ├── minimal/simple.ts      — one-shot logger (streaming markdown per-line; todo & bash-output aware)
│   ├── minimal/fullscreen.ts  — REPL alternate-screen pure ANSI (header·transcript·input·dropdown, kind "todo")
│   ├── minimal/screen.ts      — ?1049h enter/exit + resize + cursor
│   └── theme/diff/highlight/spinner/table/markdown — primitives ANSI (ANSI_PATTERN satu sumber)
│
├── bench/ — tasks.ts + runner.ts (resolve rate, steps, token, cost; --fake untuk CI, external tasks jail)
├── src/constants.ts — centralized LIMITS (file size, timeout, search limit, paging, todo, bg jobs)
├── src/app/ — provider-layer / rag-layer / tool-layer (setup orchestration)
├── scripts/ — coverage-gate.ts (gate agregat) · vendor-minicore.ts (sync + --check) · telemetry-gate.ts
├── test/ bun:test — hermetic/offline (live & docker di-skip otomatis)
│
├── .minicode/ (gitignored) — sessions.db / vector.db / allowlist.json / skills / checkpoints / todos / repomap.json / traces.jsonl
│
└── vendor/minicore/ KERNEL BEKU (hasil sync, jangan edit)
    └── src/core/ STATE/MODEL/ACTION/LOOP + EventBus/ContextStore/budget/recovery/compaction + seam compactAsync & initialMessages
```

## Alur Data

```
prompt → CLI (config+skills+RAG+resume) → Router → Kernel LOOP ⇄ Tools
                ↓                                           ↓
         EventBus → ANSI TUI (minimal/simple + fullscreen)   ContextStore (compaction)
                ↓
           sessions.db (persist tiap turn)
```

## Layer Guard (berlapis)

```
PermissionHandler (bash-guard ternormalisasi + jail realpath + cwd, allow-all tetap jail) → validateArgs (kernel) → executor (order-preserving, cap di src/constants.ts, antrean abort-aware, file-lock resolve+toLowerCase) → tool defense-in-depth → execute
bash: resolveSandbox → bwrap/seatbelt otomatis bila ada; tanpa isolasi nyata permission default turun ke allowlist (dinyatakan ke user, tidak diam-diam)
spawn env: sanitizeSpawnEnv(base, extra) — strip berbasis kata-kunci kredensial pada HASIL MERGE FINAL
file writes: atomicWriteText — tmp randomUUID + O_EXCL + 0600 + rename retry (Windows EPERM) — termasuk checkpoint applySnapshots
web_fetch: redirect manual ≤5 hop, isPrivateHost + DNS pinning (lookup+cache 30s) per-hop (CGNAT/mapped-IPv6/ULA/link-local), body hard-cap 2MB
```

`read_file/write_file/edit` punya jail ganda: `permission.ts` (realpath-based) + di dalam tool sendiri. `bash` → `SIGTERM` lalu `SIGKILL` 2 detik. `grep` menerapkan jail di kedua engine: walker memakai `realpath` per file, jalur ripgrep memvalidasi tiap baris hasil di `normalizeRgLine` (`--no-follow` + glob exclude `.git`/`node_modules`/dotdir).

**bash-guard: normalisasi sebelum pemeriksaan.** Denylist regex-atas-string-mentah trivially dilewati oleh hal yang shell anggap setara (`cat .e""nv`, `X=.env; cat $X`, `p=python3; $p -c 1`, `node --eval`). `bash-guard.ts` membuang quote pemisah kata dan menyubstitusi assignment variabel literal lebih dulu, lalu memeriksa bentuk ternormalisasi **dan** mentah. Postur diukur oleh `experiments/bash-bypass-probe.ts` (38 pola serangan + 15 perintah sah); saat ini 0 bypass / 0 over-block di mode `auto` dan `allowlist`. Batasnya jujur: ini analisis statis, jadi command substitution dinamis tetap butuh sandbox OS untuk ditahan.

## Mode CLI

| Perintah | Fungsi |
|---|---|
| `minicode "prompt" [--tui] [--interactive] [--ask] [--allow-all]` | Jalankan agent |
| `minicode exec "prompt" [--json]` | Headless CI — JSONL event stream + baris `{"type":"summary"}` di stdout |
| `minicode config add --baseUrl --apiKey [--id]` | Tambah provider (auto detect `GET /models`) |
| `minicode config mcp add <id> --command --args` | Daftarkan MCP lokal |
| `minicode config lsp add <ext> --command` | Daftarkan LSP per ekstensi |
| `minicode mcp serve [--all-tools]` | Jadi MCP server |
| `minicode skills list|show` | Lihat skill `/nama` |
| `minicode sessions list|export <id> [--jsonl]` | Riwayat |

Mode permission bisa diganti saat runtime lewat Shift+Tab di TUI — handle-nya datang dari seam `onPermissions` di `createMinicodeSession`, bukan dari `session.config` (kernel tidak mengeksposnya).

## Isolasi Sub-Agent

1. **ContextStore baru** — history terpisah
2. **Signal** — `ctx.signal` diteruskan ke Pool & `session.run()`
3. **Budget** `1..50` — `explore=5`, `plan=15`
4. **Filter state parent** — `write_memory`/`forget_memory`/`todo_write` dibuang (rencana & memori milik parent); `bash_output`/`bash_kill` juga dibuang karena job id milik parent
5. **Error → result** — tidak crash parent
6. **Pool(3)** — queue abort-aware

## Perubahan Penting (audit + hardening — 71 test)

* **Security v0.2** — auto mode perketat: `delegate_task`/`mcp_call` di-gate (prompt TTY / tolak non-TTY), wildcard MCP ditutup (tool dinamis hanya server terdaftar), denylist bash +11 regex (interpreter `-c/-e`, `base64|sh`, `printenv`, baca `.env`), **bash env kredensial di-strip**, jail terpusat `src/policy/jail.ts` + diterapkan juga di `glob`/`grep`
* **Core seam** — kernel minicore dibuka seam additif `compactAsync` (backward-compatible); LLM compaction ter-wire otomatis di loop dengan fallback mechanical
* **Session/Persistence** — WAL + `updated_at` + transaction, persistence **incremental append-only** (fallback rewrite saat history menyusut), content `Uint8Array` → placeholder, `vector` WAL align-safe LIMIT 500, `files` append atomic 200k guard
* **Config** — validasi schema, id dedup hash, merge local→akhir (router default benar), `remove --global/--local`
* **Providers** — router fallback `network` clone-error, anthropic `max_tokens` + usage message_delta, detect timeout 4s, build provider dedup `src/providers/build.ts`
* **Policy** — executor order-preserving (mixed step sequential, pure-read paralel, write di-cap; `bash`/memory/todo = EXCLUSIVE tanpa path-lock), usage anti double-count + cost dihitung saat get() dengan model efektif, compaction dedup getKeptCount + abort-aware
* **Tools** — grep dua engine (ripgrep + walker) dengan jail identik, glob `{a,b}`, git paralel Promise.all timeout 8s, bash cwd jail + env-sanitize + progres streaming + background job, `read_file` paging bernomor, todo per sesi, memory cwd-aware, task event-forward parent (cost tracking) + explore lsp/mcp_list
* **MCP/LSP** — transport circular-safe + backpressure + rl leak + log JSON invalid, parse-error balas `{id:null}` per spec; LSP KIND 26 + formatPos line:char + exit auto-restart + didClose cleanup
* **Hooks** — allowlist merge global+local atomic chmod600
* **Skills** — frontmatter `\n---` safe, recursive dir, slug name, `$ARGUMENTS`
* **CLI** — `--timeout` flag (0=Infinity), RAG all providers, promptArgs knownFlags only, resume cap 2000, readPrompt 500ms, arg-parsing dipecah `cli/args.ts` (testable)
* **TUI** — text cap 20k, args circular-safe, formatError `?? ""`, detach idempotent, transcript kind `todo`
* **Fase 0 (audit v0.7.0)** — `cmdName` ReferenceError yang mematikan semua slash builtin di TUI, `exec --json` yang tak pernah stream (`on(handler)` 1-argumen → `on("*")`), Shift+Tab permission placebo (`__setMode`/`__getMode` tanpa implementasi + seam `onPermissions`), `cli/`+`scripts/` masuk `tsconfig`
* **Fase 1** — vendor `minicore` (self-contained install + gate `vendor:check`), `read_file` offset/limit bernomor, `grep` ripgrep, `todo_write`/`todo_read`, `bash` streaming + background
* **Fase 2** — `bash-guard.ts` berbasis normalisasi (menutup kelas bypass quote-split/indirection/flag-panjang/env-dump/upload-exfil/process-sub/rm-destruktif), `sandbox-policy.ts` (OS sandbox otomatis, downgrade `allowlist` bila tak ada isolasi), `SECRET_ENV_RE` berbasis kata-kunci (berhenti memakan `GITHUB_WORKSPACE` dsb), allowlist diperluas ke perintah read/build yang sah

## Test Suite

`bun test` — offline/hermetic (fetch di-mock, DB di tmpdir, tanpa API key); live terpisah via `test:live`. Cakupan area: busy/abort/timeout/max_steps session + initialMessages seam, persistence incremental + binary placeholder + resume (toolCallId/name) + WAL capped + busy-retry, invalid config, router all-fail/clone + model substitution + rate limiter + image bytes utk anthropic (magic-byte sniff), deny-bypass varian + auto-gate delegate/mcp/registered-MCP + sensitive path + wildcard MCP, executor order+cap+abort-no-leak+prompt-abort antrean, symlink escape (realpath di permission layer), glob brace + cwd jail, grep include/null, bash cwd jail + env-sanitize + buffer cap streaming, vector roundtrip + SQL delete, pool cap/abort, LSP \b, allowlist merge, skills slug/$ARGUMENTS, formatError, usage double-count + cache cost + pricing per-segment, EventBus crash-isolation, compactAsync seam, verifier self-heal, repomap, scrub tanpa-whitelist + ratelimit, sandbox (skip tanpa docker), apply_patch, checkpoint undo/redo + jail, cli-args, markdown fence, tui-diff/table/theme, env-strip, ssrf-guard, executor-abort, lib-fs (atomic write O_EXCL), jail-realpath, bash-cap, router-image, trace, **cli-regression (slash builtin overlay, EventBus wildcard, permission setMode)**, **phase1-tools (read_file paging, kesetaraan dua engine grep, todo, background job, permission tool baru)**, **phase2-security (normalisasi bash-guard, 33 kelas bypass, 25 pola lama, 32 perintah sah anti-over-block, resolusi sandbox 10 skenario, SECRET_ENV_RE 45 nama variabel)**.

Gate CI: `bun run vendor:check`, `bun x tsc --noEmit` (mencakup `cli`/`scripts`/`experiments`), `bun run lint`, `bun test`, `bun run gate:coverage` (agregat baris "All files"), `bun test` dengan `MINICODE_GREP_ENGINE=js` (jalur fallback grep), `bun experiments/bash-bypass-probe.ts` untuk kedua mode (0 bypass / 0 over-block), `bench:smoke`, `gate:telemetry`.

## Known Limitations

Diperbarui setelah Fase 0–2 dari audit v0.7.0 — daftar ini disengaja jujur; perbaikan terjadwal ada di [PLAN_V4.md](PLAN_V4.md).

1. Butuh `bun` (`bun:sqlite` dipakai langsung). Symlink test skip di Windows tanpa privilege.
2. **MCP client hanya stdio** — belum SSE/Streamable HTTP, jadi server MCP remote tak terjangkau. Sisi *server* (`src/mcp/server.ts`) sudah punya `tools`/`resources`/`prompts`. → Fase 3.3.
3. **bash-guard adalah analisis statis.** Korpus 38 pola serangan kini 0 bypass, tapi command substitution dinamis (`$(curl ...)`), aritmetika shell, dan indirection berlapis tidak bisa diselesaikan tanpa mengeksekusi. Isolasi nyata datang dari sandbox OS/container, bukan dari guard.
4. **Windows tidak punya OS sandbox.** bubblewrap/seatbelt hanya Linux/macOS, jadi di Windows default turun ke `allowlist` — lebih ketat, dan sebagian perintah tulis lewat shell ditolak. Pakai `--sandbox docker` atau `--allow-all` bila memang perlu.
5. **`background:true` tidak bersandbox** — ditolak eksplisit saat `--sandbox` aktif, karena container/namespace ephemeral mati bersama call-nya.
6. **Git read-only** (`git_status/diff/log`); checkpoint memakai snapshot file (cap `WORKSPACE_SNAPSHOT_LIMIT`) + `spawnSync git status`, bukan shadow-git. → Fase 3.1, 4.2.
7. **`src/repo/tree-sitter.ts` adalah stub** yang selalu `return null`; repo-map nyata berbasis regex. → Fase 3.2 (implementasi atau hapus).
8. Auth hanya API key mentah — belum ada OAuth/device-code untuk provider dengan free tier. → Fase 4.1.
9. `vector.db` `LIMIT 500` — paging belum untuk memory >5k. `open()` SQLite masih sinkron per operasi (singleton pool = refactor berikutnya).
10. Benchmark `bench/runner.ts` butuh provider ber-API-key untuk hasil nyata (`--fake` hanya smoke).
11. `vendor/minicore` adalah salinan — mengeditnya langsung akan hilang saat `vendor:minicore`. Sumber kebenaran tetap repo `minicore`; publish ke npm masih opsi terbuka.
12. Lisensi **MIT** (lihat `LICENSE`) — dokumen lama menyebut EULA/proprietary, itu sudah tidak berlaku.
