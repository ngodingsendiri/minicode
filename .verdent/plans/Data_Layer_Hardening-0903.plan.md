# Plan: Lapisan Data Hardening — 2026-09-03

## Objektif

Menutup 3 race kritis `read→modify→write` tanpa lock yang bisa hilangkan data, 2 high symlink-escape di `mkdir`, `Atomics.wait` yang block event-loop, serta debt keamanan data-at-rest (scrub, SSRF, PII) yang ditemukan pada audit lapisan data 2026-09-03. Semua perbaikan harus meninggalkan test yang gagal di commit sebelumnya dan menjaga gate hijau.

## Temuan audit (ringkas)

- **3 Critical:** `src/config.ts:145` & `src/session/checkpoint.ts:65` read-modify-write tanpa lock → lost-update `config.json`/`manifest.json` di Pool(3) sub-agent; `src/lib/atomic-write.ts:13` symlink `mkdir -p` bisa ikut link keluar jail.
- **2 High (security):** `src/session/persistence.ts:76` `Atomics.wait` block main thread 25-100ms freeze TUI; `src/memory/vector.ts:67` SSRF embedding (baseUrl ke IMDS) + secret persisten tanpa scrub; `src/session/persistence.ts:14` DB file 644 world-readable.
- **Medium:** `src/lib/db-path.ts:11` sync block, `src/memory/files.ts:24` PII leak homedir di prompt, `src/policy/usage.ts:38` cacheIncluded global + reprice seluruh history dengan model terakhir, `src/policy/pricing.ts:212` redirect follow tanpa SSRF, `src/policy/compaction.ts:127` leak DeepSeek, `src/telemetry/trace.ts:36` error tidak di-scrub.

Coverage gate 82.66%/84.88% lulus, tapi `cli/setup.ts` 0% (subprocess) dan banyak branch `catch{}` tidak tercover.

## Langkah eksekusi — prioritas P0 → P2

### P0 — Data loss & hang (sebelum rilis)

**P0.1 Lock `config.json` & `manifest.json` (Critical)**
- Berkas: `src/config.ts:145-203` (`saveMcpServer`/`saveLspServer`/`saveProvider`/`remove*`), `src/session/checkpoint.ts:65-203` (`saveCheckpointManifest`, `recordCheckpointFrom*`).
- Cara: tambah file lock (`proper-lockfile` 1KB atau `open(wx)` retry + mtime CAS loop). Pola: `read → modify → write tmp → rename` dengan `retry` 3× baca ulang jika `mtime` berubah. Serialkan per-session via `Pool(1)` atau `Map<path,Promise>`.
- Test: `test/config-race.test.ts` — 2 proses paralel `saveMcpServer` id berbeda → kedua id harus ada (sebelumnya salah satu hilang). `test/checkpoint-race.test.ts` serupa.

**P0.2 Jangan overwrite corrupt**
- Berkas: `src/config.ts:154` `catch{}` → `cfg={providers:[]}` lalu overwrite, `src/session/checkpoint.ts:44` `catch → return empty manifest`.
- Cara: `if (read succeeds && JSON.parse throws SyntaxError) { backup to .corrupt.<ts>; throw new Error("config corrupt: …") }`. Jangan return empty.
- Test: tulis `config.json` = `{ invalid`, panggil `saveMcpServer` → expect throw, file asli tidak berubah + `.corrupt` ada.

**P0.3 Transaksi `loadSession` leak handle (High)**
- Berkas: `src/session/persistence.ts:217-273` (`loadSession`, `listSessions`, `deleteSession` tanpa `finally db.close()`).
- Cara: `try { … } finally { db.close() }` di semua jalur. Hapus `catch{}` kosong, log `EACCES`.
- Test: mock `prepare(...).all` throw → `expect(db.close).toHaveBeenCalled()` via spy.

### P1 — Keamanan data-at-rest & SSRF

**P1.1 `mkdir` mode & symlink jail (High)**
- Berkas: `src/lib/atomic-write.ts:13`, `src/lib/db-path.ts:11`, `src/session/persistence.ts:14`, `src/memory/files.ts:42`.
- Cara: `mkdir(..., {recursive:true, mode:0o700})` + `chmod` best-effort, `realpath` + `isPathOutsideRoot` sebelum pilih lokal, `open(tmp,"wx",0o600)` → `lstat` check di Windows.
- Test: buat `.minicode → /tmp/evil` symlink → `resolveDbPath` harus throw/tolak.

