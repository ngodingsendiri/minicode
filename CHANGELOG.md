# Changelog

## [0.8.0] - 2026-09-02 — Penghapusan tema + perbaikan cwd jail (P2.1) + hardening lanjutan

### Fixed
- **P2.1 `cwd` jail tuntas (P0 keamanan):** semua tool file (`write_file`, `read_file`, `edit`, `apply_patch`, `glob`, `grep`, `bash`, `git_*`) sebelumnya memakai `process.cwd()` sehingga `--cwd` menyesatkan dan `isPathOutsideRoot` ter-anchor ke direktori yang salah. Ditambah seam aditif `cwd?: string` di `vendor/minicore/src/core/tool.ts:22` + `executor.ts` + `session.ts` + `loop.ts`, diteruskan dari `src/app/session.ts:96` → kernel, dan `src/tools/*` kini memakai `ctx.cwd ?? process.cwd()` dengan `resolve(sessionRoot, raw)` + file-lock per-cwd. `vendor/minicore` sinkron (`19 file, 4591de2f578d9f4c`), `vendor/minicore` source di `D:\git\minicore` juga diperbarui.
- **Penghapusan fitur tema:** `src/ui/render/themes.ts` dihapus, `src/ui/render/theme.ts` jadi palet tunggal TOKENS dark, flag `--theme`/`/theme`/`MINICODE_THEME`/`themeState`/`applyTheme` dihapus dari `cli/index.ts` & HELP, test `theme.test.ts` disesuaikan (palet tunggal, NO_COLOR), `cli-session` block `--theme` dihapus, `no-frozen` komentar diperbaiki, `extreme-mcp` diselaraskan ke English.
- **Lint & lockfile:** `bun.lock` dinormalisasi via `bun install`, 9 file terhapus dari `outputs/` (audit lama) + `.verdent` plan diarsipkan, `package-lock.json` ganda dihapus, `import-convention` & `extreme-mcp` lolos setelah English-only.

### Changed
- `AGENTS.md` Jebakan ditambah catatan `ToolContext.cwd` + versi badge `v0.8.0` di `docs/ARCHITECTURE.html`.

### Test & Gate
- `1168 pass 0 fail`, `gate:coverage` 82.79%/85.22%, `gate:pack` 22/22, `gate:bash` 0 bypass, `extreme-bash-fuzz` 0/2582, `extreme-mcp` 67/67. `extreme-shadow-git` skala 2000 file masih timeout 300s di Windows (unit `shadow-git.test.ts` 22 pass — hambatan I/O Windows, bukan regresi).

## [Unreleased] — Audit UI/UX (V6) + uji live multi-provider (V7) + bug hunter UI (V8)

### V8 — bug hunter UI/UX: 31 temuan dari tiga ronde

Metode: harness adversarial per lapisan render, lalu **verifikasi dampak** dengan menggerakkan TUI sungguhan. Pemisahan itu penting — 5 dari 12 temuan ronde 1 ternyata tidak berdampak (simple logger tidak merender diff card; tidak ada sumber nyata untuk newline di tabel), dan tidak diperbaiki.

| Metrik | Sebelum V8 | Sesudah |
|---|---|---|
| Test | 913 pass | **1064 pass** |
| Coverage | 80,52% / 83,10% | **81,46% funcs / 83,03% lines** |
| Temuan hunter tersisa | — | **0** (tiga harness) |

