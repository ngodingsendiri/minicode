# Minicode User Guide

## Instalasi

```bash
git clone https://github.com/ngodingsendiri/minicode && cd minicode
bun install && bun link
```

**Prasyarat:** `bun >= 1.0`. Tidak perlu clone repo lain — kernel MiniCore di-vendor ke `vendor/minicore`. Setup wizard otomatis saat pertama `minicode`.

Opsional: `rg` (ripgrep) di PATH mempercepat tool `grep`. Tanpa `rg`, walker internal dipakai dengan hasil identik.

## Mode CLI

| Perintah | Fungsi |
|---|---|
| `minicode` | Mode interaktif (REPL) + wizard bila belum ada provider |
| `minicode "prompt"` | Sekali jalan (headless) |
| `echo "prompt" \| minicode` | Via pipe |
| `minicode exec "prompt" [--json]` | Headless CI — event JSONL + baris `{"type":"summary"}` di stdout |
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
| `--sandbox none` | Matikan sandbox otomatis (opt-out sadar, tanpa downgrade permission) |
| `--sandbox os` | Paksa OS-native: bubblewrap (Linux) / seatbelt (macOS). Sudah otomatis bila tersedia |
| `--ratelimit <rpm>` | Batas request LLM per menit (token bucket) |
| `--budget <usd>` | Batas biaya sesi; warn 80%, exit/break bila lewat |
| `--plan` | Read-only plan mode (tidak bisa edit file / bash) |
| `--allowlist` | Bash hanya perintah aman (git/bun test/bun run/npm run) |
| `--ask` | Tanya persetujuan setiap tool |
| `--allow-all` | Nonaktifkan semua sandbox (path jail tetap aktif) |
| `--model <name>` | Override model LLM (atau `providerId::model` paksa provider) |
| `--provider <id>` | Paksa provider id agnostik (tanpa ubah config; filter single) |
| `--resume <id>` | Lanjutkan sesi sebelumnya (full history, bukan teks dump) |
| `--timeout <ms>` | Hard deadline per run (default 900000 = 15 min; 0 = Infinity) |
| `--interactive` | Paksa mode REPL |

Di TUI, **Shift+Tab** memutar mode permission (`auto` → `ask` → `plan` → `allowlist`) dan benar-benar mengubah keputusan permission, bukan cuma label header.

## Environment Variables

| Variabel | Fungsi |
|---|---|
| `MINICODE_VERIFY_CMD` | Custom verify command (ganti `detectVerifyCommand`) |
| `MINICODE_BASH_ALLOWLIST` | Kustom allowlist bash (koma-pisah, ganti DEFAULT) |
| `MINICODE_SANDBOX` | Sandbox mode: `docker` \| `os` (alias `bwrap`/`seatbelt`) \| `none` |
| `MINICODE_SANDBOX_IMAGE` | Image Docker (default `node:22-alpine`) |
| `MINICODE_SANDBOX_MEMORY` | Memory cap (default `512m`) |
| `MINICODE_GREP_ENGINE` | `js` → paksa walker internal, jangan pakai ripgrep |
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

## Tool Penting

### `read_file` — paging bernomor

Output selalu diberi nomor baris (`12: const x = 1`) supaya rujukan ke `edit`/`apply_patch` akurat.

```
read_file({ path: "src/big.ts" })                    # 2000 baris pertama
read_file({ path: "src/big.ts", offset: 2001 })      # lanjutkan
read_file({ path: "src/big.ts", offset: 500, limit: 50 })
```

File di atas `READ_FILE_MAX_BYTES` (2 MB) **hanya** bisa dibaca dengan `offset`/`limit` — tanpa itu tool menolak alih-alih diam-diam memotong konteks yang model kira utuh. Footer memberi `offset` berikutnya bila masih ada sisa.

### `grep` — dua engine, hasil sama

`rg` dipakai bila ada di PATH (`--vimgrep --no-follow`, exclude `.git`/`node_modules`/dotdir), jika tidak walker internal. Keduanya menerapkan jail path dan secret-scrub yang sama, dan diuji memberi hasil identik. Paksa fallback dengan `MINICODE_GREP_ENGINE=js` (dipakai CI untuk menguji jalur itu).

