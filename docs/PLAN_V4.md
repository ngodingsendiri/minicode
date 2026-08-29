# PLAN V4 — Perbaikan Berdasarkan Audit 0.7.0

**Status:** Fase 0 ✅ · Fase 1 ✅ · Fase 2 ✅ · Fase 3 ✅ · Fase 4 belum.

**Basis audit:** commit `2cc335b` (v0.7.0). Semua angka di bawah **terverifikasi dengan eksekusi**, bukan salinan dari dokumen sebelumnya.

| Metrik | Klaim dokumen lama | Hasil ukur saat audit | Setelah Fase 0–3 |
|---|---|---|---|
| Test | 243 / 189 / 243 (tiga angka berbeda) | 265 total, 257 pass, 8 skip | 520 total, 512 pass, 8 skip |
| Coverage | "threshold 80" tanpa penegakan | 72,17% funcs / 76,34% lines | 73,73% / 77,97% + gate agregat nyata |
| Lint | implisit bersih | 68 error, 16 warning | **0 error** |
| Typecheck | "0" | 0 tapi `cli/` diexclude → **14 error** saat disertakan | **0** dengan `cli`+`scripts`+`experiments` |
| Tools | 23 | 24 | 28 |
| Grep | "ripgrep-like" | walker JS | ripgrep bila ada + fallback walker |
| `bun install` tanpa sibling | — | **gagal** | **hijau** (vendor) |
| Pola bypass bash | — | **33 lolos** (dari 38 diuji) | **0 lolos** |
| Sandbox default | — | tidak ada, murni opt-in | OS-native otomatis; tanpa itu → `allowlist` |
| Checkpoint | — | salin isi file, cap 200 | tree git, O(delta), tanpa cap |
| MCP client | — | stdio saja | stdio + Streamable HTTP/SSE |
| `tree-sitter.ts` | "optional wasm loader" | stub `return null` | **dihapus** (keputusan terukur) |

**Prinsip tetap:** kernel MiniCore beku. Hanya seam additif backward-compatible. Semua item di bawah adalah Tool / Policy / Provider / CLI.

---

## Fase 0 — P0 Blocker ✅

Empat bug ini membuat produk terasa rusak dalam 5 detik pertama pemakaian. Semuanya lolos CI karena `cli/` di luar `tsconfig` dan tanpa test.

| # | Bug | Lokasi | Bukti | Status |
|---|---|---|---|---|
| B1 | `cmdName` tidak dideklarasikan → semua slash builtin mati di TUI | `cli/fullscreen-driver.ts` | `ReferenceError: cmdName is not defined`, ditelan `catch { return null }` | ✅ Deteksi builtin lewat nilai kembalian `handled` (bukan exception); `captureOutput` jadi generik + meneruskan `value`; `shouldExit` untuk `/exit` ikut ditangani |
| B2 | `exec --json` tidak stream event | `cli/commands/exec.ts` | `on(handler)` 1-arg → 0 event; `on("*", handler)` → 3 event | ✅ `on("*")`; summary pindah dari stderr ke stdout sebagai `{"type":"summary"}`; `--allowlist` yang bocor jadi prompt diperbaiki |
| B3 | Shift+Tab cycle permission = placebo | `cli/fullscreen-driver.ts` + `src/policy/permission.ts` | `session.config` tidak ada di kernel; `__setMode`/`__getMode` hanya di type-cast **tanpa implementasi** → TypeError tersembunyi di `?.` | ✅ Implementasi nyata kedua method + seam `onPermissions` di `createMinicodeSession` → `CliSession.permissions`. Kernel tidak disentuh |
| B4 | `cli/` + `scripts/` tidak di-typecheck | `tsconfig.json:include` | 14 error saat disertakan (B1 di antaranya) | ✅ Disertakan, semua error dibereskan |

**Kebersihan repo:** lint 68→0 error (termasuk `noControlCharactersInRegex` lewat `ANSI_PATTERN` satu sumber di `src/tui/theme.ts`), `minicode-0.6.0.tgz` dihapus + `*.tgz` di-gitignore, angka test/tool hardcode dibuang dari markdown, `CONTRIBUTING.md` yang masih menyatakan proprietary/EULA diperbaiki ke MIT.

