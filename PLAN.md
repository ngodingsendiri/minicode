# PLAN.md — Rencana penyempurnaan aktif

**Untuk agent AI yang melanjutkan pekerjaan ini.** Dokumen ini adalah satu-satunya rencana yang harus dieksekusi. Rencana lama (`docs/PLAN_V4.md`, `PLAN_V5.md`, `PLAN_UIUX_V6.md`) adalah **arsip** — semua itemnya sudah selesai; jangan dikerjakan ulang.

Basis: audit UI/UX menyeluruh (V6), uji live dua gateway nyata (V7), dan bug hunter UI tiga ronde (V8). Riwayat lengkap di [CHANGELOG.md](CHANGELOG.md).

---

## Keadaan saat ini — baca ini dulu

Jalankan sendiri, jangan percaya angka di dokumen:

```bash
bun test                  # harapan: semua hijau, 0 fail
bun x tsc --noEmit        # harapan: tanpa keluaran
bun run lint              # harapan: exit 0 (warning boleh ada)
bun run gate:coverage     # harapan: melewati min 77 funcs / 80 lines
bun run gate:pack         # harapan: 22 pemeriksaan lulus
bun run extreme           # harapan: 0 bypass, semua pass
```

Kondisi yang sudah dicapai dan **tidak boleh mundur**:

- REPL bisa dipakai (dulu mati bisu pada prompt pertama).
- Lebar karakter dihitung per KOLOM terminal (`src/tui/width.ts`), bukan per karakter.
- Teks model/tool disanitasi (`src/tui/sanitize.ts`) — hanya SGR yang lewat.
- Biaya sesi kumulatif benar; `--budget` benar-benar memutus.
- Error provider tampil ringkas + saran, bukan dump JSON.
- Semua overlay menghormati ukuran terminal sungguhan.
- Bahasa UI diarahkan ke English-only pada surface UI aktif; glyph tetap punya fallback ASCII.

---

## Status eksekusi terbaru (update 2026-09-02)

Ringkasan progres terhadap roadmap UI CLI-constrained (outputs/UI_FOUNDATION_REDESIGN_CLI_CONSTRAINED_2026-09-01.md):

- ✅ Tahap 0 (guardrail + baseline) selesai.
- ✅ Tahap 1 (quick structural wins) selesai.
- ✅ Tahap 2 (overlay consolidation) selesai.
- ✅ Tahap 3 (component family refactor) selesai.
- ✅ Tahap 4 (runtime feedback harmonization) selesai.
- ✅ Tahap 5 (verification & hardening) selesai.

