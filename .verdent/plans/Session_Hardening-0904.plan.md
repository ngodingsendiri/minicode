# Plan: Session Hardening — 2026-09-04

## Objektif

Menutup gap alur session yang ditemukan pada audit mendalam 2026-09-04: duplikat `turnCount`, `Nan` budget/timeout, checkpoint buta `bash` di non-repo, resume tanpa `turnCount`/`cost`, serta lock lintas-proses & hook timeout. Semua perbaikan meninggalkan test yang gagal di commit sebelumnya.

## Temuan audit (ringkas)

- **High:** `vendor/session.ts:222` duplikat turnCount, `cli/setup.ts:183` checkpoint non-git buta bash, `persistence.ts:223` resume kehilangan turnCount/budget, `cli/index.ts:140` NaN budget/timeout, `hooks/run.ts:35` tanpa timeout.
- **Medium:** `vendor/loop.ts:44` compacted flag palsu, `cli/setup.ts:195` postEditSnapshots leak saat abort, `src/app/session.ts:54` buildSystemPrompt tanpa signal.
- **Low:** `vendor/history.ts` replace tanpa validasi, `todoSession` global race.

## Langkah eksekusi — P0 → P2

### P0 — Rilis blocker (sebelum 0.8.2)

**P0.1 Resume continuity**
- Berkas: `src/session/persistence.ts:217` `loadSession` + `cli/setup.ts:114`
- Cara: `loadSession` kembalikan `{messages, turns, system, cwd, turnCount}` (SELECT MAX(turn_idx) atau COUNT turns); `createCliSession` seed `turnState.turnCount` & `usage.sessionCost` dari `turns` (bukan 0). Test: save 2 turn, resume, `expect(session.state.turnCount===2)` & `usage.getSession().cost === 0.3`.

**P0.2 Validasi NaN/timeout**
- Berkas: `cli/index.ts:140,159`, `cli/setup.ts:99`
- Cara: `const n=Number(raw); if(!Number.isFinite(n)||n<0){ warn; n=undefined }` jangan teruskan NaN. `createTimeout` clamp `0→Infinity` didokumentasi, `NaN→warn fallback 900_000`.

**P0.3 Checkpoint non-git bash**
- Berkas: `cli/setup.ts:183` `postEditSnapshots` filter `edit/write/patch` saja
- Cara: fallback `snapshotWorkspace` diff full untuk non-repo (sudah ada `beginTurnSnapshot` mode files), atau perluas `execution:completed` ke `bash` dengan `git status --porcelain` check. Test: non-repo `bash "echo hi > a.txt"` → undo hapus `a.txt`.

**P0.4 Hook timeout**
- Berkas: `src/hooks/run.ts:35`
- Cara: `Promise.race([spawn, timeout 5s])` + `kill SIGTERM→SIGKILL` + warn `process.stderr`.

### P1 — Konsistensi loop & signal

**P1.1 Compacted flag**
- Berkas: `vendor/loop.ts:44`, `vendor/minicore/src/core/compact.ts:9`
- Cara: `compactStore` return `boolean didCompact` (compare length), baru `compacted=true` & emit.

**P1.2 postEditSnapshots leak**
- Berkas: `cli/setup.ts:195`
- Cara: tambah `session.events.on("turn:aborted", clear)` atau `finally` di `turn:completed` handler.

**P1.3 buildSystemPrompt timeout**
- Berkas: `src/app/session.ts:54`
- Cara: teruskan `signal` + `Promise.race` 5s fallback prompt minimal.

### P2 — Backlog

- `vendor/history.ts:12` validasi `replace` bounds, `todoSession` per-instance `AsyncLocalStorage`, `MAX_CHECKPOINTS` → `LIMITS`.

## Verifikasi / DoD

```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
# + khusus
bun test test/checkpoint.test.ts test/persistence-ttl.test.ts test/cli-session.test.ts
```

- `P0.1` resume test hijau, `P0.2` NaN warn + fallback, `P0.3` non-repo bash undo hijau, `P0.4` hook gantung tidak block >5s.
- `MIN_LINES/MIN_FUNCS` dinaikkan bila coverage naik.

## Catatan

- Urutan: P0.1→P0.4 minggu ini → P1.1→P1.3 sprint depan → P2 backlog.
- Lokasi plan: `.verdent/plans/Session_Hardening-0904.plan.md` (lokal) + ringkas di `PLAN.md: P5`.
