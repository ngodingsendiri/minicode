# Plan: Env Var & Perintah Hardening — 2026-09-04

## Objektif

Menutup gap dokumentasi & inkonsistensi referensi Env Var (5 undocumented `MINICODE_*` + `AGENT_*/TAVILY`) dan Perintah (kontradiksi `HELP` timeout, 7 phantom slash, `web_search` tidak READONLY, `KNOWN_FLAGS` vs subcommand flags). Semua perbaikan meninggalkan test yang gagal di commit sebelumnya.

## Temuan audit (ringkas)

- **5 `MINICODE_*` dibaca tapi tidak di `docs/USAGE.md:62`:** `MINICODE_BELL` (`approval/prompt.ts:17`), `MINICODE_SHOW_THINKING` (`render/reasoning.ts:7`), `MINICODE_THINKING` (`openai-compat.ts:63`), `MINICODE_EMBED_MODEL` (`memory/vector.ts:93`), `TAVILY_API_KEY` + `AGENT_*/DEEPSEEK_BASE_URL/ANTHROPIC_MODEL` (provider fallback) — 5 Medium.
- **Drift `MINICODE_TIMEOUT_MS`:** code `900000` (`setup.ts:104`) vs `HELP` `600000` (`index.ts:50`) — High.
- **7 phantom slash:** `/undo` `/redo` `/cost` `/resume [id]` `/clear` + alias `/models` etc. ada di `USAGE.md:111-122` tapi `BUILTIN_COMMANDS` `commands.ts:43` (8) tidak handle → `Unknown command` — High.
- **`web_search` tidak READONLY:** `permission.ts:21` `READONLY_TOOLS` tanpa `web_search` → ditolak di `--plan` padahal read-only seperti `web_fetch` — High.
- **`KNOWN_FLAGS` vs subcommand:** 13 flags `--baseUrl/--apiKey/...` dipakai `commands/config.ts` tapi tidak di `KNOWN_FLAGS` (`args.ts:24`) → `promptFromArgs("tes" --match foo)` jadi prompt word — Medium.
- **`SECRET_ENV_RE` kurang `PAT`:** `GITHUB_PAT` lolos (`scrub.ts:58`) — Medium.

## Langkah eksekusi — P0 → P2

### P0 — Rilis blocker (sebelum 0.9.0)

**P0.1 Fix HELP timeout**
- Berkas: `cli/index.ts:50` `default 600000` → `900000`
- Cara: `HELP` ` --timeout <ms> hard deadline per run (default 900000 = 15min; 0 = Infinity)`
- Test: `test/cli-help-language.test.ts` tambah `expect(HELP).toContain("900000")`

**P0.2 Phantom slash — pilih A (implement)**
- Berkas: `cli/commands.ts:43` `BUILTIN_COMMANDS` (8→15), `cli/repl.ts` driver, `docs/USAGE.md:111`, `docs/ARCHITECTURE.html:570`
- Cara Opsi A (disarankan, penuhi janji docs): tambah di `commands.ts` `case "undo"/"redo"` → `checkpoint.ts` restore, `case "cost"` alias → `status`, `case "resume"` alias → `sessions`, `case "clear"` → `\x1b[2J` + `console.clear()`, `hidden:true` alias `models/providers/usage/quit`. Update `ARCHITECTURE.html:570` pindah `/thinking` ke driver list. **Alternatif B** (hapus 7 baris dari `USAGE.md`) — pilih B bila ingin ikut test `cli-help-language:47` yang expect `/cost` tidak di `/help` (maka USAGE harus hapus, bukan implement).
- Test: `minicode /undo` → `success` bukan `Unknown command`; `test/cli-help-language.test.ts` sesuaikan ekspektasi.

**P0.3 `web_search` READONLY**
- Berkas: `src/policy/permission.ts:21` `READONLY_TOOLS`
- Cara: `READONLY_TOOLS = [... , "web_fetch", "web_search", ...]`
- Test: `permission.test.ts` `web_search` mode `readonly` → `allow`