Catatan eksekusi terbaru:
- Primitive overlay shared sudah dipakai oleh picker/provider-manager/model-manager (`src/ui/screens/overlay.ts`).
- Statusline sekarang depth-safe untuk nested write (`src/ui/runtime/statusline.ts`).
- Harmonisasi copy English-only pada surface UI/CLI yang aktif sudah selesai.
- Sinkronisasi assertion test selesai: `test/phase2-security.test.ts` diperbarui agar sesuai microcopy English baru (`automatically`, `unknown mode`).
- Flake `cli-session` yang memicu timeout hook afterEach/afterAll ditutup dengan menonaktifkan cleanup rekursif temp workspace di `test/cli-session.test.ts` (housekeeping diserahkan ke OS).
- `scripts/coverage-gate.ts` diperbaiki agar memanggil runtime Bun via `process.execPath` (bukan perintah `bun` di PATH), untuk lingkungan yang tidak menaruh bun di PATH.
- Penghapusan fitur tema tuntas: `src/ui/render/themes.ts` dihapus, `src/ui/render/theme.ts` jadi palet tunggal (satu set TOKENS dark, auto-detect NO_COLOR>COLORTERM>truecolor>mono), flag `--theme` & slash `/theme` & env `MINICODE_THEME`/`themeState`/`applyTheme` dihapus dari `cli/index.ts`, HELP, dan test. Dijaga oleh `test/no-frozen-runtime-value.test.ts` & `test/theme.test.ts` baru.
- Sisa inkonsistensi plan .verdent dibersihkan: `test/cli-session.test.ts:604` blok `describe("cli: --theme")` dihapus, komentar `themeState` di `test/no-frozen-runtime-value.test.ts:20` diperbaiki, `bun.lock` divalidasi `bun install` + `--frozen-lockfile` hijau, `experiments/extreme-mcp-adversarial.ts` diselaraskan ke English ("private host rejected", "redirect not followed", "not valid JSON").
- Gate di host ini (Win32, Bun 1.4.0, 2026-09-02): `tsc` PASS, `lint` PASS (17 warn), `bun test` 1168 pass 0 fail, `gate:coverage` 82.79% funcs / 85.22% lines (min 81/83 PASS), `gate:pack` 22/22 PASS, `gate:bash` 0/38 bypass 0/15 over-block di kedua mode, `extreme-bash-fuzz` 0 bypass (2582 varian), `extreme-mcp` 67/67 PASS. `extreme-shadow-git` masih timeout 300s di Windows (unit `shadow-git.test.ts` 22 pass — hambatan I/O skala 2000 file, bukan regresi fungsional).
- `vendor/minicore` sinkron ulang (`19 file, be68c07aa4ae8cb6`) via `bun run vendor:minicore`.

Next action (urut eksekusi):
1. P1.1–P1.3 masih terbuka (coverage `cli/setup.ts` 0%, provider-manager harness, highlight), dan P2.1 `cwd` jail butuh keputusan arsitektur A/B/C — lihat §P1/P2.
2. Publish npm (P2.2) menunggu bump `package.json` + `CHANGELOG.md` release note + kredensial.

---

## Prinsip yang mengatur rencana ini

1. **Verifikasi perilaku, bukan bentuk kode.** Harness yang men-`grep` sumber jadi basi begitu kode diperbaiki — terbukti di ronde 3, di mana harness lama melapor 9 temuan yang sudah tidak ada. Tulis harness yang **menjalankan** kodenya.
2. **Buktikan dampak sebelum memperbaiki.** 5 dari 12 temuan ronde 1 tidak berdampak nyata dan sengaja tidak diperbaiki. Temuan tanpa bukti dampak adalah utang, bukan aset.
3. **Setiap perbaikan meninggalkan test yang gagal di commit sebelumnya.** Kalau test barumu lulus di kode lama, ia tidak menguji apa yang kamu kira.
4. **Jangan menambah permukaan baru sebelum yang ada teruji.** Tidak ada fitur baru di rencana ini kecuali P2.3 (i18n), dan itu perlu persetujuan pemilik repo lebih dulu.

---

## P0 — Cegah kelas bug yang sudah tiga kali terulang

### P0.1 Aturan lint untuk "nilai beku saat import"

**Masalah terverifikasi tiga kali:**

| Kejadian | Berkas | Akibat |
|---|---|---|
| V6 | `src/tui/theme.ts` — objek `c` | `/theme` dan `--theme` tidak berefek apa pun; test lolos karena hanya memeriksa nilai kembalian `applyTheme` |
| V6 | `src/tui/theme.ts` — palet per-tema | Sama; `mono` tidak pernah monokrom |
| V8 | `src/tui/theme.ts` — `glyphs`, `cli/commands.ts` — `const OK = glyphs.check` | Fallback ASCII tidak berlaku; `MINICODE_ASCII=1` diabaikan |

Pola identik: nilai yang bergantung pada state runtime (env, tema) disimpan ke `const` di module scope, sehingga dievaluasi sekali saat import.

**Yang harus dikerjakan.** Tambahkan pemeriksaan otomatis. Dua opsi, pilih yang paling murah:

- **Opsi A (disarankan):** test konvensi baru `test/no-frozen-runtime-value.test.ts` yang membaca berkas di `src/tui/**` dan `cli/**`, lalu menolak pola `const X = <ident>.<prop>` di module scope ketika `<ident>` ada di daftar objek-bergetter (`c`, `glyphs`, `themeState`). Pola ini sudah dipakai repo (`test/import-convention.test.ts`) jadi konsisten.
- **Opsi B:** aturan Biome kustom. Lebih tepat secara semantik, tapi Biome belum punya API plugin stabil — periksa dulu sebelum memilih ini.

**Selesai bila:** test gagal bila seseorang menambahkan `const X = glyphs.dot` di module scope, dan lulus untuk kode saat ini. Sertakan komentar yang menjelaskan **mengapa** aturan ini ada, dengan menyebut tiga kejadian di atas.

### P0.2 Dokumentasikan kontrak getter di `src/tui/theme.ts`

Tambahkan komentar di atas `c` dan `glyphs` yang menyatakan eksplisit: *"Getter — JANGAN simpan ke const di module scope; lihat PLAN.md P0.1."* Sudah ada sebagian; pastikan keduanya punya dan menyebut P0.1.

---

## P1 — Tutup lubang cakupan yang paling berisiko

### P1.1 Test untuk `cli/setup.ts` dan `cli/index.ts`

Keduanya **0% tercakup** dan menjadi jalur masuk semua hal: parsing flag, resolusi sandbox, pembangunan sesi, budget, trace, plan mode re-exec.

Tidak bisa dites dengan harness fake-TTY (butuh proses nyata). Pendekatan yang sudah terbukti di repo ini: `test/cli-subcommands.test.ts` men-`spawnSync` biner sungguhan. Perluas pola itu.

**Yang harus diuji (minimal):**

| Kasus | Cara memverifikasi |
|---|---|
| `--budget` memutus dan exit 1 | fake provider lokal (lihat pola di riwayat: server Bun kecil yang menyajikan SSE), budget sangat kecil |
| Peringatan 80% muncul, tidak memutus | budget sedikit di atas biaya satu run |
| `--plan` menolak tool tulis | prompt yang meminta `write_file`, periksa berkas tidak ada |
| `--timeout` benar-benar memutus | provider yang menggantung |
| `--resume <id>` memuat riwayat | simpan sesi, resume, periksa jumlah pesan |
| Notice `[sandbox]` tidak muncul untuk perintah tanpa tool | `--version`, `providers`, `stats` |
| Trace tertulis dengan model terisi | periksa `.minicode/traces.jsonl` |
| `--verify` menjalankan self-heal | proyek dengan `typecheck` yang gagal lalu berhasil |

**Selesai bila:** `cli/index.ts` dan `cli/setup.ts` ≥50% lines, dan gate coverage dinaikkan ke angka baru yang terukur.

### P1.2 Perluas harness untuk prompt berantai (`provider-manager` alur a/d/e)

`cli/provider-manager.ts` masih ~45% lines. Alur `a` (tambah), `d` (hapus), `e` (ubah) memakai `askLine`/`askSecret` **di dalam** raw mode yang di-suspend — harness sekarang tidak bisa menjawab prompt berurutan.

**Yang harus dikerjakan.** Tambahkan ke `test/helpers/tui-harness.ts`:

```ts
/** Jawab prompt berurutan: setiap kali komponen memasang listener baru, kirim jawaban berikutnya. */
answerSequence(answers: string[]): Promise<void>
```

Implementasinya perlu mendeteksi kapan listener stdin diganti (suspend → resume). Petunjuk: `provider-manager` memanggil `removeListener` lalu `on("data")` lagi; harness bisa menghitung siklus itu.

**Yang harus diuji:** tambah provider dengan preset, tambah dengan URL kustom, batal di tengah (Ctrl+C pada `askSecret`), hapus dengan konfirmasi `y` dan `n`, ubah dengan rollback saat detect gagal, dan **hapus provider yang sedang aktif** (peringatan harus muncul).