**Coverage gate.** Rencana awal memakai `bunfig.toml` `coverageThreshold`; setelah diuji itu **tidak bisa dipakai** — Bun mengevaluasi threshold per-file, jadi bahkan `0.01` gagal karena ada file 0% (`src/sandbox/os.ts` hanya jalan di Linux/macOS). Diganti `scripts/coverage-gate.ts` yang mem-parse baris "All files"; diuji dua arah (baseline lulus, `--lines 95` gagal).

**Regresi:** `test/cli-regression.test.ts` — 10 test yang gagal bila ketiga bug kembali. B2 diuji dengan membandingkan `on("*")` vs `on(handler)` di run yang sama, jadi test itu mendokumentasikan *kenapa* pola lamanya salah.

---

## Fase 1 — Distribusi & Tool Fundamental ✅

### 1.1 Distribusi ✅ — vendor, bukan npm

`package.json` `workspaces: ["../minicore"]` + `minicore: workspace:*` membuat `bun install` gagal tanpa clone sibling (terverifikasi: `error: Workspace not found "../minicore"`).

Opsi npm (rencana awal) ditinggalkan: publish butuh kredensial dan tidak reversible. Dipilih **vendor** — `vendor/minicore/` (19 file, ~72 KB) di-commit, dep jadi `file:./vendor/minicore`.

- `scripts/vendor-minicore.ts` — sync dari `../minicore` + `--check` untuk CI. Hash agregat mendeteksi drift; diuji dengan menyuntik perubahan lalu memastikan `vendor:check` exit 1.
- Tanpa sibling, script tetap lulus dengan pesan (vendor yang ada dianggap sah) — kontributor tanpa clone kedua tidak diblokir.
- `tsconfig` paths → `./vendor/minicore/...`; import test `../../minicore/src/...` diseragamkan ke `minicore/...`.
- CI: checkout minicore jadi `continue-on-error` (hanya untuk verifikasi + test kernel), cache key tak lagi butuh `minicore/bun.lock`.

**Terverifikasi:** salin file *tracked* saja ke direktori kosong → `bun install` hijau, `tsc` 0, 302 test pass, tanpa sibling `../minicore` sama sekali.

### 1.2 `read_file` offset/limit + nomor baris ✅

Output kini bernomor (`12: const x = 1`) supaya rujukan `edit`/`apply_patch` akurat. `offset` (1-indexed) + `limit` (default 2000, max 5000). File >2 MB bisa dibaca **hanya** dengan paging — tanpa itu tetap ditolak, karena diam-diam memotong konteks yang model kira utuh lebih berbahaya daripada error. Footer memberi `offset` berikutnya. Baris sangat panjang dipotong per baris; direktori ditolak dengan pesan spesifik.

### 1.3 `grep` via ripgrep ✅ — dengan catatan pengukuran

`rg` dipakai bila ada di PATH (`--vimgrep --no-follow`, exclude `.git`/`node_modules`/dotdir), fallback walker dipertahankan. `MINICODE_GREP_ENGINE=js` memaksa fallback; CI menguji jalur itu eksplisit.

**Koreksi angka.** Audit melaporkan walker 3.550 ms. Setelah diukur ulang di proses bersih, walker sebenarnya **~110–160 ms**; 3.550 ms itu termasuk *cold start* import modul pada pengukuran pertama, bukan biaya scan. Jadi klaim "50× lebih lambat" di audit terlalu keras — perbaikan nyata dari ripgrep lebih kecil dari yang diperkirakan, dan manfaat utamanya muncul pada repo jauh lebih besar. Nilai tambah yang pasti: `--max-filesize`, exclude bawaan, dan tidak membebani event loop.

Jail tetap berlaku di kedua jalur: walker via `realpath` per file, ripgrep via validasi tiap baris di `normalizeRgLine`. Diuji memberi hasil identik pada fixture yang sama.

### 1.4 `todo_write` / `todo_read` ✅

State per sesi di `.minicode/todos/<id>.json` (atomic write). Kirim seluruh daftar, bukan delta. Hanya satu `in_progress` dipertahankan — sisanya dinormalisasi ke `pending`. Cap jumlah item dan panjang `content`. File korup dianggap kosong, tidak melempar. Dirender utuh di TUI (transcript kind `todo`) dan one-shot logger. `todo_read` masuk READONLY sehingga tetap boleh di mode `plan`.

### 1.5 `bash` streaming + background ✅

