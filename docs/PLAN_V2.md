# PLAN V2 — Penyempurnaan Minicode + MiniCore (Serap Kelebihan 9 CLI)

> Tujuan: ambil **semua kelebihan** Opencode, Claude Code, Codex CLI, Gemini CLI, Qwen CLI, Kiro CLI, Aider, Cursor CLI, Devin — tanpa merusak janji **MiniCore frozen**. Satu-satunya perubahan core = **seam additif backward-compatible** (`compactAsync` + `initialMessages` sudah ada).

Status audit 2026-08-28: **170 pass / 12 fail / 9 errors** — HEAD broken karena `minicore` stub `src/core/index.ts:1` dan `src/policy/executor.ts:3` `import {runCall} from "minicore/core/executor.ts"` tidak ada. **P0 = kembalikan core nyata.**

---

## 0. Prinsip Arsitektur

```
minicore frozen (STATE/MODEL/ACTION/LOOP + EventBus/ContextStore/budget/recovery/compaction)
   ↑  hanya seam additif opsional, fallback aman
minicode (23 tools, pool 3, MCP/LSP, TUI pure ANSI, RAG hybrid)
```

Aturan `README.md:92` : buktikan dulu tidak bisa sebagai Tool/Provider/Policy sebelum buka seam core.

---

## 1. Matriks Kelebihan yang Diserap

| Sumber | Kelebihan Spesifik | Diadopsi di Minicode sebagai | Modul Target | Prioritas |
|---|---|---|---|---|
| **OpenCode** | 75+ providers via Models.dev, Ollama local, Hashline deterministic edit, BubbleTea TUI 120fps, Oh-My-OpenAgent subagents, free BYOK | Provider registry universal + `provider::model` sudah ada `cli/provider-manager.ts`; tambah `ollama` preset + Hashline edit | `src/providers/presets.ts`, `src/tools/patch.ts`, `src/tui/minimal/fullscreen.ts` | P1 |
| **Claude Code** | SWE 80.8%, subagents Explore/Plan isolasi context, permission per-tool regex `Bash(npm test *)`, hooks pre/post, CLAUDE.md hierarki, Jupyter | Permission regex halus + subagent `explore=readonly+lsp` sudah ada `src/agents/pool.ts:31` `src/policy/permission.ts:128`; tambah hooks `src/hooks/index.ts` + memory hierarki | `src/policy/permission.ts`, `src/hooks/`, `src/memory/files.ts` | P1 |
| **Codex CLI** | Rust 45s, Landlock/seccomp + Seatbelt sandbox, `codex exec` JSON, GitHub Actions `@codex` | Sandbox OS-native tanpa Docker (seatbelt/bubblewrap/landlock adapter) + headless `minicode exec --json` | `src/sandbox/os.ts` (baru), `cli/commands.ts` | P0-P1 |
| **Gemini CLI** | 1M context, Google Search grounding, free 1k/day, checkpoints/resume, trusted folders | Compaction LLM async sudah ada `src/policy/compaction.ts:18`; perlu tree-sitter + search grounding + checkpoint branch | `src/policy/compaction.ts`, `src/tools/web_fetch.ts`, `src/session/checkpoint.ts` | P1 |
| **Qwen CLI** | Qwen3-Coder open-weight, murah, Apache2 | Preset `qwen` + local model via Ollama/vLLM | `src/providers/presets.ts` | P2 |
| **Kiro CLI** | Spec-driven (`spec.md` → steering → code), AWS steering | Skill `spec` + workflow `/spec-init` → `/spec-impl` | `src/skills/loader.ts`, `.minicode/skills/spec.md` | P1 |
| **Aider** | tree-sitter repo-map, git diff/apply deterministik, murah | Ganti regex 9 bahasa `src/repo/repomap.ts` ke tree-sitter wasm + benchmark | `src/repo/repomap.ts` | P0 |
| **Cursor CLI** | Bugbot PR review, headless `cursor-agent`, IDE native | `minicode review` skill + `minicode exec` CI mode + LSP diagnostics auto | `src/skills/`, `cli/args.ts` | P2 |
| **Devin** | Browser, deploy, long-horizon cloud, async | `delegate_task` long-running + persistence incremental sudah ada `src/session/persistence.ts`; tambah `minicode cloud` stub + browser tool opsional | `src/tools/task.ts`, `src/session/persistence.ts` | P3 |

