# Rencana Penyempurnaan UI Minicode

Tanggal: 2026-09-01  
Basis: hasil audit UI menyeluruh (`outputs/UI_AUDIT_REPORT_2026-09-01.md`)

## 1) Area yang perlu ditingkatkan

## A. Hierarki visual
- Menyamakan pola title, sub-title, empty-state, hint keyboard, dan status feedback antar screen.
- Menstandarkan gaya selected row, info sekunder (muted), warning/error/success.

## B. Konsistensi komponen
- Menyatukan perilaku screen interaktif (`picker`, `provider-manager`, `model-manager`) ke satu pola overlay responsif.
- Mengurangi duplikasi logic render/cleanup/suspend-resume.

## C. Tipografi
- Konsistensi bahasa microcopy (hindari campuran ID/EN dalam satu alur).
- Menjaga keterbacaan terminal kecil dan fallback non-ANSI.

## D. Warna
- Menjaga konsistensi token warna semantik (`success`, `error`, `warning`, `accent`) di semua surface.
- Menambah validasi legibility lintas tema (`dark`, `light`, `mono`).

## E. Spacing
- Menstandarkan vertical rhythm (jarak antar section, prompt, hasil aksi).
- Menjaga ritme visual pada mode interaktif dan fallback linear.

## F. Navigasi
- Konsistensi affordance keyboard dan discoverability shortcut (help/contextual hints).
- Menyamakan pola konfirmasi aksi destruktif.

## G. Responsivitas
- Semua path rendering memakai ukuran kolom terminal aktual (display-width aware).
- Menutup gap di path fallback yang masih berbasis `.length`.

## H. Aksesibilitas
- Menambah preferensi non-visual (toggle bell).
- Menjamin mode mono tetap punya hierarki tanpa ketergantungan warna.

## I. Kejelasan interaksi
- Memperjelas feedback state (loading/running/success/error/cancel).
- Menstandarkan wording konfirmasi dan dampak aksi.

---

## 2) Tiga opsi perbaikan

## Opsi 1 — Minimal (Stabilisasi Cepat)

**Fokus:** patch area kritis tanpa refactor struktur besar.  
**Cakupan utama:**
1. Fix fallback width (`input.ts` path inline) agar display-width aware.
2. Fix `section()` agar pakai `displayWidth`.
3. Tambah `MINICODE_BELL=0` di approval prompt.
4. Rapikan 15-25 microcopy paling sering muncul (ID/EN konsisten minimal di alur utama).

**Dampak:** Sedang  
**Effort:** Rendah  
**Risiko:** Rendah  
**Kelebihan:** cepat terlihat hasilnya.  
**Kekurangan:** akar inkonsistensi komponen belum tuntas.

---

## Opsi 2 — Menengah (Konsolidasi Sistem UI)

**Fokus:** kombinasi quick wins + konsolidasi pola komponen inti.  
**Cakupan utama:**
1. Seluruh item Opsi 1.
2. Migrasi `model-manager` ke pola overlay responsif (setara picker/provider-manager).
3. Ekstrak primitive overlay bersama (render loop, cleanup, resize, cursor lifecycle).
4. Standarisasi style contract lintas komponen (title/hint/footer/empty-state/feedback).
5. Standarisasi template konfirmasi aksi destruktif.
6. Tambah regression test untuk legibility lintas tema + fallback responsif.

**Dampak:** Tinggi  
**Effort:** Menengah  
**Risiko:** Menengah-rendah (terkendali dengan test).  
**Kelebihan:** memperbaiki UX secara nyata sekaligus menurunkan biaya maintenance.  
**Kekurangan:** butuh refactor terarah dan review lebih ketat.

---

## Opsi 3 — Komprehensif (Redesign CLI UI Foundation)

**Fokus:** redesign menyeluruh sistem visual dan interaction model.  
**Cakupan utama:**
1. Seluruh item Opsi 2.
2. Penerapan token desain lebih lengkap + i18n penuh (dictionary semua string UI).
3. Unifikasi runtime feedback engine (spinner/status line) ke abstraction tunggal.
4. Penyusunan guideline formal UI (komponen, layout, microinteraction, accessibility checks).
5. Ekspansi test harness UI untuk skenario ekstrem tambahan.

**Dampak:** Sangat tinggi  
**Effort:** Tinggi  
**Risiko:** Menengah-tinggi (scope besar, potensi regresi perilaku).  
**Kelebihan:** fondasi jangka panjang paling kuat.  
**Kekurangan:** mahal, lead time panjang, risiko schedule slip.

