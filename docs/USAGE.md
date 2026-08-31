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
| `minicode --interactive` | REPL linier — agentic Unix shell, output mengalir ke scrollback |
| `minicode --provider <id> "prompt"` | Paksa provider agnostik tanpa ubah config (atau `provider::model`) |
| `minicode config add --baseUrl <url> --apiKey <key>` | Tambah provider LLM |
| `minicode config mcp add <id> --command <cmd> --args "<a1,a2>"` | Daftarkan MCP server stdio |
| `minicode config mcp add <id> --url <https://…>` | Daftarkan MCP server HTTP (Streamable HTTP/SSE) |
| `minicode config lsp add <ext> --command <cmd> --args "<a1,a2>"` | Daftarkan LSP server |
| `minicode auth login [provider]` | Login OAuth device-code (tanpa API key) |
| `minicode auth status\|logout\|list` | Kelola kredensial OAuth |
| `minicode pricing status\|sync\|show <model>\|clear` | Tabel harga untuk estimasi biaya |
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
| `MINICODE_THEME` | Tema aktif: `dark` \| `dim` \| `light` \| `mono` (juga lewat `--theme`) |
| `NO_COLOR` | Set apa pun selain `0` → matikan seluruh warna (mengalahkan tema) |
| `MINICODE_ASCII` | `1` → paksa glyph ASCII (`[OK]`, `>`, `.`) untuk konsol tanpa UTF-8 |
| `MINICODE_COMPACT` | `1` → tool call satu baris ringkas (default: expanded; juga `/compact`, Ctrl+O) |
| `MINICODE_JUSTIFY` | `0` → matikan rata kanan-kiri pada keluaran teks model |
| `MINICODE_DROPDOWN` | `0` → matikan floating dropdown, pakai hint inline (konsol legacy) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` | Fallback API key |

## Config `.minicode/config.json`

```json
{
  "providers": [{ "id": "my-provider", "baseUrl": "...", "apiKey": "...", "models": ["gpt-4o"] }],
  "mcpServers": [
    { "id": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] },
    { "id": "remote", "url": "https://mcp.example.com/mcp", "headers": { "authorization": "Bearer xxx" } }
  ],
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
| `/help` | Daftar perintah + skill + tombol penting |
| `/help tombol` | Daftar pintasan papan tombol lengkap |
| `/provider` | Kelola provider: tambah (`a`), hapus (`d`), ubah (`e`). Provider aktif ditandai `(aktif)`; konfirmasi hapus menyebut jumlah model yang ikut hilang |
| `/model [cari]` | Picker semua provider·model (bisa difilter). Format `providerId::modelName` memaksa provider |
| `/sync` | Segarkan daftar model dari semua provider |
| `/undo` | Batalkan perubahan berkas dari turn terakhir |
| `/redo` | Terapkan ulang perubahan yang dibatalkan |
| `/cost` | Pemakaian token & biaya **kumulatif sesi** (bukan turn terakhir); menampilkan model efektif bila router menyubstitusi |
| `/sessions` | Daftar sesi terbaru |
| `/resume [id]` | Lanjutkan sesi (picker tanpa argumen; respawn via `--resume`) |
| `/status` | Info runtime (ID sesi, model, provider, tool aktif, skill) |
| `/thinking [on\|off]` | Tampilkan/sembunyikan reasoning model |
| `/init` | Buat `AGENTS.md` untuk proyek ini |
| `/theme [nama]` | Ganti tema: `dark` \| `dim` \| `light` \| `mono` |
| `/clear` | Bersihkan transkrip di layar |
| `/exit` | Keluar |

Alias yang juga dikenali (tidak muncul di `/help`): `/models`, `/providers`, `/usage`, `/quit`, `/compact`, `/history`.

### Papan tombol (REPL)