- Foreground memancarkan `provider:extension` kind `bash-output` inkremental (tampil di `--verbose`). `CappedBuffer` menggantikan closure lama; cap tetap diterapkan saat streaming.
- `background:true` → job id, lalu `bash_output(id)` (hanya output **baru** sejak baca terakhir) dan `bash_kill(id)`. Cap `BASH_BACKGROUND_MAX_JOBS`, reap job selesai, dan semua job dimatikan di `close()` CLI — tidak ada proses yatim.
- **Keputusan desain:** `background:true` **ditolak** saat `--sandbox` aktif. Container/namespace ephemeral mati bersama call-nya, jadi menjanjikan isolasi untuk proses berumur panjang akan menyesatkan. Lebih baik gagal eksplisit.

### Bonus dari Fase 2 yang ikut dikerjakan

`src/policy/executor.ts` — `bash` dipindah dari `WRITE_TOOLS` ke `EXCLUSIVE_TOOLS`. Sebelumnya `bash` mengambil write-slot tapi `getFilePath()` selalu `null` untuknya, sehingga dengan `EXECUTOR_WRITE_CONCURRENCY: 1` dua bash read-only terserialisasi tanpa alasan. (Item 2.3 di rencana awal.)

---

## Fase 2 — Sandbox Default & Keamanan ✅

### 2.1 Menutup bypash bash ✅ — dengan pendekatan berbeda dari rencana

Rencana awal: "tambal celah termurah" (`--eval`, `env`, `set`, `-F file=@`, `rm -rf ..`). Saya tidak menempuh itu, karena menambal pola satu-satu pada regex-atas-string-mentah tidak menyelesaikan **kenapa** ia bocor: shell menganggap banyak bentuk setara, sementara regex melihat karakter.

Diganti `src/policy/bash-guard.ts` yang **menormalisasi dulu, memeriksa kemudian**:

- `stripQuotes` — buang quote pemisah kata: `cat .e""nv` → `cat .env`, `pyt"h"on3` → `python3`.
- `inlineSimpleVars` — substitusi assignment literal, dengan re-scan per lintasan sehingga rantai (`a=.env; b=$a; cat $b`) juga selesai.
- Pemeriksaan dijalankan pada bentuk ternormalisasi **dan** mentah (beberapa pola justru hilang saat quote dibuang).

Kelas aturan: inline-interpreter (semua bentuk flag, bukan hanya `-e`/`-c`), env dump (`env`/`set`/`export -p`/`declare -x`/`compgen -v`, bukan hanya `printenv`), referensi env berkata-kunci rahasia, upload-exfil (`-d @`, `-F …=@`, `-T`, `--upload-file`, `--post-file`), process substitution & here-string, pipe-ke-interpreter, download-then-run, container escape, root scan, akses berkas/direktori kredensial, dan `rm` rekursif **dengan target berbahaya** — dipisah supaya `rm -rf node_modules/.cache` tidak lagi ikut terblokir.

Hasil terukur (`experiments/bash-bypass-probe.ts`, 38 pola serangan + 15 perintah sah):

| Mode | Sebelum | Sesudah |
|---|---|---|
| `auto` | 33/38 bypass, 1/15 over-block | **0/38, 0/15** |
| `allowlist` | 7/38 bypass, 4/15 over-block | **0/38, 0/15** |

Catatan: audit awal melaporkan 13 bypass karena hanya 13 pola yang saya uji saat itu. Setelah korpus diperluas ke 38, angka sebenarnya 33 — lebih buruk dari yang dilaporkan.

Allowlist juga diperbaiki: sebelumnya hanya 13 pola sehingga `grep -r TODO src` ikut ditolak. Sekarang mencakup perintah read/build yang sah, sementara operasi tulis lewat shell **tetap ditahan** (itu memang tujuan mode paling ketat — agent yang perlu menulis punya `write_file`/`edit` yang ter-jail).

### 2.1b Sandbox default ✅

`src/policy/sandbox-policy.ts` `resolveSandbox`:

- Tanpa `--sandbox`: bila bwrap/seatbelt tersedia → pakai, cetak sekali bahwa sandbox aktif.
- Tanpa isolasi tersedia (termasuk **semua Windows**) → permission default turun ke `allowlist` + jelaskan alasannya. Prinsipnya: jangan pernah menjanjikan isolasi yang tak bisa dipenuhi.
- `--allow-all`/`--ask`/`--plan`/`--allowlist` → pilihan user dihormati, tanpa downgrade dan tanpa ceramah.
- `--sandbox none` → opt-out sadar, senyap.
- `--sandbox docker` tapi daemon mati → tidak berpura-pura; downgrade + peringatan.
- Docker **tidak** dipakai otomatis meski tersedia: menarik image dan menjalankan container tanpa diminta terlalu invasif untuk sebuah default.

