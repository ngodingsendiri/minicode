# PLAN UI/UX — Minicode 0.7.1 → 0.8.0

**Basis:** audit `src/tui/minimal/fullscreen.ts:338` `src/tui/minimal/simple.ts:118` `cli/wizard.ts:76` `cli/index.ts:13` — 257 pass, TUI unify `206e578`.

---

## P1 — CLI & Wizard (2 hari)

| Task | File | DoD |
|---|---|---|
| Wizard picker searchable + URL validate `new URL()` + spinner `detectModels` 6s | `cli/wizard.ts:21` `cli/picker.ts:76` `src/providers/detect.ts` | `Minicode Setup` arrow nav, typo URL → `invalid url` instant, spinner dots |
| Help `--help --json` via `dispatch` | `cli/index.ts:13` `cli/router.ts:38` | `minicode --help --json` → JSON HELP for `exec` CI |
| Error unify `glyphs.cross` `c.error` | `src/tui/minimal/simple.ts:111` `cli/errors.ts` `src/tui/minimal/fullscreen.ts:186` | `✗` konsisten simple/fullscreen |

---

## P1 — Input Engine (2 hari, blocker)

| Task | File |
|---|---|
| Hapus `histCache` manual `fullscreen.ts:301` `histIdx` 6 baris → `prompt-engine.ts:44` `applyKey` single `PromptState` + `hist[]` | `fullscreen.ts:296` `cli/prompt-engine.ts:44` |
| Fix `Tab` `m[Math.max(0,sel)]` `fullscreen.ts:326` vs `enter` `matches()[sel]` `-1` undefined | `fullscreen.ts:320` `fullscreen.ts:326` |
| Paste `a\..` 500 char `wrap` `src/tui/wrap.ts:5` saat `W<80` + bracket `\x1b[200~` decode `prompt-engine.ts:177` | `prompt-engine.ts:177` `src/tui/wrap.ts:5` |

---

## P1 — Render & Transcript (2 hari)

| Task | File |
|---|---|
| Full repaint `\x1b[H\x1b[2J` `fullscreen.ts:200` → diff `prevOut` + virtual scroll `tail.slice(-bodyH)` capping `expanded?500:100` | `fullscreen.ts:172` `fullscreen.ts:191` |
| `push` `plain(strip)` `fullscreen.ts:182` → `formatWrapped` `src/tui/wrap.ts:5` + `decorateMarkdown` keep `+`/`-` color `renderDiffCard` `src/tui/diff.ts:40` | `fullscreen.ts:182` `simple.ts:24` |
| `<80 cols` header 2 baris `trunc(dispModel,30)` `fullscreen.ts:201` → `W-40` dynamic, `menuLines 8→6` `H*0.3` | `fullscreen.ts:176` |

---

## P2 — Theme & Status (1 hari)

| Task | File |
|---|---|
| Header `modeColor \x1b[33m` `fullscreen.ts:197` → `c[mode]` `src/tui/theme.ts:119` 4 preset live `cli/index.ts:101` | `fullscreen.ts:197` `src/tui/theme.ts:119` |
| `cost` sync `fullscreen.ts:74` `provider:extension usage` vs `simple.ts:54` `formatUsage` unify | `fullscreen.ts:74` `simple.ts:54` |
| Footer `ctrl+c/esc/ctrl+o/shift+tab` `fullscreen.ts:237` + `ctrl+g` diff + `ctrl+r` hint countdown | `fullscreen.ts:237` |

---

## P2 — Perf (1 hari)

| Task | File |
|---|---|
| `RING_MAX 100→60` `fullscreen.ts:8` `overlayLines H-5→H-8` `fullscreen.ts:178` | `fullscreen.ts:8` |
| Spinner `setInterval 150ms` `fullscreen.ts:168` → `setTimeout` coalesce | `fullscreen.ts:168` |
| `getSize()` `screen.ts:23` cache `resize` `onResize` `screen.ts:26` | `screen.ts:23` |

---

## P3 — A11y (0.5 hari)

| Task | File |
|---|---|
| `enableBracketedPaste` `screen.ts:30` decode `\x1b[200~` `prompt-engine.ts:177` + `showCursor` di `uncaughtException` `fullscreen.ts:352` | `screen.ts:30` `fullscreen.ts:352` |
| Mouse click-to-copy `?1000h` `screen.ts:30` already — tambah `click` → copy `tail` | `screen.ts:30` |

---

## KPI

* `bun test 257` + `prompt-engine` 2000 fuzz hijau, `minicode --tui` 10 interaksi no flicker CPU <5%
* `W 60` `H 20` no ANSI cut, `emoji 😀` paste 10 char utuh
* `docs/USAGE.md:126` + `cli/index.ts:13` HELP json

Timeline: Minggu 1 P1 CLI+Input+Render, Minggu 2 P2 Theme+Perf+A11y → 0.8.0