---

## 2. Fase 0 — Stabilisasi Kritis (P0, 1-2 hari)

| # | Task | File | Definisi Selesai |
|---|---|---|---|
| 0.1 | **Kembalikan minicore nyata** — vendor stub `src/core/index.ts:1` diganti snapshot commit terakhir yang hijau (153 test). Jika tidak ada, `git submodule` atau copy `../minicore` versi tagged v0.1.0 | `../minicore/src/core/*`, `package.json:29` | `bun test` 243 pass (235+8 skip) hijau, `bun x tsc --noEmit` bersih |
| 0.2 | **Fix import broken** `src/policy/executor.ts:3` `runCall`, `src/policy/compaction.ts:1` `compact.ts`, `src/providers/build.ts` `minicore/providers/openai-compat.ts` — sync path ke core nyata | `src/policy/*`, `src/providers/*` | 0 error "Cannot find module 'minicore/...'" |
| 0.3 | **Lock engine** — `package.json:12` `bun >=1.0` + docs bun-only dipertegas, atau tambah `node` compat shim `bun:sqlite` → `better-sqlite3` fallback | `package.json`, `src/session/persistence.ts:1` | Install fresh clone tanpa `../minicore` tetap jalan |
| 0.4 | **Lisensi** — ganti `UNLICENSED` `package.json:7` ke `MIT`/`Apache-2.0` agar PR diterima | `LICENSE`, `package.json` | `gh api repos/:owner/:repo/license` valid |
| 0.5 | **Gate**: `scripts/telemetry-gate.ts` resolve-rate ≥0.3 sudah ada — aktifkan di CI | `.github/workflows/*` | CI merah jika gate gagal |

---

## 3. Fase 1 — Inti Keamanan & Repo Intelligence (P0, 3-5 hari)

### 1.1 Sandbox OS-native tanpa Docker (Codex-like)
* **Masalah:** `src/tools/bash.ts:30` hanya `MINICODE_SANDBOX=docker` — butuh Docker Desktop di Windows. Codex/Gemini pakai **Seatbelt (macOS) / bubblewrap / Landlock+seccomp (Linux)** tanpa Docker.
* **Plan:** Buat `src/sandbox/os.ts` adapter:
  ```ts
  export type OsSandbox = { available(): boolean; run(cmd:string, opts): Promise<{output,code}> }
  // impl: darwin→ seatbelt, linux→ bwrap --ro-bind / --unshare-net, win→ fallback docker
  ```
  Policy `src/policy/permission.ts:201` tetap jalankan jail `isRealPathOutsideRoot` sebelum sandbox — defense-in-depth `docs/ARCHITECTURE.md:119`.
* **DoD:** `minicode --sandbox os "rm -rf /"` terblock tanpa Docker; 3 test baru `sandbox-os.test.ts`.

### 1.2 Tree-sitter Repo-Map (Aider)
* **Masalah:** `src/repo/repomap.ts` regex — miss generic, decorator, import graph ranking lemah vs Aider tree-sitter.
* **Plan:** Tambah dep `web-tree-sitter` wasm (zero native build). Fallback regex jika wasm gagal load. Ranking tetap import-graph `repomap.ts:MAX_FILES 60`.
* **DoD:** `bench` + snapshot `repomap.test.ts` akurasi ≥95% pada fixture TS/Py/Go.

