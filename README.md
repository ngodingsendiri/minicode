# Minicode

Coding agent built on **frozen MiniCore** (`../minicore` v0.1.0, 148 tests, 3a4f3fa FREEZE).

MiniCore = kernel runtime `STATE/MODEL/ACTION/LOOP` (tidak diubah lagi). Minicode = layer agencode: filesystem, shell, git, permission, LLM-compaction, memory, UI.

## Hubungan
```
minicore (frozen, zero-dep, 16 modul)  ← tidak disentuh
   ↑
minicode (coding-agent, depends file:../minicore)
  ├─ src/tools/  → Tool (read_file, bash, edit, git)
  ├─ src/providers/ → re-export openai-compat + future anthropic
  ├─ src/policy/ → permission interaktif, budget/compaction agencode
  └─ cli/        → TUI agencode
```

## Quickstart
```bash
bun install
bun test        # 12 tests (tools + providers + smoke)
bun run typecheck # clean
bun cli/index.ts "buat http server di src/server.ts" --verbose
```

## Tools (9, auto permission)
`read_file` (2MB guard), `write_file` (mkdir), `edit` (exact unique replace), `glob` (pattern), `grep` (regex), `bash` (30s, abort, 20k trunc), `git_status`/`git_diff`/`git_log`.

## Providers
- OpenAI-compat (OpenAI/OpenRouter/Ollama/vLLM) via `minicore`
- Anthropic `src/providers/anthropic.ts` (streaming, tool_use, retryAfter cap 30s)
- Router `src/providers/router.ts` — fallback `rate_limit/server`, C4 `Uint8Array→base64` fix, by model name

## Policy
- `src/policy/permission.ts` mode `auto` (allow readonly, denylist bash `rm -rf /`, fork bomb, jail `cwd`)
- `src/policy/context.ts` `minicodeEstimator` (C5 image `bytes*4/3`) + `buildSystemPrompt` (AGENTS.md + git ls-files)
- `src/session.ts` `createMinicodeSession` — P2 cap 30s

## TUI
`src/tui/renderer.ts` — event-driven `provider:text` streaming, `execution:*`, `context:compacted`, `usage` (efficient, no deps, ANSI).

## Aturan
- Jangan ubah `../minicore/src/core/*` — kalau butuh primitive baru, buktikan dulu tidak bisa sebagai Tool/Provider/Policy.
- P2/C4/C5 sisa minicore ditangani di sini sebagai policy/adapter agencode, bukan patch core.

Lihat `../minicore/docs/MINICORE-FINAL-AUDIT.md` untuk batas kernel.
