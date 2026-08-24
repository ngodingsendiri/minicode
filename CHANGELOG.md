# Changelog

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