**Lebar karakter salah di seluruh lapisan** — akar, bukan gejala. Semua kode menganggap 1 karakter = 1 kolom. Bukti: 38 code point CJK menempati **73 kolom** di terminal 40 kolom; baris membungkus sendiri dan frame TUI (dihitung per baris) rusak. Ditambah `src/tui/width.ts` (tabel EastAsianWidth UAX #11): CJK/Hangul/kana/emoji 2 kolom, combining mark & ANSI 0 kolom. Seluruh pemanggil dialihkan: `truncAnsi`, `renderTable`, `wordWrap`, `justifyLine`, `renderDiffCard`, kursor fullscreen, `scrollableLine`, `padToWidth`.

**Teks model bisa mengendalikan terminal.** Terverifikasi sampai ke terminal: `provider:text` berisi `aman\x1b[2J\x1b[H\x1b[?1049hJAHAT\x1b]0;bajak\x07` benar-benar membersihkan layar, keluar dari alternate screen, dan mengubah judul jendela. Model, server MCP, atau isi berkas bisa memanipulasi tampilan. Ditambah `src/tui/sanitize.ts`: **hanya SGR** (`ESC[…m`) yang lewat; CSI non-SGR, OSC, DCS, dan C0 selain tab/newline dibuang. Diterapkan ke `provider:text`, hasil tool, argumen tool, dan isi todo — warna diff card tetap utuh.

**Fence markdown tanpa bahasa didekorasi sebagai markdown.** `npm run build -- --flag=*value*` kehilangan bintangnya karena dianggap italic. Hanya fence *berbahasa* yang dilindungi sebelumnya; fence tanpa bahasa justru bentuk paling umum untuk perintah shell.

**Byte kontrol masuk prompt.** Ctrl+L/K/T/Z jatuh ke cabang `char`: `"teks"` + tiga tombol itu mengirim `"teks\f\u000b\u0014"` ke model — tak terlihat di layar, tapi ikut terkirim. Kini semua C0 tak dikenal dibuang. Paste multi-baris juga: newline masuk baris input dan membuat frame 26 baris di terminal 24; kini newline/tab jadi spasi.

**Semua overlay mengabaikan terminal kecil.** `picker` dan `panel` punya lantai minimum (`Math.max(44, …)`, `Math.max(40, …)`, `Math.max(5, …)`) yang memaksa ukuran lebih besar dari terminal: label 55 kolom digambar di terminal 40 kolom, 6 baris dicetak di terminal 3 baris. Lantai dihapus.

**Wizard setup adalah titik terlemah** — ironis karena ia hal pertama yang dilihat pengguna baru. Memakai `readline` dengan `"Choice [1-15]"` sementara REPL punya `runPicker` (panah + filter), dan **nomor di luar rentang diam-diam jatuh ke pilihan pertama** sehingga mengetik `99` memilih OpenAI tanpa memberi tahu. Ditulis ulang memakai picker; 11 test baru (sebelumnya nol).

**`provider-manager` menulis config dengan konfirmasi paling minim.** `Delete "x"? [y/N]` tidak menyebut berapa model ikut hilang maupun bahwa provider itu sedang aktif. Kini menyebut jumlah model, memperingatkan bila aktif, dan menandai `(aktif)` di daftar.

**Lima perintah berfungsi tapi tidak bisa ditemukan.** `/clear`, `/exit`, `/quit`, `/compact`, `/history` ditangani tapi tidak terdaftar — tidak muncul di `/help` **dan** tidak bisa dilengkapi Tab. Kini 21 entri, dengan `hidden: true` untuk alias. `/help` juga dipecah: 29 → 18 baris (muat di overlay 24 baris), pintasan lengkap ke `/help tombol`.

**Alternate screen ditulis tanpa memeriksa dukungan terminal.** `isTTY` tidak menjamin VT — `TERM=dumb`, Emacs shell, conhost lama menampilkan `ESC[?1049h` sebagai sampah. Ditambah `supportsVt()` dan `MINICODE_NO_ALT=1`.

**Pola beku, kali ketiga.** Setelah objek warna `c` (V6) dan palet tema (V6), kini `glyphs` (`supportsUtf8` dievaluasi saat import) dan `const OK = glyphs.check` di `commands.ts`. Semuanya jadi getter/fungsi. Tiga kali bug yang sama menandakan kecenderungan struktural — ditangani sebagai item rencana, bukan tambalan.

Lainnya: `renderTable` melempar pada `width` negatif; nilai bernewline memecah baris tabel; kata/URL/CJK tanpa spasi tidak di-wrap (kini dipecah per kolom); `renderDiffCard` tidak membatasi panjang baris; penanda hasil aksi bercampur (`[OK]`/`[FAIL]` vs kalimat vs tanpa penanda); bahasa campur Inggris–Indonesia di wizard, provider-manager, dan pesan slash command.

### V8 — test baru (+151)

`width.test.ts` (34) · `sanitize.test.ts` (26) · `tui-overlay.test.ts` (18) · `wizard.test.ts` (11) · `cli-help-language.test.ts` (29) · plus tambahan di `tui-diff`, `tui-table`, `tui-format`, `prompt-engine`.

### V7 — empat bug yang hanya muncul dengan provider sungguhan

Diuji dengan dua gateway nyata: `gorouter.app` (4 model Claude) dan OpenRouter (**18 model gratis**, matriks penuh). Yang diukur bukan kualitas model, tapi apakah lapisan minicode bertahan di bawah token nyata, rate-limit mendadak, endpoint hilang, dan harga yang tidak ada di tabel.

| Metrik | Sebelum V7 | Sesudah |
|---|---|---|
| Test | 876 pass | 913 pass |
| Model gratis OpenRouter berhasil tool-call | — | 12/18 (6 sisanya ditolak provider: 429/403/404) |
| Resolve-rate terukur | 0,00 (5 trace provider maintenance) | **1,00** (5/5 tugas berpemeriksa objektif) |

**`/cost` dan `--budget` selalu 0 setelah turn pertama** (`src/policy/usage.ts`). `fullscreen-driver` memanggil `usage.reset()` setiap turn, dan `reset()` menghapus satu-satunya akumulator yang ada. Bukti live: 51.915 token nyata dilaporkan sebagai **0 token, $0.0000**. Konsekuensinya berantai — `/cost` yang berjudul "biaya sesi" selalu nol, header REPL kembali `$0.0000` setelah setiap jawaban, dan `--budget` **tidak akan pernah terpicu** berapa pun yang dibakar. Kini ada dua akumulator: `get()` per-turn dan `getSession()` kumulatif. Setelah perbaikan 74.354 token / $0.3745 terlaporkan benar, dan `--budget 0.05` benar-benar menolak prompt berikutnya.

**`cli/errors.ts` punya 10 test tapi tidak dipanggil dari mana pun.** Renderer memakai `formatProviderError()` yang mencetak `[kategori] <pesan mentah>`, sehingga body JSON provider tumpah utuh. Satu 429 OpenRouter menghasilkan 400+ karakter berisi `metadata`, `provider_error_code`, `limit_source`, dan URL dokumentasi — di dalam frame TUI selebar 100 kolom. Kini semua jalur error (`formatProviderError`, `formatError`, event `provider:extension`, dan `catch` di `submit()`) melewati satu formatter. Ditambah `extractProviderDetail()` yang tahu bentuk-bentuk nyata: OpenRouter menyembunyikan alasan sebenarnya di `metadata.raw` sementara `message` hanya berbunyi "Provider returned error"; Cloudflare mengirim HTML dengan `<title>`; body streaming bisa terpotong di tengah JSON.

Hasilnya: `z-ai/glm-5.2:free is temporarily rate-limited upstream.` + saran dari `remedy_hint` provider, bukan dump JSON.

**Model gratis dihargai seperti varian berbayarnya** (`src/policy/pricing.ts`). Pencocokan per-segmen mengabaikan sufiks `:free`, jadi `z-ai/glm-5.2:free` dilaporkan $1,25/M padahal OpenRouter menyatakan `prompt=0 completion=0` (diverifikasi lewat `/api/v1/models`). Dampaknya bukan kosmetik: `--budget` bisa memutus sesi yang sebenarnya tidak berbiaya sepeser pun. Kini `:free` selalu $0, kecuali overlay punya entri eksplisit untuk id ber-`:free`.

**`exec` mengirim nilai flag ke model sebagai bagian prompt** (`cli/commands/exec.ts`). Filternya `a !== getArg("--model") && a !== getArg("--cwd")` hanya membuang nilai dua flag. Terverifikasi: `exec "ulangi: MARKER" --provider gorouter --session uji --timeout 120000` mengirim `"MARKER gorouter uji 120000"`. Pada satu run model benar-benar tersesat — 38.072 token ($0,19) dipakai menebak apakah "gorouter" itu proyek Cloud Foundry dan apakah "60000" itu port atau timeout. Kini memakai `promptFromArgs()`, implementasi yang sama dengan jalur non-exec.

### V7 — perbaikan pendukung

- **`--budget 0.001` tampil sebagai `$0.00`** → pesan pemutusnya berbunyi `$0.0601 > $0.00`, user membaca batas nol. `src/tui/money.ts` baru: di bawah $1 pakai 4 desimal.
- **Model tidak tahu direktori kerjanya.** System prompt tidak menyebut cwd, jadi model menebak — pada uji `--plan` ia menyimpulkan *"cwd saat ini adalah /, yang tidak writable"* padahal berjalan di workspace Windows normal. Ditambah bagian `# Environment` (cwd + platform).
- **Trace bermodel kosong** saat user tidak memberi `--model`, sehingga tidak bisa diatribusikan ke provider dan kolom Status di `minicode providers` selalu "belum dipakai" meski sudah dipakai. Kini memakai model efektif hasil substitusi router.
- **Kompaksi LLM mengabaikan signal yang sudah abort** (`addEventListener` tidak memicu untuk signal ter-abort), jadi request ringkasan tetap terkirim setelah user membatalkan.

### V7 — test baru (+37)

- `test/usage-session.test.ts` (8) — pemisahan turn vs sesi, akumulasi lintas turn, basis harga setelah reset.
- `test/money.test.ts` (6) — nilai kecil, batas $1, negatif, NaN/Infinity.
- `test/errors-usage.test.ts` (+13) — bentuk error nyata: 429 OpenRouter dengan `metadata.raw`, 403 agentic-harness, 404 no-tool-support, 502 HTML Cloudflare, body JSON terpotong.
- `test/providers-build.test.ts` (9) — id provider diteruskan (tanpa ini router memetakan semua ke satu kunci generik), hybrid Anthropic/OpenAI, provider OAuth tanpa login dibuang bukan dikirim dengan token undefined.
- `test/compaction.test.ts` (14) — ringkasan menggantikan prefix, hasil tool sukses ikut sebagai fakta, error ditandai, fallback saat provider gagal/kosong, abort diteruskan.
- `test/phase4-auth-git-pricing.test.ts` (+2) — `:free` tidak mewarisi harga.

### V7 — yang diverifikasi aman

- **API key tidak bocor**: 0 temuan pada seluruh berkas repo, tidak ada di `traces.jsonl`, tidak ada di output UI; `scrubSecrets` meredaksi di pesan error.
- Streaming 40 baris tidak melebihi tinggi terminal, tidak ada baris lewat lebar kolom, tidak ada sekuens ANSI tergantung.
- Tool call berantai (`write_file` → `bash` → `bash`) dengan berkas nyata di disk dan `bun test` lolos 6/6.
- Ctrl+C dan Esc menghentikan run tanpa keluar; REPL menerima prompt lagi sesudahnya.
- `--plan` benar-benar menolak `write_file`.
- Rangkaian 429 → 404 → 403 → model sehat: REPL pulih tanpa satu pun `unhandledRejection`.
- Gate lain tetap hijau: bash-fuzz 0 bypass, shadow-git 31/31, MCP adversarial 67/67, pack-check 22/22, vendor sinkron.

### V7 — masalah diketahui yang TIDAK diperbaiki

**`--cwd` diabaikan oleh semua tool file.** Berkas yang diminta di `--cwd <dir>` muncul di direktori proses. `write_file.ts:24` memakai `process.cwd()` sebagai root — begitu juga `read_file`, `edit`, `patch`, `glob`, `grep`. Sudah didokumentasikan sebelumnya di `scripts/human-sim.ts` ("kernel ToolContext tak punya cwd"). Tidak disentuh karena memperbaikinya berarti mengubah kontrak `ToolContext` di kernel yang dibekukan — keputusan arsitektur, bukan perbaikan UI. Konsekuensinya nyata: `--cwd` menyesatkan, dan jail keamanan ter-anchor ke direktori yang salah.

**Overhead gateway di luar kendali minicode.** Diukur langsung: request kosong ke gorouter sudah memakan 6.847 prompt token ($0,034) sebelum minicode mengirim apa pun. Kontribusi minicode sendiri ~4.455 token (system prompt 1.405 + skema 31 tool 3.050). Gateway juga menimpa identitas — ditanya namanya, model menjawab nama agent lain. Perilaku provider, tapi perlu diketahui saat menilai biaya.

---

## Audit UI/UX (V6)

Basis: audit UI/UX menyeluruh ([docs/PLAN_UIUX_V6.md](docs/PLAN_UIUX_V6.md)) — 24 temuan, diverifikasi dengan menjalankan tiap subcommand, mengemudikan TUI lewat harness keystroke sintetis, dan memanggil `handleBuiltinCommand` langsung.

| Metrik | Sebelum | Sesudah |
|---|---|---|
| REPL menerima prompt | **tidak** (mati bisu) | ya |
| Test | 747 pass | **859 pass** |
| Berkas UI tanpa cakupan test | 19 | 6 (jalur yang butuh proses nyata) |
| Coverage agregat | 71,95% funcs / 76,76% lines | **79,33% / 82,15%** |
| Gate coverage | min 69 / 74 | min 77 / 80 |

### Fixed — blocker

- **REPL mati bisu pada prompt pertama.** `render()` memanggil `startSpinner()`, yang memanggil `tickSpinner()` → `render()` lagi. Karena `spinnerTimer` baru terisi *setelah* `render()` selesai, guard `if (spinnerTimer) return` selalu lolos: rekursi tak berbatas → `RangeError: Maximum call stack size exceeded`. `onLine` **tidak pernah** terpanggil, layar berhenti pada prompt user tanpa spinner, tanpa jawaban, tanpa pesan error. Bug masuk pada `a4fcfa9` ("spinner coalesce") dan tidak tertangkap satu test pun — lapisan interaktif punya nol cakupan.

  Perbaikan: `startSpinner` men-set timer sebelum render. Dijaga oleh test `"Enter memanggil onLine tepat sekali"`, yang **gagal** pada commit sebelum perbaikan.

- **`--interactive` crash di luar TTY.** `setRawMode is not a function` beserta stack trace mentah, karena `setRawMode` dipanggil tanpa cek `isTTY` — semua komponen lain (`askLine`/`runPicker`/`runPanel`) punya fallback ini. Kini ada `attachNonTty()`: event dilaporkan sebagai baris polos.

- **Kegagalan async tak lagi bisu.** `unhandledRejection` ditampilkan sebagai baris transcript, bukan membuat layar diam.

### Fixed — tema & warna

- **`/theme` dan `--theme` tidak berefek apa pun.** Objek `c` di `src/tui/theme.ts` mengevaluasi token tema **saat import** (`success: trueWrap(tk("success"))` di module scope), jadi `applyTheme()` mengganti state tapi closure warna sudah beku. `/theme light` melapor `Theme: light` dengan gembira sambil tetap mencetak warna dark. `test/theme.test.ts` hanya memeriksa nilai kembalian `applyTheme`, itu sebabnya lolos.

  Setiap slot kini getter yang membaca `themeState`, dengan palet per-tema di-cache. 181 call-site di 22 berkas tidak perlu diubah. Alias legacy (`c.red`…`c.brightCyan`) dipetakan ke token tema alih-alih hex hardcoded — inilah yang membuat `mono` benar-benar monokrom, jalur aksesibilitasnya.

- **Transcript TUI membuang seluruh warna dan format.** `push()` men-`strip()` semua isi, sehingga diff card kehilangan hijau/merah dan `decorateMarkdown()` yang dipanggil satu baris di atasnya sia-sia — bold, inline code, dan syntax highlight dibuang tepat setelah dibuat. Kini `truncAnsi()` memotong berdasarkan lebar **tampak**, menutup atribut yang terbuka, dan tidak pernah membelah sekuens di tengah maupun memotong emoji separuh.

- **`stripAnsi` tidak menangkap sekuens private-mode.** `ESC[?25l`, `ESC[?2026h`, `ESC[?1049h` lolos utuh — dan `captureOutput()` memakainya untuk membersihkan isi overlay, jadi kode kontrol bisa masuk ke teks. Pola diperluas (termasuk OSC); implementasi duplikat di `wrap.ts` diganti re-export.

### Fixed — biaya & anggaran di REPL

- **Biaya tidak pernah muncul selama sesi interaktif.** Header menunggu `provider:extension { kind:"usage", data.cost }` yang **tidak dikirim provider mana pun** — `openai-compat.ts` dan `anthropic.ts` hanya mengirim token. Biaya dihitung di `createUsageCollector.get()` dari tabel harga, dan TUI tidak pernah membacanya. `FullscreenMinimalOpts` kini menerima `usage()`.

- **`--budget` diabaikan di REPL.** Nilainya diteruskan lalu di-`void` (`fullscreen-driver.ts:197`): tidak ada peringatan 80%, tidak ada penghentian saat lewat batas — padahal jalur one-shot punya keduanya. Kini header menampilkan `$0.85/$1.00` berwarna sesuai rasio, dan prompt baru ditolak setelah batas terlampaui.

### Fixed — input & kursor

- **Tidak ada editing di tengah baris.** `left`/`right` mengembalikan `none` dan `PromptState` tidak punya posisi kursor: `abcdef` + panah kiri ×3 + `X` menghasilkan `abcdefX`. Untuk memperbaiki satu kata di prompt panjang, user harus menghapus seluruh sisanya. Footer bahkan mencetak `_` sebagai kursor palsu di ujung baris.

  `PromptState` kini punya `cursor` (indeks **code point**, bukan unit UTF-16, jadi emoji tak pernah terbelah). Ditambahkan Home/End/Delete/Ctrl+A/Ctrl+E; `backspace`, `ctrl-w`, dan penyisipan karakter menghormati kursor. Renderer memposisikan kursor terminal sungguhan; `_` palsu dihapus. Baris panjang digeser horizontal mengikuti kursor, bukan hanya ujung.

- **Tab mengabaikan seleksi.** `askLine` selalu melengkapi item pertama meski user sudah menekan panah bawah; jalur fullscreen sudah benar. Dua jalur beda perilaku untuk tombol yang sama.

- **Byte mouse bocor jadi teks.** `enableMouse()` mengaktifkan mode `?1000h` tapi `decodeKey` tidak mengenali `ESC[M` + 3 byte koordinat, jadi klik mengubah `teks` menjadi `teks 00`. Mouse tracking dimatikan (tidak ada konsumennya) dan laporan X10 maupun SGR kini dikenali lalu **dibuang**.

- **Panah atas menggabungkan history ke teks yang sedang ditulis** (`halo` → `halo <entri history>`), menghancurkan prompt yang sedang disusun. Kini mengganti baris seperti shell, dengan baris kerja disimpan dan kembali saat turun melewati entri terbaru.

### Fixed — overlay & dispatch

- **Overlay meluber melewati tinggi terminal dan tidak bisa di-scroll.** Kapasitas dihitung (`H - 8`) tapi loop render mengiterasi seluruh `overlay.lines`: overlay 30 baris di terminal 20 baris merender 35 baris, judul terguling keluar layar, dan panah tidak melakukan apa pun. Kini di-slice, bisa di-scroll (panah/Home/End), dengan indikator `13-30/40`.

- **Setiap slash command menempuh tiga jalur.** `/status` memanggil `onPicker` → `onOverlay` → mungkin `onLine`; untuk salah ketik, `onOverlay` bahkan mengeksekusi builtin dengan stdout dibajak sebelum ditolak. Nama kini divalidasi lebih dulu.

- **`/resume` di TUI hanya mencetak instruksi manual** (`keluar lalu jalankan: minicode --resume <id>`) padahal jalur klasik me-respawn proses otomatis. Kini keduanya sama.

### Fixed — konsistensi CLI

- **`--version` / `-v`** — sebelumnya diperlakukan sebagai prompt dan dikirim ke LLM. Versi dibaca dari `package.json`, bukan di-hardcode.
- **Help kontekstual.** `config`, `config mcp`, `config lsp`, `mcp` tanpa argumen mencetak HELP global 45 baris lalu exit 0 — bukan error, bukan petunjuk. Kini help spesifik per subcommand; subcommand asing exit **1** supaya skrip bisa mendeteksi (`sessions`, `skills`, `pricing`, `auth` diseragamkan).
- **`renderTable`: `width` jadi batas keras.** Sebelumnya minimum, sehingga satu nilai panjang melebarkan kolom dan header berhenti berbaris dengan body — nyata di `config list` dengan id provider 23 karakter. `providers` juga beralih ke `renderTable` dari `padEnd(16)` manual yang rusak untuk id panjang.
- **`stats --json`** diterima tanpa keluhan lalu diabaikan; kini menghasilkan JSON.
- **Notice `[sandbox]`** muncul di stderr untuk **setiap** invokasi di Windows, termasuk yang tidak menyentuh tool. Kini hanya bila sesi berpotensi menjalankan perintah.
- **Satu bahasa** untuk seluruh keluaran (Indonesia); `usage:` tetap Inggris mengikuti konvensi CLI. Sebelumnya `providers`/`config`/`skills`/`sessions` Inggris sementara `auth`/`pricing`/TUI Indonesia — user melihat keduanya dalam satu sesi.
- **`/help` mendokumentasikan 13 pintasan papan tombol.** Ctrl+O, Ctrl+R, Shift+Tab, Ctrl+U, Ctrl+W, Esc, dan `\` continuation sebelumnya hanya bisa ditemukan dengan membaca kode; footer menyebut empat.

### Fixed — kebersihan

- **`/thinking` punya dua state dan nol konsumen.** `cli/commands.ts` menulis `process.env.MINICODE_SHOW_THINKING`, `fullscreen.ts` menulis `showThinking.ref`; tak ada yang membaca yang lain, dan tak ada renderer yang membaca keduanya. Toggle melaporkan sukses tanpa efek. Kini satu state (`src/tui/reasoning.ts`) dengan konsumen nyata di kedua renderer.
- **Justify meratakan baris terakhir paragraf**, menghasilkan "sungai" spasi (`dengan      lebar      tertentu`). Baris akhir paragraf kini rata kiri; `MINICODE_JUSTIFY=0` mematikan sepenuhnya.
- **`--ui` dan `--tui` dihapus** — keduanya diparse dan diteruskan tapi tidak pernah dibaca.
- **`test/import-convention.test.ts`** menuduh dirinya sendiri (berkasnya memuat pola yang dicari sebagai literal regex).

### Added — test lapisan interaktif

Sebelumnya `fullscreen.ts`, `input.ts`, `picker.ts`, `panel.ts`, `provider-manager.ts` semuanya nol cakupan — permukaan utama produk tidak diuji sama sekali.

- **`test/helpers/tui-harness.ts`** — fake TTY: stdin injektabel, stdout/stderr tertangkap sebagai frame, ukuran terminal dapat diatur, `ready()` menunggu listener terpasang (komponen melakukan `await` sebelum memasang listener, jadi keystroke lebih awal hilang tanpa jejak), dan pelacak `unhandledRejection`.
- **`test/tui-fullscreen.test.ts`** (44) — submit prompt, dropdown, Tab, overlay + scroll, picker, streaming, diff berwarna, cost/budget, history, kursor, mode, resize, interupsi, mouse, non-TTY, pembersihan terminal saat detach.
- **`test/tui-classic.test.ts`** (36) — `askLine`, `runPicker`, `runPanel`, `runProviderManager`, `captureOutput`.
- **`test/tui-format.test.ts`** (42) — `wrap`, `format`, `reasoning`, `statusline`, simple logger.
- **`test/cli-handlers.test.ts`** (45) + **`test/cli-subcommands.test.ts`** (25) — handler in-process dan biner sungguhan (exit code, aliran stdout/stderr).

## [Sebelumnya] — Audit V4 (Fase 0–4) + V5 (eksperimen ekstrem & distribusi)

Basis: audit menyeluruh v0.7.0 ([docs/PLAN_V4.md](docs/PLAN_V4.md)) dilanjutkan dengan tiga harness adversarial ([docs/PLAN_V5.md](docs/PLAN_V5.md)). Semua angka terverifikasi dengan eksekusi.

### Security — V5: empat bug ditemukan oleh eksperimen adversarial

Probe lama hanya membuktikan guard menahan serangan **yang sudah dipikirkan**. Tiga harness baru membangkitkan kasus sendiri dan menemukan hal yang terlewat.

- **`experiments/extreme-bash-fuzz.ts`** — mutasi kombinatorial dari transformasi yang shell anggap setara (quote-split, indirection variabel untuk nama perintah maupun argumen, rantai dua tingkat, flag panjang, wrapper perintah, chaining), PRNG ber-`--seed` agar temuan bisa direproduksi. Run pertama: **101 bypass (52 unik)** dari 2.435 varian. Tiga kelas akar:

  | Bypass | Kenapa lolos | Perbaikan |
  |---|---|---|
  | `command env`, `nice env`, `exec 'env'`, `time env` | Deteksi env-dump ter-anchor ke awal perintah; wrapper menggeser posisi kata | `stripCommandWrappers()` membuang 14 wrapper (`command`/`exec`/`nice`/`nohup`/`setsid`/`timeout N`/`stdbuf`/`sudo`/…) berulang hingga 4 lapis |
  | `rm --recursive --force /` | Pola lama hanya mencari `-[a-z]*r` | `RM_RECURSIVE` menerima `--recursive`/`--dir` |
  | `rm -rf /; :` | Pola target mensyaratkan whitespace/akhir-string; `;` menempel langsung | `RM_DANGEROUS_TARGET` menerima `;`/`&` sebagai pembatas |
  | `b(){ b\|b& };b` dan varian terpecah variabel | Pola fork bomb literal `:(){ :\|:& };:` | Pola struktural: definisi fungsi apa pun dengan pipe + `&` |

  Setelah perbaikan: **0 bypass** pada 6 seed dan pada run panjang (12.912 varian berbahaya + 2.400 varian sah). Regresi terkunci di `test/bash-fuzz-regression.test.ts` (44 test).

  Catatan: dua "bypass" awal ternyata **palsu** — mutator kosmetik yang berjalan sebelum indirection menyisipkan tab di tengah kata, sehingga payload rusak di shell nyata (`C=find\t/` berarti "assign lalu jalankan `/`"). Harness diperbaiki (mutator dipisah struktural vs kosmetik), bukan guard-nya. Perilaku yang benar didokumentasikan sebagai test.

- **`experiments/extreme-mcp-adversarial.ts`** — server yang sengaja jahat. Menemukan: **balasan untuk request id lain diterima sebagai hasil.** Server yang membalas `{"id": 4242, ...}` terhadap request `id: 1` — atau hanya mengirim notifikasi tanpa `id` — diterima sebagai sukses dan `result: undefined` menjalar ke pemanggil. Jalur SSE sudah mencocokkan id; jalur JSON tidak. `readJsonResponse` kini menerima `expectId`. Diverifikasi juga: heap tidak tumbuh saat server mengirim 512 MB, `Authorization` tidak muncul di pesan error, 13 pola host privat ditolak konsisten dengan `web_fetch`.

- **`experiments/extreme-shadow-git.ts`** — 31 pemeriksaan, 0 gagal. Mengonfirmasi klaim O(delta) dengan pengukuran: snapshot 200/1.000/5.000 file = 282/604/522 ms, manifest **konstan 364 B**. Konkurensi 10 sesi paralel menghasilkan tree identik tanpa index yatim. Nama file unicode/emoji/spasi/120-karakter/diawali-`-` semuanya ter-undo.

### Added — V5

- **MCP client mengonsumsi `resources` & `prompts`.** Sisi server minicode sudah lama menyajikannya; client hanya memakai `tools`. `initialize` kini mendeklarasikan `{ tools, resources, prompts }` (sebelumnya hanya `tools`, sehingga server yang sopan tidak menawarkan sisanya). Tool baru **`mcp_read`** (`resources/read`) dan **`mcp_prompt`** (`prompts/get`); `mcp_list` menampilkan tiga kategori.

  Keduanya **di-gate meski read-only** — menarik konten dari server pihak ketiga langsung ke konteks model adalah jalur prompt-injection, dan "read-only" tidak berarti "aman". `mcp_list` tidak di-gate karena hanya melaporkan metadata server yang user daftarkan sendiri. Discovery bersifat opsional: server yang membalas "Method not found" tetap terhubung. Blob biner tidak ditumpahkan sebagai base64.

- **`scripts/pack-check.ts`** — gate distribusi. Menelusuri graf import dari `bin` (98 modul), memverifikasi setiap target ikut terkemas, memeriksa vendor lengkap untuk 12 spesifier, dan menolak 14 pola berkas rahasia/sampah. Field `files` mudah tertinggal, dan kegagalannya hanya muncul setelah publish.

- **Perintah eksperimen**: `bun run extreme`, `extreme:fuzz`, `extreme:git`, `extreme:mcp`, `gate:pack`. CI naik dari 14 ke 18 langkah.

### Changed — V5: distribusi npm

- **Tarball npm sebelumnya gagal dipasang.** Dependency `minicore: file:./vendor/minicore` di-resolve relatif terhadap cache Bun, bukan terhadap paket terpasang: `Could not find package.json for "file:../../../../../.bun/install/cache/.../vendor/minicore"`. `bun install` lokal hijau, jadi masalah ini tak terlihat sampai tarball benar-benar diuji.

  Diganti **subpath imports** (`package.json` `imports`), fitur yang justru dirancang untuk ini. 73 import site di 51 file dimigrasikan dari `minicore` ke `#minicore`; `dependencies` kini kosong. Terverifikasi end-to-end: `npm pack` → `bun install <tarball>` di proyek bersih → `minicode --help`, `pricing status`, `auth list` berjalan lewat `node_modules/.bin/minicode`. Tarball 222 KB, 124 file, 697 KB unpacked.

- **`package.json`** dilengkapi `files`, `keywords`, `repository`, `homepage`, `bugs` untuk kesiapan publish.

### Fixed — V5: dua bug dari migrasi itu sendiri

Penggantian teks massal menghasilkan dua kesalahan yang **lolos typecheck**:

- **Nama direktori ikut terganti.** `resolve(repoRoot, "..", "minicore")` menjadi `"..", "#minicore"`, sehingga `vendor:check` melapor "vendor kosong" padahal ada 20 file. `#` hanya bermakna untuk spesifier import, bukan path filesystem.
- **Karakter non-ASCII rusak.** File yang ditulis ulang lewat pipeline PowerShell tanpa encoding eksplisit mengubah `—`, `…`, `─` menjadi U+FFFD di 2 file (9 dan 2 kemunculan), memecahkan satu assertion test. Dipulihkan dari `git show HEAD:<file>` lalu perubahan yang dimaksud diterapkan ulang.
- Sekalian ditemukan: `tsconfig.json` punya BOM, yang membuat `JSON.parse` gagal dengan "Unrecognized token".

`test/import-convention.test.ts` menjaga ketiganya plus konsistensi `package.json`/`tsconfig.json`.

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
- **Test yang bergantung waktu.** Suite gagal 17 test sekali saat dijalankan dengan `--coverage` (instrumentasi memperlambat spawn), lalu hijau 6× berturut setelahnya. Dua penyebab diperbaiki alih-alih dibiarkan sebagai flake: timeout tool git dipindah dari hardcode 8 s ke `LIMITS.GIT_TIMEOUT_MS` (20 s) karena `git_commit` menjalankan empat operasi berurutan, dan `Bun.sleep` tetap di test MCP diganti polling ber-deadline (server yang tak pernah membalas untuk uji timeout, poll sampai request diterima untuk uji notify).

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
- `test/bash-fuzz-regression.test.ts` — 44 test yang mengunci temuan fuzz: 14 wrapper perintah tak boleh menyembunyikan payload, `rm` long-option, chaining tanpa whitespace, varian fork bomb, dan batas normalisasi yang jujur (payload yang memang rusak tidak diklaim berbahaya).
- `test/mcp-resources-prompts.test.ts` — 19 test terhadap server MCP HTTP nyata: discovery `resources`/`prompts`, server tools-only tetap terhubung, kapabilitas `initialize`, blob biner tak ditumpahkan, dan izin gated untuk `mcp_read`/`mcp_prompt`.
- `test/import-convention.test.ts` — 9 test: tak ada spesifier `minicore` lama tertinggal, `package.json`/`tsconfig.json` sejalan, nama direktori vendor tanpa `#`, `vendor:check` hijau, tak ada U+FFFD, tak ada BOM di konfigurasi.
- `experiments/bash-bypass-probe.ts` — korpus manual (38 serangan + 15 perintah sah). Exit 0 hanya bila 0 bypass **dan** 0 over-block (`bun run gate:bash`).
- `experiments/extreme-bash-fuzz.ts` · `extreme-shadow-git.ts` · `extreme-mcp-adversarial.ts` — harness adversarial yang menemukan empat bug di atas (`bun run extreme`).
- `scripts/pack-check.ts` — 22 pemeriksaan tarball npm (`bun run gate:pack`).

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
