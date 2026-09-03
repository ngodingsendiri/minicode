# Plan: Memory / RAG Hardening — 2026-09-05

## Objektif
Tutup 4 kritis + 8 medium dari audit 2026-09-05: `process.cwd()` bocor `--cwd`, `Atomics.wait` freeze, `instr(lower())` full scan tanpa FTS5, injeksi noise tanpa threshold — plus bloat, global leak, dim mismatch, SSRF embedding. Semua perbaikan meninggalkan test yang gagal di commit sebelumnya (bukti dampak, bukan klaim).

Basis: `src/memory/vector.ts:238` `files.ts:89` `tools/memory.ts:113` `app/rag-layer.ts:58` `repo/repomap.ts:437` `policy/context.ts:111` — audit mendalam 2026-09-05 (12 temuan).

## Temuan ringkas

- **Kritis:** K1 `tools/memory.ts:20,25,70,110` `process.cwd()` hardcode → `--cwd` isolasi bocor; K2 `vector.ts:129` `Atomics.wait` sync 175ms block; K3 `vector.ts:139,195` `instr(lower(text),lower(?))` scan tanpa `FTS5`/`lower(text)` index; K4 `vector.ts:237` tanpa `MIN_SCORE` → `0.05` tetap di-`# Relevant memory`.
- **Medium:** M1 dedup exact `Map<text>` tanpa MMR; M2 dim mismatch silent 0; M3 `resolveDbPath` fallback global `~/.minicode/vector.db`; M4 tanpa TTL/MAX_ROWS; M5 SSRF embedding `redirect:follow` fail-open; M6 trunc inkonsisten 6k/4k/1k; M7 tanpa chunking/metadata; M8 vector tidak lewat `fileLocks`.
- **Kekuatan dipertahankan:** scrub `vector.ts:160` `files.ts:31` + `chmod 600` `vector.ts:172`, WAL cap `vector.ts:19`, hybrid fallback `vector.ts:233`.

## Langkah eksekusi — P0 → P2

### P0 — Rilis blocker (sprint ini, <2 hari) — gate P9 wajib hijau sebelum 0.9.0

**P0.1 `process.cwd()` → `ctx.cwd` (isolation)**
- Berkas: `src/tools/memory.ts:5` (3 tool), `src/memory/files.ts:19,61` default, `src/app/rag-layer.ts:31` sudah benar, `cli/setup.ts:118` inject.
- Cara: `const cwd = (ctx as {cwd?:string}).cwd ?? (ctx as unknown as {cwd?:string}).cwd ?? process.cwd()` — ganti semua `process.cwd()` di `readMemoryTool:20`, `readMemoryTool:25`, `writeMemoryTool:70`, `forgetMemoryTool:110`. `files.ts` biarkan default tapi tool wajib pass `cwd`. Formal `ToolContext` type bila perlu `vendor/minicore/src/core/tool.ts:22` cek tipe.
- Test: `test/memory-cwd-isolation.test.ts` baru — `ToolContext {cwd: tmpA}` write → `vector.db` di `tmpA/.minicode/vector.db`, `process.cwd()` file tidak ada; `readMemoryTool` dengan `cwd` berbeda tidak leak. *Gagal di commit sebelumnya bila pakai `process.cwd()` harcode.*

**P0.2 `Atomics.wait` → `Bun.sleep` async (freeze TUI)**
- Berkas: `src/memory/vector.ts:120-133` `withBusyRetry`, `src/session/persistence.ts:82-91` same, `src/session/checkpoint.ts` jika ada.
- Cara: `async function withBusyRetry<T>(fn:()=>Promise<T>|T, attempts=3):Promise<T>` + `await Bun.sleep(25<<i)` + `try/finally db.close()` di `searchHybrid:216` + `addMemory:176`. Jaga backward compat: `withBusyRetrySync` untuk path sync bila masih dipakai.
- Test: `test/memory-busy-async.test.ts` — `Pool(3)` parallel `addMemory` 20x tanpa freeze (ukur `Bun.nanoseconds()` <500ms total), `Atomics.wait` tidak ada di grep `src/memory/vector.ts`. *Sebelumnya `Atomics.wait` ada.*

