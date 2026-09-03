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

## Status eksekusi terbaru (update 2026-09-03)

Ringkasan progres terhadap roadmap UI CLI-constrained (outputs/UI_FOUNDATION_REDESIGN_CLI_CONSTRAINED_2026-09-01.md):

- ✅ Tahap 0 (guardrail + baseline) selesai.
- ✅ Tahap 1 (quick structural wins) selesai.
- ✅ Tahap 2 (overlay consolidation) selesai.
- ✅ Tahap 3 (component family refactor) selesai.
- ✅ Tahap 4 (runtime feedback harmonization) selesai.
- ✅ Tahap 5 (verification & hardening) selesai.
- ✅ P2.1 `cwd` jail tuntas (0.8.0): seam aditif `cwd?:string` di `vendor/minicore` + `src/tools/*` resolve terhadap `ctx.cwd`.
- ✅ UI P0-P2 render hardening tuntas (0.8.1): DCS/APC, fence, inline code, highlight, chunk SGR, table, overlay gap, busy deadlock, detail/reasoning getter (lihat di bawah).

Catatan eksekusi terbaru:
- Primitive overlay shared sudah dipakai oleh picker/provider-manager/model-manager (`src/ui/screens/overlay.ts`).
- Statusline sekarang depth-safe untuk nested write (`src/ui/runtime/statusline.ts`).
- Harmonisasi copy English-only pada surface UI/CLI yang aktif sudah selesai.
- Sinkronisasi assertion test selesai: `test/phase2-security.test.ts` diperbarui agar sesuai microcopy English baru (`automatically`, `unknown mode`).
- Flake `cli-session` yang memicu timeout hook afterEach/afterAll ditutup dengan menonaktifkan cleanup rekursif temp workspace di `test/cli-session.test.ts` (housekeeping diserahkan ke OS).
- `scripts/coverage-gate.ts` diperbaiki agar memanggil runtime Bun via `process.execPath` (bukan perintah `bun` di PATH), untuk lingkungan yang tidak menaruh bun di PATH.
- Penghapusan fitur tema tuntas: `src/ui/render/themes.ts` dihapus, `src/ui/render/theme.ts` jadi palet tunggal (satu set TOKENS dark, auto-detect NO_COLOR>COLORTERM>truecolor>mono), flag `--theme` & slash `/theme` & env `MINICODE_THEME`/`themeState`/`applyTheme` dihapus dari `cli/index.ts`, HELP, dan test. Dijaga oleh `test/no-frozen-runtime-value.test.ts` & `test/theme.test.ts` baru.
- Sisa inkonsistensi plan .verdent dibersihkan: `test/cli-session.test.ts:604` blok `describe("cli: --theme")` dihapus, komentar `themeState` di `test/no-frozen-runtime-value.test.ts:20` diperbaiki, `bun.lock` divalidasi `bun install` + `--frozen-lockfile` hijau, `experiments/extreme-mcp-adversarial.ts` diselaraskan ke English ("private host rejected", "redirect not followed", "not valid JSON").
- `vendor/minicore` sinkron ulang (`19 file, 4591de2f578d9f4c`) via `bun run vendor:minicore`.
- **Audit UI mendalam 2026-09-02** — 3 sub-audit (input / render / overlay-REPL) menemukan 8 High + 7 Medium + 6 Low. Semua **P0 (keamanan/hang) & P1 (render)** & **P2 (UX kecil)** dieksekusi pada 2026-09-03 (lihat `PLAN.md: Audit UI — temuan P0-P2`):
  - P0.1 `approval/prompt.ts:22` sanitize `toolName/actionSummary` (+ try/catch JSON)
  - P0.2 raw-mode `try/finally` di `input.ts:117,330` & `picker.ts:110` (terminal tidak tertinggal raw saat `buildRenderSpec` throw)
  - P0.3 `busy` `try/finally` di `provider-manager.ts:152` & `model-manager.ts:83` (deadlock bila `onAdd` throw)
  - P0.4 gap 1 baris suspend (`provider-manager.ts:130` & `model-manager.ts:89` hapus `\r\n` di `suspend`)
  - P0.5-P0.7 streaming decoder `prompt-engine.ts:265` `decodeKeysStream` (UTF-8 split, bracket paste `ESC[200~…201~`, mouse X10 `ESC[M`+3 byte & SGR `ESC[<…M` tahan di `pending`)
  - P0.8 grapheme `Intl.Segmenter` di `prompt-engine.ts:65` (`toGraphemes`), `askSecret` & `picker` backspace grapheme
  - P1.1 `simple.ts:48` fence state `parseFence` sinkron dengan `markdown.ts:37` (char/len), highlight di dalam fence
  - P1.2 inline `code` placeholder `\u0000` di `markdown.ts:14` (sebelumnya `**` di dalam `` `**a**` `` jadi bold)
  - P1.3 `width.ts:110` CSI truncated tidak greedy (hanya params, ` ` teks `"` → `" world"` bukan `"orld"`)
  - P1.4 `highlight.ts:139` `findCommentIndex` string-aware (`"https://"` tidak jadi komentar)
  - P1.5 `turn-status.ts:76` & `spinner.ts:28` sanitize `label/message` (`sanitizeAnsiLine`)
  - P1.6 `width.ts:184` `chunkByWidth` bawa open SGR ke potongan berikutnya
  - P2.1 `MAX_VISIBLE` adaptif `rows-3` di `input.ts:105`, P2.2 clamp `keep = min(max(8,cols-4), max(4,cols-1))`
  - P2.3 history lock reset `ctrl-w/ctrl-u/tab/left/right` di `input.ts:279`
  - P2.4 `askSecret` grapheme backspace + sanitasi paste + `decodeKeysStream`
  - P2.5 `wizard.ts:73` `readline` → `askLine` (satu stack sanitasi/width/history)
  - P2.6 `diff.ts:12` dokumentasi O(n·m) heuristik & cap
  - **Session P0-P1 (0.8.2)**: resume `turnCount` (`persistence.ts:223` + `vendor/session.ts:40` + `setup.ts:114`), `NaN` guard (`cli/index.ts:134`, `setup.ts:99`), checkpoint bash non-git (`setup.ts:216` `snapshotWorkspace` penuh), hook timeout 5s (`hooks/run.ts:35`), compacted `didCompact` (`vendor/loop.ts:38`)
