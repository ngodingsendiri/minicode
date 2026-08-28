# Minicode

Coding agent built on **MiniCore** (`../minicore` v0.1.0, 153 tests — seam additif `compactAsync` + `initialMessages`).

**v0.6.0** — Fase 0-1 hardening: fix `renderer.ts` rekursi `wOut` crash, `allow-all` jail bypass (universal jail sebelum `allow-all`), `busy-spin` → `Atomics.wait` (vector/persistence), SSRF DNS pinning (lookup + cache 30s), executor file-lock normalize `resolve+toLowerCase`, checkpoint `atomicWriteText`, scrub `REDIS|GITHUB|GOOGLE|AZURE|SUPABASE`, `LIMITS` sync (`DETECT_GLOBAL_TIMEOUT_MS` 6s) — **243 test** hermetic (8 skip live/docker), klasik TUI siap dihapus di Fase 2.

**v0.5.1** — security hardening: env-sanitasi terpusat untuk semua spawn (bash/docker/MCP/LSP), MCP tools bertitik selalu gated (tanpa wildcard auto-allow), SSRF guard redirect-per-hop + body cap, atomic write O_EXCL di semua tool tulis, jail realpath di permission layer, executor antrean abort-aware, SQLite WAL capped + busy-retry, telemetry opt-in scrub (`MINICODE_TELEMETRY=0`), router image bytes utk anthropic, `/sync` invalidate cache, pricing per-segment, nol `as never/as any` produksi — **243 test** (8 skip live/docker).

**v0.4.0** — UI/UX overhaul: preset gateway (`/provider-add` pilih 6 gateway), `provider::model` routing, `/sync` auto-refresh models, dropdown suggestions grouped `COMMANDS/SKILLS`, `minicode providers|models|sync` tanpa LLM, transparansi fallback di summary, turn status line, budget prompt, `/resume` interaktif, error user-friendly, TTL configurable, Fase 1–6 plan (prompt engine pure + fuzz test, live test terpisah, CI fix, telemetry gate) — **197 test** (8 skip live/docker).

**v0.3.x** — hardening keamanan (allowlist mode, Docker sandbox, plan mode, budget enforce, secret scrubber, jail), repo-map (9 bahasa + LSP), self-heal `--verify`, resume sejati, apply_patch, checkpoint pre-turn, `minicode stats`, benching.

📖 **Lihat [docs/USAGE.md](docs/USAGE.md)** untuk panduan lengkap (config, flags, MCP/LSP, benchmark).

MiniCore = kernel runtime `STATE/MODEL/ACTION/LOOP` (inti di-freeze; satu-satunya patch = seam additif backward-compatible). Minicode = layer agencode lengkap: 23 tools, sub-agents, MCP/LSP, skills, hooks ask, TUI minimal pure ANSI (alternate-screen, tanpa Ink/React), memory hybrid RAG, sessions sqlite, repo-map, verifier.

## Hubungan
```
minicore (zero-dep, 16 modul — inti di-freeze; hanya seam additif `compactAsync` di-loop yang dibuka) ← perubahan additif saja, backward-compatible
   ↑
minicode (coding-agent, depends file:../minicore)
   ├─ src/tools/     → 23 Tool (fs/bash/git/memory/task/mcp/lsp) + symlink jail defense-in-depth
  ├─ src/agents/    → Pool concurrency 3 (sub-agent isolasi, abort-aware)
  ├─ src/hooks/     → allowlist merge global+local atomic chmod600 + promptAsk card [y/n/a]
  ├─ src/policy/    → permission auto|ask|readonly|allow-all, executor order-preserving 8/2,
  │                   compaction mechanical sync + LLM async (compactAsync seam kernel, fallback aman)
  ├─ src/providers/ → openai-compat + anthropic + router fallback rate_limit/server/network
  ├─ src/mcp/       → client/server/transport stdio (backpressure, circular-safe)
  ├─ src/lsp/       → client diagnostics/definition/references/hover/symbols (didClose cleanup)
  ├─ src/skills/    → loader recursive .minicode/skills/*.md ({{args}}/$ARGUMENTS, slug name)
   ├─ src/tui/       → minimal/simple+fullscreen (pure ANSI ?1049h) + theme/highlight/diff/spinner
  ├─ docs/          → ARCHITECTURE.md
  └─ cli/           → REPL (tab completion, multiline, history, slash commands), wizard, subcommands
```