---

## 3) Opsi terbaik yang dipilih

## Pilihan: **Opsi 2 (Menengah) — Konsolidasi Sistem UI**

### Alasan pemilihan (dampak × effort × risiko)
- **Dampak:** hampir setara opsi komprehensif untuk pain point utama user (konsistensi, kejelasan, responsivitas).
- **Effort:** masih realistis untuk dieksekusi bertahap tanpa menghentikan delivery fitur.
- **Risiko:** cukup terkendali karena perubahan berpusat di UI layer yang sudah punya pagar test kuat.

**Kesimpulan:** Opsi 2 memberi **nilai tertinggi per effort** dengan risiko yang masih sehat.

---

## 4) Prioritas eksekusi (quick wins + tahap lanjutan)

## Tahap 0 — Quick Wins (P1)
**Target:** 1x siklus sprint pendek.

### Item
1. Perbaiki fallback inline width di `src/ui/input/input.ts`.
2. Perbaiki `section()` di `src/ui/render/theme.ts` agar display-width aware.
3. Tambah toggle bell `MINICODE_BELL=0` di `src/ui/approval/prompt.ts`.
4. Rapikan microcopy kunci (alur REPL utama, picker/provider-manager/help).

### Effort relatif
- **Rendah**

### Hasil yang diharapkan
- Rendering lebih stabil pada CJK/emoji dan terminal kecil.
- Kenyamanan aksesibilitas meningkat (suara notifikasi bisa dinonaktifkan).
- Persepsi kualitas meningkat lewat copy yang lebih konsisten.

---

## Tahap 1 — Konsolidasi Komponen Inti (P1-P2)
**Target:** 1 sprint menengah.

### Item
1. Migrasi `model-manager` ke overlay responsif.
2. Ekstrak shared overlay primitive dari `picker` + `provider-manager`.
3. Terapkan style contract lintas komponen (title/hint/empty-state/feedback).

### Effort relatif
- **Menengah**

### Hasil yang diharapkan
- UX antar screen terasa satu sistem, bukan terpisah.
- Reuse meningkat, duplikasi menurun.
- Perubahan UI selanjutnya jadi lebih cepat dan aman.

---

## Tahap 2 — Kejelasan Interaksi & Aksesibilitas Lanjutan (P2)
**Target:** 1 sprint menengah.

### Item
1. Standarisasi template konfirmasi aksi destruktif.
2. Perkuat discoverability shortcut (help + contextual hint).
3. Tambah test legibility lintas tema dan skenario fallback.

### Effort relatif
- **Menengah**

### Hasil yang diharapkan
- Pengguna lebih paham konsekuensi aksi.
- Shortcut lebih mudah ditemukan dan dipakai.
- Risiko regresi visual menurun.

---

## Tahap 3 — Penguatan Jangka Panjang (opsional, P3)
**Target:** setelah stabilisasi tahap 0-2.

### Item
1. Penyempurnaan vertical rhythm lintas flow.
2. Pertimbangan i18n lebih formal (jika target audiens multi-bahasa).
3. Penyederhanaan runtime feedback engine bila dibutuhkan.

### Effort relatif
- **Menengah-tinggi**

### Hasil yang diharapkan
- Konsistensi polish level meningkat.
- Fondasi UI lebih siap untuk skala produk dan tim.

---

## 5) Ringkasan matriks keputusan

| Opsi | Dampak | Effort | Risiko | Kelayakan saat ini |
|---|---|---|---|---|
| Minimal | Sedang | Rendah | Rendah | Baik untuk patch cepat |
| Menengah (dipilih) | Tinggi | Menengah | Menengah-rendah | **Terbaik (nilai/biaya paling optimal)** |
| Komprehensif | Sangat tinggi | Tinggi | Menengah-tinggi | Baik untuk fase redesign besar |

---

## 6) KPI hasil implementasi (disarankan)

1. **Consistency KPI**: ≥90% screen interaktif mengikuti style contract yang sama.
2. **Responsiveness KPI**: tidak ada overflow visual pada skenario terminal kecil yang tercakup test.
3. **Accessibility KPI**: opsi non-visual (bell toggle) tersedia dan terdokumentasi.
4. **Maintenance KPI**: pengurangan duplikasi logic overlay (LOC duplikat turun signifikan).
5. **Usability KPI**: shortcut discoverability naik (diukur lewat umpan balik user / adopsi command shortcut).
