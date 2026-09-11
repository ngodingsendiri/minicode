# Changelog


## Unreleased — Review P0 + Minimalis (0.9.9)

- Jail simetris `move_file`/`delete_file` di permission layer; `MINICODE_SANDBOX_STRICT=1` fail-closed; allowlist `bun run`/`bun x` tolak ekspansi shell.
- `--budget-strict`, `step-traces.jsonl` + `minicode stats` deny-rate, `audit:harness` 60 cek, baseline-first `--verify`, `--tool-scope explore`, validasi resume.
- `config --cwd` diperbaiki (branch list/add mengabaikan `--cwd`); SWE docker per-era `bench/docker/` + `--docker`; run POSIX pertama (WSL) TOCTOU 1000× 0 lolos.
- Provider minimalis + auto-switch; thinking effort picker di `/model` (Enter = pilih + effort, Esc = batal total); effort anti-hilang.
- Hardening P0 review + terminal transient arbitration (single ownership `statusline.ts`) + audit CLI/UX menyeluruh.
- Docs: redesign `ARCHITECTURE.html`, kontrak FROZEN baru, `HARNESS.md` baru, `USAGE`/`PLAN`/`AGENTS` sinkron.

## 0.9.6 — Audit UX

Tab kosong toggle plan/build, did-you-mean (≤2), banner konteks, `/thinking on-off` (kini diganti picker Enter di `/model`), sync jujur `{updated,failed}`, doctor warn 0-model, error tunggal, sandbox notice tepat, `models --match` bersih, auth non-TTY fail-fast, English-only + regex penjaga, `/quit` dihapus, USAGE lengkap. Konsolidasi: `/cost` & `/usage` → `/status`, `/resume` → `/sessions`.

## 0.9.5 → 0.9.0

- 0.9.5: `submit_result` + `ask_user` (gated+DI), plan artifact, snippet verify, `branchSession`, TTL hierarkis + `access_count`, Responses chaining, `reasoningEffort` map, retry-after + coba-ulang-di-tempat, probe `/responses`, harness TUI 10/10, SWE-bench Lite pin, doctor, lint 0 warning.
- 0.9.4: side-map `thought_signature`, `code_run` tanpa shell, trash bersama, `read_image` utuh.
- 0.9.3: `code_run`/bash timeout tree-kill + regression 4 tools.
- 0.9.2: `--cwd` repo-wide, `O_NOFOLLOW`, pricing refresh, `max_tokens` 8192, `thought_signature`, 4 tools, memory kategori.
- 0.9.1: UI Shell-Max (`/copy` OSC52, Ctrl+R/J, statusline rich, wrap/table/diff/picker).
- 0.9.0: CLI flag-injection hardening + Memory/RAG P0-P2.

Detil V8/V7/V6 (hunter UI 31 temuan, uji live multi-provider, audit UI/UX) ada di `CHANGELOG.md`.