**Selesai bila:** `provider-manager.ts` ≥70% lines.

### P1.3 Test `src/tui/highlight.ts` (80% → ≥90%)

Cabang yang belum tersentuh: Python, shell, JSON, diff, dan `formatCodeBlock`. Uji dengan kode nyata per bahasa, plus masukan adversarial (string tak tertutup, karakter kontrol, berkas 5.000 karakter). Sudah ada pola di `test/tui-theme-highlight.test.ts`.

---

## P2 — Keputusan yang butuh persetujuan pemilik repo

### P2.1 Kontrak `cwd` untuk tool file — **butuh keputusan arsitektur**

**Ini masalah paling serius yang belum diperbaiki, dan sengaja tidak disentuh.**

`write_file.ts:24` (dan `read_file`, `edit`, `patch`, `glob`, `grep`) memakai `process.cwd()` sebagai root jail, bukan cwd sesi. Akibatnya terverifikasi lewat uji live: berkas yang diminta di `--cwd <dir>` muncul di direktori proses.

Dua konsekuensi, satu di antaranya soal keamanan:
1. `--cwd` menyesatkan — dokumentasi menjanjikan "workspace root" tapi tool mengabaikannya.
2. **Path jail ter-anchor ke direktori yang salah**, jadi pemeriksaan `isPathOutsideRoot` membandingkan terhadap root yang bukan workspace sesi.

Sudah didokumentasikan di `scripts/human-sim.ts` ("kernel ToolContext tak punya cwd") — artinya diketahui lama tapi dibiarkan.

**Mengapa perlu keputusan:** memperbaikinya berarti menambahkan `cwd` ke `ToolContext` di `vendor/minicore` — kernel yang **dibekukan**. Prinsip repo (`docs/ARCHITECTURE.md`) hanya mengizinkan seam aditif yang backward-compatible.

**Tiga opsi, sajikan ke pemilik repo sebelum mengerjakan:**

| Opsi | Cara | Risiko |
|---|---|---|
| A | Tambah `cwd?: string` opsional ke `ToolContext` kernel (seam aditif, seperti `compactAsync` dan `initialMessages` sebelumnya) | Menyentuh kernel beku; butuh `bun run vendor:minicore` dan pembaruan `VENDOR.md` |
| B | `process.chdir()` sekali di `createCliSession` bila `--cwd` diberikan | Sederhana, tapi `chdir` global merusak sub-agent paralel dan tool yang memakai path relatif ke repo minicode sendiri |
| C | Dokumentasikan sebagai batasan: hapus `--cwd` dari HELP, atau jelaskan bahwa ia hanya memengaruhi config/sesi, bukan tool | Jujur tapi mengurangi kemampuan |

**Jangan pilih sendiri.** Sajikan tabel ini, jelaskan konsekuensi keamanannya, minta keputusan.

### P2.2 Publish ke npm

Tarball sudah terverifikasi bisa dipasang (`bun run gate:pack` hijau, 22 pemeriksaan). `npm publish` belum dijalankan — butuh kredensial dan keputusan rilis.

Sebelum publish, pastikan: versi di `package.json` dinaikkan, `CHANGELOG.md` punya bagian bernomor versi (bukan `[Unreleased]`), dan `bun run gate:pack` masih hijau.

### P2.3 Internasionalisasi — **keputusan sudah diambil: English-only**

Keputusan pemilik repo untuk batch saat ini: gunakan **English-only** pada UI/copy aktif.

Implikasi eksekusi:
1. Semua user-facing string baru wajib berbahasa Inggris.
2. String Indonesia yang tersisa diperlakukan sebagai technical debt dan dibersihkan bertahap.
3. Fokus tahap ini **bukan** membangun i18n table (`MINICODE_LANG=en|id`) dulu, melainkan menuntaskan konsistensi English-only agar rilis tidak campur bahasa.

