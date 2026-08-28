# Changelog

## [0.7.0] - 2026-08-29

### TUI & UX Polish — "Production Ready"
- **Theme-aware TUI** — `modeColor` dari semantic colors (`c.success` auto, `c.warning` plan, `c.info` ask), header responsive `<80 cols`, footer dynamic cost + hints
- **Input engine unified** — `decodeKeys` + `applyKey` dari `prompt-engine` single source, emoji 2-unit, bracket paste `\x1b[200~` support, Ctrl+O/R/Shift+Tab native key types
- **Diff cards** — `renderDiffCard` untuk edit/apply_patch (Ubuntu style +/−), ANSI-safe wrap via `formatWrapped`
- **Performance** — `RING_MAX 100→60`, spinner `setInterval→setTimeout` coalesce, diff repaint `prevOut` cache
- **Accessibility** — bracket paste `\x1b[?2004h`, mouse `\x1b[?1000h`, cursor restore on crash
- **Input fixes** — Tab/enter sel=-1 bug fix, case-insensitive matches, history via prompt-engine

### License
- **MIT License** — `UNLICENSED → MIT`, `private: false`, npm publish ready

### Security & Core
- **Minicore v0.1.1** — retryAfter cap 30s (`RETRY_AFTER_MAX_MS`) P2 fix
- **Extreme experiments** — fuzz/context/security all pass (257+154 tests)

## [0.6.0] - 2026-08-26