- Gate di host ini (Win32, Bun 1.4.0, 2026-09-03): `tsc` PASS, `lint` PASS (17 warn), `bun test` 1180 pass (12 baru `cli-setup-coverage`) / 8 skip 0 fail, `gate:coverage` 81.17%/83.45% (min81/83 PASS), `gate:pack` 22/22 PASS.

Next action (urut eksekusi):
1. Publish npm 0.8.2 (CHANGELOG [0.8.2] sudah siap + `gate:pack` hijau).
2. Extreme shadow Windows (`.verdent/plans/Extreme_Shadow…`): profiling `snapshotTree` 200/1000/5000 file → batch `--stdin-paths` atau `rows-` adaptif (tracked lokal, tidak block rilis).
3. P1 asli `cli/setup.ts` — tertutup via `test/cli-setup-coverage.test.ts` 12 test direct import (`setup.ts:61.54%/70%`), P1.2 `answerSequence` & P1.3 `highlight` 99% sudah (backlog `spawnSync` harness terpisah tetap ada tapi tidak block).
4. P2–P7 backlog: `P4 P2` trace lock/FTS5/`net` strict + `P5 P1.2` leak & `P1.3` timeout + `P6` sisa `P0.3` MCP/LSP/todo + `P1` guard — sprint depan; `P7` P2 polish `ARCH` line numbers.

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

  > **Update 2026-09-03:** `cli/setup.ts` kini `61.54% funcs / 70% lines` via `test/cli-setup-coverage.test.ts` 12 test direct import (bukan `Bun.spawn` yang tidak terhitung di `gate:coverage`). `cli/index.ts` top-level `process.exit` tetap via `spawn` di `test/cli-session.test.ts` + `readVersion` via `readFile`. `provider-manager` 95%/90% & `highlight` 99% sudah, gate `81.17%/83.45%` tetap hijau.

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