Scope lanjutan yang masih harus dibereskan:
- surface `cli/commands/**`
- sisa pesan error/tool yang masih Indonesia di luar jalur UI yang sudah disentuh
- test titles/assertions yang masih campur bahasa bila menguji copy user-facing

Catatan: opsi i18n dua bahasa tetap bisa dibuka lagi setelah stabilisasi release berikutnya.

---

## P3 — Pengukuran yang belum dilakukan

### P3.1 Resolve-rate pada benchmark yang diakui

Resolve-rate 1,00 yang terukur berasal dari 5 tugas satu-hingga-tiga langkah dengan pemeriksa objektif. Itu membuktikan lapisan tool bekerja, **bukan** bahwa agent kompeten pada tugas nyata.

Yang perlu: SWE-bench Lite atau setara. `bench/runner.ts` sudah ada kerangkanya. Perlu provider ber-API-key dan waktu eksekusi panjang.

**Jangan mengklaim angka resolve-rate di dokumen sampai pengukuran ini dilakukan.**

### P3.2 Verifikasi endpoint OAuth lewat login sungguhan

`src/providers/oauth.ts` mengimplementasikan device flow (RFC 8628) tapi endpoint belum dikonfirmasi lewat login nyata — butuh interaksi browser.

### P3.3 Provider API native

OpenAI Responses API dan Gemini native belum ada; Gemini masih lewat shim `/v1beta/openai`. Bukan blocker, tapi membatasi fitur (misalnya reasoning terstruktur).

---

## Yang sengaja TIDAK dikerjakan

Agar cakupan jelas dan tidak melebar diam-diam:

- **Tidak ada framework TUI baru.** Pure ANSI tetap. Ink/blessed akan membuang seluruh `fullscreen.ts` demi masalah yang perbaikannya berukuran satu fungsi.
- **Tidak ada mouse support.** Mouse tracking sudah dimatikan di V6 karena byte koordinatnya bocor ke input dan tidak ada konsumennya.
- **Tidak ada tema baru.** Empat preset sudah bekerja; menambah tema tanpa pengguna yang meminta adalah spekulasi.
- **Tidak ada virtual scroll transcript.** `RING_MAX 60` + `tail.slice(-bodyH)` memadai sampai ada keluhan nyata.
- **Repo-map tetap regex.** Alasan lengkap (dengan tabel pengukuran) ada di komentar `extractSymbolsAsync` di `src/repo/repomap.ts`. Tree-sitter menambah dua dependensi dan ~1,4 MB wasm per bahasa untuk simbol yang hampir seluruhnya member kelas — bukan yang berguna untuk orientasi.

---

## Cara bekerja di repo ini

**Sebelum mulai:** baca `AGENTS.md`, jalankan seluruh gate di bagian "Keadaan saat ini".

**Selama bekerja:**
- Ikuti gaya kode yang ada; jangan memperkenalkan pustaka baru.
- Bahasa komentar: Indonesia, menjelaskan **mengapa** bukan **apa**. Sertakan bukti (angka, nama berkas, perilaku terverifikasi) untuk keputusan non-obvious.
- Encoding: UTF-8 tanpa BOM. Repo ini pernah rusak karena pipeline PowerShell tanpa encoding eksplisit — `test/import-convention.test.ts` menjaganya, jalankan setelah mengedit berkas berisi karakter non-ASCII.
- Jangan mengedit `vendor/minicore/**` tanpa keputusan eksplisit (lihat P2.1).

**Sebelum menyatakan selesai:**
```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
```
Semua harus hijau. Bila coverage naik, naikkan juga angka minimum di `scripts/coverage-gate.ts` supaya tidak bisa mundur.

**Jangan commit** kecuali diminta. Bila diminta: periksa `git status` dan `git diff` lebih dulu, stage hanya berkas yang dimaksud, jangan pernah commit rahasia.