**P0.3 Threshold + jangan inject noise (pollution)**
- Berkas: `src/memory/vector.ts:232-237` `searchHybrid`, `src/app/rag-layer.ts:40` `systemExtra`, `src/tools/memory.ts:50`.
- Cara: `const MIN_SCORE = opts.queryVec ? 0.20 : 0.25` — filter `scored.filter(s=>s.score>=MIN_SCORE)` sebelum `sort/slice`; bila `filtered.length===0` `systemExtra=undefined` (jangan `# Relevant memory`). `read_memory` tool tetap tampilkan `score` tapi beri `(below threshold)` di footer. `LIMITS` tambah `MEMORY_MIN_SCORE_HYBRID 0.20` `MEMORY_MIN_SCORE_KEYWORD 0.25`.
- Test: `test/memory-threshold.test.ts` — insert 3 memories `score 0.05` vs 1 `score 0.8` → `searchHybrid("auth")` hanya return 1, `createRagLayer` tanpa hits → `systemExtra undefined`. *Sebelumnya `hits.length===1` walau 0.05.*

### P1 — Kualitas & keamanan (1 minggu)

**P1.1 FTS5 atau expression index (perf)**
- Berkas: `src/memory/vector.ts:24-27` `CREATE TABLE memory`, `src/memory/vector.ts:195,203` pre-filter.
- Cara: Migrasi Opsi A (disarankan, murah): `CREATE INDEX IF NOT EXISTS idx_memory_text_lower ON memory(lower(text))` + ubah `instr(lower(text),lower(?))` → `lower(text) LIKE '%' || lower(?) || '%' ESCAPE '\'` (memakai index expr). Opsi B: `CREATE VIRTUAL TABLE memory_fts USING fts5(text, content='memory', content_rowid='rowid')` + triggers `INSERT/DELETE/UPDATE`. Benchmark `5000 rows` sebelum/sesudah — target `keywordRows` <50ms (sebelum `instr` ~300ms).
- Test: `test/memory-fts.test.ts` — `EXPLAIN QUERY PLAN` memakai index, latency `searchHybrid` 1000 rows <100ms.

**P1.2 TTL + MAX_ROWS + prune (bloat)**
- Berkas: `src/memory/vector.ts:147,180` `clearAllMemory`, `src/constants.ts:29` `LIMITS`.
- Cara: `LIMITS.MEMORY_TTL_DAYS=90` `MEMORY_MAX_ROWS=5000` `MEMORY_MAX_BYTES=10*1024*1024`. Di `addMemory` setelah `INSERT` → `DELETE WHERE created_at < now-TTL` + `DELETE WHERE id IN (SELECT id FROM memory ORDER BY created_at DESC LIMIT -1 OFFSET MAX_ROWS)` + `VACUUM` periodik bila `db.prepare("SELECT COUNT(*)").get() % 1000 ===0`. `LIMITS` `TRACE` sudah ada pola `purgeExpired`.
- Test: insert 10 rows umur 100 hari → `addMemory` baru prune old, `COUNT(*) <=5000`.

**P1.3 Embedding meta: `model,dim` + dim mismatch guard**
- Berkas: `src/memory/vector.ts:24` schema, `vector.ts:69,93` `embedTexts`, `vector.ts:48` `cosine`.
- Cara: `ALTER TABLE memory ADD COLUMN model TEXT, ADD COLUMN dim INTEGER`; `addMemory` simpan `model`+`dim=vec.length`; `searchHybrid` bila `queryVec.length != r.dim` → `vecScore=0` + `process.stderr.write("[warn] dim mismatch")` + flag re-embed background `LIMITS.EMBEDDING_RETRY=1`. `searchHybrid` log once.
- Test: `addMemory` dengan `dim 1536`, query dengan `dim 3072` → `score` fallback `0.3*kw`, warn tercatat.