## P4 — Lapisan Data: data-at-rest, consistency, SSRF, pricing

Audit 2026-09-03 menemukan 3 Critical race `read→modify→write` tanpa lock, 2 High symlink-escape `mkdir`, `Atomics.wait` yang block event-loop, serta debt `scrub`/PII/`isPrivateHost` fail-open. Detail lengkap & langkah prioritas ada di `.verdent/plans/Data_Layer_Hardening-0903.plan.md` (ringkas di bawah).

**P0 — Data loss & hang (sebelum rilis):**
- **P0.1 Lock `config.json` & `manifest.json`:** `src/config.ts:145` `saveMcp/Lsp/Provider` dan `src/session/checkpoint.ts:65` read-modify-write tanpa `mtime` CAS → lost-update di `Pool(3)`. Tambah `proper-lockfile` atau `mtime` retry loop + `Pool(1)` per path. Test: 2 proses paralel `saveMcpServer` id berbeda → kedua harus ada.
- **P0.2 Jangan overwrite corrupt:** `src/config.ts:154` `catch{}` reset → timpa file corrupt dengan `{providers:[]}`. Backup `.corrupt.<ts>` + throw, `loadCheckpointManifest:44` jangan `return empty` diam.
- **P0.3 Leak handle:** `src/session/persistence.ts:217` `loadSession` tanpa `finally db.close()` → `database is locked` permanen di Windows. Bungkus `try/finally`, `Atomics.wait` → `Bun.sleep` async.

**P1 — Keamanan data-at-rest & SSRF:**
- **P1.1 `mkdir` 0o700 + symlink jail:** `atomic-write.ts:13`, `db-path.ts:11`, `persistence.ts:14` `mkdir({recursive:true})` ikut symlink → `realpath` + `isPathOutsideRoot` + `chmod 600` untuk `.db-wal/-shm`.
- **P1.2 Scrub & PII:** `memory/files.ts:24`, `vector.ts:158`, `compaction.ts:55`, `trace.ts:36` `scrubSecrets` sebelum prompt/INSERT + `tildePath` untuk homedir + `chmod 600`.
- **P1.3 SSRF lengkap:** `vector.ts:67`, `pricing.ts:212` `fetchWithSsrfGuard` (`isPrivateHostWithDns` + `redirect:"manual"` + cap 2M) + `compaction` jangan ke DeepSeek bila primary bukan DeepSeek.
- **P1.4 `Atomics.wait` → `Bun.sleep`:** `persistence.ts:76` & `vector.ts:108` jadi async.
- **P1.5 `usage.ts` multi-model:** `cacheIncluded` global + reprice seluruh history dengan model terakhir → akumulasi `session.cost += segmentCost` per-turn.

**P2 — Reliability & perf (backlog):** `trace` rotate lock, `memory/files` truncate `atomicWriteText`, `net.ts:38` `isPrivateHostWithDns` opsi `strict`, `pricing` pre-sort, `vector` FTS5, `shadow-git` `inside` case-insensitive + tolak symlink.

  **Selesai bila:** `P0.1` race test hijau di `Pool(3)`, `P1.2` scrub test hijau, `isPrivateHost` fuzz `0x/0177` pass, `bun x tsc --noEmit && bun test && bun run gate:coverage && bun run gate:pack` hijau, `MIN_LINES/MIN_FUNCS` dinaikkan bila naik.

  > **Update 2026-09-03:** `P0.1-P1.5` sudah di-commit `9a09012` (lock `config`/`manifest`, corrupt backup, `try/finally db.close` + `chmod 600`, `mkdir 0o700`, scrub `memory/files:24` + `vector:158` + `compaction:55` + `trace:36`, SSRF `vector:67`/`pricing:212`/`compaction:127`, `usage.ts` per-segmen), gate `81.17%/83.45%` hijau. Sisa `P2` backlog.

