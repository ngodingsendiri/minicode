# Audit Menyeluruh Lapisan UI — Minicode

Tanggal: 2026-09-01  
Cakupan: `src/ui/**`, integrasi `cli/**` yang memengaruhi presentasi, serta bukti dari `test/tui-*.test.ts`, `test/prompt-engine.test.ts`, `test/ui-boundary.test.ts`.

## Ringkasan Eksekutif

UI Minicode saat ini sudah **cukup matang untuk terminal-first UX**: layer boundary jelas, handling CJK/emoji kuat, sanitasi ANSI sudah defensif, dan banyak regresi historis sudah ditutup oleh test.  
Namun masih ada gap penting pada:

1. **Konsistensi visual lintas screen** (terutama `model-manager` vs picker/provider-manager),
2. **Konsistensi bahasa** (ID/EN campur pada label dan microcopy),
3. **Aksesibilitas non-visual** (bel notifikasi hardcoded, tanpa opsi preferensi),
4. **Responsivitas fallback inline** (masih pakai `.length`, berisiko salah hitung pada CJK/emoji),
5. **Hierarki dan ritme spasi** yang belum distandardisasi lintas komponen.

---

## Metodologi Audit

- Review kode UI utama:
  - Input & interaction: `src/ui/input/input.ts`, `src/ui/input/prompt-engine.ts`
  - Rendering primitives: `src/ui/render/{theme,width,wrap,table,diff,markdown,highlight,sanitize,errors}.ts`
  - Surface komponen: `src/ui/screens/{picker,provider-manager,model-manager,wizard}.ts`
  - Runtime state & feedback: `src/ui/runtime/{spinner,statusline}.ts`, `src/ui/assistant/{simple,turn-status}.ts`
  - Approval UX: `src/ui/approval/prompt.ts`
- Review alur integrasi CLI yang memicu UI:
  - `cli/repl.ts`, `cli/setup.ts`, `cli/{commands,provider-manager,model-manager,wizard}.ts`
- Verifikasi bukti kualitas lewat test suite UI:
  - `test/tui-overlay.test.ts`, `test/tui-classic.test.ts`, `test/prompt-engine.test.ts`, `test/tui-table.test.ts`, `test/ui-boundary.test.ts`, dst.

---

## Temuan Terperinci per Dimensi

## 1) Struktur Layout

### Temuan Positif
- **Arsitektur layer UI bersih dan terjaga**:
  - `src/ui/contract.ts` memisahkan event payload UI dari kernel.
  - `test/ui-boundary.test.ts` menegakkan larangan import silang (`src/ui` vs non-ui).
- Overlay line-based pada picker/provider-manager memakai pola clear+redraw yang konsisten (`SYNC_START`, `CLEAR`, cursor restore).

### Temuan Masalah

#### F-01 — Ketidakkonsistenan paradigma layout antar screen
- **Bukti**:
  - `src/ui/screens/picker.ts` dan `provider-manager.ts` memakai overlay ANSI responsif.
  - `src/ui/screens/model-manager.ts` masih model `console.log` linear sederhana.
- **Dampak**: UX terasa “dua produk” dalam satu CLI; affordance dan navigasi visual berubah drastis antar menu.
- **Prioritas**: **P1 (High)**
- **Rekomendasi spesifik**:
  1. Refactor `model-manager.ts` untuk reuse primitive overlay yang sama dengan picker/provider-manager.
  2. Satukan scaffold komponen list interaktif (title, list rows, footer hint, selection style) ke helper shared.

#### F-02 — Pola konstanta ANSI diulang di banyak file
- **Bukti**: `DIM/RESTORE/CLEAR/SYNC_*` dideklarasi berulang di `input.ts`, `picker.ts`, `provider-manager.ts`.
- **Dampak**: redundansi dan risiko drift perilaku jika satu komponen berubah, lain tertinggal.
- **Prioritas**: **P2 (Medium)**
- **Rekomendasi**:
  - Buat util terpusat semacam `render/ansi-primitives.ts` (export konstanta + helper clear/move).

---

## 2) Hierarki Visual

### Temuan Positif
- Hierarki status cukup jelas:
  - Aksen untuk selected row (`›` + bold + accent),
  - Secondary info dimmed,
  - Error/warning/success terpisah semantik via token `c.*`.
- Diff card (`render/diff.ts`) menampilkan context/add/delete dengan kontras yang baik untuk terminal.

### Temuan Masalah

#### F-03 — Hierarki antar komponen belum sepenuhnya seragam
- **Bukti**: Header/footer/hint style berbeda antara `picker`, `provider-manager`, `wizard`, dan `approval/prompt`.
- **Dampak**: cognitive switching cost meningkat.
- **Prioritas**: **P2 (Medium)**
- **Rekomendasi**:
  - Definisikan “UI style contract” internal:
    - Judul panel,
    - Label bantuan keyboard,
    - Empty state,
    - Success/error acknowledgement.
  - Terapkan token semantic kelas “title/subtitle/hint/active/error/success” pada semua screen.

---

## 3) Tipografi