**P0.4 `KNOWN_FLAGS` vs subcommand**
- Berkas: `cli/args.ts:24` `VALUE_FLAGS` / `cli/index.ts:199` `promptFromArgs`
- Cara: tambah `SUBCOMMAND_VALUE_FLAGS` untuk `commands/config.ts` etc., atau pindah `promptFromArgs` setelah `dispatch` (cek `args[0]` adalah subcommand → skip prompt extraction). Paling murah: buat `SUBCOMMAND_FLAGS = new Set(["--baseUrl","--apiKey","--id",…])` dan `flagNameOf` cek `KNOWN_FLAGS ∪ SUBCOMMAND_FLAGS`.
- Test: `promptFromArgs(["hello","--match","foo"])` dengan `args[0]="hello"` tetap `"hello --match foo"`? Untuk one-shot `minicode "tes" --match foo` harus tetap prompt `"tes --match foo"`? Klarifikasi: subcommand `minicode models --match foo` tidak lewat `promptFromArgs` (dispatch dulu) — jadi aman.

### P1 — Docs & discoverability (next sprint)

**P1.1 Lengkapi USAGE Flags tabel**
- Berkas: `docs/USAGE.md:62` `USAGE.md:104`, `cli/index.ts:94` `help --json`
- Cara: tambah row `--verbose`, `--max-steps <n>`, `--context-window <n>`, `--session <id>` di `USAGE.md` tabel; tambah `help --json` entry `session`, `context-window`, `interactive`, `json` di `cli/index.ts:94`.
- Test: `test/cli-help-language.test.ts` expect HELP vs JSON sinkron

**P1.2 Tambah 5 MINICODE_* + AGENT_* ke USAGE**
- Berkas: `docs/USAGE.md:62` `MINICODE_BELL` (`approval/prompt.ts:17` `0→silent`), `MINICODE_SHOW_THINKING` (`reasoning.ts:7`), `MINICODE_THINKING` (`openai-compat.ts:63`), `MINICODE_EMBED_MODEL` (`memory/vector.ts:93`), `TAVILY_API_KEY` + `AGENT_*/DEEPSEEK_BASE_URL/ANTHROPIC_MODEL` (fallback chain)
- Cara: tambah 5 baris baru setelah `MINICODE_DROPDOWN`, perluas baris `OPENAI_API_KEY` jadi grup fallback.
- Test: `grep -R process.env docs/USAGE.md` sinkron

**P1.3 `SECRET_ENV_RE` PAT**
- Berkas: `src/policy/scrub.ts:58` `CREDENTIAL_WORD`
- Cara: `CREDENTIAL_WORD = "(?:...|PAT|KEY)"` dengan anchor `_KEY$` (sudah ada `KEY` tunggal di plan, tapi hati-hati `MONKEY`), tambah `PAT` saja. Update `test/env-strip.test.ts` `GITHUB_PAT` → `[REDACTED]`.
- Test: `env-strip.test.ts` `GITHUB_PAT` `MY_PAT` harus scrub

### P2 — Polish (backlog)

- `cli/args.ts:24` hapus/implement `--output-format` & `--prompt` shadow flag (hapus dari `VALUE_FLAGS` atau implement `getArg("--output-format")` di `index.ts` help json)
- `isPrivateHost` `0x/0177` fuzz, `allowlist` `npx` RCE docs, `ARCH` line numbers → tanpa angka

## Verifikasi / DoD

```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
# + khusus
bun test test/cli-help-language.test.ts test/phase2-security.test.ts
bun run gate:bash
```

- `P0.1` HELP vs code `900000` sinkron, `P0.2` `/undo` → `success`, `P0.3` `web_search` di `plan` → `allow`, `P0.4` `promptFromArgs` tidak bocor `--match`
- `P1.1` USAGE vs HELP vs `help --json` 100% sinkron, `P1.2` `USAGE.md` vs `process.env` 38 vars sinkron, `P1.3` `GITHUB_PAT` scrub
- `MIN_LINES/MIN_FUNCS` naik bila naik

## Catatan

- Urutan: P0.1→P0.4 minggu ini → P1.1→P1.3 sprint depan → P2 backlog.
- Lokasi plan: `.verdent/plans/Env_Command_Hardening-0904.plan.md` (lokal) + ringkas di `PLAN.md: P6` (ganti P6 lama Tool Layer atau jadi P7).
