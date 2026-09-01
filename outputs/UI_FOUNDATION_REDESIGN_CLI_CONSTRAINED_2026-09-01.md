# UI Foundation Redesign Plan (Opsi 3) — CLI-Constrained

Tanggal: 2026-09-01  
Status: Baseline eksekusi baru (menggantikan asumsi Opsi 3 lama)  
Arah utama: **Redesign komprehensif, tetapi tetap shell-like CLI**

---

## 0) Constraint desain yang tidak boleh dilanggar (Non-Negotiable)

1. Tetap **CLI-first** dan keyboard-first.
2. Output utama tetap **linear scrollback** (append-only flow), bukan layar aplikasi permanen.
3. Tidak boleh menjadi fullscreen TUI sebagai mode utama.
4. Tidak ada sidebar/dashboard/panel-grid permanen ala IDE.
5. Tool call, status, feedback, hasil tetap **inline** di aliran output.
6. Overlay/picker hanya **transient**, dipakai saat perlu (selection/focus task), bukan kerangka utama UI.
7. Prioritas: ringan, cepat, terbaca, predictable, minim noise visual.
8. Terapkan **progressive disclosure**:
   - informasi penting selalu tampak,
   - detail tambahan hanya saat relevan (verbose/expand/command khusus).

**Definisi sukses utama:**
> “CLI yang dirancang sangat baik”, bukan “IDE/TUI di terminal”.

---

## 1) Audit keputusan desain: Pertahankan vs Perbaiki vs Konsolidasi vs Rebuild

## A. Pertahankan (sudah kuat)
1. **Arsitektur boundary UI** (`src/ui/contract.ts` + `test/ui-boundary.test.ts`).
2. **Display-width aware rendering** (CJK/emoji) di core (`width.ts`, `wrap.ts`, table truncation).
3. **Sanitasi ANSI defensif** untuk input/output tidak terpercaya (`sanitize.ts`).
4. **Flow REPL linear shell-like** (`cli/repl.ts` + `assistant/simple.ts`) dengan output append-only.
5. **Progressive disclosure yang sudah ada** (compact/expanded, reasoning toggle, verbose mode).

## B. Perbaiki (targeted)
1. Fallback inline non-ANSI masih ada path `.length` (responsivitas belum konsisten penuh).
2. Bahasa microcopy masih campur ID/EN di beberapa permukaan.
3. Bell notifikasi permission belum punya preferensi user (`MINICODE_BELL=0` belum standar resmi sistem).
4. Vertical rhythm antar flow belum seragam (prompt/panel/success/error spacing).

## C. Konsolidasi (eliminasi duplikasi)
1. Primitive overlay (render/cleanup/resize/cursor lifecycle) di picker/provider-manager.
2. Semantic style token untuk title/subtitle/hint/empty-state/status feedback.
3. Runtime feedback lifecycle (spinner/status-line) agar perilaku terminal state konsisten.
4. Template wording untuk destructive confirmation agar konsisten lintas aksi.

## D. Rebuild (komponen yang perlu rombak)
1. `model-manager` (masih gaya linear sederhana) -> migrasi ke overlay transient yang konsisten, **tanpa mengubah paradigma CLI utama**.
2. UI guideline/contract formal agar komponen baru otomatis mengikuti sistem shell-like.

---

## 2) Redesign scope komprehensif (tetap shell-like)

## 2.1 Design Tokens & Semantic Visual System
- Bentuk token semantic lintas layer:
  - `title`, `subtitle`, `hint`, `muted`, `accent`, `success`, `warning`, `error`, `active`, `pending`.
- Token harus berbasis fungsi semantik, bukan hardcoded per komponen.
- Tema `dark/light/mono` tetap dipertahankan dengan fallback aman non-ANSI.

## 2.2 Typography & Hierarchy
- Standarisasi level informasi:
  - Level 1: hasil utama / status final,
  - Level 2: konteks tindakan,
  - Level 3: detail opsional.
