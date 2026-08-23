# Minicode

Coding agent built on **frozen MiniCore** (`../minicore` v0.1.0, 148 tests, FREEZE).

MiniCore = kernel runtime `STATE/MODEL/ACTION/LOOP` (tidak diubah lagi). Minicode = layer agencode lengkap: 20 tools, sub-agents, MCP/LSP, skills, hooks ask, Ink TUI, memory hybrid RAG, sessions sqlite.

## Hubungan
```
minicore (frozen, zero-dep, 16 modul)  ← tidak disentuh
   ↑
minicode (coding-agent, depends file:../minicore)
  ├─ src/tools/     → 20 Tool (fs/bash/git/memory/task/mcp/lsp)
  ├─ src/agents/    → Pool concurrency 3 (sub-agent isolasi)
  ├─ src/hooks/     → allowlist + promptAsk [y/n/a]
  ├─ src/policy/    → permission auto|ask|readonly|allow-all, compaction deepseek, executor 8/2, usage cost
  ├─ src/providers/ → openai-compat + anthropic + router + detect hybrid Bearer/x-api-key
  ├─ src/mcp/       → client/server/transport (stdio)
  ├─ src/lsp/       → client diagnostics/definition/references/hover/symbols
  ├─ src/skills/    → loader .minicode/skills/*.md (/name args)
  ├─ src/tui/       → renderer ANSI + ink.tsx (--tui)
  ├─ docs/          → ARCHITECTURE.md
  └─ cli/           → tri-mode headless/interactive/TUI
```

## Quickstart
```bash
bun install
bun test        # 24 tests (tools + providers + smoke + hooks + skills + persistence/vector)
bun run typecheck # clean
minicode config add --baseUrl https://openrouter.ai/api/v1 --apiKey sk-or-... 
bun cli/index.ts "buat http server" --verbose        # headless
bun cli/index.ts --interactive                        # REPL
bun cli/index.ts --tui "refactor src/utils"           # Ink TUI
bun cli/index.ts --ask "deploy script"                # human-in-loop y/n/a
bun cli/index.ts "/review src/a.ts"                   # skill slash-command
```

## Tools (20)
FS `read_file`(2MB) `write_file`(mkdir) `edit`(unique) · search `glob` `grep` · exec `bash`(30s abort trunc) · git `git_status/diff/log` · memory `read/write/forget_memory` (hybrid RAG) · agents `delegate_task` (isolasi, pool 3, explore=readonly) · MCP `mcp_list` `mcp_call` (+dynamic `serverid.toolname`) · LSP `lsp_diagnostics/definition/references/hover/symbols`

## Providers (hybrid x-api-key + Bearer)
OpenAI-compat (OpenAI/OpenRouter/Ollama/vLLM/DeepSeek), Anthropic streaming tool_use cap 30s, Router fallback rate_limit/server + C4 base64 fix + P2 retryAfter cap. Detect `GET /models`. Config global+local merge.

## Policy & Memory
permission `auto|ask|readonly|allow-all` — bash denylist (`rm -rf /`, fork bomb, curl|sh), jail cwd, `.env` deny; ask = allowlist glob + TUI prompt persist `.minicode/allowlist.json`. Compaction LLM Tier-2 deepseek v4 flash fallback mechanical. Executor parallel 8 / write 2. Usage cost pricing. Sessions sqlite `sessions.db` save/load/list/export/resume. Vector hybrid `vector.db` 0.7 cosine + 0.3 keyword, embedding hybrid headers.

## Skills
`.minicode/skills/*.md` frontmatter `name/description` + body template `{{args}}`. `minicode skills list/show`, prompt `/name args` expand otomatis, daftar di system prompt.

## Aturan
- Jangan ubah `../minicore/src/core/*` — kalau butuh primitive baru, buktikan dulu tidak bisa sebagai Tool/Provider/Policy.
- P2/C4/C5 sisa minicore ditangani di sini sebagai policy/adapter agencode, bukan patch core.

Lihat `docs/ARCHITECTURE.md` + `../minicore/docs/MINICORE-FINAL-AUDIT.md`.