| Tombol | Fungsi |
|---|---|
| `enter` | Kirim prompt |
| `shift+tab` | Putar mode permission (`auto` → `ask` → `plan` → `allowlist`) |
| `tab` | Lengkapi perintah dari dropdown (menghormati item yang sedang dipilih) |
| `↑` / `↓` | Jelajahi history, atau pilih item dropdown bila terbuka |
| `ctrl+t` | Tampilkan/sembunyikan reasoning model |
| `ctrl+o` | Putar tool call compact/expanded (juga `/compact`) |
| `←` / `→` | Geser kursor (editing di tengah baris) |
| `ctrl+a` / `ctrl+e` | Ke awal / akhir baris |
| `home` / `end` / `del` | Sama seperti di editor |
| `ctrl+w` | Hapus satu kata sebelum kursor |
| `ctrl+u` | Kosongkan baris |
| `esc` | Tutup dropdown / picker / manager |
| `ctrl+c` | Saat busy: hentikan turn; saat idle dua kali beruntun: keluar |
| `\` di akhir baris | Sambung ke baris berikutnya |

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

### `git_commit` — satu-satunya tool git yang menulis

```
git_commit({ message: "fix: null check", paths: ["src/a.ts"] })
git_commit({ message: "wip", all: true })   # semua file yang SUDAH dilacak git
```

**Di-gate** seperti `delegate_task`: mode `auto` meminta persetujuan sekali (TTY) atau menolak (non-TTY); `readonly`/`plan`/`allowlist` menolak. Sub-agent tidak mendapatkannya — commit adalah keputusan tingkat-task.

Yang **sengaja tidak** ada: `push`, `amend`, `reset`, `rebase`, `checkout`, `branch -D`, `stash drop`. Semuanya sulit dibalikkan atau mempengaruhi remote/repo orang lain.

Keamanan: pesan diteruskan sebagai satu argumen `-m` sehingga `$(...)` dan backtick di dalamnya **tidak dieksekusi**; `git add -- <paths>` memisahkan path dari opsi sehingga file bernama `-weird.txt` tidak jadi flag; path dan `cwd` dijail seperti tool lain. Bila tak ada perubahan, hasilnya pesan informatif — bukan exception.

## Autentikasi

Dua jalur, bisa dipakai bersamaan:

### API key

```bash
minicode config add --baseUrl https://api.openai.com/v1 --apiKey sk-…
```

### OAuth device-code (tanpa API key)

```bash
minicode auth list            # provider yang mendukung
minicode auth login qwen      # tampilkan kode → buka URL → tunggu persetujuan
minicode auth status          # kredensial + kapan kedaluwarsa
minicode auth logout qwen
```

Alurnya RFC 8628: minicode menampilkan kode singkat dan URL, Anda menyetujui di browser, minicode menyelesaikan sisanya. Tidak butuh redirect URI dan tidak membuka port lokal, jadi berfungsi lewat SSH.

**Di mana token disimpan:** `~/.minicode/auth.json` (chmod 600) — **bukan** `config.json`. Alasannya: `.minicode/config.json` lokal sering ikut ter-commit, sementara token adalah rahasia berumur pendek. Provider OAuth menyimpan `apiKey: ""` di config dan token diambil saat runtime.

Refresh otomatis dengan margin 60 detik sebelum kedaluwarsa, jadi login sekali cukup. Bila provider OAuth belum login (atau refresh gagal), provider itu **dibuang dari daftar dengan peringatan** alih-alih mengirim header kosong yang gagal dengan pesan membingungkan.

> **Catatan kejujuran:** mekanisme device flow diuji lengkap terhadap server OAuth lokal (18 test mencakup pending/slow_down/denied/expired/clamp), tapi nilai endpoint dan clientId provider belum dikonfirmasi lewat login sungguhan. Bila salah, `auth login` melaporkan error dari server apa adanya.

## Biaya & harga model

17 harga bawaan selalu tersedia offline. Untuk cakupan lebih luas:

```bash
minicode pricing sync                       # tarik models.dev (3.162 model, ~213 KB)
minicode pricing status                     # sumber aktif + umur cache
minicode pricing show claude-sonnet-4-5     # harga satu model + sumbernya
minicode pricing clear                      # hapus cache, kembali ke bawaan
```

**Tidak ada fetch otomatis.** Jalur run biasa hanya membaca cache lokal; request ke pihak ketiga saat startup menambah latensi dan membocorkan pola pemakaian (IP + waktu) tanpa diminta. Cache kedaluwarsa tetap dipakai dengan tanda — harga lama lebih berguna daripada "N/A".

Cara pencocokan: per-segmen (pemisah `/` dan `:`), kunci terpanjang menang. Jadi `deepseek/deepseek-chat:free` cocok, `claude-sonnet-4-5` menang atas `claude-sonnet-4`, dan `my-gpt-4o-wrapper` **tidak** cocok dengan `gpt-4o`.

Satu model id sering ditawarkan beberapa provider dengan harga berbeda — `qwen3-coder-plus` ada di 6 provider, dua di antaranya $0 karena paket berlangganan. Overlay membuang kandidat gratis bila ada yang berbayar, lalu mengambil **median**, supaya `--budget` tidak diam-diam menganggap semuanya gratis.

Semua angka tetap **estimasi**: biaya riil tergantung provider, paket, dan diskon.

## MCP & LSP

**MCP:** dua transport didukung.

```bash
# stdio — server lokal yang di-spawn minicode
minicode config mcp add fs --command npx --args "-y,@modelcontextprotocol/server-filesystem,."

