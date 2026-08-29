# Minicode

Coding agent built on **MiniCore** (kernel di-vendor ke `vendor/minicore`, seam additif `compactAsync` + `initialMessages`).

MiniCore = kernel runtime `STATE/MODEL/ACTION/LOOP` (inti di-freeze; satu-satunya patch = seam additif backward-compatible). Minicode = layer agencode: tools FS/bash/git/memory/todo/MCP/LSP, sub-agents, skills, hooks ask, TUI minimal pure ANSI (alternate-screen, tanpa Ink/React), memory hybrid RAG, sessions sqlite, repo-map, verifier.

> Angka yang bisa dihitung mesin (jumlah test, tool, coverage) **tidak ditulis di sini** — jalankan `bun test`, `bun run gate:coverage`, atau lihat CI. Riwayat perubahan per versi ada di [CHANGELOG.md](CHANGELOG.md).

📖 **Lihat [docs/USAGE.md](docs/USAGE.md)** untuk panduan lengkap (config, flags, MCP/LSP, benchmark) · [docs/PLAN_V4.md](docs/PLAN_V4.md) untuk roadmap aktif.

## Hubungan
```
vendor/minicore (zero-dep — inti di-freeze; hanya seam additif `compactAsync` + `initialMessages` yang dibuka)
   ↑
minicode (coding-agent, depends file:./vendor/minicore — self-contained, tanpa sibling clone)
  ├─ src/tools/     → Tool fs/bash/git/memory/todo/task/mcp/lsp + symlink jail defense-in-depth
  ├─ src/agents/    → Pool concurrency 3 (sub-agent isolasi, abort-aware)
  ├─ src/hooks/     → allowlist merge global+local atomic chmod600 + promptAsk card [y/n/a]
  ├─ src/policy/    → permission auto|ask|readonly|plan|allowlist|allow-all, executor order-preserving,
  │                   compaction mechanical sync + LLM async (compactAsync seam kernel, fallback aman)
  ├─ src/providers/ → openai-compat + anthropic + router fallback rate_limit/server/network
  ├─ src/mcp/       → client stdio + Streamable HTTP/SSE (host privat ditolak) · server tools/resources/prompts
  ├─ src/lsp/       → client diagnostics/definition/references/hover/symbols (didClose cleanup)
  ├─ src/session/   → persistence sqlite + checkpoint shadow-git (tree, O(delta), HEAD user utuh)
  ├─ src/skills/    → loader recursive .minicode/skills/*.md ({{args}}/$ARGUMENTS, slug name)
  ├─ src/tui/       → minimal/simple+fullscreen (pure ANSI ?1049h) + theme/highlight/diff/spinner
  ├─ docs/          → ARCHITECTURE.md · PLAN_V4.md
  └─ cli/           → REPL (tab completion, multiline, history, slash commands), wizard, subcommands
```

## Quickstart
```bash
# sekali saja — install & setup (butuh bun >= 1.0, TANPA clone tambahan)
git clone https://github.com/ngodingsendiri/minicode && cd minicode
bun install && bun link

# sekarang jalan di mana aja:
minicode                # mode chat interaktif + wizard setup pertama kali
minicode "buat http server" --verbose   # sekali jalan
minicode auth login     # login OAuth device-code (tanpa API key)
minicode providers      # daftar gateway (tanpa LLM)
minicode models --match gemini  # cari model lintas provider
minicode sync           # refresh model baru dari semua provider
```

Kernel MiniCore di-vendor ke `vendor/minicore` (19 file, ~72 KB) sehingga repo ini self-contained. Sumber kebenaran tetap repo `minicore`; kontributor yang punya clone sibling `../minicore` menyinkronkan dengan `bun run vendor:minicore`, dan CI menjaga kesinkronan lewat `bun run vendor:check`.

Wizard & `/provider-add` menyajikan preset gateway (OpenAI, Anthropic, OpenRouter, DeepSeek, OpenCode Zen, Google, Ollama, Qwen, Groq, dll), API Key ter-masking, auto-detect models.

