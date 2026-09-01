# Eksekusi Tahap 2 — Konsolidasi Komponen UI (CLI-Constrained)

Tanggal: 2026-09-01

## Ruang lingkup tahap 2
Fokus tahap ini adalah konsolidasi komponen interaktif agar pola UI konsisten, tetap transient, dan tetap shell-like (bukan fullscreen app shell).

## Perubahan yang dieksekusi

### 1) Ekstraksi primitive overlay bersama
- **File baru:** `src/ui/screens/overlay.ts`
- **Isi utama:**
  - `renderTransientOverlay(lines, prevRows)`
  - `clearTransientOverlay(prevRows)`
- **Manfaat:**
  - Menghilangkan duplikasi logic redraw + delete-line cleanup.
  - Menjaga perilaku transient overlay yang konsisten lintas komponen.

### 2) Picker menggunakan primitive overlay bersama
- **File:** `src/ui/screens/picker.ts`
- **Perubahan:**
  - Render/cleanup overlay kini memakai helper shared dari `overlay.ts`.
  - Konstanta ANSI lokal yang redundant dihapus.
- **Dampak:** perilaku visual tetap sama, tetapi implementasi lebih ringkas dan seragam.

### 3) Provider manager menggunakan primitive overlay bersama
- **File:** `src/ui/screens/provider-manager.ts`
- **Perubahan:**
  - Render overlay dan suspend cleanup memakai helper shared.
  - Konstanta ANSI duplikat dipangkas.
- **Dampak:** mengurangi risiko drift perilaku antar screen interaktif.

### 4) Migrasi model manager ke pola overlay transient
- **File (ditulis ulang):** `src/ui/screens/model-manager.ts`
- **Perubahan:**
  - Dari tampilan linear `console.log` ke overlay transient keyboard-first.
  - Menjaga alur existing: pilih model, tambah, hapus, close.
  - Teks UI diselaraskan lebih konsisten (`aktif`, `Tidak ada model terkonfigurasi`, hint footer yang seragam).
- **Dampak:**
  - Konsistensi UX meningkat dengan picker/provider-manager.
  - Tetap mengikuti constraint CLI shell-like (tidak fullscreen, tidak panel permanen).

### 5) Penyesuaian test yang terdampak
- **File:** `test/model-manager-flows.test.ts`
- **Perubahan assertion:**
  - `active` -> `aktif`
  - `No models configured.` -> `Tidak ada model terkonfigurasi`

### 6) Update dokumentasi arsitektur (wajib karena modul baru)
- **File:** `docs/ARCHITECTURE.html`
- **Perubahan:**
  - Menambahkan entri `screens/overlay.ts` pada peta `src/ui/`.
  - Menjelaskan bahwa model-manager kini mengikuti pola overlay transient yang sama.

---

## Validasi

### Kondisi saat eksekusi
- Runtime `bun` tidak tersedia di PATH shell/PowerShell sesi ini, sehingga test suite tidak bisa dieksekusi dari command standar (`bun test`).

### Implikasi
- Perubahan kode tahap 2 sudah diterapkan.
- Test yang terdampak sudah diperbarui.
- Verifikasi otomatis penuh perlu dijalankan ulang ketika binary bun tersedia di environment sesi.

---

## Dampak terhadap roadmap Opsi 3 (CLI-constrained)

Tahap 2 berhasil menutup target utama konsolidasi komponen:
1. Primitive overlay terpusat,
2. Migrasi `model-manager` ke pola transient konsisten,
3. Dokumentasi arsitektur sinkron.

Semua perubahan tetap mematuhi prinsip utama:
- output utama tetap linear inline,
- interaksi tetap keyboard-first,
- tidak mengubah Minicode menjadi TUI/IDE terminal.

---

## Rekomendasi tahap lanjut
1. Jalankan regression tests begitu bun executable tersedia di PATH sesi.
2. Lanjut ke harmonisasi feedback runtime (spinner/status lifecycle) dengan pola shared.
3. Lanjut standardisasi style contract lintas prompt/title/hint/empty-state secara formal.