# Changelog

## [Unreleased] — Audit V4 Fase 0–4

Basis: audit menyeluruh v0.7.0 (lihat [docs/PLAN_V4.md](docs/PLAN_V4.md)). Semua angka di dokumen itu terverifikasi dengan eksekusi, bukan salinan klaim lama.

### Added — Fase 4

- **Login OAuth tanpa API key** (`src/providers/oauth.ts`). Device Authorization Grant (RFC 8628), dipilih di atas authorization-code+PKCE karena tidak butuh redirect URI, tidak membuka port lokal, dan bekerja lewat SSH. Penanganan sesuai spec: `authorization_pending`, `slow_down` (naikkan interval minimal +5 s per §3.5), `access_denied`/`expired_token` berhenti dengan pesan, interval liar di-clamp 1–60 s, dan error tak dikenal **berhenti** alih-alih polling sampai timeout.

  Kredensial di `~/.minicode/auth.json` (chmod 600) — **terpisah dari `config.json`** karena config sering ikut ter-commit sementara token adalah rahasia berumur pendek. Refresh otomatis dengan margin 60 detik. `buildProviderListAsync` menukar `apiKey` dengan access token segar saat runtime; provider OAuth yang belum login **dibuang dengan peringatan** alih-alih mengirim `Authorization: Bearer undefined`.

  Perintah: `minicode auth login|status|logout|list`.

  Catatan jujur: mekanismenya diuji end-to-end terhadap server device-flow lokal (18 test mencakup seluruh cabang spec), tapi nilai endpoint/clientId provider belum dikonfirmasi lewat login sungguhan dari lingkungan pengembangan. Bila salah, `auth login` melaporkan error server apa adanya.

- **`git_commit`** — tool git pertama yang menulis. Di-**gate** setara `delegate_task`: commit mengubah riwayat yang dibagikan, bukan sekadar file kerja. Sub-agent tidak mendapatkannya.

  Yang **sengaja tidak** disediakan: `push`, `reset --hard`, `rebase`, `checkout`, `branch -D`, `stash drop`, `amend`. Semuanya sulit dibalikkan atau mempengaruhi remote/repo orang lain; agent tidak butuh itu untuk menyelesaikan task.

  Keamanan yang diuji: pesan diteruskan sebagai satu argumen `-m` sehingga `$(touch pwned)` dan backtick **tidak dieksekusi** (dibuktikan: tak ada file baru setelah commit), `git add -- <paths>` memisahkan path dari opsi sehingga `-weird.txt` tidak jadi flag, path dijail di permission layer dan di dalam tool, dan "tidak ada perubahan" mengembalikan pesan informatif alih-alih exception. Sekalian: `git_status`/`git_diff`/`git_log` kini juga menjail `cwd`.

- **Tabel harga dari models.dev** (`src/policy/pricing.ts`). 17 entri bawaan (offline) + overlay 3.162 model. **Tidak ada fetch otomatis** — rencana menyebut "tarik dengan cache", tapi request ke pihak ketiga saat startup menambah latensi dan membocorkan pola pemakaian tanpa diminta. Sync hanya lewat `minicode pricing sync`; jalur run biasa hanya membaca cache. Payload 4,4 MB → cache 213 KB karena hanya field biaya yang diambil. Perintah: `minicode pricing status|sync|show|clear`.

### Fixed — Fase 4

- **Harga `gpt-4o` 2× terlalu tinggi.** Tabel lama menulis $5/M input — itu harga peluncuran Mei 2024 yang dipotong separuh pada Agustus 2024 menjadi $2,50. Estimasi biaya dan `--budget` untuk model ini salah sejak lama. Test yang mengunci angka lama diperbarui **dengan catatan alasannya**, bukan diam-diam.
- **Harga bisa jadi $0 karena urutan iterasi objek.** Satu model id sering ditawarkan beberapa provider dengan harga berbeda — terukur: `qwen3-coder-plus` muncul di 6 provider, dua di antaranya $0 (paket berlangganan). Implementasi awal mengambil "yang pertama" dan hasilnya **$0**, artinya estimasi biaya nol dan `--budget` tak akan pernah memicu. Diganti: buang kandidat gratis bila ada yang berbayar, lalu ambil **median** (bukan min yang menyesatkan ke bawah, bukan max yang alarmis).

### Changed — Fase 3

