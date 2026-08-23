# Minicode

Coding agent built on **frozen MiniCore** (`../minicore` v0.1.0, 148 tests, FREEZE).

**v0.1.3** — audit 100% semua komponen (31 file), extreme test suite, security hardening (symlink escape, denylist bypass).

MiniCore = kernel runtime `STATE/MODEL/ACTION/LOOP` (tidak diubah lagi). Minicode = layer agencode lengkap: 20 tools, sub-agents, MCP/LSP, skills, hooks ask, Ink TUI, memory hybrid RAG, sessions sqlite.

## Hubungan
```
minicore (frozen, zero-dep, 16 modul)  ← tidak disentuh
   ↑
minicode (coding-agent, depends file:../minicore)
  ├─ src/tools/     → 20 Tool (fs/bash/git/memory/task/mcp/lsp) + symlink jail defense-in-depth
  ├─ src/agents/    → Pool concurrency 3 (sub-agent isolasi, abort-aware)
  ├─ src/hooks/     → allowlist merge global+local atomic chmod600 + promptAsk [y/n/a]
  ├─ src/policy/    → permission auto|ask|readonly|allow-all, executor order-preserving 8/2,
  │                   compaction mechanical sync (+LLM async helper), usage cost anti double-count
  ├─ src/providers/ → openai-compat + anthropic + router fallback rate_limit/server/network
  ├─ src/mcp/       → client/server/transport stdio (backpressure, circular-safe)
  ├─ src/lsp/       → client diagnostics/definition/references/hover/symbols (didClose cleanup)
  ├─ src/skills/    → loader recursive .minicode/skills/*.md ({{args}}/$ARGUMENTS, slug name)
  ├─ src/tui/       → renderer ANSI + ink.tsx (--tui, text cap 20k)
  ├─ docs/          → ARCHITECTURE.md
  └─ cli/           → tri-mode headless/interactive/TUI (--timeout flag)
```

## Quickstart
```bash
# sekali saja — install & setup (butuh bun >= 1.0)
git clone https://github.com/ngodingsendiri/minicode && cd minicode
bun install && bun link

# sekarang jalan di mana aja:
minicode                # mode chat interaktif + wizard setup pertama kali
minicode "buat http server" --verbose   # sekali jalan
```

Wizard pertama cuma minta Base URL (Enter = OpenRouter) + API Key, auto-detect models, tersimpan selamanya.

```bash
minicode --tui "refactor src/utils"     # Ink TUI
minicode --ask "deploy script"          # human-in-loop y/n/a
minicode --timeout 300000 "task panjang"
minicode "/review src/a.ts"             # skill slash-command
bun test                                # 59 tests
```

## Tools (20)
FS `read_file`(2MB+realpath jail) `write_file`(atomic tmp→rename, mkdir) `edit`(unique+atomic) · search `glob`({a,b}) `grep`(include filter, null-byte skip) · exec `bash`(30s SIGTERM→SIGKILL, cwd jail) · git `git_status/diff/log`(timeout 8s paralel) · memory `read/write/forget_memory` (hybrid RAG WAL) · agents `delegate_task` (isolasi, pool 3, explore=readonly+lsp, event forward ke parent) · MCP `mcp_list` `mcp_call` (+dynamic `serverid.toolname`) · LSP `lsp_diagnostics/definition/references/hover/symbols`(\b word-boundary)

## Providers (hybrid x-api-key + Bearer)
OpenAI-compat (OpenAI/OpenRouter/Ollama/vLLM/DeepSeek), Anthropic streaming tool_use cap 30s max_tokens configurable, Router fallback rate_limit/server/network clone-error + C4 base64 fix + P2 retryAfter cap. Detect `GET /models` timeout 4s. Config global+local merge (local prioritas) atomic write + chmod 600.

## Policy & Memory
permission `auto|ask|readonly|allow-all` — bash denylist 16 regex (`rm -rf /*`, `${HOME}`, fork bomb, curl|sh, shred, truncate, sudo rm), path jail sep-aware + **symlink realpath escape-check**, `.env`/`.git/config`/`node_modules` deny; ask = allowlist glob merge global+local + TUI prompt persist. Compaction mechanical sync (LLM async via `compactWithLlm`). Executor order-preserving: mixed step sequential, pure-read 8× parallel, pure-write cap 2. Usage cost pricing longest-key (deepseek/gpt-4.1/o1/o3/gemini). Sessions sqlite WAL `updated_at` + vacuum. Vector hybrid WAL `0.7 cosine + 0.3 keyword`, dim-mismatch safe.

## Security Layers
```
PermissionHandler (denylist+jail+cwd) → validateArgs (kernel) → executor (order/cap) → tool realpath+atomic → execute
config.json/allowlist.json → atomic tmp+rename + chmod 600 · MCP serve curated tools + permission aktif
```

## Skills
`.minicode/skills/**/*.md` (recursive) frontmatter `name/description` + body `{{args}}` atau `$ARGUMENTS`. Nama auto-slug (`My Skill`→`my-skill`). `minicode skills list/show`, prompt `/name args`.

## Aturan
- Jangan ubah `../minicore/src/core/*` — kalau butuh primitive baru, buktikan dulu tidak bisa sebagai Tool/Provider/Policy.
- P2/C4/C5 sisa minicore ditangani di sini sebagai policy/adapter agencode, bukan patch core.

Lihat `docs/ARCHITECTURE.md` + `../minicore/docs/MINICORE-FINAL-AUDIT.md`.
