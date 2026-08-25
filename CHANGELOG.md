# Changelog

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