- **Checkpoint berbasis shadow-git** (`src/session/shadow-git.ts`). `snapshotWorkspace` lama menyalin **isi** setiap file ke JSON manifest: O(ukuran workspace) per turn, di-cap 200 file sehingga undo tidak lengkap secara senyap pada perubahan besar. Sekarang memakai object store git: index sementara lewat `GIT_INDEX_FILE` → `git write-tree`, tree di-pin dengan ref `refs/minicode/<sesi>/…`, undo = diff dua tree lalu pulihkan hanya path yang berubah.

  Jaminan yang diuji, bukan diasumsikan: index dan `HEAD` user tidak pernah disentuh (tak ada `add`/`commit`/`checkout`/`reset`/`stash` pada state user), ref menunjuk *tree* bukan commit sehingga tak muncul di `git log --all`/`git branch`, tree tetap terbaca setelah `git gc --prune=now`, dan restore hanya menyentuh path yang berbeda. Manifest kini menyimpan SHA: file 200 KB tidak lagi membuat manifest membengkak (<2 KB). Turn tanpa perubahan tidak membuat checkpoint kosong. Perubahan 250 file dari satu `bash` ter-undo seluruhnya — sebelumnya cap 200 menyisakan 50 file. Repo non-git memakai fallback snapshot file.

- **MCP client mendukung Streamable HTTP** (`src/mcp/http-transport.ts`). Client sebelumnya hanya stdio, sementara sisi *server* minicode sudah menyajikan `tools`/`resources`/`prompts` — asimetri yang membuat seluruh ekosistem MCP remote tak terjangkau. Spec 2025-03-26: POST JSON-RPC, respons `application/json` atau `text/event-stream`, `Mcp-Session-Id` disimpan dari `initialize` dan dikirim ulang, `Mcp-Protocol-Version` hasil negosiasi, `DELETE` saat close.

  Config menerima `url` sebagai alternatif `command`: `minicode config mcp add ctx7 --url https://… --header "authorization=Bearer xxx"`. Keamanan yang **bukan** bawaan spec: host privat ditolak kecuali `--allow-private` (server MCP yang menunjuk `169.254.169.254`/localhost adalah SSRF klasik — memakai penjaga DNS-pinning yang sama dengan `web_fetch`), redirect tidak diikuti, ukuran balasan dibatasi, `Authorization` tidak pernah di-log. `server/discover` (ekstensi non-standar) kini hanya dicoba untuk stdio lokal.

### Fixed — Fase 3

- **`core.autocrlf` merusak byte saat restore.** Di Windows default-nya `true`, sehingga `checkout-index` menerapkan smudge filter dan memulihkan file LF sebagai CRLF — restore mengubah isi yang tidak diminta siapa pun (terukur: `a\nb\n` → `a\r\nb\r\n`). Setiap invokasi git kini memakai `-c core.autocrlf=false -c core.safecrlf=false`.
- **`sessionId` tertentu mematikan snapshot.** `--session "sess/../..~weird:id"` menghasilkan path index `.git\..~weird:id-…` yang ditolak Windows (`Invalid argument`), jadi snapshot gagal total dan checkpoint hilang senyap. Sanitasi kini dipakai untuk nama berkas **dan** nama ref.

### Removed — Fase 3

- **`src/repo/tree-sitter.ts` dihapus**, bukan diimplementasikan. Prototipe `web-tree-sitter` + `tree-sitter-typescript` berjalan dan cepat (init 89 ms, load grammar 19 ms, parse 6 ms), tapi perbandingan pada 5 file nyata menunjukkan yang terlewat regex hampir seluruhnya **member kelas dan helper lokal** (`constructor`, `append`, `execute`, `check`, `__setMode`) — bukan simbol top-level yang berguna untuk orientasi. Biayanya: dua dependensi, ~1,4 MB wasm per bahasa dikali sembilan bahasa, grammar terpisah, jalur async baru. Faktor penentu: repo-map **sudah menyentuh cap 2.500 char** pada repo ini, jadi simbol tambahan tidak akan sampai ke prompt — ia justru menggeser yang lebih penting. Alasan + tabel pengukuran dicatat di komentar `extractSymbolsAsync` agar keputusan tak perlu diulang dari nol.

### Security — Fase 2