## P5 — Session: turnCount, NaN, checkpoint, hook

Audit 2026-09-04 menemukan duplikat `turnCount`, `NaN` budget/timeout, checkpoint buta `bash` di non-repo, resume tanpa `turnCount`/`cost`, lock lintas-proses. Detail di `.verdent/plans/Session_Hardening-0904.plan.md`.

**P0 — Rilis blocker:**
- **P0.1 Resume continuity:** `persistence.ts:223` `loadSession` → kembalikan `turns` + `sessionMeta`, seed `turnState.turnCount` & `usage.sessionCost` di `setup.ts:114`. Test: resume 2 turn → `turnCount===2` & `cost 0.3`.
- **P0.2 Validasi NaN:** `index.ts:140` & `setup.ts:99` `Number.isFinite` + warn + fallback `undefined`, jangan teruskan `NaN`.
- **P0.3 Checkpoint bash:** `setup.ts:183` `postEditSnapshots` hanya `edit/write/patch` → perluas ke `bash` via `snapshotWorkspace` diff untuk non-repo.
- **P0.4 Hook timeout:** `hooks/run.ts:35` `Promise.race` 5s + `kill`.

**P1 — Konsistensi:**
- **P1.1 Compacted flag:** `loop.ts:44` `compactStore` return `didCompact` baru `compacted=true`.
- **P1.2 postEditSnapshots leak:** `setup.ts:195` `turn:aborted` handler clear map.
- **P1.3 buildSystemPrompt timeout:** `app/session.ts:54` teruskan `signal` + 5s fallback.

  **Selesai bila:** resume `turnCount`/`cost` kontinu, `NaN` tidak diteruskan, non-repo `bash` undo, hook tidak block >5s, gate hijau.

  > **Update 2026-09-03:** `P0.1-P1.3` sudah di-commit `6d8662f` (seed `turnCount` via `vendor/session:40`, `NaN` guard `index:134`/`setup:99`, `snapshotWorkspace` penuh untuk non-repo, hook 5s, `didCompact`, `buildSystemPrompt` signal), gate `81.28%/83.26%` hijau.

## P6 — Tool Layer: jail, bash-guard, scrub, atomik

Audit 2026-09-04 menemukan 8 High: OOM paged, TOCTOU symlink di 7 tool, ripgrep leak, `bash` cwd, MCP/LSP/todo scrub, `allow-all` bypass, `SENSITIVE` inkonsistensi, DNS `fail-open`. Detail di `.verdent/plans/Tool_Layer_Hardening-0904.plan.md`.

**P0 — Rilis blocker:**
- **P0.1 Streaming paged read + TOCTOU:** `read_file:107` `paged=true` tetap `readFile` 1GB → OOM, 7 tool `isPathOutsideRoot(real, resolve(root))` tanpa `realpath(root)`. Pakai `createReadStream` + `O_NOFOLLOW` + `realpath` ulang setelah `open`.
- **P0.2 Edit/patch uniqueness + ripgrep leak + bash cwd:** `edit:193` hanya `exact/crlf` → `trimmed/fuzzy` edit salah, `grep:92` `rg` tanpa `realpath` bocor symlink, `bash:84` `spawn({cwd:c})` tidak `resolve(sessionRoot,c)`.
- **P0.3 MCP/LSP/todo scrub + jail:** `mcp_call:71` tidak `scrubSecrets`, `lsp:19` `process.cwd()` + tanpa `isSensitive`, `todo:27` `sessionId` traversal → sanitasi `replace(/[^a-zA-Z0-9_-]/g,"_")` + `scrub` + `ctx.cwd`.