### Temuan Positif
- Lebar tampilan sudah diukur berbasis **kolom terminal** (`displayWidth`) sehingga CJK/emoji lebih aman.
- `wrap.ts` dan `width.ts` punya dokumentasi alasan teknis yang kuat.

### Temuan Masalah

#### F-04 — Mixing bahasa pada microcopy UI
- **Bukti**:
  - Indonesia: “lagi”, “cocok”, “Provider not found” campur.
  - Inggris: “Permission required”, “Tool”, “No models configured.”
- **Dampak**: tone tidak konsisten, terutama untuk user non-teknis.
- **Prioritas**: **P1 (High)**
- **Rekomendasi**:
  1. Tetapkan baseline bahasa (ID penuh / EN penuh / i18n toggle).
  2. Audit string literal di `src/ui/**` lalu migrasi ke dictionary sederhana.
  3. Mulai dari screen paling sering: `repl`, `input`, `picker`, `provider-manager`, `approval`.

#### F-05 — Fallback non-ANSI inline masih hitung panjang via `.length`
- **Bukti**: `src/ui/input/input.ts` pada `renderInline` menggunakan `content.length` dan `printedW` berbasis length.
- **Dampak**: potensi misalignment pada CJK/emoji di console legacy (aksesibilitas & readability turun).
- **Prioritas**: **P1 (High)**
- **Rekomendasi**:
  - Ganti hitung lebar fallback ke `displayWidth` + `truncateToWidth/padToWidth`.

---

## 4) Spasi & Rhythm

### Temuan Positif
- Banyak komponen sudah menjaga lebar dengan `truncateToWidth` dan spacing berbasis layout terminal.
- Table renderer (`render/table.ts`) sudah menangani newline/tab dan lebar kolom dengan baik.

### Temuan Masalah

#### F-06 — Ritme vertikal belum seragam antar flow
- **Bukti**: `wizard.ts`, `provider-manager.ts`, `model-manager.ts` memakai pola blank-line yang berbeda-beda (`\n` prefix/suffix).
- **Dampak**: transisi visual antar mode kurang halus.
- **Prioritas**: **P3 (Low-Medium)**
- **Rekomendasi**:
  - Buat guideline “vertical rhythm” untuk:
    - before/after section title,
    - before action prompt,
    - after success/error.

---

## 5) Konsistensi Komponen

### Temuan Positif
- `prompt-engine.ts` cukup kuat: cursor code-point aware, editing in-line, tab completion sesuai selection, handling bracketed paste.
- Ada pengamanan regresi kuat di test `prompt-engine.test.ts` dan `tui-classic.test.ts`.

### Temuan Masalah

#### F-07 — Duplikasi pola overlay logic
- **Bukti**: `picker.ts` dan `provider-manager.ts` punya blok render/cleanup/suspend-resume sangat mirip.
- **Dampak**: maintenance cost naik; bug fix harus diterapkan dua tempat.
- **Prioritas**: **P2 (Medium)**
- **Rekomendasi**:
  - Ekstrak engine overlay generik:
    - mount/unmount,
    - redraw diff rows,
    - resize subscription,
    - cursor hide/show lifecycle.

#### F-08 — Spinner/statusline punya pola lifecycle mirip tapi tidak terunifikasi
- **Bukti**: `runtime/spinner.ts` vs `assistant/turn-status.ts` sama-sama mengelola cursor + repaint interval.
- **Dampak**: risiko edge-case terminal state (cursor visibility) jika satu diperbarui tidak sinkron.
- **Prioritas**: **P2 (Medium)**
- **Rekomendasi**:
  - Satukan ke util `status-render-loop` dengan API small:
    - start/stop/suspend/resume,
    - cursor-safe exit hook.

---

## 6) Aksesibilitas

### Temuan Positif
- Tema `mono` tersedia (jalur aksesibilitas minim warna).
- UTF-8 fallback glyph tersedia (`glyphs` getter).
- Sanitasi ANSI untuk input tidak terpercaya sudah baik (`render/sanitize.ts`).

### Temuan Masalah

#### F-09 — Bell notifikasi permission hardcoded
- **Bukti**: `src/ui/approval/prompt.ts` selalu `process.stdout.write("\x07")`.
- **Dampak**: mengganggu user sensitif suara / screen-recording / remote terminal.
- **Prioritas**: **P1 (High)**
- **Rekomendasi**:
  - Tambah opt-out env/config: `MINICODE_BELL=0` atau preferensi user.
  - Default tetap on, tapi hormati NO_COLOR-like accessibility preference.

#### F-10 — Light theme tersedia tapi tidak tercover kuat oleh regresi visual
- **Bukti**: `themes.ts` mendukung `light`, namun test lebih fokus perilaku token/render daripada audit kontras/legibility lintas tema.
- **Dampak**: potensi readability issue pada terminal light background tanpa terdeteksi cepat.
- **Prioritas**: **P2 (Medium)**
- **Rekomendasi**:
  - Tambah snapshot test sederhana untuk output representative (`status`, `diff`, `picker selected`, `error`) per theme.

---