# Streamable HTTP — server remote (spec 2025-03-26, SSE juga ditangani)
minicode config mcp add ctx7 --url https://mcp.example.com/mcp --header "authorization=Bearer xxx"

# server HTTP di localhost butuh opt-in eksplisit (anti-SSRF)
minicode config mcp add lokal --url http://127.0.0.1:3000/mcp --allow-private
```

Setelah terdaftar, `mcp_list` menampilkan **tools, resources, dan prompts** sekaligus, dan tersedia empat tool:

| Tool | Spec | Catatan |
|---|---|---|
| `mcp_list` | `tools/list` + `resources/list` + `prompts/list` | read-only, tidak di-gate |
| `mcp_call` | `tools/call` | di-gate |
| `mcp_read` | `resources/read` | di-gate — lihat alasan di bawah |
| `mcp_prompt` | `prompts/get` (server merender argumen) | di-gate |

Tool dinamis `serverId.toolName` juga otomatis muncul.

`resources` dan `prompts` bersifat **opsional di spec**: server yang membalas "Method not found" (mayoritas ekosistem) tetap terhubung dengan tool-nya utuh. Blob biner dari `resources/read` tidak ditumpahkan sebagai base64 — diganti penanda ukuran, karena 2.000 karakter base64 memakan konteks tanpa memberi informasi.

**Keamanan transport HTTP:** host privat **ditolak** kecuali `--allow-private` — server MCP yang menunjuk `169.254.169.254` atau `localhost` adalah jalur SSRF, dan penjaganya sama dengan `web_fetch` (DNS pinning). Redirect tidak diikuti. Ukuran balasan dibatasi. Balasan dicocokkan per request id, jadi server yang membalas id lain tidak diterima sebagai hasil. Header `Authorization` diteruskan tapi tidak pernah masuk log.

**Catatan izin:** semua tool MCP bertitik **selalu di-gate** — mode `auto` meminta konfirmasi sekali per tool (jawab `[a] Always` untuk persist ke allowlist); mode `readonly`/`plan`/`allowlist` menolaknya. Server terdaftar tidak mendapat wildcard auto-allow (proteksi supply-chain).

`mcp_read` dan `mcp_prompt` di-gate **meski read-only**: keduanya menarik konten dari server pihak ketiga langsung ke konteks model, yang merupakan jalur prompt-injection. "Read-only" tidak berarti "aman". `mcp_list` tidak di-gate karena hanya melaporkan metadata server yang Anda daftarkan sendiri.

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

Dua lapis, keduanya bisa Anda jalankan sendiri:

```bash
bun run gate:bash            # korpus manual: 38 pola serangan + 15 perintah sah
bun run extreme:fuzz         # mutasi kombinatorial ber-seed (~13.000 varian)
bun experiments/extreme-bash-fuzz.ts --seed 999 --rounds 3   # reproduksi spesifik
```

Probe manual menguji serangan yang sudah dipikirkan. Fuzz membangkitkan varian sendiri dari transformasi yang shell anggap setara — quote-split, indirection variabel (nama perintah maupun argumen), rantai dua tingkat, flag panjang, wrapper perintah, chaining — dan **menemukan 3 kelas bypass yang korpus manual lewatkan**:

| Yang lolos | Kenapa |
|---|---|
| `command env`, `nice env`, `exec 'env'` | Deteksi env-dump ter-anchor ke awal perintah; wrapper menggeser posisi kata |
| `rm --recursive --force /` | Pola lama hanya mencari `-[a-z]*r` |
| `rm -rf /; :` | Pola target mensyaratkan whitespace; `;` menempel langsung |

Semuanya kini tertutup (`stripCommandWrappers` membuang 14 wrapper hingga 4 lapis) dan terkunci sebagai regresi. Exit 0 hanya bila **0 bypass dan 0 over-block** di kedua lapis.

> **Batas yang tetap jujur.** bash-guard adalah analisis statis atas bahasa Turing-complete. Command substitution dinamis (`$(curl ...)`), aritmetika shell, dan indirection berlapis tidak bisa diselesaikan tanpa mengeksekusi. Guard menaikkan biaya serangan; **sandbox OS/container yang memberi isolasi**. Untuk task benar-benar tak terpercaya, jalankan di Linux/macOS (bwrap/seatbelt otomatis) atau `--sandbox docker`.

## Plan Mode

`--plan` → read-only. Agen bisa membaca, mencari, merencanakan (`todo_read` tetap boleh), tapi tidak bisa menulis file, menjalankan bash, `todo_write`, atau memanggil sub-agent. Berguna untuk review dan planning sebelum eksekusi. Di TUI, Shift+Tab bisa memutar ke mode ini saat sesi berjalan.

## Budget

`--budget <usd>` → lacak biaya LLM. Peringatan 80% → kuning. Bila lewat budget: one-shot `exit(1)`, REPL `break` loop.

## Checkpoint & Undo

Setiap turn otomatis membuat checkpoint. Ada dua mode, dipilih otomatis:

**Repo git (utama).** Snapshot disimpan sebagai **SHA tree git**, bukan salinan isi file. Biayanya O(delta) bukan O(ukuran workspace), dan tidak ada batas jumlah file — perubahan 250 file dari satu `bash` ter-undo seluruhnya.

Jaminannya:
- Index dan `HEAD` Anda **tidak pernah** disentuh. Tidak ada `git add`, `commit`, `checkout`, `reset`, atau `stash` pada state Anda.
- Ref disimpan di `refs/minicode/<sesi>/…` dan menunjuk *tree*, bukan commit — jadi tidak muncul di `git log --all` maupun `git branch`.
- Aman dari `git gc`: ref mem-pin object-nya.
- Line ending tidak diubah (`core.autocrlf=false` dipaksa di setiap operasi).
- Restore hanya menyentuh path yang berbeda; file lain tak tersentuh.

**Batas yang perlu diketahui:** snapshot memakai `git add -A`, jadi **file ber-`.gitignore` tidak ikut** dan perubahan padanya tidak bisa di-undo. Ini disengaja (kami tidak ingin menyimpan `node_modules`), tapi berarti undo mencakup "yang dilacak git", bukan "seluruh disk".

**Non-repo (fallback).** Snapshot isi file seperti sebelumnya, dengan cap `WORKSPACE_SNAPSHOT_LIMIT`.

`/undo` kembali ke kondisi sebelum turn, `/redo` ke kondisi sesudahnya. Manifest di `.minicode/checkpoints/` dengan cap **20** terbaru (`LIMITS.CHECKPOINT_MAX_COUNT`). Turn yang tidak mengubah apa pun tidak membuat checkpoint.

## Sessions

Sesi disimpan di `.minicode/sessions.db` (WAL). `minicode sessions list` untuk daftar. `--resume <id>` untuk melanjutkan dengan history penuh (termasuk `toolCallId`/`name`). Sesi basi dihapus otomatis setelah **30 hari** (`MINICODE_SESSION_TTL_DAYS=0` = simpan selamanya; nilai lain dalam hari). `minicode sessions purge` untuk menghapus manually.

## Repo Intelligence

System prompt otomatis memuat repo-map berbasis **regex** (9 bahasa) dengan fallback LSP `workspace/symbol`. Cache di `.minicode/repomap.json` (sig mtime). File diurutkan import-graph (60 files, 2.5k chars). `MINICODE_REPOMAP=regex` untuk skip LSP. Hashline edit `src/tools/hashline.ts` deterministik.

Tree-sitter **tidak** dipakai. Prototipe `web-tree-sitter` berjalan dan cepat, tapi perbandingan pada file nyata menunjukkan yang terlewat regex hampir seluruhnya member kelas dan helper lokal — bukan simbol top-level. Sementara repo-map sudah menyentuh cap 2.500 char, jadi simbol tambahan justru menggeser yang lebih penting. Alasan lengkap + tabel pengukuran ada di komentar `extractSymbolsAsync` (`src/repo/repomap.ts`).

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
bun run gate:bash      # korpus serangan bash
bun run gate:pack      # gate tarball npm (graf import, rahasia, ukuran)
bun run vendor:check   # vendor/minicore sinkron dengan ../minicore
bun run extreme        # tiga harness adversarial (fuzz + stress + server jahat)
bun run bench:smoke    # fake tasks, CI-safe
bun run bench --runs 2 # median 2 runs
minicode exec "prompt" --json       # headless CI (JSONL + summary di stdout)
MINICODE_GREP_ENGINE=js bun test test/phase1-tools.test.ts   # jalur grep fallback
MINICODE_LIVE=1 bun run test:live   # live E2E (butuh provider + API key)
```