## Quickstart
```bash
# sekali saja — install & setup (butuh bun >= 1.0)
git clone https://github.com/ngodingsendiri/minicode && cd minicode
bun install && bun link

# sekarang jalan di mana aja:
minicode                # mode chat interaktif + wizard setup pertama kali
minicode "buat http server" --verbose   # sekali jalan
minicode providers      # daftar gateway (tanpa LLM)
minicode models --match gemini  # cari model lintas provider
minicode sync           # refresh model baru dari semua provider
```

Wizard & `/provider-add` menyajikan preset gateway (OpenAI, Anthropic, OpenRouter, DeepSeek, OpenCode Zen, Google), API Key ter-masking, auto-detect models.

```bash
minicode --tui "refactor src/utils"     # TUI minimal alternate-screen (pure ANSI, tanpa Ink)
minicode --ask "deploy script"          # human-in-loop confirmation card
minicode --verify "fix bugs lalu typecheck"  # auto-verify + self-heal setelah run
minicode --sandbox docker "task"        # eksekusi bash dalam container ephemeral
minicode --ratelimit 30 "task"          # batasi request LLM (rpm)
minicode "/review src/a.ts"             # skill slash-command
bun test                                # 189 offline test + 8 skip (live/docker)
bun run test:live                       # E2E live (butuh config + jaringan)
bun run bench:smoke                     # benchmark smoke (tanpa API key)
```

## Tools (23)
FS `read_file`(2MB+realpath jail, **secret-scrubbed**) `write_file`(atomic tmp→rename, mkdir) `edit`(unique+atomic, fuzzy CRLF/spasi) `apply_patch`(search/replace multi-hunk) · search `glob`({a,b}, cwd jail) `grep`(include filter, null-byte skip, scrub) · exec `bash`(30s SIGTERM→SIGKILL, cwd jail, **env kredensial di-strip**, **Docker sandbox optional**) · git `git_status/diff/log`(timeout 8s paralel) · memory `read/write/forget_memory` (hybrid RAG WAL) · agents `delegate_task` (isolasi, pool 3, explore=readonly+lsp, event forward ke parent) · MCP `mcp_list` `mcp_call` (+dynamic `serverid.toolname`, hanya server terdaftar) · LSP `lsp_diagnostics/definition/references/hover/symbols`(\b word-boundary)

## Providers (hybrid x-api-key + Bearer)
OpenAI-compat (OpenAI/OpenRouter/Ollama/vLLM/DeepSeek), Anthropic streaming tool_use cap 30s max_tokens configurable, Router fallback rate_limit/server/network clone-error + C4 base64 fix + P2 retryAfter cap. Detect `GET /models` timeout 4s. Config global+local merge (local prioritas) atomic write + chmod 600. Build provider terpusat di `src/providers/build.ts`.

