# Plan: Tool Layer Hardening — 2026-09-04

## Objektif

Menutup temuan audit tool layer 2026-09-04: OOM paged bypass, TOCTOU symlink, uniqueness edit, ripgrep leak, cwd resolve, MCP/LSP scrub, todo traversal, allow-all bypass, SENSITIVE inkonsistensi, DNS fail-open, serta debt glob/limit/entropy. Semua perbaikan meninggalkan test yang gagal di commit sebelumnya.

## Temuan audit (ringkas)

- **Critical/High (8):** `read_file:107` OOM paged 1GB, `write/edit/patch/glob/grep/atomic-write` TOCTOU symlink, `edit:193` uniqueness hanya exact, `grep:92` ripgrep realpath leak, `bash:84` cwd tidak resolve, `mcp_call:71` tidak scrub, `lsp:19` process.cwd + tanpa jail, `todo:27` sessionId traversal, `permission:177` allow-all bypass, `bash-guard:111` SENSITIVE_TARGET vs RE, `net:38` DNS fail-open 400ms + cache rebinding, `npx` allowlist RCE.
- **Medium (8):** globToRegExp root/subdir salah, limit NaN unbounded, atomic entropy/EXDEV/mkdir symlink, bash scrub double + marker hilang, write_file chars vs bytes, patch tanpa max, allowlist trunc 200 collision, scrub SECRET_ENV_RE PAT/KEY.

## Langkah eksekusi — P0 → P2

### P0 — Rilis blocker (sebelum 0.9.0)

**P0.1 Streaming paged read + TOCTOU**
- Berkas: `read_file.ts:107`, `atomic-write.ts:14`, `write_file:30`, `edit:152`, `patch:46`, `glob:26`, `grep:32`
- Cara: `read_file` paged → `createReadStream` + line slicing atau hard cap 50M absolut; `atomic-write` `O_NOFOLLOW` + `realpath` ulang setelah `open` + `EXDEV` fallback `copy+unlink`; semua tool `open(..., O_NOFOLLOW)` + `fstat` + `realpath(fd)` untuk jail (defense-in-depth, permission layer tetap `isRealPathOutsideRoot`).
- Test: `test/phase1-tools` + `jail-realpath` symlink file/dir + `read_file` paged 2M+1 → tetap ditolak, `write_file` via symlink dir → `outside workspace`.

**P0.2 Edit/patch uniqueness + ripgrep leak + bash cwd**
- Berkas: `edit.ts:193`, `patch.ts:66`, `grep.ts:92`, `bash.ts:84`
- Cara: `edit/patch` uniqueness untuk `trimmed/fuzzy` → `multiple times` (bukan `not found`); `grep` `normalizeRgLine` → `await realpath(join(root,rel))` + `isPathOutsideRoot`; `bash` `const absCwd = c ? resolve(sessionRoot,c) : sessionRoot` + `spawn({cwd:absCwd})`.
- Test: `tools.test.ts:12` duplicate trimmed/fuzzy → `multiple times`; `grep` symlink file keluar via `rg` → diblok.

**P0.3 MCP/LSP/todo scrub + jail**
- Berkas: `mcp_call.ts:71,99,147`, `mcp/client.ts:224`, `lsp.ts:19,59`, `todo.ts:27,118`, `git.ts:123`
- Cara: `scrubSecrets` di semua jalur `mcp_call/read/prompt` + prefix `[mcp: untrusted]` + `sanitizeAnsi`; `lsp` `ctx.cwd` + `isSensitive`/`isRealPathOutsideRoot` + `scrub`; `todoPath` `sessionId.replace(/[^a-zA-Z0-9_-]/g,"_")`; `git assertPaths` tambah `isRealPathOutsideRoot` + `isSensitive`.
- Test: resource berisi `sk-` → `[REDACTED]`; `lsp` `~/.ssh/id_rsa` → `outside workspace`; `todoSession.id="../../pwned"` → sanitasi.

### P1 — Keamanan guard

**P1.1 Guard konsistensi**
- Berkas: `bash-guard.ts:111` `SENSITIVE_TARGET` → `SENSITIVE_RE`, `net.ts:38` `strict` fail-closed + tanpa cache untuk `web_fetch`/MCP, `permission.ts:177` `allow-all` tetap `bashDenied` untuk `STATIC_DENY`/`RM_DANGEROUS`, `web_fetch.ts:45` protocol whitelist `http/https` + `readCapped` error path, `web_search.ts:63` `redirect:"manual"` + DNS tiap hop.
- Test: `bash-fuzz-regression` tambah `unshare -r env`, `ssrf-guard` fuzz `0x/0177`, `phase2-security` allow-all destructive deny.

**P1.2 Allowlist & scrub**
- Berkas: `permission.ts:114` `npx`/`bun run *` keluarkan dari default atau dokumentasikan RCE, `allowlist.ts:46` trunc 200 → hash sha256, `scrub.ts:58` `SECRET_ENV_RE` tambah `PAT` + `KEY` tunggal, `constants` `GREP timeout` partial marker.
- Test: `env-strip` `GITHUB_PAT`, `allowlist-npx`.

### P2 — Reliability & perf (backlog)

- `globToRegExp` → `picomatch`, `limit NaN` clamp `Number.isFinite`, `atomic` entropy `randomUUID().replaceAll("-","").slice(0,16)`, `bash` background marker + reap interval + listener leak, `write_file` `Buffer.byteLength` + `patch` `PATCH_MAX_COUNT 50`, `hashline` trimmed verify.
- Debt test: `bash-cap` background marker, `lib-fs` symlink pre-create, `tools` glob root vs subdir.

## Verifikasi / DoD

```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
# + khusus
bun test test/jail-realpath.test.ts test/phase1-tools.test.ts test/tools.test.ts
bun run gate:bash && bun run extreme
```

- `P0.1` paged 1GB → OOM tidak terjadi, `P0.2` symlink dir → `outside workspace`, `P0.3` MCP `sk-` → `[REDACTED]`, `isPrivateHost` fuzz pass, `bun test` hijau, `MIN_LINES/MIN_FUNCS` naik bila naik.

## Catatan

- Urutan: P0.1→P0.3 minggu ini → P1.1→P1.2 sprint depan → P2 backlog.
- Lokasi plan: `.verdent/plans/Tool_Layer_Hardening-0904.plan.md` (lokal) + ringkas di `PLAN.md: P6`.
