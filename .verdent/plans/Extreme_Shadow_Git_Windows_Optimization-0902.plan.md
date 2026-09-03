## Objektif

Optimasi `experiments/extreme-shadow-git.ts` agar tidak timeout 300s di Windows, sambil menjaga jaminan O(delta) shadow-git dan menutup P1 coverage tersisa (cli/setup, highlight sudah 99% — verifikasi).

## Temuan audit (2026-09-02)

1. **extreme-shadow-git timeout 300s** di Windows pada step `[1] skala — 2000 file` (setelah fix `vendor/minicore` cwd seam). `test/shadow-git.test.ts` 22 pass — unit logic benar, hambatan I/O skala besar (5000 file → `git write-tree` + `hash-object` per file lambat di NTFS).
2. **P1.1 `cli/setup.ts` & `cli/index.ts` 0%** di aggregate coverage (tidak ter-cover oleh `bun test --coverage` karena dijalankan via `Bun.spawn` di `cli-session.test.ts`). `gate:coverage` 82.73%/85.19% lolos, tapi tabel P1 PLAN.md menuntut ≥50% lines untuk kedua file.
3. **P1.2 provider-manager** sudah 95%/90% (dari 45%) — selesai; **P1.3 highlight** 100%/99.56% — selesai (terverifikasi via coverage.txt). Sisa hanya P1.1.
4. **P2.1 cwd jail** sudah tuntas via `ToolContext.cwd` (0.8.0) — perlu regress test baru di `test/cli-session.test.ts` untuk `--cwd` isolation.
5. **Pack** 133 file 750KB pass, **bash-fuzz** 0/2582 pass, **mcp adversarial** 67/67 pass setelah English fix.

## Langkah eksekusi

### Tahap A — Extreme shadow Windows

1. **Profiling** `extreme-shadow-git.ts` di Windows: ukur `snapshotTree` 200/1000/5000 file via `console.time`, identifikasi hot spot (`git ls-files`, `writeTree` batch, `hash-object` per file).
2. **Optimasi** (pilih satu, jangan spekulasi tanpa ukur):
   - **Opsi A:** Kurangi skala Windows: `scale = process.platform==='win32'? 500 : 2000` untuk step pertama, atau `SKIP_SCALE=1` env.
   - **Opsi B:** Batch `hash-object` via `git hash-object --stdin-paths` sekali, bukan per file.
   - **Opsi C:** Paralel `snapshotTree` per 100 file (p-map 4) — hanya bila profiling tunjukkan CPU bound.
3. **Tutup gate `extreme`** di CI Linux sebagai source of truth; Windows cukup `SKIP` skala besar dengan alasan.

### Tahap B — P1.1 coverage

1. Tambah 8 test di `test/cli-session.test.ts` sesuai tabel PLAN.md P1.1 (budget, 80% warn, plan, timeout, resume, sandbox notice, trace, verify). Semua sudah ada kecuali `--budget` edge & `trace` model — sinkron dengan `gate:coverage` aggregate.
2. Naikkan `MIN_LINES/MIN_FUNCS` di `scripts/coverage-gate.ts:32` bila melebihi 83/81 (sekarang 82.73/85.19 — boleh naik ke 82/85).

### Tahap C — Verifikasi cwd

1. Tambah test `cli: --cwd isolation` di `cli-session.test.ts`: `runWithProvider` dengan `--cwd` ws.dir + tool `write_file` ke `file.txt`, pastikan `existsSync(ws.dir/file.txt)` true dan `existsSync(repoRoot/file.txt)` false (regresi P2.1).
2. Jalankan `bun test` + `gate:coverage` + `gate:pack` + `extreme-mcp` + `extreme-bash-fuzz` sebagai bukti DoD.

## Verifikasi / DoD

| Langkah | Target | Bukti |
|---|---|---|
| A | `extreme-shadow-git` selesai <120s di Windows atau skip terdokumentasi | log `== EXTREME SHADOW-GIT ==` tanpa timeout |
| B | `cli/setup.ts` ≥50% lines di laporan coverage teks (atau dokumentasi bahwa coverage subprocess tidak terukur aggregate, tapi test ada) | `coverage.txt` atau `gate:coverage` tanpa `D` untuk cli |
| C | `--cwd` jail benar | test `isolation` hijau + `gate:pack` 22/22 |

## Catatan

- Jangan ubah `vendor/minicore` lagi tanpa bump `VENDOR.md` hash; seam `cwd` sudah aditif.
- `outputs/UI_FOUNDATION_REDESIGN...` adalah roadmap Tahap 0-5 — jangan hapus.
- Commit terpisah: `fix(cwd): ...`, `chore(docs): ...`, `test(cli): ...`