Bila `rg` gagal (regex flavour beda, binary rusak), tool otomatis jatuh ke walker dan mencetak peringatan — bukan gagal total.

### `todo_write` / `todo_read` — rencana per sesi

Untuk task 3+ langkah. Kirim **seluruh daftar** setiap kali, bukan delta. Disimpan di `.minicode/todos/<sessionId>.json`.

```
todo_write({ todos: [
  { content: "baca schema", status: "completed" },
  { content: "tulis migrasi", status: "in_progress" },
  { content: "jalankan test", status: "pending" }
]})
```

Status: `pending` | `in_progress` | `completed` | `cancelled`. Hanya satu `in_progress` yang dipertahankan — sisanya dinormalisasi ke `pending` agar daftar punya satu fokus. Daftar dirender utuh di TUI dan output one-shot.

### `bash` — streaming & background

Foreground memancarkan progres inkremental (`provider:extension` kind `bash-output`), terlihat di `--verbose`. Untuk proses yang hidup melewati satu turn:

```
bash({ cmd: "bun run dev", background: true })   # → job id bg_xxxxxxxx
bash_output({ id: "bg_xxxxxxxx" })               # output BARU sejak baca terakhir
bash_kill({ id: "bg_xxxxxxxx" })                 # SIGTERM lalu SIGKILL
```

Batas: `BASH_BACKGROUND_MAX_JOBS` job hidup sekaligus; semua job dimatikan saat CLI keluar (tidak ada proses yatim). `background:true` **ditolak** saat `--sandbox` aktif — container/namespace ephemeral mati bersama call-nya, jadi janji isolasi tidak bisa dipenuhi untuk proses berumur panjang.

## MCP & LSP

**MCP:** `minicode config mcp add` untuk daftarkan server, lalu `mcp_list`/`mcp_call` tersedia. Tool dinamis `serverId.toolName` otomatis terdaftar. **Catatan izin:** semua tool MCP bertitik **selalu di-gate** — mode `auto` akan meminta konfirmasi sekali per tool (jawab `[a] Always` untuk persist ke allowlist); mode `readonly`/`plan`/`allowlist` menolaknya. Server terdaftar tidak mendapat wildcard auto-allow (proteksi supply-chain).

**LSP:** `minicode config lsp add` untuk daftarkan language server. Setelah terdaftar: `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_symbols`, `lsp_workspace_symbols`. LSP diagnostics juga otomatis di tool `edit`/`write_file` bila server terkonfigurasi.

## Verify & Self-Healing

`--verify` auto-detect perintah (typecheck → test → tsconfig). Setelah run utama, verify dijalankan. Bila gagal, agen diperintahkan memperbaiki (maks 3 siklus). Output error dibungkus dalam fence agar tidak terpengaruh prompt injection.

## Sandbox

**Aktif otomatis.** Sejak Fase 2, sandbox tidak lagi murni opt-in:

| Kondisi | Yang terjadi |
|---|---|
| bubblewrap (Linux) / seatbelt (macOS) tersedia | bash berjalan di dalamnya, tanpa perlu flag |
| tidak tersedia (termasuk **semua Windows**) | permission default turun ke `allowlist` + alasannya dicetak sekali |
| `--allow-all` / `--ask` / `--plan` / `--allowlist` diberikan | pilihan Anda dihormati, tidak ditimpa dan tidak ada peringatan |
| `--sandbox none` | opt-out sadar; tanpa downgrade, tanpa peringatan |
| `--sandbox docker` | container ephemeral (`--network none`, 512m, 1 CPU, `node:22-alpine`) |
| `--sandbox docker` tapi daemon mati | tidak berpura-pura terisolasi: turun ke `allowlist` + peringatan |

Docker **tidak** dipakai otomatis meski tersedia — menarik image dan menjalankan container tanpa diminta terlalu invasif untuk sebuah default.

### Lapisan perlindungan bash

