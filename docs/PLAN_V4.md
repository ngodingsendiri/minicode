# PLAN V4 — Perbaikan Berdasarkan Audit 0.7.0

**Status:** Fase 0 ✅ · Fase 1 ✅ · Fase 2 ✅ · Fase 3 ✅ · Fase 4 ✅

**Basis audit:** commit `2cc335b` (v0.7.0). Semua angka di bawah **terverifikasi dengan eksekusi**, bukan salinan dari dokumen sebelumnya.

| Metrik | Klaim dokumen lama | Hasil ukur saat audit | Setelah Fase 0–4 |
|---|---|---|---|
| Test | 243 / 189 / 243 (tiga angka berbeda) | 265 total, 257 pass, 8 skip | 569 total, 561 pass, 8 skip |
| Coverage | "threshold 80" tanpa penegakan | 72,17% funcs / 76,34% lines | 72,74% / 77,24% + gate agregat nyata |
| Lint | implisit bersih | 68 error, 16 warning | **0 error** |
| Typecheck | "0" | 0 tapi `cli/` diexclude → **14 error** saat disertakan | **0** dengan `cli`+`scripts`+`experiments` |
| Tools | 23 | 24 | 29 |
| Grep | "ripgrep-like" | walker JS | ripgrep bila ada + fallback walker |
| `bun install` tanpa sibling | — | **gagal** | **hijau** (vendor) |
| Pola bypass bash | — | **33 lolos** (dari 38 diuji) | **0 lolos** |
| Sandbox default | — | tidak ada, murni opt-in | OS-native otomatis; tanpa itu → `allowlist` |
| Checkpoint | — | salin isi file, cap 200 | tree git, O(delta), tanpa cap |
| MCP client | — | stdio saja | stdio + Streamable HTTP/SSE |
| `tree-sitter.ts` | "optional wasm loader" | stub `return null` | **dihapus** (keputusan terukur) |
| Auth | — | API key mentah saja | + OAuth device-code (RFC 8628) |
| Git | — | read-only | + `git_commit` (di-gate) |
| Harga model | 13 hardcode | 13 hardcode, `gpt-4o` **2× salah** | 17 bawaan + 3.162 dari models.dev (opt-in) |

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

## Fase 4 — Ekosistem & Akses ✅

### 4.1 OAuth device-code ✅

`src/providers/oauth.ts` mengimplementasikan Device Authorization Grant (RFC 8628). Dipilih di atas authorization-code+PKCE karena tidak butuh redirect URI, tidak membuka port lokal, dan bekerja lewat SSH — tiga hal yang semuanya relevan untuk agent terminal.

Penanganan yang sesuai spec dan diuji: `authorization_pending` (poll lagi), `slow_down` (naikkan interval minimal +5 s, §3.5), `access_denied`/`expired_token` (berhenti dengan pesan), interval liar di-clamp 1–60 s, dan error tak dikenal **berhenti** alih-alih polling sampai timeout.

Kredensial disimpan di `~/.minicode/auth.json` — **terpisah dari `config.json`** karena config sering di-commit (`.minicode/config.json` lokal) sementara token adalah rahasia berumur pendek. Refresh token dipakai otomatis dengan margin 60 detik sebelum kedaluwarsa, jadi login sekali cukup.

`buildProviderListAsync` menukar `apiKey` dengan access token segar saat runtime. Provider OAuth yang belum login **dibuang dari daftar dengan peringatan** — lebih baik hilang daripada mengirim `Authorization: Bearer undefined` yang gagal dengan pesan membingungkan.

Perintah: `minicode auth login|status|logout|list`.

**Batas yang harus jujur:** nilai endpoint/clientId provider belum bisa saya verifikasi dengan login sungguhan dari lingkungan ini (butuh interaksi browser). **Mekanismenya** diuji end-to-end terhadap server device-flow lokal (`Bun.serve`) — 18 test mencakup seluruh cabang spec. Identitas provider perlu dikonfirmasi saat pertama dipakai; bila salah, `auth login` melaporkan error server apa adanya, bukan gagal senyap. Ini dicatat juga di komentar `OAUTH_PROVIDERS`.

### 4.2 `git_commit` ✅

Di-**gate** setara `delegate_task`/`mcp_call`: commit mengubah riwayat yang dibagikan, bukan sekadar file kerja. Mode `auto` meminta persetujuan sekali (TTY) / menolak (non-TTY); `readonly`/`plan`/`allowlist` menolak. Sub-agent tidak mendapat tool ini — commit adalah keputusan tingkat-task.

Yang **sengaja tidak** disediakan: `push`, `reset --hard`, `rebase`, `checkout`, `branch -D`, `stash drop`, `amend`. Semuanya sulit dibalikkan atau mempengaruhi remote/repo orang lain. Agent tidak butuh itu untuk menyelesaikan task, dan menyediakannya memindahkan risiko besar ke tangan yang tak bisa menilai konteksnya.

Keamanan yang diuji: pesan commit diteruskan sebagai satu argumen `-m` sehingga `$(touch pwned)` dan backtick **tidak** dieksekusi (dibuktikan: tak ada file baru setelah commit), `git add -- <paths>` memisahkan path dari opsi sehingga nama file `-weird.txt` tidak jadi flag, path dijail di permission layer **dan** di dalam tool, `cwd` dijail sama seperti bash/glob/grep, dan "tidak ada perubahan" mengembalikan pesan informatif alih-alih exception.

Sekalian: `git_status`/`git_diff`/`git_log` kini juga menjail `cwd` — sebelumnya hanya permission layer yang memeriksanya.

### 4.3 Pricing dari models.dev ✅ — dengan dua koreksi

