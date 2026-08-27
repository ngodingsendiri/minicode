# Minicode User Guide

## Instalasi

```bash
git clone https://github.com/ngodingsendiri/minicode && cd minicode
bun install && bun link
```

**Prasyarat:** `bun >= 1.0`. Setup wizard otomatis saat pertama `minicode`.

## Mode CLI

| Perintah | Fungsi |
|---|---|
| `minicode` | Mode interaktif (REPL) + wizard bila belum ada provider |
| `minicode "prompt"` | Sekali jalan (headless) |
| `echo "prompt" \| minicode` | Via pipe |
| `minicode --tui "prompt"` | TUI minimal alternate-screen pure ANSI (tanpa Ink) |
| `minicode --provider <id> "prompt"` | Paksa provider agnostik tanpa ubah config (atau `provider::model`) |
| `minicode config add --baseUrl <url> --apiKey <key>` | Tambah provider LLM |
| `minicode config mcp add <id> --command <cmd> --args "<a1,a2>"` | Daftarkan MCP server |
| `minicode config lsp add <ext> --command <cmd> --args "<a1,a2>"` | Daftarkan LSP server |
| `minicode skills list` | Daftar skill terpasang |
| `minicode sessions list` | Riwayat sesi |
| `minicode mcp serve` | Ekspos minicode sebagai MCP server |

## Flags

| Flag | Deskripsi |
|---|---|
| `--verify` | Auto-verify + self-heal (detect: typecheck → test → tsconfig) |
| `--sandbox docker` | Eksekusi bash dalam container ephemeral (`--network none`) |
| `--ratelimit <rpm>` | Batas request LLM per menit (token bucket) |
| `--budget <usd>` | Batas biaya sesi; warn 80%, exit/break bila lewat |
| `--plan` | Read-only plan mode (tidak bisa edit file / bash) |
| `--allowlist` | Bash hanya perintah aman (git/bun test/bun run/npm run) |
| `--ask` | Tanya persetujuan setiap tool |
| `--allow-all` | Nonaktifkan semua sandbox |
| `--model <name>` | Override model LLM (atau `providerId::model` paksa provider) |
| `--provider <id>` | Paksa provider id agnostik (tanpa ubah config; filter single) |
| `--resume <id>` | Lanjutkan sesi sebelumnya (full history, bukan teks dump) |
| `--timeout <ms>` | Hard deadline per run (default 900000 = 15 min; 0 = Infinity) |
| `--interactive` | Paksa mode REPL |

## Environment Variables