## 7) Responsivitas

### Temuan Positif
- Banyak bug terminal kecil sudah ditutup:
  - `picker.ts` menyesuaikan rows/cols aktual,
  - handling resize ada,
  - truncate by display width.
- Bukti test: `tui-overlay.test.ts` memverifikasi skenario sempit dan resize.

### Temuan Masalah

#### F-11 — `section()` masih gunakan `label.length` bukan display width
- **Bukti**: `src/ui/render/theme.ts` pada `section(title)` pakai `label.length`.
- **Dampak**: separator bisa meleset untuk judul CJK/emoji.
- **Prioritas**: **P2 (Medium)**
- **Rekomendasi**:
  - Ganti ke `displayWidth(label)` untuk hitung dash.

#### F-12 — Screen `model-manager` belum responsive-aware setara screen lain
- **Bukti**: `src/ui/screens/model-manager.ts` rendering sangat linear, tidak ada clamp width/height.
- **Dampak**: pada terminal kecil, keterbacaan turun dan interaksi tidak sejelas picker/provider-manager.
- **Prioritas**: **P1 (High)**
- **Rekomendasi**:
  - Naikkan `model-manager` ke arsitektur overlay responsif (lihat F-01).

---

## 8) Interaksi Mikro

### Temuan Positif
- Keybinding UX sudah cukup kaya:
  - Shift+Tab cycle mode,
  - Ctrl+O compact toggle,
  - Ctrl+T reasoning toggle,
  - Esc behavior pada picker filter sudah dua tahap (clear filter lalu close).
- History behavior pada `askLine` sudah benar (replace, bukan append kacau).

### Temuan Masalah

#### F-13 — Discoverability interaksi mikro belum seragam
- **Bukti**: sebagian shortcut diumumkan di `/help`, sebagian hanya implicit di UI/footer atau komentar kode.
- **Dampak**: fitur ada tapi tidak terpakai user baru.
- **Prioritas**: **P3 (Low-Medium)**
- **Rekomendasi**:
  - Tambahkan “hint ringkas kontekstual” konsisten di semua surface interaktif.
  - Standarkan kalimat bantuan akhir panel.

#### F-14 — Confirmation flow destructive action belum terstruktur severity level
- **Bukti**: provider delete sudah ada prompt konfirmasi, namun belum ada standar wording antar aksi destruktif lainnya.
- **Dampak**: risiko UX tidak konsisten untuk tindakan irreversible/berdampak.
- **Prioritas**: **P2 (Medium)**
- **Rekomendasi**:
  - Definisikan template konfirmasi destruktif:
    - objek yang dihapus,
    - dampak langsung,
    - status aktif/nonaktif,
    - default choice aman.

---

## Daftar Prioritas (Roadmap Tindakan)

## P1 — Wajib didahulukan
1. **Unifikasi UI screen interaktif** (`model-manager` naik ke overlay architecture).  
2. **Perbaiki fallback inline width calc** di `input.ts` dari `.length` ke display-width aware.  
3. **Konsistensi bahasa UI** (minimal untuk surface primer).  
4. **Tambahkan kontrol preferensi bell** (`MINICODE_BELL=0`).

## P2 — Penting
5. Ekstraksi shared overlay primitives (kurangi duplikasi picker/provider-manager).  
6. Unifikasi lifecycle status render (spinner + turn-status).  
7. Perbaiki `section()` agar display-width aware.  
8. Standarisasi template konfirmasi aksi destruktif.

## P3 — Nice-to-have bernilai
9. Standar ritme spasi vertikal antar screen.  
10. Perkuat discoverability shortcut/micro-interactions.  
11. Tambah snapshot legibility lintas tema.

---

## Quick Wins (estimasi effort kecil, dampak tinggi)

1. `theme.ts::section()` -> ganti `label.length` menjadi `displayWidth(label)`.  
2. `input.ts::renderInline` -> ganti `content.length/printedW` ke display width.  
3. `approval/prompt.ts` -> guard bell dengan env (`MINICODE_BELL`).  
4. Rapikan string campuran ID/EN pada komponen yang paling sering muncul (`askLine`, `picker`, `provider-manager`, `help`).

---

## Risiko Jika Tidak Ditangani

- Drift UX makin besar karena sebagian screen modern overlay, sebagian legacy line-mode.
- Bug visual CJK/emoji bisa muncul kembali di path fallback/utility yang belum full display-width aware.
- Fitur mikro tetap underused akibat discoverability rendah.
- Aksesibilitas (auditory) bisa menurunkan kenyamanan pengguna tertentu.

---

## Kesimpulan

Secara fondasi, UI Minicode sudah berada di level **stabil dan defensif** untuk CLI interaktif modern. Fokus perbaikan berikutnya bukan lagi “patch bug kasar”, melainkan **konsolidasi desain sistem UI**: samakan pola antar screen, rapikan bahasa, dan tutup gap aksesibilitas/responsivitas yang tersisa.  
Dengan menyelesaikan item P1+P2 di atas, kualitas UX akan naik signifikan tanpa perlu perubahan arsitektur besar.