Berlaku juga di `minicode exec` — headless CI justru paling butuh, karena di sana tak ada manusia yang bisa menyetujui prompt.

### 2.2 `SECRET_ENV_RE` ✅

Pola lama memuat nama vendor telanjang (`GITHUB`, `GOOGLE`, `AZURE`, `REDIS`, `SUPABASE`), sehingga `GITHUB_WORKSPACE`, `GITHUB_REF`, `GITHUB_SHA`, `GOOGLE_CHROME_PATH`, `AZURE_CONFIG_DIR`, `REDIS_HOST`, `AWS_REGION` ikut terhapus dari env subprocess — memecahkan build di CI.

Sekarang berbasis **kata-kunci kredensial**, dengan nama vendor hanya bila disertai penanda rahasia. Diuji dengan 24 nama rahasia (semua harus di-strip) dan 21 nama benign (semua harus tetap ada).

### 2.3 Executor: `bash` write-slot ✅ (dikerjakan di Fase 1)

---

## Fase 3 — Repo Intelligence & Checkpoint ✅

### 3.1 Checkpoint shadow-git ✅

`snapshotWorkspace` lama menyalin **isi** setiap file ke JSON manifest: O(ukuran workspace) per turn, di-cap `WORKSPACE_SNAPSHOT_LIMIT` (200) file sehingga undo tidak lengkap secara senyap pada perubahan besar, dan memakai `spawnSync git status` di jalur async.

`src/session/shadow-git.ts` memakai object store git yang sudah ada:

1. Index sementara lewat `GIT_INDEX_FILE` → `git add -A -- .` → `git write-tree`.
2. Tree di-pin dengan ref di `refs/minicode/<sesi>/<label>-<sha8>` supaya `gc` tak membuangnya.
3. Undo = `git diff --name-status` dua tree, lalu pulihkan **hanya** path yang berubah (`read-tree` + `checkout-index` pada index sementara), dan hapus file yang muncul setelah snapshot.

Jaminan yang diuji, bukan diasumsikan: index dan HEAD user tidak pernah tersentuh (tak ada `add`/`commit`/`checkout`/`reset`/`stash` pada state user), ref tidak muncul di `git log --all` maupun `git branch` karena menunjuk *tree* bukan commit, tree tetap terbaca setelah `git gc --prune=now`, dan `.gitignore` dihormati.

Dua bug ditemukan lewat pengujian, bukan lewat inspeksi:

- **`core.autocrlf` merusak byte.** Di Windows default-nya `true`, sehingga `checkout-index` menerapkan smudge filter dan memulihkan file LF sebagai CRLF — restore mengubah isi yang tidak diminta siapa pun. Terukur: `a\nb\n` → `a\r\nb\r\n`. Diperbaiki dengan `-c core.autocrlf=false -c core.safecrlf=false` pada setiap invokasi git.
- **`sessionId` bisa mematikan snapshot.** `--session "sess/../..~weird:id"` menghasilkan path index `.git\..~weird:id-…` yang ditolak Windows (`Invalid argument`), jadi snapshot gagal total dan checkpoint hilang senyap. Sanitasi kini dipakai untuk nama berkas **dan** nama ref.

Manifest sekarang menyimpan SHA, bukan isi: diuji dengan file 200 KB, manifest tetap <2 KB. Turn tanpa perubahan tidak lagi membuat checkpoint kosong. Perubahan dari `bash` (250 file sekaligus) kini ter-undo seluruhnya — sebelumnya cap 200 menyisakan 50 file.

Fallback snapshot-file dipertahankan untuk direktori non-git.

### 3.2 Tree-sitter: dihapus ✅ — keputusan diukur

Rencana memberi dua pilihan: implementasi nyata atau hapus. Saya membuat prototipe lebih dulu, lalu memutuskan berdasarkan datanya.

`web-tree-sitter` + `tree-sitter-typescript` **berjalan** dan cepat (init 89 ms, load grammar 19 ms, parse 6 ms). Query pada 5 file nyata di repo ini:

| file | tree-sitter | regex | yang terlewat regex |
|---|---|---|---|
| `src/policy/bash-guard.ts` | 6 | 5 | 1 (helper lokal) |
| `src/session/shadow-git.ts` | 14 | 13 | 1 (helper lokal) |
| `src/tools/bash.ts` | 11 | 9 | 5 (method kelas) |
| `src/repo/repomap.ts` | 14 | 14 | 0 |
| `src/policy/permission.ts` | 12 | 9 | 3 (method) |

Yang terlewat hampir seluruhnya **member kelas dan helper lokal**, bukan simbol top-level yang berguna untuk orientasi. Biayanya: dua dependensi, ~1,4 MB wasm **per bahasa** dikali sembilan bahasa yang didukung, grammar terpisah untuk masing-masing, dan jalur async baru.

Faktor penentu: repo-map **sudah mencapai cap 2.500 char** pada repo ini (terukur). Simbol tambahan tidak akan sampai ke prompt — ia justru menggeser simbol top-level yang lebih penting. Jadi biaya nyata, manfaat nol.

File dihapus; alasan lengkap dicatat di komentar `extractSymbolsAsync` agar keputusannya tidak perlu diulang dari nol. Bila repo-map dipisah per-file atau cap dinaikkan, tree-sitter layak ditimbang ulang — dengan pengukuran baru.

### 3.3 MCP client Streamable HTTP ✅

Client hanya mendukung stdio, sementara sisi *server* minicode sudah menyajikan `tools`/`resources`/`prompts` — asimetri yang membuat seluruh ekosistem MCP remote tak terjangkau.

`src/mcp/http-transport.ts` mengimplementasikan Streamable HTTP (spec 2025-03-26): POST JSON-RPC, respons `application/json` **atau** `text/event-stream`, header `Mcp-Session-Id` disimpan dari `initialize` dan dikirim ulang, `Mcp-Protocol-Version` hasil negosiasi, `DELETE` saat close.

Config MCP kini menerima `url` sebagai alternatif `command`:
```bash
minicode config mcp add ctx7 --url https://mcp.example.com/mcp --header "authorization=Bearer xxx"
minicode config mcp add lokal --url http://127.0.0.1:3000/mcp --allow-private
```

Keamanan yang **bukan** bawaan spec dan ditambahkan di sini: host privat ditolak kecuali `allowPrivateHost` (server MCP yang menunjuk `169.254.169.254` atau localhost adalah SSRF klasik — memakai penjaga DNS-pinning yang sama dengan `web_fetch`), redirect tidak diikuti, body dibatasi agar server nakal tak bisa memicu OOM, dan `Authorization` tidak pernah di-log.

Diuji terhadap **server HTTP nyata** (`Bun.serve` di localhost), bukan mock fetch — karena yang rawan justru perilaku di atas kabel: event SSE terpotong tepat di tengah payload JSON, pemisah CRLF, event non-JSON di antara balasan, notifikasi sebelum balasan, dan aliran yang berakhir tanpa balasan (harus error, bukan hang).

`server/discover` (ekstensi non-standar) kini hanya dicoba untuk stdio lokal; server HTTP langsung `initialize` sesuai spec.

---

## Fase 4 — Ekosistem & Akses (belum)

### 4.1 OAuth minimal satu provider (P1 untuk adopsi)

Hanya API key mentah. Kompetitor: Claude Code (Pro/Max), Copilot CLI, Gemini CLI (login Google), Qwen Code (free tier). Untuk user yang sensitif biaya, ini penghalang adopsi terbesar setelah distribusi. Target realistis: satu jalur device-code ke provider dengan free tier. Token di `~/.minicode/auth.json`, `chmod 600` (pola `atomicWriteText` yang sudah ada).

### 4.2 Git write tools (P2)

`src/tools/git.ts` hanya read. Tambah `git_commit` (di-gate seperti `delegate_task`), opsional auto-commit per turn ala Aider. Sinergis dengan 3.1.

### 4.3 Provider modern (P2)

- `usage.ts` `PRICING` hardcode 13 model → tarik dari `models.dev` dengan cache.
- OpenAI Responses API, Gemini native API (sekarang lewat shim `/v1beta/openai`).

---

## Perbaikan Dokumentasi ✅ (berkelanjutan)

Aturan yang berlaku sejak Fase 0: **setiap klaim yang bisa dihitung mesin, dihasilkan mesin atau tidak ditulis.** Dokumentasi yang over-claim membuat pembaca teknis mendiskon semua klaim lain — termasuk yang benar dan kuat, seperti SSRF guard.

