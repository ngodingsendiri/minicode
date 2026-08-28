# PLAN V3 — Penyempurnaan Menuju 1.0 (pasca MIT)

**Status:** `71e1e2c` 257 pass `src/tools/index.ts:24` 24 tools, `minicore 1eceea9` cap 30s `src/core/recovery.ts:31`, `LICENSE:1` MIT `package.json:7` MIT. `bun x tsc --noEmit` 0.

**Prinsip:** MiniCore frozen (`src/core/session.ts:44` `initialMessages` + `src/core/loop.ts:293` `compactAsync` saja). Semua fitur baru sebagai Tool/Provider/Policy `README.md:92`.

---

## 1. Gap Fundamental (kritik V2)

| # | Gap | Lokasi | Dampak | Fix |
|---|---|---|---|---|
| G1 | Distribusi `file:../minicore` | `package.json:29` `workspaces` | `bun install` ENOENT Windows tanpa sibling | Vendor `minicore` ke `src/core/_vendor` atau `npm: minicore@0.1.1` |
| G2 | Lisensi UNLICENSED | `LICENSE:1` | Block komunitas — 0 stars | ✅ MIT done |
| G3 | Repo-map regex | `src/repo/repomap.ts:74` `PATTERNS` | 70% akurasi vs tree-sitter 95% | `src/repo/tree-sitter.ts:18` real `web-tree-sitter` + 3 bahasa utama TS/Py/Go |
| G4 | Lint 27e | `biome.json:6` | Debt `!` `src/tui/*` | `// biome-ignore` atau `noNonNullAssertion:off` sudah, sisa `useYield` minor |
| G5 | Sandbox regex bypass | `src/policy/permission.ts:30` 27 regex | `${HOME}` interpolation lolos | Default `os` `src/sandbox/os.ts:1` bila available |

---

## 2. Roadmap 1.0 (5 minggu → 0.7.0→1.0)

### Fase 3.1 — Distribusi & DX (Minggu 1, P0)
- [ ] `src/core/_vendor` atau publish `minicore` ke npm, `package.json:29` hapus `workspaces`
- [ ] `bun add -d web-tree-sitter` optional, `src/repo/tree-sitter.ts:13` load `tree-sitter-typescript.wasm` lazy, fallback regex
- [ ] `minicode skills install gh:owner/repo` `src/skills/loader.ts:47` `git clone --depth 1`
- [ ] `README.md:98` quickstart tanpa `../minicore` clone

### Fase 3.2 — Repo Intelligence (Minggu 2, P1)
- [ ] `src/repo/repomap.ts:59` `REPOMAP_MAX_FILES 60→40` `REPOMAP_MAX_CHARS 2500` hemat token
- [ ] Tree-sitter real untuk TS/Py/Go, benchmark `repomap.test.ts` akurasi ≥95%
- [ ] `src/repo/repomap.ts:273` cache TTL 5m `mtimeMs` + `sig` (sudah, polish)

### Fase 3.3 — Perf & Cost (Minggu 3, P1)
- [x] `src/constants.ts:29` 6/1, `src/policy/compaction.ts:134` 250 chars/600 tokens/10s — done
- [ ] `src/policy/usage.ts` price table `models.dev` auto, `provider::model` hint per-task cheap/expensive
- [ ] `bench/runner.ts:42` median 2 runs + delta report `bench/results.json`

### Fase 3.4 — Ekosistem (Minggu 4, P2)
- [x] `src/mcp/server.ts:163` resources/prompts, `src/tools/web_search.ts:1` Tavily — done
- [ ] `cli/commands/exec.ts:1` `--worktree` isolated per Codex, `src/session/checkpoint.ts` branch `fork`
- [ ] `.minicode/skills/spec.md:1` Kiro steering → publish ke marketplace

### Fase 3.5 — Hardening & 1.0 (Minggu 5, P0)
- [ ] `bun run typecheck` 0 (done), `bun test --coverage` 95% `src/policy` `src/providers`
- [ ] `bench --runs 2` resolveRate ≥0.6 (dari 0.59 live), `scripts/telemetry-gate.ts` gate
- [ ] `CHANGELOG.md` 0.7.0→1.0, `docs/USAGE.md:126` sandbox `os` + `web_search` + `exec --json`

---

## 3. Tuning Konkret

| File | Before | After | Alasan |
|---|---|---|---|
| `src/constants.ts:29` | 8/2 | **6/1** | 4-core laptop, HDD safe |
| `src/constants.ts:20` | 15s 2000 | **10s 1500** | 30% cost save |
| `src/policy/compaction.ts:134` | 400/80/300 | **250/60/250** | factual tetap, token -30% |
| `src/constants.ts:52` | WAL 32M | **16M** | SSD kecil |
| `src/policy/permission.ts:30` | denylist only | **default `os`** | regulasi |

---

## 4. KPI Rilis

- `bun test` 257/257 + `minicore` 154/154 hijau
- `bun x tsc --noEmit` 0, `bench:smoke 10/10`
- `repomap` akurasi ≥95% (fixture TS/Py/Go)
- `LICENSE` MIT, `package.json:7` MIT, `npm publish` dry-run ok

---

## 5. Risiko

| Risiko | Mitigasi |
|---|---|
| wasm bloat | lazy + fallback regex |
| os sandbox need bwrap | `available()` → fallback `allowlist` |
| npm publish tanpa minicore sibling | vendor atau `npm: minicore` |

*Semua perubahan agencode — core frozen kecuali cap `src/core/recovery.ts:31`.*