### 1.3 Hashline Edit Deterministik (OpenCode)
* **Masalah:** `src/tools/edit.ts` fuzzy 4-level + `src/tools/patch.ts` SEARCH/REPLACE — bisa partial write.
* **Plan:** Port `Hashline` dari OpenCode: hitung hash per line, edit via hunk hash, `O_EXCL` atomic `src/policy/../lib/fs.ts` sudah ada.
* **DoD:** `patch.test.ts` 100% pass + benchmark partial-write 0.

---

## 4. Fase 2 — Model & Provider Universal (P1, 3 hari)

| Task | Detail | File |
|---|---|---|
| **2.1 Registry Models.dev** | Sync `src/providers/presets.ts` (saat ini 6 preset) ke 75+ via `https://models.dev/api.json` cached 24h. Format `provider::model` sudah ada `cli/provider-manager.ts` | `src/providers/presets.ts`, `src/providers/detect.ts` |
| **2.2 Ollama local** | Preset `ollama` `baseUrl http://localhost:11434/v1` + `apiKey ollama` dummy, `GET /models` tetap `DETECT_*` `src/constants.ts:38` | `presets.ts`, `detect.ts:38` |
| **2.3 Tool grouping & cost** | `src/providers/router.ts` fallback sudah ada; tambah `tools_budget` hint per task (Qwen murah untuk explore, Claude mahal untuk plan) | `router.ts`, `src/agents/pool.ts` |
| **2.4 Qwen3-Coder preset** | Tambah `qwen` gateway Alibaba `https://dashscope.aliyuncs.com/compatible-mode/v1` | `presets.ts` |

---

## 5. Fase 3 — Context & Memory Selevel Gemini/Claude (P1, 4 hari)

### 3.1 1M Context via Compaction+Prompt Cache
* Sudah ada `src/policy/compaction.ts:18` `compactAsync` seam + `src/providers/anthropic.ts` prompt caching `ephemeral`. **Perbaiki:** `COMPACTION_LLM_TIMEOUT_MS 15s` `constants.ts:20` → adaptive (sisa budget), `contentToText` truncation `compaction.ts:132` 400→800 chars untuk faktualitas.
* Tambah `anthropic` prompt caching untuk system+repomap (hemat 50% token).

### 3.2 Search Grounding (Gemini)
* `src/tools/web_fetch.ts` sudah ada SSRF guard 5 hop + 2MB cap `constants.ts:45`. Tambah `google_search` tool (opsional) + `web_fetch` fallback ke `tavily` jika `GOOGLE_API_KEY` ada. Grounding tidak inject ke history tanpa verifikasi (anti prompt-injection).

### 3.3 Memory Hierarki (Claude CLAUDE.md)
* `src/memory/files.ts` + `src/policy/context.ts` `buildSystemPrompt` sudah merge MEMORY.md+AGENTS.md 8k. Ubah ke hierarki: `~/.minicode/MEMORY.md` → `.minicode/MEMORY.md` → `AGENTS.md` → `.minicode/rules/*.md` (mirip `CLAUDE.md` + `.claude/rules/`).

---

## 6. Fase 4 — UX/TUI Setara OpenCode/Claude (P1, 3 hari)

| Fitur | Inspirasi | Implementasi Minicode |
|---|---|---|
| **Shift+Tab mode live** `auto/ask/plan/allowlist` | OpenCode build/plan toggle | Sudah partial `cli/fullscreen-driver.ts`; polish header badge `src/tui/minimal/fullscreen.ts` |
| **Headless `minicode exec --json`** | Codex `codex exec`, Claude `claude -p` | `cli/commands.ts` tambah `exec` subcommand: `session.run` → JSONL events `docs/ARCHITECTURE.md:109` |
| **Trusted folders** | Gemini | `src/policy/jail.ts` tambah allowlist root di `config.json` `trustedFolders: string[]` |
| **Spec-driven** | Kiro | `.minicode/skills/spec.md` template `steering.md` → `requirements.md` → `design.md` → `tasks.md` (workflow 3 file) |
| **PR Review Bugbot** | Cursor | Skill `review` + `lsp_diagnostics` auto di `src/policy/verifier.ts:appendLspDiagnostics` |
| **Checkpoint branch** | Gemini/Cline | `src/session/checkpoint.ts` tambah `fork` (git-like) di samping `undo/redo` |
| **Voice input (opsional P3)** | Gemini | Stub `src/tui/voice.ts` via `whisper.cpp` local — low prio |