- **bash-guard berbasis normalisasi** (`src/policy/bash-guard.ts`) menggantikan denylist regex-atas-string-mentah. Rencana awal "tambal celah satu-satu" ditinggalkan karena tidak menyelesaikan akar masalahnya: shell menganggap banyak bentuk setara sementara regex melihat karakter. Sekarang quote pemisah kata dibuang dan assignment variabel literal disubstitusi (dengan re-scan per lintasan untuk rantai) **sebelum** pemeriksaan, lalu bentuk ternormalisasi dan mentah keduanya diperiksa.

  Kelas yang kini tertutup: indirection variabel (`X=.env; cat $X`), quote-splitting (`cat .e""nv`, `pyt"h"on3 -c`), flag panjang (`node --eval`/`--print`), env dump (`env`/`set`/`export -p`/`declare -x`/`compgen -v` — sebelumnya hanya `printenv`), referensi env berkata-kunci rahasia, upload-exfil (`-d @`, `-F …=@`, `-T`, `--upload-file`, `--post-file`), process substitution dan here-string, download-then-run dua tahap, container escape (`-v /:`, `--privileged`, `--pid host`), scan dari root filesystem, akses berkas/direktori kredensial, serta `rm` rekursif dengan target berbahaya.

  Terukur oleh `experiments/bash-bypass-probe.ts` (38 pola serangan + 15 perintah sah sebagai guard anti-over-block): mode `auto` dari **33/38 bypass → 0/38**, mode `allowlist` dari **7/38 → 0/38**, over-block dari 1 dan 4 → **0**. Audit awal melaporkan 13 bypass karena hanya 13 pola yang diuji saat itu; setelah korpus diperluas, angka sebenarnya lebih buruk.

- **`rm -rf` dipisah dari target berbahaya.** Pola lama menganggap setiap `/` berbahaya sehingga `rm -rf node_modules/.cache` ikut ditolak. Sekarang `rm` rekursif hanya ditolak bila targetnya root, home, traversal `..`, wildcard telanjang, atau `--no-preserve-root`.

- **Sandbox aktif otomatis** (`src/policy/sandbox-policy.ts`). Bila bubblewrap (Linux) atau seatbelt (macOS) tersedia, bash berjalan di dalamnya tanpa flag. Bila tidak ada isolasi nyata — termasuk semua Windows — permission default turun ke `allowlist` dan alasannya dicetak sekali; prinsipnya jangan pernah menjanjikan isolasi yang tak bisa dipenuhi. Pilihan user (`--allow-all`/`--ask`/`--plan`/`--allowlist`) tidak ditimpa dan tidak dapat peringatan. `--sandbox none` = opt-out sadar dan senyap. `--sandbox docker` yang daemonnya mati juga tidak berpura-pura: downgrade + peringatan. Docker tidak dipakai otomatis meski tersedia karena menarik image tanpa diminta terlalu invasif untuk sebuah default. Berlaku juga di `minicode exec`, yang justru paling butuh karena tak ada manusia untuk menyetujui prompt.

- **Allowlist diperluas ke perintah read/build yang sah.** Sebelumnya hanya 13 pola sehingga `grep -r TODO src` ikut ditolak. Operasi tulis lewat shell (`mkdir`, `cp`, `mv`, `rm`, `touch`) **tetap ditahan** — itu memang tujuan mode paling ketat; agent yang perlu menulis punya `write_file`/`edit` yang ter-jail.

- **`SECRET_ENV_RE` berbasis kata-kunci kredensial.** Pola lama memuat nama vendor telanjang (`GITHUB`, `GOOGLE`, `AZURE`, `REDIS`, `SUPABASE`), sehingga `GITHUB_WORKSPACE`, `GITHUB_REF`, `GITHUB_SHA`, `GOOGLE_CHROME_PATH`, `AZURE_CONFIG_DIR`, `REDIS_HOST`, `AWS_REGION` ikut terhapus dari env subprocess dan memecahkan build CI. Nama vendor sekarang hanya dicocokkan bila disertai penanda rahasia. Diuji dengan 24 nama rahasia dan 21 nama benign.

### Fixed — tiga bug yang lolos CI karena `cli/` di luar `tsconfig` dan tanpa test