1. **bash-guard ternormalisasi** (`src/policy/bash-guard.ts`) — quote pemisah kata dibuang dan assignment variabel sederhana disubstitusi **sebelum** pemeriksaan. Ini menutup kelas bypass, bukan pola individual:

   | Dulu lolos | Kenapa | Sekarang |
   |---|---|---|
   | `cat .e""nv` | regex melihat `.e""nv`, shell membaca `.env` | ditolak |
   | `X=.env; cat $X` | regex tak pernah melihat `.env` | ditolak |
   | `p=python3; $p -c 1` | regex tak melihat `python3 -c` | ditolak |
   | `node --eval "1"` | hanya `-e` yang di-regex | ditolak |
   | `env`, `set`, `export -p` | hanya `printenv` yang diblok | ditolak |
   | `curl -F file=@~/.ssh/id_rsa` | tak ada aturan upload | ditolak |
   | `bash <(curl x)` | tak ada aturan process substitution | ditolak |
   | `rm -rf ..` | pola lama hanya kenal `/` dan `~` | ditolak |

2. **Allowlist** (`--allowlist`, dan default bila tak ada sandbox) — hanya bentuk perintah read/build: `git status/diff/log/branch/show`, `bun test/run/x tsc`, `npm run/exec`, `npx`, `ls`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `which`, `echo`, `pwd`. Operasi tulis lewat shell (`mkdir`, `cp`, `mv`, `rm`, `touch`) **ditahan** — agent yang perlu menulis file punya `write_file`/`edit` yang ter-jail. Untuk `npm exec`/`npx`, arg tak boleh memuat ekspansi shell (`$`, backtick) atau redirection.

3. **Path jail** — realpath-based, berlaku bahkan saat `--allow-all`.

4. **Env scrub** — `sanitizeSpawnEnv` menghapus variabel berkata-kunci kredensial dari hasil merge final. Nama vendor telanjang tidak lagi ikut: `GITHUB_WORKSPACE`, `GITHUB_REF`, `GOOGLE_CHROME_PATH`, `REDIS_HOST`, `AWS_REGION` **tetap ada** (sebelumnya terhapus dan memecahkan build CI), sementara `GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`, `DATABASE_URL` tetap di-strip.

5. **web_fetch / web_search** — redirect manual 5 hop + DNS pinning 30s + body 2MB.

### Mengukur, bukan mengklaim

```bash
bun experiments/bash-bypass-probe.ts                  # mode auto
bun experiments/bash-bypass-probe.ts --mode allowlist
```

38 pola serangan + 15 perintah sah (guard anti-over-block). Exit 0 hanya bila **0 bypass dan 0 over-block**. Angka saat ini: 0/38 bypass di kedua mode.

> **Batas yang tetap jujur.** bash-guard adalah analisis statis atas bahasa Turing-complete. Command substitution dinamis (`$(curl ...)`), aritmetika shell, dan indirection berlapis tidak bisa diselesaikan tanpa mengeksekusi. Guard menaikkan biaya serangan; **sandbox OS/container yang memberi isolasi**. Untuk task benar-benar tak terpercaya, jalankan di Linux/macOS (bwrap/seatbelt otomatis) atau `--sandbox docker`.

## Plan Mode

`--plan` → read-only. Agen bisa membaca, mencari, merencanakan (`todo_read` tetap boleh), tapi tidak bisa menulis file, menjalankan bash, `todo_write`, atau memanggil sub-agent. Berguna untuk review dan planning sebelum eksekusi. Di TUI, Shift+Tab bisa memutar ke mode ini saat sesi berjalan.

## Budget

`--budget <usd>` → lacak biaya LLM. Peringatan 80% → kuning. Bila lewat budget: one-shot `exit(1)`, REPL `break` loop.

## Checkpoint & Undo

Setiap `edit`/`write_file` otomatis membuat checkpoint (pre-edit state, `atomicWriteText`). `/undo` mengembalikan file ke kondisi sebelum turn. `/redo` mengembalikan ke kondisi setelah turn. Checkpoint disimpan di `.minicode/checkpoints/` dengan cap **20** terbaru (`LIMITS.CHECKPOINT_MAX_COUNT`). Snapshot dibatasi `WORKSPACE_SNAPSHOT_LIMIT` file — untuk repo sangat besar, shadow-git terjadwal di PLAN_V4 Fase 3.1.

