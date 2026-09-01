# Eksekusi Tahap Awal Redesign UI (CLI-Constrained)

Tanggal: 2026-09-01

## Tujuan tahap ini
Menjalankan quick structural wins dari baseline redesign komprehensif, dengan constraint shell-like CLI:
- tetap linear scrollback,
- tetap keyboard-first,
- tanpa fullscreen/permanent panel.

## Perubahan yang dieksekusi

### 1) Responsivitas display width (quick win)
- **File:** `src/ui/render/theme.ts`
- **Perubahan:** `section(title)` kini menghitung pemisah berdasarkan `displayWidth(label)` (bukan `label.length`).
- **Dampak:** separator section lebih akurat untuk CJK/emoji.

### 2) Fallback inline non-ANSI jadi display-width aware
- **File:** `src/ui/input/input.ts`
- **Perubahan:** perhitungan `printedW` pada `renderInline` memakai `displayWidth(content)`.
- **Dampak:** mengurangi artefak/leak visual pada terminal fallback saat ada CJK/emoji.

### 3) Aksesibilitas non-visual (bell preference)
- **File:** `src/ui/approval/prompt.ts`
- **Perubahan:** bell hanya dibunyikan jika `MINICODE_BELL !== "0"`.
- **Tambahan:** microcopy prompt approval dirapikan ke bahasa Indonesia agar lebih konsisten.

### 4) Regression tests ditambahkan/diperluas
- **File baru:** `test/approval-prompt.test.ts`
  - menguji bell default aktif,
  - menguji `MINICODE_BELL=0` menonaktifkan bell.
- **File diubah:** `test/tui-theme-highlight.test.ts`
  - menambah test `section()` untuk memastikan separator mengikuti display width (CJK/emoji).

## Validasi eksekusi

### Hasil command validasi
- `bun test ...` -> **gagal dieksekusi** (runtime `bun` tidak tersedia pada environment saat ini).
- `npm test ...` -> script tetap memanggil `bun test`, sehingga juga gagal karena `bun` tidak ditemukan.

### Implikasi
- Perubahan sudah diterapkan di kode dan test terkait sudah ditambah.
- Verifikasi otomatis penuh tertunda sampai runtime Bun tersedia.

## Rekomendasi langkah berikutnya
1. Setelah Bun tersedia, jalankan minimal:
   - `bun test test/approval-prompt.test.ts test/tui-theme-highlight.test.ts test/tui-classic.test.ts`
2. Lanjut tahap berikut (konsolidasi komponen):
   - ekstraksi overlay primitive,
   - migrasi `model-manager` ke pola overlay transient,
   - standardisasi style contract lintas surface.

## Dampak terhadap roadmap
Tahap ini menutup sebagian quick wins dengan risiko rendah dan tetap menjaga paradigma CLI shell-like. Ini membuka jalur aman untuk fase konsolidasi komponen tanpa mengubah DNA interaksi Minicode.