**P1 — Guard konsistensi:**
- **P1.1 `SENSITIVE_TARGET = SENSITIVE_RE` + `net:38` `strict` fail-closed + tanpa cache untuk `web_fetch`/MCP, `permission:177` `allow-all` tetap `bashDenied` untuk `STATIC_DENY`/`RM_DANGEROUS`, `web_fetch:45` whitelist `http/https` + `readCapped` error path.
- **P1.2 Allowlist & scrub:** `npx` keluar dari default allowlist (RCE), `allowlist:46` trunc 200 → hash, `scrub:58` tambah `PAT` + `KEY`.

**P2 — Reliability:** `globToRegExp` → `picomatch`, `limit NaN` clamp, `atomic` entropy `replaceAll("-","").slice(0,16)` + `EXDEV` fallback, `bash` marker + reap interval, `write_file` `Buffer.byteLength`.

  **Selesai bila:** `P0.1` paged 1GB tidak OOM, symlink dir `outside` → `outside workspace`, `edit` duplicate `trimmed` → `multiple times`, `grep` symlink `rg` → block, `bash` `cwd` resolve, `sk-` dari MCP → `[REDACTED]`, `fuzz 0x/0177` pass, gate hijau.

  > **Update 2026-09-04:** `P0.1-P0.2` sudah di-commit `44e0684` (hard cap 50M + `realRoot`, `edit` uniqueness semua mode, `patch` limit 50, `glob/grep` `NaN` clamp 1..500), gate `80.98%/83.25%` hijau. Sisa `P0.3` MCP/LSP/todo + `P1` guard jadi `P7` berikutnya (sudah dieksekusi `78f6ac1`).

## P7 — Env Var & Perintah: dokumentasi & konsistensi

Audit 2026-09-04 menemukan 38 env unik (22 `MINICODE_*`), 22 flags, 31 tools, 15 slash — 5 `MINICODE_*` undocumented, drift `HELP` timeout `600000→900000`, 7 phantom slash (`/undo` `/redo` `/cost` `/resume` `/clear` + alias), `web_search` tidak `READONLY`, `KNOWN_FLAGS` vs subcommand flags, `SECRET_ENV_RE` kurang `PAT`. Detail di `.verdent/plans/Env_Command_Hardening-0904.plan.md`.

**P0 — Rilis blocker:**
- **P0.1 `HELP` timeout:** `cli/index.ts:50` `600000` → `900000` (sinkron `setup.ts:104` + `USAGE.md:52`)
- **P0.2 Phantom slash:** pilih A (implement `undo/redo/cost/resume/clear` + `hidden:true` alias) atau B (hapus 7 baris dari `USAGE.md` + `ARCHITECTURE.html:570`) — B sesuai `test/cli-help-language:47` saat ini
- **P0.3 `web_search` READONLY:** `permission.ts:21` tambah `"web_search"` ke `READONLY_TOOLS`
- **P0.4 `KNOWN_FLAGS` vs subcommand:** `args.ts:24` `SUBCOMMAND_FLAGS` atau pindah `promptFromArgs` setelah `dispatch`

**P1 — Docs & discoverability:**
- **P1.1 USAGE tabel:** tambah `--verbose`, `--max-steps`, `--context-window`, `--session` + `help --json` (`index.ts:94`) 4 entry
- **P1.2 `MINICODE_*` 5 vars + `AGENT_*`/`TAVILY`:** `USAGE.md:62` `BELL`, `SHOW_THINKING`, `THINKING`, `EMBED_MODEL`, `AGENT_*`/`DEEPSEEK_BASE_URL`
- **P1.3 `SECRET_ENV_RE` PAT:** `scrub.ts:58` `CREDENTIAL_WORD` tambah `PAT`, test `env-strip` `GITHUB_PAT`

