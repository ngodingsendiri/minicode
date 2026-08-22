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

## Tools (12, auto permission — write diizinkan langsung)
`read_file` (2MB), `write_file` (mkdir), `edit` (unique), `glob`, `grep`, `bash` (30s), `git_status/diff/log`, `read_memory`/`write_memory`/`forget_memory` (hybrid RAG, allow write).

## Providers (hybrid x-api-key + Bearer)
- OpenAI-compat (OpenAI/OpenRouter/Ollama/vLLM/DeepSeek) via `minicore`
- Anthropic `src/providers/anthropic.ts` (streaming tool_use, cap 30s)
- Router `src/providers/router.ts` + Detect `src/providers/detect.ts` — `GET /models` hybrid headers, auto `providerHint`, fallback, C4 base64 fix
- Config `src/config.ts` `~/.minicode/config.json` + `.minicode/config.json` — `minicode config add --baseUrl --apiKey --id` + `detect`

## Policy
- `src/policy/permission.ts` auto (readonly allow, write_memory allow, bash denylist `rm -rf /`, jail `cwd`, `.env` deny)
- `src/policy/context.ts` `minicodeEstimator` C5 + `MEMORY.md` `src/memory/files.ts` + `git ls-files`
- `src/policy/compaction.ts` LLM Tier-2 `deepseek v4 flash` (`deepseek-chat` via openai-compat, fallback mechanical) — `kind: llm:deepseek-chat`
- `src/policy/executor.ts` parallel 8 / write 2
- `src/policy/usage.ts` cost, `src/session.ts` P2 cap 30s

## Memory Hybrid RAG
`src/memory/vector.ts` sqlite `~/.minicode/vector.db` (local .minicode/ prioritas) `bun:sqlite`, `text-embedding-3-small` hybrid Bearer/x-api-key `vector.ts:55`, fallback keyword, `searchHybrid` 0.7+0.3, `addMemory` after `write_memory`, inject ke systemExtra `cli/index.ts:199`.

## TUI + Sessions
`src/tui/renderer.ts` efficient ANSI, `src/session/persistence.ts` sqlite `sessions.db` `save/load/list`, CLI `cli/index.ts` `--verbose --allow-all --max-steps --context-window --resume --interactive` + `sessions list/export` `config` hybrid.

## Aturan
- Jangan ubah `../minicore/src/core/*` — kalau butuh primitive baru, buktikan dulu tidak bisa sebagai Tool/Provider/Policy.
- P2/C4/C5 sisa minicore ditangani di sini sebagai policy/adapter agencode, bukan patch core.

Lihat `../minicore/docs/MINICORE-FINAL-AUDIT.md` untuk batas kernel.