## Sessions

Sesi disimpan di `.minicode/sessions.db` (WAL). `minicode sessions list` untuk daftar. `--resume <id>` untuk melanjutkan dengan history penuh (termasuk `toolCallId`/`name`). Sesi basi dihapus otomatis setelah **30 hari** (`MINICODE_SESSION_TTL_DAYS=0` = simpan selamanya; nilai lain dalam hari). `minicode sessions purge` untuk menghapus manually.

## Repo Intelligence

System prompt otomatis memuat repo-map. **Implementasi nyata berbasis regex** (9 bahasa) dengan fallback LSP `workspace/symbol`; `src/repo/tree-sitter.ts` masih stub yang selalu mengembalikan `null` (keputusan implementasi-atau-hapus ada di PLAN_V4 Fase 3.2). Cache di `.minicode/repomap.json` (sig mtime). File diurutkan import-graph (60 files, 2.5k chars). `MINICODE_REPOMAP=regex` untuk skip LSP. Hashline edit `src/tools/hashline.ts` deterministik.

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
bun install            # sekali (butuh bun >=1.0; tanpa clone tambahan)
bun test               # offline/hermetic; live & docker di-skip otomatis
bun x tsc --noEmit     # tsc strict, mencakup src cli test bench scripts
bun run lint           # biome check
bun run gate:coverage  # gate coverage agregat (baris "All files")
bun run vendor:check   # vendor/minicore sinkron dengan ../minicore
bun run bench:smoke    # fake tasks, CI-safe
bun run bench --runs 2 # median 2 runs
minicode exec "prompt" --json       # headless CI (JSONL + summary di stdout)
MINICODE_GREP_ENGINE=js bun test test/phase1-tools.test.ts   # jalur grep fallback
MINICODE_LIVE=1 bun run test:live   # live E2E (butuh provider + API key)
```

Semua test hermetic (fetch di-mock, DB tmpdir) dan aman dijalankan berulang tanpa jaringan. Jumlah test tidak dicantumkan di sini — jalankan `bun test` untuk angka terkini.

## Troubleshooting

- **LSP tidak jalan:** `minicode config lsp add .ts --command typescript-language-server --args --stdio`. Pastikan server terinstall.
- **Docker sandbox:** `docker pull node:22-alpine`. Bila daemon mati, permission turun ke `allowlist` (bukan diam-diam tanpa isolasi).
- **Kenapa perintah saya ditolak padahal aman?** Kemungkinan mode default `allowlist` aktif karena tak ada OS sandbox. Pesan `[sandbox]` di awal run menjelaskannya. Pilih sendiri dengan `--allow-all` atau `--ask`, atau jalankan `bun experiments/bash-bypass-probe.ts` untuk melihat apa yang dianggap sah.
- **`--sandbox os` tidak berefek:** bubblewrap/seatbelt tidak ada di Windows. Pakai `--sandbox docker`, atau terima default `allowlist`.
- **Variabel env hilang di subprocess:** hanya yang berkata-kunci kredensial di-strip. `GITHUB_WORKSPACE`/`REDIS_HOST`/`AWS_REGION` seharusnya tetap ada sejak Fase 2; kalau variabel non-rahasia Anda ikut hilang, itu bug — laporkan nama variabelnya.
- **`grep` terasa lambat:** install `rg` (ripgrep). Cek jalur aktif dengan `MINICODE_GREP_ENGINE=js` untuk membandingkan.
- **File besar tak bisa dibaca:** pakai `offset`/`limit` di `read_file` — file >2 MB memang ditolak tanpa itu.
- **Background job tak jalan:** `background:true` ditolak saat `--sandbox` aktif; jalankan tanpa sandbox atau pakai foreground.
- **Verify tidak jalan:** set `MINICODE_VERIFY_CMD` atau `verifyCommand` di config.
- **Budget tidak akurat:** harga di `usage.ts` adalah estimasi rata-rata; biaya riil tergantung provider.
- **`bun install` gagal cari minicore:** pastikan `vendor/minicore` ada (ikut repo). Untuk sync ulang dari sumber butuh clone `../minicore` lalu `bun run vendor:minicore`.