TUI tetap **pure ANSI** `src/tui/minimal/screen.ts:1049h` (tanpa Ink/React) — keunggulan vs OpenCode Go adalah zero-dep, trade-off perf diterima.

---

## 7. Fase 5 — Extensibility & Ekosistem (P2)

* **MCP resources/prompts** — `src/mcp/server.ts` saat ini tools only `docs/ARCHITECTURE.md:102`; tambah `resources` + `prompts` spec MCP 2025.
* **LSP workspace/symbol** — `src/lsp/client.ts` sudah `findSymbolPosition \b`; tambah `workspace/symbol` sebagai fallback repomap.
* **Skills marketplace** — `src/skills/loader.ts` recursive `.minicode/skills/*.md` sudah ada; tambah `minicode skills install <gh:owner/repo>` (git clone shallow).
* **Hooks pre/post tool** — `src/hooks/index.ts` sudah `allowlist.json` + `promptAsk`; tambah `hooks/pre_tool_use.js` `post_tool_use.js` mirip Claude `hooks` (konteks di `MINICODE_HOOK_CTX`).
* **CI mode** — `bench/runner.ts` `--fake` sudah CI-safe; tambah `minicode exec --ci --worktree` isolated (mirip Codex worktree).

---

## 8. Bagian Core — MiniCore Frozen: Seam Additif yang Diusulkan

> **Jika bisa sebagai Tool/Provider/Policy, jangan sentuh core.** Tabel berikut hanya yang *mustahil* di layer agencode.

| # | Seam (additif, optional) | Kenapa tidak bisa di Policy? | Signature usulan (backward-compatible) | Fallback jika tidak ada | Risiko |
|---|---|---|---|---|---|
| **C1** | `budgetHook` | Core `LOOP` perlu hentikan turn saat cost > budget tanpa polling di policy | `SessionConfig.budget?: { limitUsd:number, onExceeded:()=>RecoveryAction }` | Policy `src/session.ts:178` warning 80% tetap; core fallback ke `defaultRecoveryPolicy` | Rendah — opt-in field |
| **C2** | `permissionCacheInvalidation` | `permission.ts:106` cache allowlist perlu invalidasi saat `saveAllowlist` di tool lain — butuh event bus core | `EventBus.emit('permission:changed')` + `ContextStore` invalidation | Manual `allowlistCache=null` `permission.ts:141` menutup 90% kasus — **TUNDA, cukup Policy** | Sedang |
| **C3** | `sandboxPolicy` seam | Core `executor.ts` `runCall` spawn perlu hook sandbox OS tanpa ubah caller | `SessionConfig.sandbox?: { wrapSpawn(spawnOpts): SpawnOpts }` | `src/sandbox/os.ts` wrap di `bash.ts:46` menutup tanpa core — **TUNDA** | Rendah |
| **C4** | `initialMessages` ✅ sudah ada | Resume sejati butuh seeding history penuh — tidak bisa di tool | `SessionConfig.initialMessages?: Message[]` | Sudah implement `src/session/persistence.ts:loadSession` | Selesai |
| **C5** | `compactAsync` ✅ sudah ada `compaction.ts:18` | LLM async butuh `AbortSignal` + 15s cap — sync `compact()` block loop | `CompactionStrategy.compactAsync?(store, opts, signal)` | Fallback `mechanicalCompaction` `compaction.ts:25` | Selesai |
| **C6** | `checkpointBranch` | Branch butuh fork `ContextStore` + `sessions.db` copy-on-write atomic — di luar tool | `Session.fork(newId): Session` | `src/session/checkpoint.ts:applySnapshots` manual fork menutup — **TUNDA** | Sedang |
| **C7** | `subAgentBudget` | Pool 3 `src/agents/pool.ts:31` butuh budget terpisah per sub-agent (explore=5 plan=15 `constants.ts:32`) — core `LOOP` budget global bentrok | `delegate_task` opts `budget?: number` → `createSession({budget})` isolasi | Sudah isolasi via `isolation` `task.ts:filter memory` — **TUNDA** | Rendah |