Tabel harga dipindah ke `src/policy/pricing.ts`: 17 entri bawaan (offline, selalu ada) + overlay 3.162 model dari models.dev.

**Keputusan: tidak ada fetch otomatis.** Rencana menyebut "tarik dengan cache", tapi request ke pihak ketiga saat startup menambah latensi dan membocorkan pola pemakaian (IP + waktu) tanpa diminta. Sync hanya lewat `minicode pricing sync`; jalur run biasa **hanya membaca berkas cache**. Data kedaluwarsa tetap dipakai (dengan tanda) daripada jatuh ke "N/A".

Dua temuan yang mengubah implementasi:

**Harga `gpt-4o` di tabel lama 2× terlalu tinggi.** Tertulis $5/M input — itu harga peluncuran Mei 2024 yang dipotong separuh pada Agustus 2024 menjadi $2,50. Estimasi biaya dan `--budget` untuk model ini salah sejak lama. Test yang mengunci angka lama saya perbarui **dengan catatan alasannya**, bukan diam-diam.

**Satu model id ditawarkan banyak provider dengan harga berbeda.** Terukur: `qwen3-coder-plus` muncul di 6 provider — dua di antaranya $0 (paket berlangganan), sisanya $1/M. Implementasi awal saya mengambil "yang pertama", dan hasilnya **$0** — artinya estimasi biaya nol dan `--budget` tak akan pernah memicu. Diganti: buang kandidat gratis bila ada yang berbayar, lalu ambil **median** (bukan min yang menyesatkan ke bawah, bukan max yang alarmis).

Cache hanya menyimpan field biaya: payload 4,4 MB → 213 KB.

Perintah: `minicode pricing status|sync|show <model>|clear`.

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
| `bun test` | pass, angka dari CI | 257 pass | ✅ 561 pass |
| Coverage `src/policy` + `src/providers` | ≥90% | 72% global | ⏳ 72,74% global |
| Coverage `cli/` | ≥60% | ~0% | ⏳ sebagian |
| `bun install` tanpa sibling | hijau | gagal | ✅ hijau |
| `grep` repo ini | ≤200 ms | ~110–160 ms (walker) | ✅ terpenuhi kedua engine |
| Pola bypass bash teruji | 0 lolos | 33/38 lolos | ✅ 0/38 |
| Over-block perintah sah | 0 | 1/15 auto, 4/15 allowlist | ✅ 0/15 keduanya |
| Sandbox default | aktif bila mungkin | tidak ada | ✅ OS-native otomatis |
| Checkpoint tanpa cap file | ya | cap 200 | ✅ tree git |
| MCP transport | stdio + HTTP | stdio saja | ✅ keduanya |
| Stub yang menyesatkan | 0 | 1 (`tree-sitter.ts`) | ✅ 0 |
| Jalur login tanpa API key | ada | tidak ada | ✅ OAuth device-code |
| Harga model akurat | ya | `gpt-4o` 2× salah | ✅ dikoreksi + 3.162 model |
| `bench --runs 2` resolveRate | ≥0,6 | 0,59 (live) | ⏳ belum diukur ulang |

**Sisa yang belum dikerjakan** (di luar cakupan V4, kandidat V5):

- Coverage `cli/` belum ≥60% dan `src/policy`/`src/providers` belum ≥90%.
- Resolve-rate live belum diukur ulang setelah semua perubahan ini — angka 0,59 sudah basi.
- OpenAI Responses API dan Gemini native API (masih lewat shim `/v1beta/openai`).
- Publish ke npm / `npx minicode` — distribusi masih wajib clone + Bun.
- Endpoint OAuth provider perlu konfirmasi lewat login sungguhan.
- MCP client belum mengonsumsi `resources`/`prompts` dari server remote.

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
| Server MCP remote mengirim aliran raksasa | Cap ukuran pada JSON dan SSE; diuji dengan 256 MB stream |
| Token OAuth ikut ter-commit | Disimpan di `~/.minicode/auth.json` (selalu global), bukan `config.json`; provider OAuth menyimpan `apiKey: ""` |
| Endpoint OAuth provider salah | Error server dilaporkan apa adanya; dicatat di komentar spec bahwa nilainya perlu konfirmasi login pertama |
| `git_commit` dipakai untuk operasi berbahaya | Hanya commit; push/amend/reset/rebase/checkout sengaja tidak ada. Pesan lewat `-m` argumen (bukan shell), path lewat `--` |
| Harga models.dev berbeda antar provider | Buang kandidat $0 bila ada yang berbayar, ambil median — bukan "yang pertama" yang bergantung urutan iterasi |
| Fetch pricing memperlambat startup / membocorkan pola pakai | Tidak ada fetch otomatis; hanya `pricing sync` eksplisit. Jalur run hanya baca cache lokal |
| `rg` tidak ada / beda flavour regex | Fallback walker dipertahankan + auto-fallback saat rg error, dengan peringatan |
| Background job jadi proses yatim | Cap job, reap, `killAllBackgroundJobs()` di `close()` CLI |

---

## Non-Goals

- Mengubah kernel di luar seam additif. `vendor/minicore` adalah salinan; perubahan kernel tetap lewat repo `minicore` lalu di-sync.
- Menambah primitive kernel untuk fitur apa pun di plan ini — semuanya bisa sebagai Tool/Policy/Provider/CLI.
- Mengejar paritas fitur penuh dengan Claude Code. Diferensiasi Minicode yang nyata dan defensibel adalah **disiplin arsitektur** dan **SSRF/jail hardening** (`web_fetch.ts` DNS-pinning per-hop; realpath jail sebelum `allow-all`). Bangun di atas dua itu, bukan meniru daftar fitur.