```bash
minicode --tui "refactor src/utils"     # TUI minimal alternate-screen (pure ANSI, tanpa Ink)
minicode --ask "deploy script"          # human-in-loop confirmation card
minicode --verify "fix bugs lalu typecheck"  # auto-verify + self-heal setelah run
minicode --sandbox docker "task"        # eksekusi bash dalam container ephemeral
minicode --sandbox none "task"          # matikan sandbox otomatis (opt-out sadar)
minicode --ratelimit 30 "task"          # batasi request LLM (rpm)
minicode "/review src/a.ts"             # skill slash-command
minicode exec "prompt" --json           # headless CI (JSONL stream + summary)
bun test                                # offline/hermetic (live & docker di-skip)
bun run test:live                       # E2E live (butuh config + jaringan)
bun run bench:smoke                     # benchmark smoke (tanpa API key)
bun experiments/bash-bypass-probe.ts    # ukur postur denylist bash (0 bypass = lulus)
```

## Tools
FS `read_file`(**nomor baris + offset/limit** — file besar dibaca per bagian, realpath jail, secret-scrubbed) `write_file`(atomic tmp→rename, mkdir) `edit`(unique+atomic, fuzzy CRLF/spasi + hashline) `apply_patch`(search/replace multi-hunk) · search `glob`({a,b}, cwd jail) `grep`(**ripgrep bila tersedia**, fallback walker internal; include filter, null-byte skip, scrub) · exec `bash`(30s SIGTERM→SIGKILL, cwd jail, env kredensial di-strip, **progres streaming**, **`background:true`** + `bash_output`/`bash_kill`, sandbox docker/os optional) · git `git_status/diff/log`(cwd jail, timeout 8s paralel) **`git_commit`**(di-gate; tanpa push/amend/reset) · web `web_fetch`(SSRF guard + DNS pinning) `web_search`(Tavily/DDG) · memory `read/write/forget_memory` (hybrid RAG WAL) · plan **`todo_write`/`todo_read`** (state per sesi di `.minicode/todos/`) · agents `delegate_task` (isolasi, pool 3, explore=readonly+lsp, event forward ke parent) · MCP `mcp_list` `mcp_call` (+dynamic `serverid.toolname`, hanya server terdaftar) · LSP `lsp_diagnostics/definition/references/hover/symbols/workspace_symbols`

Daftar pasti: `bun -e "import {allTools} from './src/tools/index.ts'; console.log(allTools.map(t=>t.name))"`

Catatan `grep`: `rg` dipakai otomatis bila ada di PATH. Paksa jalur fallback dengan `MINICODE_GREP_ENGINE=js`. Kedua jalur menerapkan jail + secret-scrub yang sama dan diuji memberi hasil identik.

Catatan `git_commit`: di-gate seperti `delegate_task` (persetujuan sekali di TTY, tolak di non-TTY). `push`/`amend`/`reset`/`rebase`/`checkout` **sengaja tidak disediakan** — sulit dibalikkan atau mempengaruhi remote. Pesan commit diteruskan sebagai argumen `-m`, jadi `$()` dan backtick di dalamnya tidak dieksekusi.

## Autentikasi

Dua jalur:

```bash
# 1. API key (seperti sebelumnya)
minicode config add --baseUrl https://api.openai.com/v1 --apiKey sk-…

# 2. OAuth device-code — tanpa API key, tanpa kartu kredit
minicode auth login          # tampilkan kode, buka URL, tunggu persetujuan
minicode auth status         # lihat kredensial + kapan kedaluwarsa
minicode auth logout <id>
```

Token OAuth disimpan di `~/.minicode/auth.json` (chmod 600), **bukan** di `config.json` — config sering ikut ter-commit sementara token adalah rahasia berumur pendek. Refresh berjalan otomatis dengan margin 60 detik, jadi login sekali cukup. Provider OAuth yang belum login dibuang dari daftar dengan peringatan alih-alih mengirim header kosong.