- **Semua slash builtin mati di TUI.** `cli/fullscreen-driver.ts` memakai variabel `cmdName` yang tak pernah dideklarasikan; `ReferenceError`-nya ditelan `catch { return null }`, sehingga `/help`, `/cost`, `/status`, `/sessions`, `/undo`, `/redo`, `/init`, `/theme` gagal senyap dan user hanya melihat "perintah tidak dikenal". Deteksi builtin kini lewat nilai kembalian `handled`, bukan exception. `captureOutput` jadi generik dan meneruskan nilai `fn`. `shouldExit` untuk `/exit` yang sebelumnya diabaikan ikut ditangani.
- **`exec --json` tidak pernah stream event.** `events.on(handler)` satu argumen mendaftarkan listener di bawah key `"function"` sehingga tak pernah terpanggil — mode headless untuk CI tidak berfungsi seperti didokumentasikan. Diganti `on("*", handler)`. Ringkasan pindah dari stderr ke stdout sebagai `{"type":"summary"}` supaya pipeline membaca satu stream. `--allowlist` yang bocor menjadi bagian prompt di subcommand `exec` juga diperbaiki.
- **Shift+Tab cycle permission adalah placebo.** `__setMode`/`__getMode` di `src/policy/permission.ts` hanya ada di *type-cast* tanpa implementasi, dan `session.config` tidak diekspos kernel — header menampilkan "plan" sementara agent tetap bisa menulis file dan menjalankan bash. Kedua method diimplementasikan (plus invalidasi `allowlistCache`), dan seam `onPermissions` di `createMinicodeSession` menyerahkan handle ke `CliSession.permissions`. Kernel tidak disentuh.

### Added — tool fundamental (Fase 1)

- **`read_file` paging bernomor.** Output diberi nomor baris (`12: const x = 1`) agar rujukan `edit`/`apply_patch` akurat. Param `offset` (1-indexed) + `limit` (default 2000, max 5000). File di atas 2 MB kini bisa dibaca per bagian; tanpa paging tetap ditolak — memotong konteks diam-diam lebih berbahaya daripada error eksplisit. Baris sangat panjang dipotong per baris, direktori ditolak dengan pesan spesifik.
- **`grep` dua engine.** `rg` dipakai bila ada di PATH (`--vimgrep --no-follow`, exclude `.git`/`node_modules`/dotdir), fallback walker internal dipertahankan dan diuji memberi hasil identik. `MINICODE_GREP_ENGINE=js` memaksa fallback; CI menguji jalur itu eksplisit. Jail berlaku di keduanya — walker via `realpath`, ripgrep via validasi tiap baris hasil.
- **`todo_write` / `todo_read`.** Rencana kerja per sesi di `.minicode/todos/<id>.json` (atomic). Kirim seluruh daftar, bukan delta. Hanya satu `in_progress` dipertahankan; sisanya dinormalisasi ke `pending`. File korup dianggap kosong. Dirender utuh di TUI (transcript kind `todo`) dan one-shot logger. `todo_read` masuk READONLY sehingga tetap boleh di mode `plan`.
- **`bash` streaming + background.** Foreground memancarkan `provider:extension` kind `bash-output` inkremental (tampil di `--verbose`). `background:true` mengembalikan job id, lalu `bash_output(id)` (hanya output baru sejak baca terakhir) dan `bash_kill(id)`. Job di-cap, yang selesai di-reap, dan semua dimatikan saat CLI keluar. `background:true` **ditolak** saat `--sandbox` aktif: container/namespace ephemeral mati bersama call-nya, jadi janji isolasi tidak bisa dipenuhi untuk proses berumur panjang.

### Changed — distribusi

- **`bun install` tidak lagi butuh clone sibling.** Kernel MiniCore di-vendor ke `vendor/minicore` (19 file, ~72 KB); dependency jadi `file:./vendor/minicore`. Opsi publish ke npm ditinggalkan karena butuh kredensial dan tidak reversible. `scripts/vendor-minicore.ts` menyinkronkan dari `../minicore` dan `--check` mendeteksi drift lewat hash agregat (gate CI baru `vendor:check`). Tanpa sibling, script tetap lulus dengan pesan agar kontributor tidak diblokir. Terverifikasi: salin file tracked ke direktori kosong → install, typecheck, dan seluruh test hijau tanpa `../minicore`.
- **Executor: `bash` bukan lagi "write".** `bash` dipindah ke `EXCLUSIVE_TOOLS` — sebelumnya ia mengambil write-slot tapi `getFilePath()` selalu `null` untuknya, sehingga dengan write-concurrency 1 dua bash read-only terserialisasi tanpa alasan.
- **Coverage gate nyata.** Label CI "threshold 80" sebelumnya fiksi: `bun test --coverage` tanpa konfigurasi selalu lulus. `bunfig.toml` `coverageThreshold` juga tidak bisa dipakai karena Bun mengevaluasinya per-file (bahkan 0,01 gagal karena ada file 0% yang hanya jalan di Linux/macOS). Diganti `scripts/coverage-gate.ts` yang mem-parse baris "All files"; diuji dua arah.
- **Typecheck mencakup seluruh repo.** `tsconfig.json` `include` kini memuat `cli`, `scripts`, `experiments` — 3.178 LOC entry point yang sebelumnya tak pernah diperiksa. 14 error yang muncul dibereskan.
- **Lint bersih.** 68 error → 0. `noControlCharactersInRegex` diselesaikan dengan `ANSI_PATTERN` sebagai satu sumber di `src/tui/theme.ts`, dipakai ulang oleh `wrap`, `panel`, `commands`, `input`, `fullscreen`, dan `human-sim`.