| Variabel | Fungsi |
|---|---|
| `MINICODE_VERIFY_CMD` | Custom verify command (ganti `detectVerifyCommand`) |
| `MINICODE_BASH_ALLOWLIST` | Kustom allowlist bash (koma-pisah, ganti DEFAULT) |
| `MINICODE_SANDBOX` | Sandbox mode: `docker` |
| `MINICODE_SANDBOX_IMAGE` | Image Docker (default `node:22-alpine`) |
| `MINICODE_SANDBOX_MEMORY` | Memory cap (default `512m`) |
| `MINICODE_TIMEOUT_MS` | Default timeout (ms) bila `--timeout` tidak diset; `0` = Infinity |
| `MINICODE_REPOMAP` | `regex` → paksa repo-map regex (skip LSP) |
| `MINICODE_PLAN` | `1` → mode plan (tanpa `--plan`) |
| `MINICODE_PERMISSION` | `allowlist` → mode allowlist |
| `MINICODE_SESSION_TTL_DAYS` | TTL sesi (default 30; `0` = selamanya) |
| `MINICODE_TELEMETRY` | `0`/`false`/`off` → matikan penulisan traces.jsonl |
| `MINICODE_PROVIDER_ORDER` | Urutkan provider agnostik tanpa edit config: `openai,anthropic,deepseek` |
| `MINICODE_HOOKS` | `1` → jalankan hook global `pre/post-run` dari `~/.minicode/hooks/*.js` & `.minicode/hooks/*.js` (konteks di env `MINICODE_HOOK_CTX`) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` | Fallback API key |

## Config `.minicode/config.json`

```json
{
  "providers": [{ "id": "my-provider", "baseUrl": "...", "apiKey": "...", "models": ["gpt-4o"] }],
  "mcpServers": [{ "id": "my-mcp", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] }],
  "lspServers": [{ "ext": ".ts", "command": "typescript-language-server", "args": ["--stdio"] }],
  "verifyCommand": "bun run typecheck",
  "bashAllowlist": ["git status*", "bun test*", "npm run build*"]
}
```

Config global (`~/.minicode/config.json`) + local (`.minicode/config.json`) — merge dengan prioritas local.

## Slash Commands (REPL)

Ketik `/` di prompt → floating dropdown (max 10 item + `… N more`), ter-lookup grouped `COMMANDS` / `SKILLS` saat keduanya match. `↑`/`↓` navigasi, `Tab` melengkapi, `Enter` melengkapi + submit, `Esc` tutup. Terminal lama tanpa ANSI: fallback inline hint.

| Command | Fungsi |
|---|---|
| `/help` | Daftar command + skill |
| `/providers` | Daftar provider + active model |
| `/provider-add` | Tambah provider — pilih preset (OpenAI/Anthropic/OpenRouter/DeepSeek/OpenCode Zen/Google/**Generic Ollama**) atau custom URL, auto-detect models |
| `/provider-remove <id>` | Hapus provider |
| `/models [id] [keyword]` | List model per provider; keyword = filter substring (case-insensitive) |
| `/model [name]` | Picker interaktif semua provider·model. Format `providerId::modelName` paksa provider. E.g. `/model bai::deepseek-v4-flash` |
| `/undo` | Batalkan perubahan file terakhir (pre-edit state) |
| `/redo` | Terapkan ulang perubahan yang di-undo (post-edit state) |
| `/cost` | Lihat token & biaya sesi; tampilkan model efektif bila router substitusi (fallback) |
| `/sync` | Auto-refresh daftar model dari semua provider (model baru tersinkron) |
| `/sessions` | Daftar sesi terbaru (nomor = resume) |
| `/resume [id]` | Lanjutkan sesi (picker interaktif tanpa arg; respawn via `--resume`) |
| `/status` | Info runtime (model, provider, tools, skills) |
| `/history` | Riwayat prompt |
| `/clear` | Bersihkan terminal |
| `/exit` | Keluar |

## Skills

`.minicode/skills/*.md` dengan frontmatter `name` + `description`:

```markdown
---
name: review
description: Review code changes
---
Review this diff: {{args}}
```

Panggil: `/review src/a.ts` atau `minicode "/review src/a.ts"`.

## MCP & LSP

**MCP:** `minicode config mcp add` untuk daftarkan server, lalu `mcp_list`/`mcp_call` tersedia. Tool dinamis `serverId.toolName` otomatis terdaftar. **Catatan izin:** semua tool MCP bertitik **selalu di-gate** — mode `auto` akan meminta konfirmasi sekali per tool (jawab `[a] Always` untuk persist ke allowlist); mode `readonly`/`plan`/`allowlist` menolaknya. Server terdaftar tidak mendapat wildcard auto-allow (proteksi supply-chain).

**LSP:** `minicode config lsp add` untuk daftarkan language server. Setelah terdaftar: `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_symbols`, `lsp_workspace_symbols`. LSP diagnostics juga otomatis di tool `edit`/`write_file` bila server terkonfigurasi.

## Verify & Self-Healing

`--verify` auto-detect perintah (typecheck → test → tsconfig). Setelah run utama, verify dijalankan. Bila gagal, agen diperintahkan memperbaiki (maks 3 siklus). Output error dibungkus dalam fence agar tidak terpengaruh prompt injection.

## Sandbox

- **Default:** regex denylist 27 + env-strip (`sanitizeSpawnEnv` — secret tidak diwarisi proses/container) + secret scrubber.
- **`--sandbox docker`:** bash dieksekusi di container ephemeral (`--network none`, 512m, 1 CPU, `node:22-alpine`). Image ditarik otomatis bila belum ada. Env container juga disanitasi dari hasil merge final.
- **`--allowlist`:** bash hanya perintah dalam `DEFAULT_BASH_ALLOWLIST` (git, bun test, bun run, npm run, npm exec, npx, echo, ls, cat) atau `MINICODE_BASH_ALLOWLIST`. Untuk `npm exec`/`npx`, arg harus "known-good": tidak boleh ada ekspansi shell (`$`, backtick) atau redirection (`<`, `>`); chaining `;|&` sudah diblokir.
- **web_fetch:** redirect ditangani manual (maks 5 hop, tiap host divalidasi anti-SSRF); body hard-cap 2MB.

## Plan Mode

`--plan` → read-only. Agen bisa membaca, mencari, dan merencanakan, tapi tidak bisa menulis file, menjalankan bash, atau memanggil sub-agent. Berguna untuk review dan planning sebelum eksekusi.

## Budget

`--budget <usd>` → lacak biaya LLM. Peringatan 80% → kuning. Bila lewat budget: one-shot `exit(1)`, REPL `break` loop.

## Checkpoint & Undo

Setiap `edit`/`write_file` otomatis membuat checkpoint (pre-edit state, `atomicWriteText`). `/undo` mengembalikan file ke kondisi sebelum turn. `/redo` mengembalikan ke kondisi setelah turn. Checkpoint disimpan di `.minicode/checkpoints/` dengan cap **20** terbaru (`LIMITS.CHECKPOINT_MAX_COUNT`).

## Sessions

Sesi disimpan di `.minicode/sessions.db` (WAL). `minicode sessions list` untuk daftar. `--resume <id>` untuk melanjutkan dengan history penuh (termasuk `toolCallId`/`name`). Sesi basi dihapus otomatis setelah **30 hari** (`MINICODE_SESSION_TTL_DAYS=0` = simpan selamanya; nilai lain dalam hari). `minicode sessions purge` untuk menghapus manually.

## Repo Intelligence

System prompt otomatis memuat repo-map (simbol per file — regex 9 bahasa + LSP `workspace/symbol` fallback). Cache di `.minicode/repomap.json`. File diurutkan berdasarkan skor import-graph. `MINICODE_REPOMAP=regex` untuk skip LSP.

## Benchmark

```bash
bun run bench                            # butuh provider (resolve rate nyata)
bun run bench:smoke                      # --fake, untuk CI
bun run bench --tasks path/to/tasks.json # external tasks (SWE-bench-format)
```

Metrik: resolve rate, steps, token, cost, durasi. Delta terhadap run sebelumnya ditampilkan.

Format `tasks.json` (SWE-bench-format):

```json
[
  {
    "id": "fix-issue-1",
    "prompt": "Fix the bug in buggy.ts",
    "files": [{ "path": "buggy.ts", "content": "export function f(){ return 1 }" }],
    "verify": ["export function f()", "!return 1"]
  }
]
```

## Telemetry

`.minicode/traces.jsonl` — satu baris JSON per run (sessionId, timestamp, prompt, steps, tokens, cost, ok/error). Rotate keep 1000 baris (atomic tmp+rename). Prompt di-redact via secret scrubber sebelum disimpan; file chmod 600. **Opt-out:** set `MINICODE_TELEMETRY=0` — tidak ada file yang ditulis.

## Pengujian

```bash
bun install            # sekali
bun test               # offline: 243 test (235 pass + 8 skip live/docker)
bun run typecheck      # tsc strict
bun run lint           # biome
bun run bench:smoke    # benchmark fake, CI-safe
MINICODE_LIVE=1 bun run test:live   # live E2E (butuh provider + API key)
```

Test penting pasca-hardening v0.5.1: `env-strip`, `ssrf-guard`, `executor-abort`,
`lib-fs` (atomic write), `jail-realpath`, `bash-cap`, `router-image`, `trace`,
`cli-args`. Semuanya hermetic (fetch di-mock, DB tmpdir) dan aman dijalankan
berulang tanpa jaringan.

## Troubleshooting

- **LSP tidak jalan:** `minicode config lsp add .ts --command typescript-language-server --args --stdio`. Pastikan server terinstall.
- **Docker sandbox:** `docker pull node:22-alpine`. Bila `dockerAvailable()` false, fallback ke bash langsung.
- **Verify tidak jalan:** set `MINICODE_VERIFY_CMD` atau `verifyCommand` di config.
- **Budget tidak akurat:** harga di `usage.ts` adalah estimasi rata-rata; biaya riil tergantung provider.