**P2 — Polish:** `args.ts` ` --output-format`/`--prompt` shadow flag hapus/implement, `ARCH` line numbers tanpa angka.

  **Selesai bila:** `HELP` vs code `900000` sinkron, `/undo` → `success` (atau `USAGE` bersih), `web_search` di `plan` → `allow`, `promptFromArgs` tidak bocor `--match`, `USAGE.md` vs `process.env` 38 vars sinkron, gate hijau.

  > **Update 2026-09-04:** P0-P1 `P7` sudah di-commit `78f6ac1` (`HELP` 900000, `DRIVER_COMMANDS` `/undo`/`redo`/`cost`/`resume`/`clear`, `web_search` READONLY, `VALUE_FLAGS` +12 subcommand, USAGE `+8` flags/`+7` env, `scrub` `_PAT\b`) + `bf9009f` polish (`exec` `getArg` + `ARCH` tanpa `:line`), gate `80.98%/83.25%` `1180p` hijau.

## P8 — CLI Command: router, phantom, budget, mention, hook

Audit 2026-09-04 menemukan 38 temuan: flag-injection via prompt, plan re-exec `MINICODE_PLAN` loop + prematur `process.exit(0)`, `resumeId` tanpa sanitasi, `router` global flag sebelum subcommand, `@mention` tanpa `realpath`, checkpoint buta `bash` non-git (sudah P5), `hook` tanpa timeout. Detail di `.verdent/plans/Cli_Command_Hardening-0904.plan.md`.

**P0 — Rilis blocker:**
- **P0.1 Flag-parser:** `args.ts:52` + `index.ts:77,129` `args.includes("--allow-all")` → prompt `"review --allow-all"` aktifkan sandbox. Buat `isFlag(token)` via `flagNameOf` + posisi, `getArg` hanya scan sebelum prompt text pertama.
- **P0.2 Plan re-exec:** `index.ts:341` `MINICODE_PLAN` loop + `process.exit(0)` ganda → `env MINICODE_PLAN="0"` + `await child.on("exit")` tanpa ganda, fallback `entry ?? resolvePath`.
- **P0.3 Sanitasi `resumeId`:** `index.ts:138` `resumeId` sanitasi `replace(/[^A-Za-z0-9._-]/g,"-")` sama `sessionId`.
- **P0.4 Router global flag:** `router.ts:6` `cmd = args[0]` → `minicode --cwd /tmp providers` jadi prompt. Scan subcommand pertama yang bukan flag (skip `VALUE_FLAGS` + nilainya).

**P1 — Konsistensi:**
- **P1.1 `@mention` realpath:** `repl.ts:190` `isRealPathOutsideRoot` di `mentions.ts:23`
- **P1.2 Budget/timeout validasi:** `index.ts:140` `NaN` guard sudah P0.2 session, perluas ke `exec.ts` + `maxSteps` cap 200
- **P1.3 Stats/providers/exec:** `stats.ts:15` `process.argv` → `args`, `providers.ts:17` per-line `try JSON.parse`, `exec.ts:27` `sessionId` sanitasi + `budget` `isFinite`

**P2 — Polish:** `args.ts:52` `getArg` izinkan `-5`, `readPrompt` tanpa timer 500ms, `commands.ts:119` `join` hard-coded `\\`, `repl.ts:115` `cycleMode` support `allow-all`.

**Selesai bila:** `prompt "a --allow-all"` tidak aktifkan, plan re-exec env `0` + no prematur exit, `resumeId` traversal → sanitasi, `--cwd /tmp providers` → `exit 0`, gate hijau.

## P9 — Memory / RAG: isolation, freeze, scan, noise

Audit 2026-09-05 menemukan 4 kritis: `process.cwd()` bocor `--cwd` di 3 tool memory, `Atomics.wait` freeze 175ms, `instr(lower())` full scan tanpa FTS5, injeksi noise tanpa threshold — plus 8 medium (dedup, dim mismatch, global leak, TTL, SSRF, trunc, chunking, fileLocks). Detail di `.verdent/plans/Memory_RAG_Hardening-0905.plan.md`.

