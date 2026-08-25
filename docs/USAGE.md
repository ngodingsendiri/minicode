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
| `minicode --tui "prompt"` | Ink TUI split-view |
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
| `--model <name>` | Override model LLM |
| `--resume <id>` | Lanjutkan sesi sebelumnya (full history, bukan teks dump) |
| `--timeout <ms>` | Hard deadline per run (default 600000, 0 = Infinity) |
| `--interactive` | Paksa mode REPL |

## Environment Variables

| Variabel | Fungsi |
|---|---|
| `MINICODE_VERIFY_CMD` | Custom verify command (ganti `detectVerifyCommand`) |
| `MINICODE_BASH_ALLOWLIST` | Kustom allowlist bash (koma-pisah, ganti DEFAULT) |
| `MINICODE_SANDBOX` | Sandbox mode: `docker` |
| `MINICODE_SANDBOX_IMAGE` | Image Docker (default `node:22-alpine`) |
| `MINICODE_SANDBOX_MEMORY` | Memory cap (default `512m`) |
| `MINICODE_REPOMAP` | `regex` → paksa repo-map regex (skip LSP) |
| `MINICODE_PLAN` | `1` → mode plan (tanpa `--plan`) |
| `MINICODE_PERMISSION` | `allowlist` → mode allowlist |
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

Ketik `/` di prompt → floating dropdown (max 10 item + `… N more`). `↑`/`↓` navigasi, `Tab` melengkapi, `Enter` melengkapi + submit, `Esc` tutup. Terminal lama tanpa ANSI: fallback inline hint.

| Command | Fungsi |
|---|---|
| `/help` | Daftar command + skill |
| `/providers` | Daftar provider + active model |
| `/provider-add` | Tambah provider — pilih preset (OpenAI/Anthropic/OpenRouter/DeepSeek/OpenCode Zen/Google) atau custom URL, auto-detect models |
| `/provider-remove <id>` | Hapus provider |
| `/models` | List model per provider (index = cepat pick) |
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

**MCP:** `minicode config mcp add` untuk daftarkan server, lalu `mcp_list`/`mcp_call` tersedia. Tool dinamis `serverId.toolName` otomatis terdaftar.

**LSP:** `minicode config lsp add` untuk daftarkan language server. Setelah terdaftar: `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_symbols`, `lsp_workspace_symbols`. LSP diagnostics juga otomatis di tool `edit`/`write_file` bila server terkonfigurasi.

## Verify & Self-Healing

`--verify` auto-detect perintah (typecheck → test → tsconfig). Setelah run utama, verify dijalankan. Bila gagal, agen diperintahkan memperbaiki (maks 3 siklus). Output error dibungkus dalam fence agar tidak terpengaruh prompt injection.

## Sandbox

- **Default:** regex denylist 27 + env-strip + secret scrubber.
- **`--sandbox docker`:** bash dieksekusi di container ephemeral (`--network none`, 512m, 1 CPU, `node:22-alpine`). Image ditarik otomatis bila belum ada.
- **`--allowlist`:** bash hanya perintah dalam `DEFAULT_BASH_ALLOWLIST` (git, bun test, bun run, npm run, echo, ls, cat) atau `MINICODE_BASH_ALLOWLIST`.

## Plan Mode

`--plan` → read-only. Agen bisa membaca, mencari, dan merencanakan, tapi tidak bisa menulis file, menjalankan bash, atau memanggil sub-agent. Berguna untuk review dan planning sebelum eksekusi.

## Budget

`--budget <usd>` → lacak biaya LLM. Peringatan 80% → kuning. Bila lewat budget: one-shot `exit(1)`, REPL `break` loop.

## Checkpoint & Undo

Setiap `edit`/`write_file` otomatis membuat checkpoint (pre-edit state). `/undo` mengembalikan file ke kondisi sebelum turn. `/redo` mengembalikan ke kondisi setelah turn. Checkpoint disimpan di `.minicode/checkpoints/` dengan cap 50 terbaru.

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

`.minicode/traces.jsonl` — satu baris JSON per run (sessionId, timestamp, prompt, steps, tokens, cost, ok/error). Rotate keep 1000 baris.

## Troubleshooting

- **LSP tidak jalan:** `minicode config lsp add .ts --command typescript-language-server --args --stdio`. Pastikan server terinstall.
- **Docker sandbox:** `docker pull node:22-alpine`. Bila `dockerAvailable()` false, fallback ke bash langsung.
- **Verify tidak jalan:** set `MINICODE_VERIFY_CMD` atau `verifyCommand` di config.
- **Budget tidak akurat:** harga di `usage.ts` adalah estimasi rata-rata; biaya riil tergantung provider.
