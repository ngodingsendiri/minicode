# Plan: CLI Command Hardening — 2026-09-04

## Objektif

Menutup temuan audit CLI menyeluruh 2026-09-04: flag-injection via prompt, plan re-exec exit prematur + infinite-loop, resumeId tanpa sanitasi, global flag sebelum subcommand, @mention tanpa realpath, checkpoint non-git buta bash, serta drift HELP/USAGE. Semua perbaikan meninggalkan test yang gagal di commit sebelumnya.

## Temuan audit (ringkas)

- **Critical/High (3):** `cli/args.ts:52` & `cli/index.ts:77,129` flag-injection (`"review --allow-all"` nonaktifkan sandbox), `cli/index.ts:341` plan re-exec `process.exit(0)` prematur + `MINICODE_PLAN=1` loop, `cli/index.ts:138` `resumeId` tanpa sanitasi vs `sessionId` (ANSI + traversal), `cli/router.ts:6` global flag sebelum subcommand (`--cwd /tmp providers` jadi prompt), `cli/repl.ts:190` `@mention` symlink `isPathOutsideRoot` saja.
- **Medium (6):** `cli/commands/exec.ts:27` sessionId traversal via todo, `cli/index.ts:140` `NaN` budget/timeout (sudah P0.2), `cli/setup.ts:123` resume tanpa cost seeding, `cli/repl.ts:298` `/clear` vs append-only, `cli/commands/stats.ts:15` `process.argv` vs `args`, `providers.ts:17` corrupt traces line → `[]`.
- **Low:** `cli/args.ts:52` tolak `-5`, `cli/args.ts:87` readPrompt 500ms race, `cli/commands.ts:119` `join` hard-coded `\\`, `cli/repl.ts:115` cycleMode buta allow-all.

## Langkah eksekusi — P0 → P2

### P0 — Rilis blocker (sebelum 0.9.0)

**P0.1 Flag-parser bedakan flag vs prompt**
- Berkas: `cli/args.ts:52` `getArg`, `cli/index.ts:77,129` `args.includes("--allow-all")`
- Cara: buat `isFlag(token)` via `flagNameOf` + posisi, `getArg` & `promptFromArgs` hanya scan sebelum prompt text pertama yang bukan flag, dukung ` -- ` separator POSIX. `cli/index.ts` flag booleans (`--allow-all`, `--plan`, `--verbose` dll) via `getArg` bukan `includes` mentah. Tambah test: `promptFromArgs(["review","--allow-all"])` → `"review --allow-all"` + `allowAll===false`.
- Test: `test/cli-args.test.ts` tambah 4 test injection, `test/cli-session.test.ts` tambah `minicode "tes --allow-all"` tidak aktifkan allow-all.

**P0.2 Plan re-exec exit + loop**
- Berkas: `cli/index.ts:341-362`
- Cara: `filtered = args.filter(a=>a!=="--plan")`, `env:{...process.env, MINICODE_PLAN:"0"}`, `child.on("exit",c=>process.exit(c??0))` **tanpa** `process.exit(0)` ganda di baris 362, fallback `entry ?? resolvePath(import.meta.dir,"index.ts")`, persist prompt pipe via temp file atau `--prompt` flag bila `promptFromArgs` kosong.
- Test: `test/cli-index-coverage.test.ts` mock `spawn` + `MINICODE_PLAN=1` → child env `0`.

**P0.3 Sanitasi resumeId & sessionId**
- Berkas: `cli/index.ts:138` `resumeId`, `cli/commands/exec.ts:27` `sessionId`, `src/tools/todo.ts:27` `todoPath`
- Cara: `const sanitizeId = (s:string)=> s.replace(/[^A-Za-z0-9._-]/g,"-").slice(0,64)`, `resumeId = sanitizeId(getArg("--resume") ?? "")`, `sessionId` sudah ada sanitasi di `index.ts:135` — samakan di `exec.ts:27`. `todo.ts` sanitasi `sessionId` via `sanitizeSessionId`.
- Test: `minicode --resume "../../etc"` → id `----etc`.

**P0.4 Router global flag**
- Berkas: `cli/router.ts:6`
- Cara: `const knownCmd = new Set([...]); let cmdIdx=-1; for(i=0;i<args.length;i++){ const t=args[i]; const fn=flagNameOf(t); if(fn){ if(VALUE_FLAGS.has(fn) && !t.includes("=")) i++; continue } if(!t.startsWith("-") && knownCmd.has(t)){ cmdIdx=i; break } } const cmd = cmdIdx>=0? args[cmdIdx]: undefined; const rest = cmdIdx>=0? args.slice(cmdIdx): args`
- Test: `test/cli-subcommands.test.ts` tambah `["--cwd","/tmp","providers"]` → `exit 0`.

### P1 — Konsistensi & reliability

**P1.1 @mention realpath jail**
- Berkas: `src/app/mentions.ts:23`, `cli/repl.ts:190`
- Cara: `isRealPathOutsideRoot(resolve(cwd, p), cwd)` + `isSensitive` di `resolveMentionContent`, bukan `isPathOutsideRoot` logis.
- Test: symlink `link -> /etc` + `@link/secret.txt` → `skipped`.

**P1.2 Checkpoint non-git bash + resume cost**
- Berkas: `cli/setup.ts:183` (sudah P0.3), `cli/setup.ts:123` seed `usage` cost dari `turns` (sudah P0.1 session)
- Cara: verifikasi `snapshotWorkspace` penuh untuk non-repo sudah di `6d8662f`, seed `usage.sessionCost` via `loadSession` `turns` sum.

**P1.3 Stats/providers/exec**
- Berkas: `cli/commands/stats.ts:15` `process.argv` → `args`, `providers.ts:17` per-line `try JSON.parse`, `exec.ts:27` sessionId sanitasi + `budget/ratelimit` `isFinite` + `maxSteps/timeout` pass-through.
- Test: `test/cli-commands.test.ts` `stats --json` via `args`, `exec --session ../../evil` → sanitasi.

### P2 — Polish (backlog)

- `cli/args.ts:52` allow `-5` untuk value flags numerik, `cli/args.ts:87` `readPrompt` tanpa timer 500ms, `cli/commands.ts:119` `join(cwd,"AGENTS.md")`, `cli/repl.ts:115` `cycleMode` support `allow-all`, `cli/repl.ts:298` `/clear` append-only vs `console.clear`.
- `cli/commands/config.ts:66` try/catch `detectAndSave`, `cli/commands/sessions.ts:68` pakai `resolveDbPath`, `cli/commands/auth.ts:265` `isPrivateHostWithDns` untuk `tokenUrl`.

## Verifikasi / DoD

```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
# + khusus
bun test test/cli-args.test.ts test/cli-commands.test.ts test/cli-session.test.ts
```

- `P0.1` `prompt "a --allow-all"` tidak aktifkan allow-all, `P0.2` plan re-exec env `0` + no prematur exit, `P0.3` `resumeId` traversal → sanitasi, `P0.4` `--cwd /tmp providers` → `exit 0`
- `P1.1` symlink `@link` → skip, `P1.3` `stats --json` via `args` + corrupt traces line → partial
- `MIN_LINES/MIN_FUNCS` dinaikkan bila naik.

## Catatan

- Urutan: P0.1→P0.4 minggu ini → P1.1→P1.3 sprint depan → P2 backlog.
- Lokasi plan: `.verdent/plans/Cli_Command_Hardening-0904.plan.md` (lokal) + ringkas di `PLAN.md: P7→P8`.