### Removed

- `minicode-0.6.0.tgz` (183 KB artifact build ter-commit); `*.tgz` masuk `.gitignore`.

### Docs

- Angka yang bisa dihitung mesin (jumlah test, tool, coverage) dibuang dari README/ARCHITECTURE/CONTRIBUTING/USAGE. Repo sebelumnya memuat tiga angka test berbeda dan dua jumlah tool berbeda; klaim semacam itu membuat pembaca teknis mendiskon klaim lain yang benar.
- `CONTRIBUTING.md` masih menyatakan "proprietary / closed source, tidak menerima PR" padahal `LICENSE` sudah MIT sejak 0.7.0 — diperbaiki.
- Referensi Ink yang sudah dihapus dibersihkan dari README, ARCHITECTURE, dan `src/tui/format.ts`.
- Known Limitations diperluas; tiap poin menunjuk fase PLAN_V4 yang menanganinya. Batas nyata denylist bash dinyatakan eksplisit **dengan contoh pola yang lolos**, bukan disembunyikan.
- Koreksi pengukuran: audit melaporkan walker grep 3.550 ms; setelah diukur ulang di proses bersih angkanya ~110–160 ms — 3.550 ms termasuk cold start import, bukan biaya scan. Klaim "50× lebih lambat" di audit terlalu keras dan dikoreksi di PLAN_V4.

### Tests

- `test/cli-regression.test.ts` — 10 test untuk tiga bug di atas. B2 diuji dengan membandingkan `on("*")` versus `on(handler)` di run yang sama, jadi test itu mendokumentasikan kenapa pola lamanya salah.
- `test/phase1-tools.test.ts` — 35 test: paging `read_file` (termasuk file >2 MB), kesetaraan dua engine grep, normalisasi/render/roundtrip todo, background job (output baru, cap, kill, penolakan saat sandbox), dan permission untuk tool baru di mode auto/plan/readonly.
- `test/phase2-security.test.ts` — 160 test: normalisasi bash-guard, 33 kelas bypass yang dulu lolos, 25 pola lama yang harus tetap tertutup, 32 perintah sah sebagai guard anti-over-block, integrasi guard di tiap mode permission, 10 skenario resolusi sandbox, dan 45 nama variabel env.
- `test/shadow-git.test.ts` — 22 test: index/HEAD user utuh, ref tak tampil di `git log`/`branch`, tahan `gc --prune=now`, line ending preserved (regresi `core.autocrlf`), `sessionId` ilegal (regresi path index Windows), `.gitignore` dihormati saat snapshot **dan** restore, undo/redo lintas tree, 250 file tanpa cap, manifest tetap kecil untuk file besar.
- `test/mcp-http.test.ts` — 28 test terhadap **server HTTP nyata** (`Bun.serve`), bukan mock fetch, karena yang rawan justru perilaku di atas kabel: event SSE terpotong tepat di tengah payload JSON, pemisah CRLF, event non-JSON di antara balasan, notifikasi sebelum balasan, aliran berakhir tanpa balasan (harus error bukan hang), sesi & protocol header, redirect ditolak, host privat ditolak, body cap.
- `test/phase4-auth-git-pricing.test.ts` — 49 test: device flow terhadap **server OAuth lokal** (pending, slow_down dengan kenaikan interval, access_denied, expired_token, clamp interval, balasan HTML dari captive portal, abort di tengah polling), `git_commit` (shell-injection lewat pesan, flag-injection lewat nama file, jail path & cwd, commit kosong, permission per mode), dan pricing (median antar-provider, entri $0 diabaikan, anti-substring, cache hanya field biaya).
- `experiments/bash-bypass-probe.ts` — harness pengukuran postur denylist yang outputnya dipakai di dokumentasi. Exit 0 hanya bila 0 bypass **dan** 0 over-block, jadi bisa dijadikan gate CI (`bun run gate:bash`).