Sudah dikerjakan: angka test/tool/coverage dibuang dari README/ARCHITECTURE/CONTRIBUTING/USAGE, referensi Ink dibersihkan, Known Limitations diperluas dan tiap poin menunjuk fase, batas nyata denylist bash dinyatakan eksplisit dengan contoh pola yang lolos (bukan disembunyikan), dan angka grep 3.550 ms dikoreksi di dokumen ini.

---

## KPI Rilis 1.0

| Gate | Target | Audit 0.7.0 | Sekarang |
|---|---|---|---|
| `bun x tsc --noEmit` (termasuk `cli`) | 0 | 14 error | ✅ 0 |
| `bun run lint` | 0 error | 68 error | ✅ 0 |
| `bun test` | pass, angka dari CI | 257 pass | ✅ 512 pass |
| Coverage `src/policy` + `src/providers` | ≥90% | 72% global | ⏳ 73,73% global |
| Coverage `cli/` | ≥60% | ~0% | ⏳ sebagian |
| `bun install` tanpa sibling | hijau | gagal | ✅ hijau |
| `grep` repo ini | ≤200 ms | ~110–160 ms (walker) | ✅ terpenuhi kedua engine |
| Pola bypass bash teruji | 0 lolos | 33/38 lolos | ✅ 0/38 |
| Over-block perintah sah | 0 | 1/15 auto, 4/15 allowlist | ✅ 0/15 keduanya |
| Sandbox default | aktif bila mungkin | tidak ada | ✅ OS-native otomatis |
| Checkpoint tanpa cap file | ya | cap 200 | ✅ tree git |
| MCP transport | stdio + HTTP | stdio saja | ✅ keduanya |
| Stub yang menyesatkan | 0 | 1 (`tree-sitter.ts`) | ✅ 0 |
| `bench --runs 2` resolveRate | ≥0,6 | 0,59 (live) | ⏳ belum diukur ulang |

---

## Risiko

| Risiko | Mitigasi |
|---|---|
| Vendor drift dari sumber | `vendor:check` di CI + hash agregat; `VENDOR.md` mencatat commit asal |
| Vendor diedit langsung lalu hilang | Header "JANGAN EDIT MANUAL" + dicatat di Known Limitations |
| Default `allowlist` di Windows terasa membatasi | Pesan `[sandbox]` menjelaskan alasan + cara memilih sendiri; probe bisa dijalankan untuk melihat apa yang sah |
| bash-guard over-block perintah sah | Probe memuat 15 perintah sah sebagai guard; exit 1 bila ada over-block |
| Normalisasi variabel salah substitusi | Hanya nilai literal tanpa spasi/ekspansi; nilai ber-`$(...)` sengaja tidak disubstitusi (diuji) |
| Shadow-git menyentuh repo user | Ref di namespace `refs/minicode/` menunjuk *tree*, bukan commit; tak pernah `checkout`/`reset`/`stash` pada state user; diuji HEAD & status tak berubah |
| Shadow-git mengubah line ending | `-c core.autocrlf=false` di setiap invokasi; diuji round-trip LF dan CRLF |
| `.gitignore` membuat undo tak lengkap | Disengaja (tak ingin snapshot `node_modules`) dan didokumentasikan sebagai batas, bukan disembunyikan |
| MCP HTTP jadi jalur SSRF | Host privat ditolak tanpa opt-in, redirect tidak diikuti, body dibatasi — memakai DNS-pinning yang sama dengan `web_fetch` |
| Server MCP remote mengirim aliran raksasa | Cap ukuran pada JSON dan SSA; diuji dengan 256 MB stream |
| `rg` tidak ada / beda flavour regex | Fallback walker dipertahankan + auto-fallback saat rg error, dengan peringatan |
| Background job jadi proses yatim | Cap job, reap, `killAllBackgroundJobs()` di `close()` CLI |

---

## Non-Goals

- Mengubah kernel di luar seam additif. `vendor/minicore` adalah salinan; perubahan kernel tetap lewat repo `minicore` lalu di-sync.
- Menambah primitive kernel untuk fitur apa pun di plan ini — semuanya bisa sebagai Tool/Policy/Provider/CLI.
- Mengejar paritas fitur penuh dengan Claude Code. Diferensiasi Minicode yang nyata dan defensibel adalah **disiplin arsitektur** dan **SSRF/jail hardening** (`web_fetch.ts` DNS-pinning per-hop; realpath jail sebelum `allow-all`). Bangun di atas dua itu, bukan meniru daftar fitur.