### UI/UX Overhaul - "Clean CLI"
- **Fullscreen Ink shell default** (`--ui auto|full|classic`): alternate-screen REPL terisolasi (ESC[?1049h/l) - header 1 baris (brand/model/mode/cost), transcript scrollable ring 200, status dots animasi, input dengan slash-dropdown, footer hint. Exit = terminal kembali bersih.
- **Ctrl+C lifecycle**: busy = hentikan turn saja (AbortController via kernel seam `session.run({signal})`); idle = 2x dalam 2 detik keluar bersih. Esc juga interrupt.
- **Mojibake Windows tuntas** - semua string konsol di-sweep ke ASCII-safe; prompt memakai `glyphs.prompt` (fallback `>` tanpa UTF-8).
- **Status line rapi** - kata "reasoning"/"working" dihapus (dots cukup); output tool tidak lagi menyisakan fragmen spinner (statusline suspend/resume).
- **Shift+Tab** cycle permission mode live (auto/ask/plan/allowlist) + badge header.
- **`/thinking on|off`** toggle tampilan reasoning (default off). `/init` generator AGENTS.md dari repo-map.
- **Ctrl+O** expand transcript; multiline `\`+Enter; edit keys Ctrl+U/W.
- **Bel terminal** saat permission request (ala OpenCode attention).
## [0.5.1] — 2026-08-26

### Security (P0)
- **Env sanitasi terpusat** — `sanitizeSpawnEnv()` dipakai semua spawn (bash/docker/MCP/LSP); secret (`*API_KEY/TOKEN/SECRET/DATABASE_URL`…) tidak pernah diwarisi container/server walau caller lupa strip; env eksplisit config tetap menang setelahnya.
- **MCP gating penuh** *(behavior change)* — mode `auto` tidak lagi auto-allow tool dari server MCP terdaftar; semua nama bertitik kini gated (prompt sekali + `[a] Always` persist). Menutup RCE supply-chain via server jahat.
- **SSRF web_fetch** — redirect ditangani manual (maks 5 hop) dengan re-validasi tiap host target; blok tambahan CGNAT 100.64/10, IPv4-mapped IPv6, fc00::/7, fe80::/10, `*.internal/.local/.localhost`; body dibaca dengan hard-cap 2MB (anti-OOM).
- **Scrubber tanpa whitelist** — kata `test/example/mock` tidak lagi melewati redaksi; secret yang mengandung substring itu tetap di-[REDACTED].

### Reliability
- **Executor abort-aware** — antrean write-slot & file-lock langsung reject saat abort (tidak lagi menunggu tool in-flight, bash bisa 30s); ownership handoff menjaga semaphore seimbang.
- **Atomic writes** — helper `atomicWriteText` (randomUUID tmp + `O_EXCL` + 0600 + rename retry utk Windows EPERM) dipakai write_file/edit/apply_patch/allowlist/config/checkpoint manifest.
- **Jail realpath di permission layer** — symlink keluar workspace tertangkap sebelum eksekusi tool; `SENSITIVE_RE` di-anchor per segmen (fix false-positive `my_node_modules*`) + cakupan baru (.git-credentials, credentials.json, secrets.yaml/yml/json, tfvars, .pfx/.jks).
- **SQLite** — WAL capped (`journal_size_limit`, `wal_autocheckpoint`) + retry SQLITE_BUSY untuk penulis konkuren.
- **Telemetry** — opt-out `MINICODE_TELEMETRY=0`, prompt di-scrub, chmod 0600, rotasi atomic.

### Correctness
- **Router image fix** — konten biner tool result tidak lagi di-base64-kan sebelum provider anthropic (image block media_type benar via magic-byte sniffing; fallback base64 untuk biner lain).
- **`/sync` benar-benar sync** — cache deteksi 30 menit di-invalidate saat refresh; timeout fetch per-attempt 2.5s.
- **CLI args** — `--verify` boolean (tak bocor ke prompt), dukung `--flag=value`, flag berulang terfilter semua (last-wins).
- **Pricing boundary match** — `my-gpt-4o-wrapper` tak lagi dihitung sebagai gpt-4o; varian versi (`gpt-4o-2024…`) tetap cocok.
- **Silent catch** — migrasi DB/purge/embedding/checkpoint korup kini mencetak `[warn]`.

### Engineering
- **LIMITS dipakai sungguhan** — 20 modul memakai konstanta terpusat (+15 key baru); duplikat magic number dihapus.
- **Type-safety produksi** — nol `as never`/`as any` di `src/ cli/`; `createMinicodeSession` menerima seam kernel secara type-safe.
- **dbPath dedup** — satu resolver untuk sessions.db & vector.db.

## [0.4.0] — 2026-08-25

### UI/UX (rencana Fase 5–6)
- **Preset gateway** — `/provider-add` & wizard: 6 preset (OpenAI/Anthropic/OpenRouter/DeepSeek/OpenCode Zen/Google) — baseUrl+fallback otomatis.
- **`provider::model` routing** — pilih provider spesifik; router first-match-wins untuk model kembar.
- **`minicode providers | models [id] --match <kw> | sync`** — kelola gateway tanpa LLM; `/sync` auto-sync model baru.
- **Dropdown suggestions** — floating grouped `COMMANDS`/`SKILLS` (header dimmed), max 10 + `… N more`; **bug fix name placeholder** (suggestion tidak lagi `/models [id]`).
- **Transparansi fallback** — summary turn & `/cost` menampilkan model/provider efektif saat router substitusi.
- **Turn status line** — spinner `· model · working…` (TTY), label berganti saat fallback.
- **Budget di prompt** — `minicode❯[62%]` saat `--budget`.
- **Error user-friendly** — kategori formal (`auth`/`rate_limit`/...) → pesan + fix, bukan dump JSON.
- **`/resume [id]` + `/sessions` bernomor** — resume sesi lewat picker.
- **Compaction faktual** — hasil tool sukses (isi file, output test) ikut di-LLM-summarized (bukan `<result omitted>`).

### Engineering
- **Prompt engine pure** (`cli/prompt-engine.ts`) + **fuzz test** (~93k asserts, 195 test total).
- **`test:live` terpisah** — `bun run test:live`; `bun test` default offline (8 skip).
- **CI fix** — checkout minicore sibling (dependency `file:../minicore`) + cache bun.
- **Telemetry gate** — resolve-rate ≥ 0.3 (live: 0.59); `scripts/telemetry-gate.ts`.
- **TTL configurable** — `MINICODE_SESSION_TTL_DAYS` (0=forever); `minicode sessions purge`.
- **Checkpoint prune** — 20 terbaru per session.
- **Detect cache** — 30 menit per baseUrl; lazy import ink/react (startup <400ms).
- **Cost attribution** — `deepseek-v4-flash` pricing; cost dihitung pakai model efektif.

## [0.3.2] — 2026-08-25

### UX Provider & Gateway
- **Preset gateway** — `/provider-add` & setup wizard: pilih OpenAI/Anthropic/OpenRouter/DeepSeek/OpenCode Zen/Google → baseUrl, fallback models & id ramah otomatis. Custom URL tetap bisa.
- **Pengelolaan tanpa LLM** — `minicode providers | models [id] | sync` subcommands langsung.
- **`/sync` & refresh models** — model baru dari gateway tersinkron otomatis; apiKey intak.
- **Scope global/local** — `/provider-add` tanya penyimpanan (global default ~/.minicode); `/provider-remove` hapus dari kedua scope.
- **Transparansi fallback** — `/cost` & `/status` menampilkan model efektif bila router substitusi.
- **Auto-refresh cap 6s** — deteksi gateway offline tidak membuat user menunggu 30s.
- **Plain text** — `--help` & wizard tanpa ANSI (aman console legacy).
- `/sessions` bernomor + `/resume [id]` picker interaktif (respawn dengan seeding penuh).

## [0.3.1] — 2026-08-25

### QoL / TUI
- **Floating dropdown** saat ketik `/` di REPL — dimmed, seleksi `›`, ↑/↓ navigasi, Tab/Enter complete, Esc tutup, max 10 + `… N more`. Fallback inline di console legacy (auto-detect ANSI via DSR probe).
- **Prompt engine** `cli/prompt-engine.ts` — state machine input jadi pure function (testable), input.ts cuma IO+render.
- Error user-friendly (balance/auth/rate/timeout/context) — tidak lagi raw JSON 401.
- Unknown `/command` tidak di-forward ke LLM.
- `/model` & `/models` jadi picker interaktif; format `providerId::model` untuk pilih provider spesifik.
- Router: first-match-wins untuk nama model kembar (fix 401 jatuh ke provider salah).

### Engineering
- `bun run test:live` — live E2E terpisah dari `bun test` default (CI-safe tanpa secrets).
- 20 test baru untuk prompt engine.
- Fix `glyphs.sparkle` missing (`--help` "undefined Minicode").
- `detectAnsi` — probe DSR idempotent, tidak ada listerner bocor.

## [0.3.0] — 2026-08-24

### Security
- **Allowlist mode** (`--allowlist`) — bash hanya perintah aman (git/bun/npm/echo/ls/cat) via `DEFAULT_BASH_ALLOWLIST` atau `MINICODE_BASH_ALLOWLIST`.
- **Docker sandbox hardening** — `--read-only`, `--cap-drop ALL`, `--pids-limit 128`, `--tmpfs /tmp`.
- **Plan mode** (`--plan`) — read-only planning (write/bash/delegate diblokir) + workflow "Proceed to execute?".
- **Budget enforce** (`--budget <usd>`) — warn 80%, exit(1) one-shot / break REPL bila lewat.
- **Secret scrubber** — 9 pola (sk-/AKIA/PEM/JWT/Bearer/api_key=) di read_file/bash/grep, whitelist `test|example|mock`.
- **Jail** — `.env`/`.git/credentials`/`.ssh`/`.aws`/`.npmrc`/`.netrc`/key/pem; path traversal di `/undo` diblokir.

### Core / Kernel (minicore, additive seams)
- `SessionConfig.initialMessages` — seed history penuh (resume sejati).
- `compactAsync` — LLM compaction async dengan fallback mekanikal.

### Context & Repo
- **Repo-map** — regex 9 bahasa (TS/Py/Go/Rust/Java/C/C#/Ruby/PHP), ranking import-graph, cache `.minicode/repomap.json`, fallback LSP `workspace/symbol`, env `MINICODE_REPOMAP=regex`.
- **Self-heal** (`--verify`) — auto-detect typecheck/test/tsconfig, 3 siklus, guard fence anti prompt-injection.

### TUI/TUX
- Split-view responsif (<80 col stack), markdown fence highlight, scroll arrow keys, budget gauge.
- `cli/index.ts` dipecah → `cli/setup.ts` + `cli/repl.ts` + entry tipis; format event terpusat `src/tui/format.ts`.

### Operasional
- `minicode stats` — agregasi `.minicode/traces.jsonl`.
- Benchmark — 5 task + loader external (SWE-bench-format) + delta antar run.
- Telemetry `.minicode/traces.jsonl` (rotate 1000).
- Sesi TTL 30 hari; checkpoint pre-turn workspace snapshot.

## [0.2.0] — 2026-08-24

- Hardening keamanan: auto-gate delegate/mcp, denylist 27 regex, env-sanitize, jail terpusat.
- TUI: diff card, table, spinner, markdown fence, masked wizard, history, tab completion.
- Prompt caching Anthropic, fuzzy edit 4-level, apply_patch, checkpoint `/undo`/`/redo`.
- Repo-map (regex), auto-verify, resume sejati, rate limiter, Docker sandbox, telemetry JSON.
- 132 test + bench harness.

## [0.1.3] — 2026-08-22

- Audit 100% komponen, extreme test suite, security hardening (symlink escape, denylist bypass).
- 59 test.