## Policy & Memory
permission `auto|ask|readonly|allow-all` — bash denylist 27 regex (`rm -rf /*`, `${HOME}`, fork bomb, curl|sh, shred, truncate, sudo rm, `python -c`, `sh -c`, `base64|sh`, `printenv`, baca `.env`), path jail sep-aware + **symlink realpath di permission layer**, `.env`/`.git/config`/`node_modules` deny; ask = allowlist glob merge global+local + TUI prompt persist. Auto mode: `delegate_task`/`mcp_call`/**semua tool MCP bertitik** di-gate (prompt saat TTY, **tolak** tanpa TTY) — server terdaftar tidak mendapat wildcard auto-allow. Compaction: mekanikal sinkron default; **LLM async otomatis via seam kernel `compactAsync`** (bila `DEEPSEEK_API_KEY` diset — fallback mechanical bila LLM gagal/timeout). Executor order-preserving: mixed step sequential, pure-read 8× parallel, pure-write cap 2, antrean abort-aware. Usage cost pricing longest-key **per-segment** (wrapper model tak salah harga). Sessions sqlite WAL capped + busy-retry, **persistence incremental** + placeholder binary. Vector hybrid WAL `0.7 cosine + 0.3 keyword`, dim-mismatch safe.

## Security Layers
```
PermissionHandler (denylist+jail realpath+cwd) → validateArgs (kernel) → executor (order/cap/abort-aware) → tool realpath+atomic(O_EXCL) → execute
spawn env → sanitizeSpawnEnv (secret strip final-merge; bash/docker/MCP/LSP)
config.json/allowlist.json → atomic randomUUID tmp+rename + chmod 600 · MCP serve curated tools + permission aktif
web_fetch → redirect manual ≤5 hop, tiap host divalidasi, body hard-cap 2MB
```

## Skills
`.minicode/skills/**/*.md` (recursive) frontmatter `name/description` + body `{{args}}` atau `$ARGUMENTS`. Nama auto-slug (`My Skill`→`my-skill`). `minicode skills list/show`, prompt `/name args`.

## Verification & Benchmark
- **Auto-verify** (`--verify`): deteksi command (`typecheck` → `test` → `tsconfig`) atau `MINICODE_VERIFY_CMD`; loop self-heal maks 3 siklus.
- **Repo-map**: simbol per file (TS/Py/Go/Rust/Java/C) di-cache `.minicode/repomap.json`, disuntik ke system prompt.
- **Secret scrubber**: `sk-`, `ghp_`, `AKIA`, PEM, JWT, Bearer, `api_key=...` di-redact sebelum sampai ke LLM (read_file/bash/grep) — tanpa whitelist kata.
- **Telemetry**: `.minicode/traces.jsonl` — satu baris JSON per run (tokens, steps, cost, durasi); prompt di-scrub; **opt-out** `MINICODE_TELEMETRY=0`.
- **Benchmark**: `bun run bench` (butuh provider) / `bun run bench:smoke` (fake, untuk CI) → `bench/results.json` (resolve rate, steps, token, cost).

## Aturan
- Jangan mengubah perilaku `../minicore/src/core/*` — satu-satunya pengecualian: seam **additif & backward-compatible** (mis. field opsional `compactAsync`) yang dibuka dari layer agencode. Kalau butuh primitive baru, buktikan dulu tidak bisa sebagai Tool/Provider/Policy.
- P2/C4/C5 sisa minicore ditangani di sini sebagai policy/adapter agencode, bukan patch core.

## Pengujian

```bash
bun install                 # sekali (butuh bun >= 1.0 + sibling ../minicore)
bun test                    # offline: 243 test (235 pass + 8 skip live/docker)
bun test test/ssrf-guard.test.ts          # satu file spesifik
bun run typecheck           # tsc --noEmit (strict)
bun run lint                # biome check src cli test bench scripts
bun run lint:fix            # auto-fix format/lint
bun run bench:smoke         # benchmark fake 10 task (tanpa API key, CI-safe)
```

Test **live** (jaringan + provider ber-API-key):

```bash
MINICODE_LIVE=1 bun run test:live   # E2E end-to-end via LLM sungguhan
bun run bench                       # resolve-rate nyata (butuh config provider)
bun run test:qa                     # QA fitur live ke layar
```

Catatan lingkungan:
- `bun:sqlite` dipakai langsung → **wajib Bun**, tidak jalan di Node.js.
- Test symlink di-skip otomatis tanpa privilege; test Docker di-skip bila daemon tidak jalan.
- Semua test default **hermetic/offline** — fetch di-mock, DB pakai tmpdir, tanpa API key.

## Lisensi

**MIT License.** Bebas pakai, modifikasi, distribusi — lihat [LICENSE](LICENSE). Copyright (c) 2026 ngodingsendiri.

Lihat `docs/ARCHITECTURE.md` + `../minicore/docs/MINICORE-FINAL-AUDIT.md`.
