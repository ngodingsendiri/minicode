# Minicode — Plan Penyempurnaan

Basis: audit 2026-08-25 (142+153 test pass, 3 bug ditemukan & fix).

Filosofi: **minimal, selalu verifikasi, jangan pecahkan kernel minicore** (satu-satunya pintu = seam additive).

---

## Fase 1 — Stabilitas & Pengerasan Test  (P1, minggu ini)

### 1.1 Testable input engine
- [ ] Pindahkan logika `matches → string render` dari `cli/input.ts` (`renderAnsi`/`renderInline`) ke **pure function** ter-export.
- [ ] Unit test: dropdown list, truncate `+N more`, selection clamp, Enter/Tab/Esc transitions.
- [ ] Simulasi callback hints via mock (`opts.hints`), bukan raw-mode sungguhan.
- Goal: 100% cakupan logika rendering, 0 regresi di interface paling rapuh.

### 1.2 Pisahkan live tests dari default
- [ ] `test/extreme-live.test.ts` → tag `@live` / `describe.skipIf(!process.env.MINICODE_LIVE)` atau pindah ke `test/live/`.
- [ ] `package.json`: `"test": "bun test"` tetap default tanpa jaringan; `"test:live": "bun test test/live"`.
- Goal: `bun test` bisa jalan di CI tanpa secrets, live test tetap bisa dijalankan lokal.

### 1.3 DetectAnsi race fix
- [ ] `detectAnsi`: probe sekali di awal REPL (bukan per `askLine`), `finish` idempotent, `removeListener` aman di timer.
- [ ] Non-TTY path tidak pernah menyentuh probe (guard `isTTY`).

---

## Fase 2 — Keandalan Error & Input  (P2)

### 2.1 Error classification berbasis struktur, bukan regex
- [ ] `ProviderError.category` (`auth` / `rate_limit` / `server` / `network` / `context_length_exceeded` / `invalid_request`) → pesan user-friendly langsung di `friendlyError`.
- [ ] Regex hanya untuk kasus yang definitely string (JSON body balance/credits).
- Goal: tidak ada false-positive `/401|403/` pada body JSON.

### 2.2 Input multi-byte
- [ ] Iterasi data dengan code point (`for (const c of str)` / `Array.from`), bukan `str[i]`.
- [ ] Paste emoji/em-dash tidak rusak (surrogate pairs).

### 2.3 Cost attribution fallback
- [ ] Saat router fallback mensubstitusi model (`requestFor`), usage collector pakai model **efektif**, bukan `modelRef.current`.
- [ ] Tampilkan di `/cost` jika terjadi fallback (mis. `(via deepseek-chat)`).

---

## Fase 3 — UX & Fitur  (P3)

### 3.1 REPL resume
- [ ] `/resume [id]` — lanjut sesi dari DB (kernel sudah support `initialMessages`).
- [ ] `/sessions` jadi interaktif seperti `/model` (pilih nomor → resume).

### 3.2 Consistency /status
- [ ] Tampilkan `provider::model` efektif, bukan model saja.
- [ ] Indikator cutoff budget di prompt (persen, hanya saat `--budget`).

### 3.3 Compaction
- [ ] Perbaiki kualitas compaction faktual — rangkum harus mempertahankan instruksi alat (kantor/read_file arguments), tanpa menghapus konteks penting dari runs sebelumnya.

---

## Fase 4 — Quality Gate  (P4)

### 4.1 CI
- [ ] GitHub Actions: `bun run typecheck` + `bun test` (tanpa live).
- [ ] Cache `node_modules`/`bun install`.

### 4.2 Telemetry gate
- [ ] `minicode stats` — resolve-rate target 0.3 di atas benchmark; failure di CI = warn, bukan block.

### 4.3 Cover
- [ ] `bun test --coverage` di repo; target >60% total, >90% `src/policy`, `src/providers`.

---

## Kriteria selesai (Definition of Done)
- [ ] `bun test` tanpa jaringan: hijau.
- [ ] `bun test:live` (lokal, ada config): hijau.
- [ ] `bun x tsc --noEmit`: bersih.
- [ ] Docs (`docs/USAGE.md`) sinkron setiap fitur baru.
- [ ] Changelog diperbarui per rilis.