**P1.2 Scrub & PII (High)**
- Berkas: `src/memory/files.ts:24` (`MEMORY.md` slice tanpa scrub), `src/memory/vector.ts:158` plain insert, `src/tools/memory.ts:43,50`, `src/policy/compaction.ts:55`, `src/telemetry/trace.ts:36` error.
- Cara: `scrubSecrets(txt)` sebelum push ke prompt / sebelum `INSERT` vector / sebelum `appendMemory`; `tildePath(p)` untuk homedir di system prompt; `chmod 600` untuk `vector.db`/`sessions.db`/`pricing.json`.
- Test: `MEMORY.md` berisi `sk-123` → prompt tidak mengandung `sk-`.

**P1.3 SSRF lengkap (High)**
- Berkas: `src/memory/vector.ts:67`, `src/policy/pricing.ts:212`, `src/policy/compaction.ts:127`.
- Cara: pusat `fetchWithSsrfGuard(url, opts)` yang cek `isPrivateHostWithDns` + `redirect:"manual"` tiap hop + `body cap 2M` + `strict` fail-close untuk `web_fetch`/`mcp`. `compaction` hanya pakai provider sesi (`router.currentProvider`) atau `MINICODE_COMPACTION_PROVIDER` eksplisit, jangan DeepSeek global.
- Test: `baseUrl=http://169.254.169.254` → throw `private host rejected`.

**P1.4 `Atomics.wait` → `Bun.sleep` (High)**
- Berkas: `src/session/persistence.ts:76`, `src/memory/vector.ts:108`.
- Cara: `withBusyRetry` jadi `async` + `await Bun.sleep(25*2**i)` + fungsi async, `busy_timeout=3000` tetap. Ubah call-site jadi `await`.
- Test: 2 `saveSession` paralel di event-loop tidak freeze.

**P1.5 `usage.ts` multi-model (High)**
- Berkas: `src/policy/usage.ts:38,113` global `cacheIncluded` + `costFor(total, lastModel)`.
- Cara: refactor `createUsageCollector` jadi `accumulateCost(segment, model)` → `session.cost = sum(turnCosts[])`, simpan `cacheIncluded` per-event, `effectiveModel` per-turn.
- Test: 2 turn `gpt-4o-mini` $0.01 + `claude-opus` $0.50 → `getSession().cost` ≈ $0.51 bukan $1.00.

### P2 — Reliability & perf (backlog)

- `src/telemetry/trace.ts:41` rotate lost trace (lock), `src/memory/files.ts:64` truncate race → `atomicWriteText`.
- `src/lib/net.ts:38` `isPrivateHostWithDns` fail-open 400ms → opsi `strict` atau timeout 1000ms.
- `src/policy/pricing.ts:248` pre-sort keys, `src/memory/vector.ts:21` FTS5 untuk keyword, `src/session/shadow-git.ts:225` `inside` toLowerCase Windows + tolak symlink checkout.
- Unifikasi `MAX_CHECKPOINTS` → `LIMITS`, `COMPACTION_SUMMARY_MAX_CHARS` pakai atau hapus.

## Verifikasi / DoD

```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
# + khusus data:
bun test test/persistence-vector.test.ts test/checkpoint.test.ts test/config-race.test.ts
```

- Semua gate hijau, `P0.1` race test hijau di Pool(3), `P1.2` scrub test hijau, `isPrivateHost` fuzz `0x`, `0177`, `%00`.
- Kenaikan `MIN_LINES/MIN_FUNCS` di `scripts/coverage-gate.ts` bila coverage naik.

## Catatan

- Prinsip: setiap perbaikan meninggalkan test yang gagal di commit sebelumnya.
- Urutan: P0.1→P0.3 (minggu ini) → P1.1→P1.5 (sprint depan) → P2 (backlog).
- Lokasi plan: `.verdent/plans/Data_Layer_Hardening-0903.plan.md` (lokal) + ringkas di `PLAN.md` (§ P4).