**P1.4 SSRF strict untuk embedding (fail-close)**
- Berkas: `src/memory/vector.ts:77-80` `isPrivateHostWithDns`, `src/lib/net.ts:38` `dnsCache`, `src/constants.ts:28`.
- Cara: `isPrivateHostWithDns(host,{strict:true, timeout:1000})` — fail-close bila DNS timeout, tanpa cache untuk `vector`. `fetch(embeddings, {redirect:"manual"})` + loop `max 2` cek tiap `Location` via `isPrivateHostWithDns`. Reuse `fetchWithSsrfGuard` bila sudah ada `pricing.ts:212` `vector.ts:67`.
- Test: `isPrivateHostWithDns("127.0.0.1", {strict:true}) → true`, `embedTexts` ke `http://169.254.169.254/embeddings` → `null`.

### P2 — Reliability & polish (backlog, tidak block rilis)

- **MMR + dedup cosine >0.92** sebelum `topK` `vector.ts:236` — `score*0.7` then MMR `λ=0.7` diversity, simpan `score` + `created_at` di prompt `rag-layer.ts:41` (`- text (score 0.82, 2026-09-01)`).
- **Chunking + cap di `addMemory`** `vector.ts:160` — `clean.slice(0,2000)` sebelum `embedTexts`; bila >2000 split chunks `overlap 200` + `parentId`.
- **`vector.db-wal/-shm` chmod 600** `vector.ts:170` juga untuk `-wal/-shm` (sekarang hanya `.db`).
- **Stats:** `minicode memory stats` (rows, bytes, WAL size, avg score, hit rate) `cli/commands/memory.ts` baru + trace `hits.length` di `writeTrace` `telemetry/trace.ts:36`.
- **Fix `workdir` default** `memory.ts` + `files.ts` konsisten `resolveDbPath` vs `join(homedir)`.
- **`LIMITS.MEMORY_FILE_MAX_CHARS 4000` unused** `constants.ts:22` → hapus atau pakai.

## Verifikasi / DoD

```bash
bun x tsc --noEmit && bun run lint && bun test --timeout 10000 && bun run gate:coverage && bun run gate:pack
# + khusus P0
bun test test/memory-cwd-isolation.test.ts test/memory-busy-async.test.ts test/memory-threshold.test.ts --timeout 10000
grep -R "Atomics.wait" src/memory/vector.ts src/session/persistence.ts && echo "FAIL: masih ada Atomics.wait" || echo "OK"
bun test test/memory-fts.test.ts --timeout 10000 # EXPLAIN QUERY PLAN memakai index
```

- `P0.1` `write_memory` via `ctx.cwd=/tmp/A` tidak muncul di `/tmp/B` + `process.cwd()`
- `P0.2` `grep Atomics.wait` 0 + parallel `Pool(3) 20 writes` <500ms
- `P0.3` `score 0.05` tidak masuk `systemExtra`, `score 0.8` masuk
- `P1.1` `keywordRows` <50ms untuk 5000 rows
- `P1.2` `COUNT(*) <=5000` + TTL prune
- `MIN_LINES/MIN_FUNCS` dinaikkan bila naik

## Catatan

- Urutan: P0.1→P0.3 minggu ini → P1.1→P1.4 sprint depan → P2 backlog.
- Tanpa `picomatch` / deps baru; `FTS5` builtin SQLite (Bun).
- Lokasi plan: `.verdent/plans/Memory_RAG_Hardening-0905.plan.md` (lokal) + ringkas di `PLAN.md: P9` (global, wajib update bila eksekusi).
- `repo-map` tetap regex (cap 2.5k) — tidak disentuh di plan ini (sudah diputuskan PLAN_V4).

## Yang sengaja TIDAK dikerjakan

- Tidak ada framework embedding baru (OpenAI `text-embedding-3-small` tetap, `MINICODE_EMBED_MODEL` env).
- Tidak ada migrasi ke `pgvector` / Pinecone — SQLite WAL cukup sampai 50k rows (diukur).
- Tidak ada auto-summarize memory (butuh LLM + cost) — manual `write_memory` + prune cukup.