## [0.7.0] - 2026-08-29

### TUI & UX Polish — "Production Ready"
- **Theme-aware TUI** — `modeColor` dari semantic colors (`c.success` auto, `c.warning` plan, `c.info` ask), header responsive `<80 cols`, footer dynamic cost + hints
- **Input engine unified** — `decodeKeys` + `applyKey` dari `prompt-engine` single source, emoji 2-unit, bracket paste `\x1b[200~` support, Ctrl+O/R/Shift+Tab native key types
- **Diff cards** — `renderDiffCard` untuk edit/apply_patch (Ubuntu style +/−), ANSI-safe wrap via `formatWrapped`
- **Performance** — `RING_MAX 100→60`, spinner `setInterval→setTimeout` coalesce, diff repaint `prevOut` cache
- **Accessibility** — bracket paste `\x1b[?2004h`, mouse `\x1b[?1000h`, cursor restore on crash
- **Input fixes** — Tab/enter sel=-1 bug fix, case-insensitive matches, history via prompt-engine

### License
- **MIT License** — `UNLICENSED → MIT`, `private: false`, npm publish ready

### Security & Core
- **Minicore v0.1.1** — retryAfter cap 30s (`RETRY_AFTER_MAX_MS`) P2 fix
- **Extreme experiments** — fuzz/context/security all pass (257+154 tests)

## [0.6.0] - 2026-08-26