Eksperimen adversarial terpisah:

```bash
bun run extreme:fuzz                                   # fuzz bash-guard
bun experiments/extreme-bash-fuzz.ts --seed 42 --rounds 5
bun run extreme:git                                    # stress shadow-git
bun experiments/extreme-shadow-git.ts --files 5000 --sessions 10
bun run extreme:mcp                                    # server MCP jahat
```

Semua test hermetic (fetch di-mock, DB tmpdir) dan aman dijalankan berulang tanpa jaringan. Jumlah test tidak dicantumkan di sini — jalankan `bun test` untuk angka terkini.

## Troubleshooting

- **LSP tidak jalan:** `minicode config lsp add .ts --command typescript-language-server --args --stdio`. Pastikan server terinstall.
- **Docker sandbox:** `docker pull node:22-alpine`. Bila daemon mati, permission turun ke `allowlist` (bukan diam-diam tanpa isolasi).
- **Kenapa perintah saya ditolak padahal aman?** Kemungkinan mode default `allowlist` aktif karena tak ada OS sandbox. Pesan `[sandbox]` di awal run menjelaskannya. Pilih sendiri dengan `--allow-all` atau `--ask`, atau jalankan `bun experiments/bash-bypass-probe.ts` untuk melihat apa yang dianggap sah.
- **`--sandbox os` tidak berefek:** bubblewrap/seatbelt tidak ada di Windows. Pakai `--sandbox docker`, atau terima default `allowlist`.
- **Variabel env hilang di subprocess:** hanya yang berkata-kunci kredensial di-strip. `GITHUB_WORKSPACE`/`REDIS_HOST`/`AWS_REGION` seharusnya tetap ada sejak Fase 2; kalau variabel non-rahasia Anda ikut hilang, itu bug — laporkan nama variabelnya.
- **`grep` terasa lambat:** install `rg` (ripgrep). Cek jalur aktif dengan `MINICODE_GREP_ENGINE=js` untuk membandingkan.
- **`/undo` tidak memulihkan file tertentu:** kemungkinan file itu ada di `.gitignore`. Mode shadow-git hanya men-snapshot yang dilacak git (disengaja, agar `node_modules` tak ikut).
- **MCP HTTP ditolak "host privat":** server di localhost/LAN butuh `--allow-private` saat `config mcp add`. Ini penjaga SSRF, bukan bug.
- **MCP HTTP gagal "redirect tidak diikuti":** URL server salah atau server mengarahkan ke host lain. Perbaiki URL-nya; redirect sengaja tidak diikuti.
- **`auth login` gagal / kode tak diterima:** endpoint provider mungkin berubah. Pesan error dari server ditampilkan apa adanya — cek `minicode auth list` untuk spec yang dipakai.
- **Provider OAuth hilang dari daftar:** belum login atau refresh gagal. `minicode auth status` menunjukkan mana yang kedaluwarsa; `minicode auth login <id>` untuk memulihkan.
- **`git_commit` ditolak:** tool ini di-gate. Di non-TTY (CI) ia selalu ditolak — itu memang perilaku yang diinginkan. Pakai `--allow-all` bila commit otomatis benar-benar dibutuhkan.
- **Biaya tampil N/A:** model tak ada di tabel. `minicode pricing sync` menambah 3.162 model; `pricing show <model>` memastikan apakah sudah dikenali.
- **File besar tak bisa dibaca:** pakai `offset`/`limit` di `read_file` — file >2 MB memang ditolak tanpa itu.
- **Background job tak jalan:** `background:true` ditolak saat `--sandbox` aktif; jalankan tanpa sandbox atau pakai foreground.
- **Verify tidak jalan:** set `MINICODE_VERIFY_CMD` atau `verifyCommand` di config.
- **Budget tidak akurat:** harga di `usage.ts` adalah estimasi rata-rata; biaya riil tergantung provider.
- **`bun install` gagal cari minicore:** pastikan `vendor/minicore` ada (ikut repo). Untuk sync ulang dari sumber butuh clone `../minicore` lalu `bun run vendor:minicore`.