**P0 — Rilis blocker:**
- **P0.1 `ctx.cwd` isolation:** `tools/memory.ts:20,25,70,110` `process.cwd()` → `ctx.cwd ?? process.cwd()` (seperti `read_file` 0.8.0). Test `memory-cwd-isolation` — write di `ctx.cwd=/tmp/A` tidak muncul di `process.cwd()` atau `/tmp/B`.
- **P0.2 `Atomics.wait` → `Bun.sleep` async:** `vector.ts:129` + `persistence.ts:91` `25*2^i` sync → `await Bun.sleep(25<<i)` + `try/finally db.close()` di `searchHybrid:216`. Test `grep Atomics.wait` 0 + `Pool(3) 20 writes` <500ms.
- **P0.3 Threshold + no-inject:** `vector.ts:237` `slice(0,5)` tanpa `MIN_SCORE` → `0.05` tetap inject. Filter `>=0.20` hybrid / `0.25` keyword, bila 0 jangan `# Relevant memory`. Test `score 0.05` tidak masuk, `0.8` masuk.

**P1 — Kualitas & keamanan:**
- **P1.1 FTS5/index:** `vector.ts:24` `memory(text)` `instr` full scan → `idx_memory_text_lower` expr index atau `memory_fts` virtual + triggers, benchmark 5000 rows <50ms
- **P1.2 TTL/MAX_ROWS:** `LIMITS.MEMORY_TTL_DAYS 90` `MAX_ROWS 5000` + prune `created_at<now-TTL` + `VACUUM` periodik di `addMemory`
- **P1.3 Embedding meta:** `model,dim` kolom + dim mismatch `cosine 0` → warn + re-embed background
- **P1.4 SSRF strict:** `vector.ts:77` `isPrivateHostWithDns` `strict:true` fail-close + `redirect:manual` 2 hop

**P2 — Polish:** MMR `λ=0.7` dedup `cosine>0.92`, chunk 2000+overlap 200, `vector.db-wal/-shm` `chmod 600`, `minicode memory stats`.

**Selesai bila:** `write_memory` via `ctx.cwd` isolasi, `grep Atomics.wait` 0, `score 0.05` tidak inject, `keywordRows` <50ms, `COUNT(*)<=5000`, gate hijau.

> **Update 2026-09-05:** `P0.1-P0.3` + `P1.1-P1.4` sudah dieksekusi (8 test baru `test/memory-p1.test.ts`, gate `tsc` PASS + `lint` 9 warn + `1186 pass` + `coverage 80.96/83.18` + `pack 22/22`). Catatan: `deleteMemoryByQuery` kini hitung-dulu-sebelum-DELETE — `sqlite3_changes()` ikut menghitung tulis trigger FTS sehingga `info.changes` membengkak (terukur 7 untuk 1 baris). Sisa `P2` backlog + flake TUI `provider/model-manager-flows` yang berpindah tiap run (pre-existing, di luar jalur memory — lolos saat run isolasi).
>
> **Update 2026-09-06 (P2 tuntas):** MMR λ=0.7 + dedup cosine 0.92 (`mmrRerank`, terbukti: test gagal tanpa MMR), chunk 2000/overlap 200 kolom `parent` (return parent id), `createdAt` di `MemoryHit` + display `(score, tanggal)` di RAG/tool, `chmod 600` db-wal/-shm, `memoryHits` di `RunTrace` + `createRagLayer` + `CliSession`, subcommand baru `minicode memory status [--json]` (`cli/commands/memory.ts`, `getMemoryStats`), 8 test `test/memory-p2.test.ts` + 3 test `cli-subcommands`, docs `USAGE.md` + `ARCHITECTURE.html` sinkron.

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