### UI/UX Overhaul - "Clean CLI"
- **Fullscreen Ink shell default** (`--ui auto|full|classic`): alternate-screen REPL terisolasi (ESC[?1049h/l) - header 1 baris (brand/model/mode/cost), transcript scrollable ring 200, status dots animasi, input dengan slash-dropdown, footer hint. Exit = terminal kembali bersih.
- **Ctrl+C lifecycle**: busy = hentikan turn saja (AbortController via kernel seam `session.run({signal})`); idle = 2x dalam 2 detik keluar bersih. Esc juga interrupt.
- **Mojibake Windows tuntas** - semua string konsol di-sweep ke ASCII-safe; prompt memakai `glyphs.prompt` (fallback `>` tanpa UTF-8).
- **Status line rapi** - kata "reasoning"/"working" dihapus (dots cukup); output tool tidak lagi menyisakan fragmen spinner (statusline suspend/resume).
- **Shift+Tab** cycle permission mode live (auto/ask/plan/allowlist) + badge header.
- **`/thinking on|off`** toggle tampilan reasoning (default off). `/init` generator AGENTS.md dari repo-map.
- **Ctrl+O** expand transcript; multiline `\`+Enter; edit keys Ctrl+U/W.
- **Bel terminal** saat permission request (ala OpenCode attention).
## [0.5.1] — 2026-08-26

### Security (P0)
- **Env sanitasi terpusat** — `sanitizeSpawnEnv()` dipakai semua spawn (bash/docker/MCP/LSP); secret (`*API_KEY/TOKEN/SECRET/DATABASE_URL`…) tidak pernah diwarisi container/server walau caller lupa strip; env eksplisit config tetap menang setelahnya.
- **MCP gating penuh** *(behavior change)* — mode `auto` tidak lagi auto-allow tool dari server MCP terdaftar; semua nama bertitik kini gated (prompt sekali + `[a] Always` persist). Menutup RCE supply-chain via server jahat.
- **SSRF web_fetch** — redirect ditangani manual (maks 5 hop) dengan re-validasi tiap host target; blok tambahan CGNAT 100.64/10, IPv4-mapped IPv6, fc00::/7, fe80::/10, `*.internal/.local/.localhost`; body dibaca dengan hard-cap 2MB (anti-OOM).
- **Scrubber tanpa whitelist** — kata `test/example/mock` tidak lagi melewati redaksi; secret yang mengandung substring itu tetap di-[REDACTED].

### Reliability
- **Executor abort-aware** — antrean write-slot & file-lock langsung reject saat abort (tidak lagi menunggu tool in-flight, bash bisa 30s); ownership handoff menjaga semaphore seimbang.
- **Atomic writes** — helper `atomicWriteText` (randomUUID tmp + `O_EXCL` + 0600 + rename retry utk Windows EPERM) dipakai write_file/edit/apply_patch/allowlist/config/checkpoint manifest.
- **Jail realpath di permission layer** — symlink keluar workspace tertangkap sebelum eksekusi tool; `SENSITIVE_RE` di-anchor per segmen (fix false-positive `my_node_modules*`) + cakupan baru (.git-credentials, credentials.json, secrets.yaml/yml/json, tfvars, .pfx/.jks).
- **SQLite** — WAL capped (`journal_size_limit`, `wal_autocheckpoint`) + retry SQLITE_BUSY untuk penulis konkuren.
- **Telemetry** — opt-out `MINICODE_TELEMETRY=0`, prompt di-scrub, chmod 0600, rotasi atomic.

### Correctness
- **Router image fix** — konten biner tool result tidak lagi di-base64-kan sebelum provider anthropic (image block media_type benar via magic-byte sniffing; fallback base64 untuk biner lain).
- **`/sync` benar-benar sync** — cache deteksi 30 menit di-invalidate saat refresh; timeout fetch per-attempt 2.5s.
- **CLI args** — `--verify` boolean (tak bocor ke prompt), dukung `--flag=value`, flag berulang terfilter semua (last-wins).
- **Pricing boundary match** — `my-gpt-4o-wrapper` tak lagi dihitung sebagai gpt-4o; varian versi (`gpt-4o-2024…`) tetap cocok.
- **Silent catch** — migrasi DB/purge/embedding/checkpoint korup kini mencetak `[warn]`.

### Engineering
- **LIMITS dipakai sungguhan** — 20 modul memakai konstanta terpusat (+15 key baru); duplikat magic number dihapus.
- **Type-safety produksi** — nol `as never`/`as any` di `src/ cli/`; `createMinicodeSession` menerima seam kernel secara type-safe.
- **dbPath dedup** — satu resolver untuk sessions.db & vector.db.

## [0.4.0] — 2026-08-25

### UI/UX (rencana Fase 5–6)
- **Preset gateway** — `/provider-add` & wizard: 6 preset (OpenAI/Anthropic/OpenRouter/DeepSeek/OpenCode Zen/Google) — baseUrl+fallback otomatis.
- **`provider::model` routing** — pilih provider spesifik; router first-match-wins untuk model kembar.
- **`minicode providers | models [id] --match <kw> | sync`** — kelola gateway tanpa LLM; `/sync` auto-sync model baru.
- **Dropdown suggestions** — floating grouped `COMMANDS`/`SKILLS` (header dimmed), max 10 + `… N more`; **bug fix name placeholder** (suggestion tidak lagi `/models [id]`).
- **Transparansi fallback** — summary turn & `/cost` menampilkan model/provider efektif saat router substitusi.
- **Turn status line** — spinner `· model · working…` (TTY), label berganti saat fallback.
- **Budget di prompt** — `minicode❯[62%]` saat `--budget`.
- **Error user-friendly** — kategori formal (`auth`/`rate_limit`/...) → pesan + fix, bukan dump JSON.
- **`/resume [id]` + `/sessions` bernomor** — resume sesi lewat picker.
- **Compaction faktual** — hasil tool sukses (isi file, output test) ikut di-LLM-summarized (bukan `<result omitted>`).

### Engineering
- **Prompt engine pure** (`cli/prompt-engine.ts`) + **fuzz test** (~93k asserts, 195 test total).
- **`test:live` terpisah** — `bun run test:live`; `bun test` default offline (8 skip).
- **CI fix** — checkout minicore sibling (dependency `file:../minicore`) + cache bun.
- **Telemetry gate** — resolve-rate ≥ 0.3 (live: 0.59); `scripts/telemetry-gate.ts`.
- **TTL configurable** — `MINICODE_SESSION_TTL_DAYS` (0=forever); `minicode sessions purge`.
- **Checkpoint prune** — 20 terbaru per session.
- **Detect cache** — 30 menit per baseUrl; lazy import ink/react (startup <400ms).
- **Cost attribution** — `deepseek-v4-flash` pricing; cost dihitung pakai model efektif.

## [0.3.2] — 2026-08-25

### UX Provider & Gateway
- **Preset gateway** — `/provider-add` & setup wizard: pilih OpenAI/Anthropic/OpenRouter/DeepSeek/OpenCode Zen/Google → baseUrl, fallback models & id ramah otomatis. Custom URL tetap bisa.
- **Pengelolaan tanpa LLM** — `minicode providers | models [id] | sync` subcommands langsung.
- **`/sync` & refresh models** — model baru dari gateway tersinkron otomatis; apiKey intak.
- **Scope global/local** — `/provider-add` tanya penyimpanan (global default ~/.minicode); `/provider-remove` hapus dari kedua scope.
- **Transparansi fallback** — `/cost` & `/status` menampilkan model efektif bila router substitusi.
- **Auto-refresh cap 6s** — deteksi gateway offline tidak membuat user menunggu 30s.
- **Plain text** — `--help` & wizard tanpa ANSI (aman console legacy).
- `/sessions` bernomor + `/resume [id]` picker interaktif (respawn dengan seeding penuh).

## [0.3.1] — 2026-08-25

### QoL / TUI
- **Floating dropdown** saat ketik `/` di REPL — dimmed, seleksi `›`, ↑/↓ navigasi, Tab/Enter complete, Esc tutup, max 10 + `… N more`. Fallback inline di console legacy (auto-detect ANSI via DSR probe).
- **Prompt engine** `cli/prompt-engine.ts` — state machine input jadi pure function (testable), input.ts cuma IO+render.
- Error user-friendly (balance/auth/rate/timeout/context) — tidak lagi raw JSON 401.
- Unknown `/command` tidak di-forward ke LLM.
- `/model` & `/models` jadi picker interaktif; format `providerId::model` untuk pilih provider spesifik.
- Router: first-match-wins untuk nama model kembar (fix 401 jatuh ke provider salah).

### Engineering
- `bun run test:live` — live E2E terpisah dari `bun test` default (CI-safe tanpa secrets).
- 20 test baru untuk prompt engine.
- Fix `glyphs.sparkle` missing (`--help` "undefined Minicode").
- `detectAnsi` — probe DSR idempotent, tidak ada listerner bocor.

## [0.3.0] — 2026-08-24

### Security
- **Allowlist mode** (`--allowlist`) — bash hanya perintah aman (git/bun/npm/echo/ls/cat) via `DEFAULT_BASH_ALLOWLIST` atau `MINICODE_BASH_ALLOWLIST`.
- **Docker sandbox hardening** — `--read-only`, `--cap-drop ALL`, `--pids-limit 128`, `--tmpfs /tmp`.
- **Plan mode** (`--plan`) — read-only planning (write/bash/delegate diblokir) + workflow "Proceed to execute?".
- **Budget enforce** (`--budget <usd>`) — warn 80%, exit(1) one-shot / break REPL bila lewat.
- **Secret scrubber** — 9 pola (sk-/AKIA/PEM/JWT/Bearer/api_key=) di read_file/bash/grep, whitelist `test|example|mock`.
- **Jail** — `.env`/`.git/credentials`/`.ssh`/`.aws`/`.npmrc`/`.netrc`/key/pem; path traversal di `/undo` diblokir.

### Core / Kernel (minicore, additive seams)
- `SessionConfig.initialMessages` — seed history penuh (resume sejati).
- `compactAsync` — LLM compaction async dengan fallback mekanikal.

### Context & Repo
- **Repo-map** — regex 9 bahasa (TS/Py/Go/Rust/Java/C/C#/Ruby/PHP), ranking import-graph, cache `.minicode/repomap.json`, fallback LSP `workspace/symbol`, env `MINICODE_REPOMAP=regex`.
- **Self-heal** (`--verify`) — auto-detect typecheck/test/tsconfig, 3 siklus, guard fence anti prompt-injection.

### TUI/TUX
- Split-view responsif (<80 col stack), markdown fence highlight, scroll arrow keys, budget gauge.
- `cli/index.ts` dipecah → `cli/setup.ts` + `cli/repl.ts` + entry tipis; format event terpusat `src/tui/format.ts`.

### Operasional
- `minicode stats` — agregasi `.minicode/traces.jsonl`.
- Benchmark — 5 task + loader external (SWE-bench-format) + delta antar run.
- Telemetry `.minicode/traces.jsonl` (rotate 1000).
- Sesi TTL 30 hari; checkpoint pre-turn workspace snapshot.

## [0.2.0] — 2026-08-24

- Hardening keamanan: auto-gate delegate/mcp, denylist 27 regex, env-sanitize, jail terpusat.
- TUI: diff card, table, spinner, markdown fence, masked wizard, history, tab completion.
- Prompt caching Anthropic, fuzzy edit 4-level, apply_patch, checkpoint `/undo`/`/redo`.
- Repo-map (regex), auto-verify, resume sejati, rate limiter, Docker sandbox, telemetry JSON.
- 132 test + bench harness.

## [0.1.3] — 2026-08-22

- Audit 100% komponen, extreme test suite, security hardening (symlink escape, denylist bypass).
- 59 test.
