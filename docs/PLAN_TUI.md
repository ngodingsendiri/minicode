# PLAN TUI — Penyempurnaan UI/UX Minicode (pure ANSI)

**Basis:** audit `src/tui/minimal/fullscreen.ts:338` `cli/fullscreen-driver.ts:191` `src/tui/minimal/simple.ts:118` — 257 pass, `bun x tsc 0`, `LICENSE MIT`.

**Goal:** unify engine, diff repaint, responsive, tanpa Ink — naik 6→8 vs OpenCode BubbleTea.

---

## P1 — Unify Engine (2 hari, blocker)

| Task | File | DoD |
|---|---|---|
| Ganti `onData` manual `fullscreen.ts:242` `str[i]`→`decodeKeys` `cli/prompt-engine.ts:177` | `fullscreen.ts:242` | Emoji 2-unit `prompt-engine.ts:218` paste 10 char tidak pecah, `applyKey` `prompt-engine.ts:44` satu sumber `MAX_VISIBLE 10` |
| Hapus duplikasi `Ctrl+U/W` `fullscreen.ts:285` | `fullscreen.ts:285` `prompt-engine.ts:126` | Satu handler `applyKey` untuk `backspace/left/right/up/down/tab/enter/esc/ctrl-*` |
| `matches()` `fullscreen.ts:116` `startsWith`→`toLowerCase` + `groupOf` `prompt-engine.ts:152` | `fullscreen.ts:116` `cli/fullscreen-driver.ts:59` | `/Model` ketemu `/model`, header `COMMANDS/SKILLS` dynamic |
| Test: `prompt-engine.test.ts` + `fuzz-prompt.test.ts:27` 2000 langkah tetap hijau | `test/*` | 0 fail |

---

## P1 — Diff & Wrap (2 hari)

| Task | File |
|---|---|
| `execution:completed` `fullscreen.ts:95` 3 baris → `src/tui/diff.ts:65` card + `src/tui/highlight.ts` | `fullscreen.ts:95` `simple.ts:86` |
| Transcript `push()` `fullscreen.ts:182` `plain(w-2)`→`formatWrapped` `src/tui/wrap.ts:5` + `decorateMarkdown` `src/tui/markdown.ts` | `fullscreen.ts:182` `simple.ts:24` |
| `write_file` `edit` `apply_patch` preview 400→ diff inline, `bash` 3→5 lines `simple.ts:96` | `simple.ts:81` `fullscreen.ts:95` |

---

## P1 — Responsive (1 hari)

| Task | File |
|---|---|
| `bodyH` `fullscreen.ts:179` `H - picker - menu` → `<80 cols` header 2 baris + `plain` ANSI-aware `strip` `fullscreen.ts:9` | `fullscreen.ts:172` |
| `pickerLines min(..., H-5)`→`H-6` + `menuLines min(m.length,8)`→`min(6,H*0.3)` | `fullscreen.ts:176` |
| `trunc(dispModel,30)` `fullscreen.ts:201` → `W-40` dynamic | `fullscreen.ts:201` |

---

## P2 — Theme & Status (1 hari)

| Task | File |
|---|---|
| `modeColor \x1b[33m` `fullscreen.ts:197`→`c` `src/tui/theme.ts:119` `THEMES` 4 preset | `fullscreen.ts:197` `cli/index.ts:101` |
| Header `minicode - model - mode - $cost` `fullscreen.ts:201` + `cost` sync `simple.ts:54` `formatUsage` | `fullscreen.ts:199` `simple.ts:54` |
| Footer `ctrl+c/esc/ctrl+o/shift+tab` `fullscreen.ts:237` tambah `ctrl+g` diff `ctrl+r` history hint | `fullscreen.ts:237` |

---

## P2 — Perf (1 hari)

| Task | File |
|---|---|
| Full repaint `\x1b[H\x1b[2J` `fullscreen.ts:200`→ diff `prevOut` | `fullscreen.ts:172` |
| `setInterval 150ms` spinner `fullscreen.ts:168`→ coalesce `setTimeout` + `RING_MAX 200→100` `fullscreen.ts:8` | `fullscreen.ts:8` |
| Virtual scroll `tail.slice(-bodyH)` `fullscreen.ts:191` sudah — tambah `expanded` `fullscreen.ts:44` capping 500 lines | `fullscreen.ts:44` |

---

## P3 — A11y (0.5 hari)

| Task | File |
|---|---|
| `screen.ts` `enableBracketedPaste` `\x1b[?2004h` + mouse `\x1b[?1000h` | `src/tui/minimal/screen.ts` |
| `hideCursor` `fullscreen.ts:38` `showCursor` di `uncaughtException` + `detach` `fullscreen.ts:325` | `fullscreen.ts:324` |
| `Ctrl+C` 2x hint countdown `now-lastCtrlC` `fullscreen.ts:254` → `press again to exit (2s)` | `fullscreen.ts:254` |

---

## KPI & Timeline

```
Minggu 1: P1 Unify + Diff + Responsive → `bun test 257` + `prompt-engine` fuzz 2000 langkah hijau
Minggu 2: P2 Theme + Perf → `bench:smoke 10/10`, CPU render <5% idle
```

**DoD 1.0 TUI:** `decodeKeys` unified, diff card di fullscreen, `<80 cols` tidak potong ANSI, `tui.test.ts` 95% + manual `minicode --tui` 10 interaksi no flicker.

*Semua pure ANSI — tanpa Ink/React, `?1049h` `src/tui/minimal/screen.ts`.*