**Keputusan:** **Tidak perlu buka seam baru di V2.** C1-C3,C6-C7 bisa ditutup sebagai Policy/Tool. Fokus V2 = **stabilkan core existing** (Fase 0) + **maksimalkan layer agencode**. Seam baru hanya dibuka jika benchmark `bench/runner.ts` resolve-rate <0.5 setelah Fase 1-3.

### Jika tetap perlu seam (contingency)
Prosedur `README.md:92`:
1. Buktikan di `test/extreme.test.ts` tidak bisa sebagai Policy (tulis test gagal)
2. PR seam: field `optional` + `fallback aman` + `153 test` core tetap hijau
3. Bump `minicore` `0.1.0 → 0.1.1` seam additif, `minicode` pin `workspace:*`

---

## 9. Roadmap & Estimasi

```
Minggu 1: Fase 0 (P0 stabilisasi) + 1.1 sandbox OS + 1.2 tree-sitter → rilis 0.6.1
Minggu 2: Fase 2 (registry 75+) + Fase 3 (context/memory) → rilis 0.7.0
Minggu 3: Fase 4 (exec JSON, spec-driven, trusted folders) → rilis 0.8.0
Minggu 4: Fase 5 (MCP resources, skills install) + bench SWE-bench subset → rilis 0.9.0
Minggu 5: Hardening + docs + telemetry gate → 1.0.0
```

**KPI tiap rilis:**
* `bun test` 243/243 hijau, `typecheck` 0 error, coverage ≥90% `src/policy` `src/providers`
* `bench:smoke` + `bench --runs 2` delta resolve-rate ≥ +0.05
* `ssrf-guard` + `jail-realpath` + `executor-abort` test tetap hijau
* `bench/results.json` `resolveRate` target 0.6 (dari 0.59 live)

---

## 10. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Tree-sitter wasm bloat | Lazy import + fallback regex; `LIMITS.REPOMAP_MAX_FILE_BYTES 100k` tetap |
| OS sandbox butuh privilege | Auto-detect `available()` → fallback Docker → fallback regex denylist `permission.ts:30` |
| Registry Models.dev down | Cache 24h + preset statik 6 gateway sebagai fallback `presets.ts` |
| Core seam ditolak | Semua fitur V2 didesain Policy-first — core tetap frozen |
| Lisensi proprietary | Dual-license MIT untuk code, proprietary untuk brand |

---

## 11. Checklist Eksekusi Langsung

- [ ] 0.1 kembalikan `minicore` + hijau 243 test
- [ ] 1.1 `src/sandbox/os.ts` + `src/tools/bash.ts` integrate
- [ ] 1.2 `src/repo/repomap.ts` tree-sitter
- [ ] 1.3 `src/tools/patch.ts` Hashline
- [ ] 2.1 `src/providers/presets.ts` 75+ + Ollama
- [ ] 3.3 hierarki MEMORY.md
- [ ] 4 headless `minicode exec --json` `cli/commands.ts`
- [ ] 4 spec-driven skill `.minicode/skills/spec.md`
- [ ] 5 MCP resources `src/mcp/server.ts`

*Semua perubahan agencode — core frozen kecuali C1 jika terbukti perlu.*