## Biaya & harga model

17 harga bawaan tersedia offline. Untuk cakupan lebih luas, tarik sendiri:

```bash
minicode pricing sync                 # 3.162 model dari models.dev (~213 KB cache)
minicode pricing status               # sumber yang aktif + umur cache
minicode pricing show claude-sonnet-4-5
```

**Tidak ada fetch otomatis** — jalur run biasa hanya membaca cache lokal. Request ke pihak ketiga saat startup menambah latensi dan membocorkan pola pemakaian tanpa diminta. Satu model id sering ditawarkan beberapa provider dengan harga berbeda (`qwen3-coder-plus` ada di 6 provider, dua di antaranya $0 karena paket berlangganan); overlay memakai **median** setelah membuang kandidat gratis, supaya `--budget` tidak diam-diam menganggap semuanya gratis.

## Providers (hybrid x-api-key + Bearer)
OpenAI-compat (OpenAI/OpenRouter/Ollama/vLLM/DeepSeek), Anthropic streaming tool_use cap 30s max_tokens configurable, Router fallback rate_limit/server/network clone-error + C4 base64 fix + P2 retryAfter cap. Detect `GET /models` timeout 4s. Config global+local merge (local prioritas) atomic write + chmod 600. Build provider terpusat di `src/providers/build.ts`.