- Konsistensi bahasa output (pilih baseline jelas: ID penuh atau EN penuh per mode rilis).

## 2.3 Spacing & Vertical Rhythm
- Definisikan aturan jarak global:
  - sebelum judul section,
  - antar blok feedback,
  - sebelum/akhir prompt.
- Larang blank-line berlebih yang mengganggu aliran shell.

## 2.4 Feedback State Model
- Matriks state standar: `loading/running/success/error/cancel/info`.
- Wording dan format visual tiap state konsisten lintas command/screen.
- Tetap inline; tidak dipindah ke panel terpisah.

## 2.5 Prompt/Title/Hint/Empty State Contract
- Semua komponen interaktif wajib punya pola:
  - title ringkas,
  - hint keyboard ringkas,
  - empty-state jelas + tindakan lanjut,
  - konfirmasi aksi destruktif dengan dampak.

## 2.6 Overlay/Picker Family
- Overlay tetap transient.
- Unifikasi komponen:
  - picker,
  - provider-manager,
  - model-manager (pasca migrasi).
- Target: UX seragam tanpa membuat shell menjadi “app shell”.

## 2.7 Keyboard Affordance & Discoverability
- Shortcut penting selalu discoverable (help/contextual hint).
- Progressive disclosure:
  - hint ringkas default,
  - detail shortcut lengkap via command khusus.

## 2.8 Responsive Rendering
- Semua perhitungan visual berbasis `displayWidth` (bukan `length`).
- Jaminan perilaku untuk terminal sempit + resize runtime.

## 2.9 Accessibility
- Pertahankan mode `mono` sebagai first-class accessibility path.
- Tambah kontrol non-visual feedback (bell toggle).
- Pastikan hierarki tetap terbaca tanpa warna.

## 2.10 Runtime Feedback Engine
- Jika disatukan, tujuan hanya untuk konsistensi lifecycle terminal (cursor/clear/repaint).
- Bukan untuk menambah panel visual permanen.

## 2.11 Regression Test Expansion
- Uji terminal kecil, CJK/emoji, ANSI sanitization, fallback non-ANSI, lintas tema.
- Tambah skenario konfirmasi destruktif dan konsistensi hint state.

## 2.12 UI Guideline/Contract
- Dokumen kontrak UI shell-like untuk developer:
  - apa yang wajib,
  - apa yang dilarang,
  - contoh pola komponen.

---

## 3) Arsitektur eksekusi bertahap (tanpa big-bang rewrite)

## Tahap 0 — Guardrail & Baseline Audit (wajib sebelum perubahan besar)
**Tujuan:** mengunci prinsip shell-like sebagai pagar desain.

### Deliverable
1. Dokumen guardrail “CLI shell-like UI constraints”.
2. Checklist audit komponen: keep/fix/consolidate/rebuild per file.
3. Definisi acceptance criteria tiap perubahan.

### Effort relatif
- Rendah

### Hasil diharapkan
- Tim punya batas yang jelas; redesign tidak liar.

---

## Tahap 1 — Quick Structural Wins
**Tujuan:** menutup gap paling berdampak tanpa ganggu arsitektur.

### Deliverable
1. Fix full display-width compliance (termasuk fallback path).
2. Bell preference toggle.
3. Rapikan microcopy inti + rhythm dasar.
4. Tambah test regresi untuk item di atas.

### Effort relatif
- Rendah–menengah

### Hasil diharapkan
- UI langsung lebih stabil, lebih ramah, lebih konsisten.

---

## Tahap 2 — Semantic UI System Consolidation
**Tujuan:** membangun fondasi token + contract lintas komponen.

### Deliverable
1. Semantic token map + pemakaian konsisten.
2. Shared primitive untuk overlay/transient interaction.
3. Standard feedback formatter untuk state umum.

### Effort relatif
- Menengah

### Hasil diharapkan
- Pola visual konsisten; maintenance cost turun.