## Policy & Memory
permission `auto|ask|readonly|plan|allowlist|allow-all` — bash guard **berbasis normalisasi** (`src/policy/bash-guard.ts`): quote pemisah kata dibuang dan assignment variabel sederhana disubstitusi **sebelum** pemeriksaan, jadi `cat .e""nv`, `X=.env; cat $X`, dan `p=python3; $p -c 1` tidak lagi lolos. Path jail sep-aware + **symlink realpath di permission layer**, `.env`/`.git/config`/`node_modules` deny; ask = allowlist glob merge global+local + TUI prompt persist. Mode bisa diganti runtime via Shift+Tab di TUI. Auto mode: `delegate_task`/`mcp_call`/**semua tool MCP bertitik** di-gate (prompt saat TTY, **tolak** tanpa TTY). Compaction: mekanikal sinkron default; **LLM async otomatis via seam kernel `compactAsync`**. Executor order-preserving: mixed step sequential, pure-read paralel, write di-cap, antrean abort-aware. Usage cost pricing longest-key **per-segment**. Sessions sqlite WAL capped + busy-retry, **persistence incremental** + placeholder binary. Vector hybrid WAL `0.7 cosine + 0.3 keyword`.

**Sandbox aktif otomatis.** Bila bubblewrap (Linux) atau seatbelt (macOS) tersedia, bash berjalan di dalamnya tanpa perlu flag. Bila tidak tersedia — termasuk **semua Windows** — permission default diturunkan ke `allowlist` dan alasannya dicetak sekali, karena lebih baik membatasi perintah daripada menjalankan apa pun sambil menampilkan label aman. Pilih sendiri dengan `--allow-all`/`--ask`, matikan dengan `--sandbox none`, atau pakai `--sandbox docker`.

Postur keamanan bash terukur, bukan diklaim: `bun experiments/bash-bypass-probe.ts` menjalankan 38 pola serangan (indirection variabel, quote-splitting, flag panjang, env dump, exfiltrasi upload, download-then-run, process substitution, akses kredensial, container escape, `rm` destruktif) plus 15 perintah sah sebagai guard anti-over-block. Hasil saat ini **0 bypass / 0 over-block** di mode `auto` dan `allowlist`. Batasnya tetap jujur: ini analisis statis, jadi command substitution dinamis (`$(...)`) tak bisa diselesaikan tanpa mengeksekusi — untuk itulah sandbox OS ada.

## Security Layers
```
PermissionHandler (bash-guard ternormalisasi + jail realpath + cwd) → validateArgs (kernel) → executor (order/cap/abort-aware) → tool realpath+atomic(O_EXCL) → execute
bash              → sandbox OS-native otomatis (bwrap/seatbelt) bila tersedia; tanpa itu default permission = allowlist
spawn env         → sanitizeSpawnEnv (strip kata-kunci kredensial di hasil merge final; GITHUB_WORKSPACE dsb TIDAK ikut terhapus)
config/allowlist  → atomic randomUUID tmp+rename + chmod 600 · MCP serve curated tools + permission aktif
web_fetch         → redirect manual ≤5 hop, DNS pinning per-hop, body hard-cap 2MB
```

## Skills
`.minicode/skills/**/*.md` (recursive) frontmatter `name/description` + body `{{args}}` atau `$ARGUMENTS`. Nama auto-slug (`My Skill`→`my-skill`). `minicode skills list/show`, prompt `/name args`.

## Verification & Benchmark
- **Auto-verify** (`--verify`): deteksi command (`typecheck` → `test` → `tsconfig`) atau `MINICODE_VERIFY_CMD`; loop self-heal maks 3 siklus.
- **Checkpoint shadow-git**: snapshot per turn sebagai SHA tree git — O(delta), tanpa cap jumlah file, `HEAD`/index Anda tak pernah disentuh, ref menunjuk *tree* sehingga tak muncul di `git log`. `.gitignore` dihormati (jadi undo mencakup yang dilacak git). Non-repo memakai fallback snapshot file.
- **Repo-map**: simbol per file (regex, 9 bahasa) di-cache `.minicode/repomap.json`, disuntik ke system prompt. Tree-sitter sengaja tidak dipakai — alasan terukur di `extractSymbolsAsync`.
- **Secret scrubber**: `sk-`, `ghp_`, `AKIA`, PEM, JWT, Bearer, `api_key=...` di-redact sebelum sampai ke LLM (read_file/bash/grep) — tanpa whitelist kata.
- **Telemetry**: `.minicode/traces.jsonl` — satu baris JSON per run (tokens, steps, cost, durasi); prompt di-scrub; **opt-out** `MINICODE_TELEMETRY=0`.
- **Benchmark**: `bun run bench` (butuh provider) / `bun run bench:smoke` (fake, untuk CI) → `bench/results.json` (resolve rate, steps, token, cost).

## Aturan
- Jangan mengubah perilaku `vendor/minicore/src/core/*` — direktori itu hasil sync, bukan tempat mengedit. Satu-satunya pengecualian: seam **additif & backward-compatible** (mis. field opsional `compactAsync`) yang dibuka dari repo `minicore` lalu di-sync ulang. Kalau butuh primitive baru, buktikan dulu tidak bisa sebagai Tool/Provider/Policy.
- P2/C4/C5 sisa minicore ditangani di sini sebagai policy/adapter agencode, bukan patch core.

## Pengujian

```bash
bun install                 # sekali (butuh bun >= 1.0; tanpa clone tambahan)
bun test                    # offline/hermetic; live & docker di-skip otomatis
bun test test/ssrf-guard.test.ts          # satu file spesifik
bun run typecheck           # tsc --noEmit (strict) — mencakup src cli test bench scripts
bun run lint                # biome check src cli test bench scripts
bun run lint:fix            # auto-fix format/lint
bun run gate:coverage       # gate coverage agregat (baris "All files")
bun run vendor:check        # pastikan vendor/minicore sinkron dengan ../minicore
bun run vendor:minicore     # sync ulang vendor (butuh clone sibling ../minicore)
bun run bench:smoke         # benchmark fake (tanpa API key, CI-safe)
MINICODE_GREP_ENGINE=js bun test test/phase1-tools.test.ts   # paksa jalur grep fallback
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
- `rg` opsional. Tanpa `rg`, `grep` memakai walker internal dengan hasil identik.

## Lisensi

**MIT License.** Bebas pakai, modifikasi, distribusi — lihat [LICENSE](LICENSE). Copyright (c) 2026 ngodingsendiri.

Lihat `docs/ARCHITECTURE.md` + `docs/PLAN_V4.md`.