---

## Tahap 3 — Component Family Refactor (transient UI only)
**Tujuan:** menyelaraskan keluarga komponen interaktif.

### Deliverable
1. Migrasi `model-manager` ke pola overlay transient.
2. Refit `picker` & `provider-manager` ke primitive bersama.
3. Konfirmasi destruktif terstandar.

### Effort relatif
- Menengah

### Hasil diharapkan
- Interaksi terasa satu sistem, tetap shell-native.

---

## Tahap 4 — Runtime Feedback Harmonization
**Tujuan:** feedback engine konsisten, tidak noisy.

### Deliverable
1. Harmonisasi spinner/status lifecycle (cursor-safe, no ghost artifacts).
2. Progressive disclosure rules untuk output detail.

### Effort relatif
- Menengah

### Hasil diharapkan
- Feedback jelas, cepat, dan tetap ringan secara visual.

---

## Tahap 5 — Verification, Guideline, & Hardening
**Tujuan:** mengunci kualitas jangka panjang.

### Deliverable
1. Regression suite diperluas (terminal size/theme/fallback).
2. Dokumen “UI Contract for CLI Shell-like Components”.
3. Checklist PR agar komponen baru mengikuti kontrak.

### Effort relatif
- Menengah

### Hasil diharapkan
- Kualitas UI stabil lintas evolusi fitur.

---

## 4) Matriks prioritas eksekusi

## Quick Wins (eksekusi paling awal)
1. Full display-width compliance di semua path render.
2. Bell toggle + fallback non-visual behavior.
3. Microcopy consistency untuk permukaan utama.
4. Rhythm spacing dasar.

## Lanjutan prioritas tinggi
5. Shared overlay primitive.
6. Migrasi model-manager.
7. Semantic token adoption.
8. Standard feedback state system.

## Lanjutan prioritas menengah
9. Runtime feedback harmonization.
10. Regression suite ekspansi komprehensif.
11. Formal UI contract + contribution rules.

---

## 5) Estimasi effort relatif (bukan jam absolut)

- Tahap 0: Rendah
- Tahap 1: Rendah–Menengah
- Tahap 2: Menengah
- Tahap 3: Menengah
- Tahap 4: Menengah
- Tahap 5: Menengah

**Total program:** Menengah–Tinggi (sesuai Opsi 3), namun risiko diperkecil lewat fase bertahap.

---

## 6) Risiko & mitigasi

1. **Risiko drift ke TUI/IDE-like**  
   Mitigasi: guardrail non-negotiable + review checklist wajib.

2. **Risiko regressi interaksi keyboard**  
   Mitigasi: tambah regression test khusus shortcut dan flow cancel/select.

3. **Risiko noise visual berlebih**  
   Mitigasi: progressive disclosure by default + compact mode tetap prioritas.

4. **Risiko refactor terlalu besar sekali jalan**  
   Mitigasi: larang big-bang rewrite; wajib phase-gate per tahap.

---

## 7) Acceptance criteria global

1. Minicode tetap append-only linear flow untuk output utama.
2. Tidak ada komponen fullscreen permanen pada alur default.
3. Semua komponen baru mengikuti semantic style contract.
4. Semua screen interaktif utama konsisten pola visual dan keyboard affordance.
5. Responsivitas terminal kecil tetap aman (terverifikasi test).
6. Mode mono + non-visual preference tetap berfungsi.
7. User experience akhir memenuhi urutan kualitas:
   **simple → coherent → fast → readable → predictable → distinctly CLI**.

---

## 8) Keputusan implementasi

Program ini **mengadopsi Opsi 3 (Komprehensif)** sebagai baseline, **dengan constraint shell-like sebagai pagar utama**.  
Artinya: redesign fondasi dilakukan serius, tetapi setiap perubahan wajib menjaga DNA Minicode sebagai CLI modern, bukan TUI/IDE terminal.
