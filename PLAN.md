# PLAN.md — Rencana penyempurnaan aktif

**Untuk agent AI yang melanjutkan pekerjaan ini.** Dokumen ini adalah satu-satunya rencana yang harus dieksekusi. Rencana lama (`docs/PLAN_V4.md`, `PLAN_V5.md`, `PLAN_UIUX_V6.md`) adalah **arsip** — semua itemnya sudah selesai; jangan dikerjakan ulang.

Basis: audit UI/UX menyeluruh (V6), uji live dua gateway nyata (V7), dan bug hunter UI tiga ronde (V8). Riwayat lengkap di [CHANGELOG.md](CHANGELOG.md).

---

## Keadaan saat ini — baca ini dulu

Jalankan sendiri, jangan percaya angka di dokumen:

```bash
bun test                  # harapan: semua hijau, 0 fail
bun x tsc --noEmit        # harapan: tanpa keluaran
bun run lint              # harapan: exit 0 (warning boleh ada)
bun run gate:coverage     # harapan: melewati min 81 funcs / 83 lines
bun run gate:pack         # harapan: 22 pemeriksaan lulus
bun run extreme           # harapan: 0 bypass, semua pass
```

Kondisi yang sudah dicapai dan **tidak boleh mundur**:

- REPL bisa dipakai (dulu mati bisu pada prompt pertama).
- Lebar karakter dihitung per KOLOM terminal (`src/tui/width.ts`), bukan per karakter.
- Teks model/tool disanitasi (`src/tui/sanitize.ts`) — hanya SGR yang lewat.
- Biaya sesi kumulatif benar; `--budget` benar-benar memutus.
- Error provider tampil ringkas + saran, bukan dump JSON.
- Semua overlay menghormati ukuran terminal sungguhan.
- Bahasa UI diarahkan ke English-only pada surface UI aktif; glyph tetap punya fallback ASCII.

---

## Status eksekusi terbaru (update 2026-09-06)

- ✅ P0-P9 tuntas dan dihapus dari plan (commit `e143db2` 0.9.0 + `b8b5749` 0.9.1): guardrail, coverage, overlay, English-only, tema, data-at-rest, session, tool-layer, env/command, CLI hardening, memory/RAG P0-P2.
- ✅ P12 UI Shell-Max DIEKSEKUSI `b8b5749` (9.3/10): `/copy` OSC52, Ctrl+R/Ctrl+J, statusline rich, wrap/table/diff/picker, harness output-driven. Gate `tsc PASS / lint 9 warn / 1224 pass 0 fail / coverage 81.44/83.65 / pack 22/22`.

Next action — sisa aktif (urut):
1. **P13 P0** — Raise 3 dimensi (Model/Tool/Sesi-Memori) ≤3 hari.
2. **P10 P0** — TOCTOU + `--cwd` repo-wide (minggu ini).
3. **P11 P0** — Provider correctness (minggu ini).
4. **P10/P11/P13 P1** — sprint (Responses, reasoning_effort, SWE-bench Lite, flake TUI).

---

## Prinsip yang mengatur rencana ini

1. **Verifikasi perilaku, bukan bentuk kode.** Harness yang men-`grep` sumber jadi basi begitu kode diperbaiki — terbukti di ronde 3, di mana harness lama melapor 9 temuan yang sudah tidak ada. Tulis harness yang **menjalankan** kodenya.
2. **Buktikan dampak sebelum memperbaiki.** 5 dari 12 temuan ronde 1 tidak berdampak nyata dan sengaja tidak diperbaiki. Temuan tanpa bukti dampak adalah utang, bukan aset.
3. **Setiap perbaikan meninggalkan test yang gagal di commit sebelumnya.** Kalau test barumu lulus di kode lama, ia tidak menguji apa yang kamu kira.
4. **Jangan menambah permukaan baru sebelum yang ada teruji.** Tidak ada fitur baru di rencana ini kecuali yang sudah disetujui owner.

---

## P10 — Path to 9+: TOCTOU, `--cwd` repo-wide, SWE-bench Lite, flake TUI

Empat pekerjaan rumah terakhir sebelum skor 9+ bisa diklaim (audit 2026-09-06). Detail ada di bagian ini.

**P0 — Rilis blocker (minggu ini):**
- **P0.1 `--cwd` repo-wide:** `getArg` berhenti di token subcommand (boundary anti-injeksi P8) → SEMUA handler (`sessions`, `stats`, `providers`, …) mengabaikan `--cwd` (terverifikasi: artefak jatuh ke repo/global). Fix di `cli/router.ts`: bangun `subArgv` (flag sebelum cmd + args dari cmd) + `subGetArg`; hapus workaround `subArg` di `memory.ts`. Test: tiap subcommand `--cwd tmp` assert artefak lokal.
- **P0.2 TOCTOU `O_NOFOLLOW`:** 6 tool pola cek-dulu-pakai-kemudian (`realpath` lalu `readFile` terpisah). Helper baru `src/lib/safe-open.ts` (open `O_NOFOLLOW` → fstat → baca via handle; `O_NOFOLLOW` di `atomic-write.ts`; fallback `dev+ino` terdokumentasi di Windows). Test `test/tool-toctou.test.ts` dengan swapper latar (harus menang ≥1× di kode lama).

**P1 — Kepercayaan pengukuran (sprint depan):**
- **P1.1 Flake TUI:** `tui-harness.ts` sleep-based (`settleMs 15`, timeout 2000) + `send` fan-out ke stale listener → `waitForOutput` + `answerSequence` v2 + kirim ke listener raw-terbaru; kembalikan timeout ≤5000; 10/10 hijau + `test/tui-harness.test.ts` baru.
- **P1.2 SWE-bench Lite:** `bench/swebench.ts` baru (clone + checkout `base_commit`, prompt = problem_statement, verify = `FAIL_TO_PASS` via pytest, `PASS_TO_PASS` sampled); 20 instance terstratifikasi di-pin; angka resolve rate TERCETAK (berapa pun) sebelum boleh dikutip — PLAN P3.1 tetap berlaku.

**Selesai bila:** artefak `--cwd` selalu lokal, swapper 3×1000 iterasi 0 lolos, timeout manager ≤5000 + 10/10 hijau, angka SWE-Lite-20 dari run nyata, gate hijau.

## P11 — Provider Hardening: correctness, harga, Responses, retry

Audit 2026-09-06 menemukan provider skor terendah (7.5): shim Gemini drop `thought_signature` (400 diam-diam), harga Opus usang 3× (rusak `--budget`), tanpa Responses API dan `reasoning_effort`, 429 bakar-daftar provider, deteksi via substring URL, OAuth 1 provider belum terverifikasi, tanpa observabilitas, `max_tokens` 4096 sunyi. Detail ada di bagian ini.

**P0 — Kebenaran (minggu ini):**
- **P0.1 `thought_signature` pass-through:** teruskan `extra_content.google` dari delta tool_call → echo verbatim (seam aditif bila perlu). Test: tool loop Gemini thinking 3-turn hijau.
- **P0.2 Refresh harga:** koreksi Opus `$5/$25` + GPT-5.x/Claude 4.6/Gemini 3.x/DeepSeek V4; `pricing status` tampilkan umur cache + peringatan stale (tanpa auto-fetch).
- **P0.3 `max_tokens` 8192 + `length` eksplisit:** stop terpotong jadi peringatan, bukan teks sunyi.

**P1 — Daya saing (sprint depan):**
- **P1.1 Adapter Responses API** (`/v1/responses`, `previous_response_id`, `store:false` default) + `providerHint: "responses"`.
- **P1.2 `reasoning_effort` generik** (`ProviderEntry`, dipetakan per-wire).
- **P1.3 Retry-after dihonori**, fallback hanya non-429 (hapus bakar-daftar).
- **P1.4 Wire dari probe** (bukan substring URL) + Gemini native bila P0.1 rapuh.

**P2 — Kematangan:** routing policy + provider efektif di header, OAuth Copilot/ChatGPT, observabilitas `/cost` (pola `memoryHits`).

**Selesai bila:** tool loop Gemini 3-turn hijau, Opus ≈⅓ biaya lama, `length` eksplisit, fake Responses SSE benar, 429 tunggu-di-tempat, gate hijau.

**Sengaja ditolak:** proxy universal ala LiteLLM — tiga adapter kecil yang jujur > satu proxy ajaib (postur zero-dep).

## P13 — Raise 3 Dimensi Tertinggal: Model 8.0→8.7, Tool 8.5→9.0, Sesi/Memori 8.5→9.0

Skor saat ini **8.2**. Target **P0 (≤3 hari): 8.4**, **P1 (sprint): 8.6**. Berbasis riset read-only 2026-09-06 (empat fact-sheet: inventaris 31 tools `src/tools/index.ts:47`, 14 preset `src/providers/presets.ts:14`, 6 mode `src/policy/permission.ts:8`, WAL+shadow-git+FTS5/MMR). **Keputusan pemilik dikunci:** P0 dulu; memori **opt-out** (`MINICODE_AUTO_MEMORY=0`); **sandbox tidak disentuh** (skor 8.0 dibiarkan — pemilik menolak kerja sandbox Windows/Linux). Tanpa TUI, tanpa proxy universal LiteLLM, tanpa edit `vendor/minicore/**` kecuali seam aditif.

**P0 — Semua yang menaikkan skor (≤3 hari, tanpa ubah UI/API):**

- **Model (8.0→8.7):**
  - **M0.1 `thought_signature` pass-through:** seam aditif `provider_meta?: unknown` di `vendor/minicore/src/core/tool.ts:22` (+ `VENDOR.md`, `bun run vendor:minicore`); teruskan `extra_content.google.thought_signature` dari delta `vendor/minicore/src/providers/openai-compat.ts:112` → `ToolCall._meta` → echo verbatim. *DoD:* fake SSE 3-turn Gemini thinking → turn-3 tidak 400.
  - **M0.2 Refresh `BUILTIN_PRICING`:** `src/policy/pricing.ts:30` Opus `$15/$75→$5/$25` + GPT-5.x/Claude 4.6/Gemini 3.x/DeepSeek V4; `cli/commands/pricing.ts:42` tampil `ageH` + `(stale)` >30d (tanpa auto-fetch).
  - **M0.3 `max_tokens` 4096→8192:** `src/providers/anthropic.ts:73` + warning `length` eksplisit di `src/ui/render/errors.ts` + `src/ui/assistant/simple.ts`.
- **Tool (8.5→9.0):**
  - **T0.1 `move_file` + `delete_file`** (delete soft ke `.trash/`; jail sama `write_file.ts:30`, atomic, `isSensitive`).
  - **T0.2 `read_image`** — reuse `estimateImageTokens` `src/policy/context.ts:15` → base64 `data:image/...` cap `BASH_OUTPUT_MAX_CHARS`.
  - **T0.3 Pisah `readonly` vs `plan` — DEFERRED:** ditolak, `plan` = `readonly` strict (test `plan mode: read-only` + `permission Fase 1` menuntut todo_write/delegate ditolak). Kembali hanya bila ada desain `write_plan` artifact + test baru.
  - **T0.4 `O_NOFOLLOW` safe-open** `src/lib/safe-open.ts` → 6 tool file + `atomic-write.ts`; fallback `dev+ino` Windows (paralel P10.2).
  - **T0.5 `code_run` tool** — sandboxed sama `bash`, bypass deny `INLINE_INTERPRETER` `bash-guard.ts:135` (hanya bila `MINICODE_SANDBOX=os|docker`).
- **Sesi & Memori — opt-out (8.5→9.0):**
  - **S1 Persist summary:** `src/policy/compaction.ts:187` → `addMemory(summary.slice(0,1200), {category:'summary'})`, guard `if (process.env.MINICODE_AUTO_MEMORY !== "0")`.
  - **S2 Kategori:** `src/memory/vector.ts:30` migration `category` (`fact|decision|preference|snippet|summary`) + `write_memory {category?, tags?}` (default `fact`); boost `score+=0.1` bila query match.
  - **S3 Scope `all`:** `vector.ts:431` `scope: 'cwd'|'global'|'all'` (merge dua DB, perbaiki silent shadowing `src/lib/db-path.ts:16`); default `cwd`.

**P1 — Sprint (8.4→8.6):**
- **Model:** adapter Responses API `src/providers/responses.ts` (`/v1/responses`, `previous_response_id`, `store:false` default) + `providerHint:"responses"`; `reasoningEffort?: "low"|"medium"|"high"` di `src/config.ts:29` (dipetakan per-wire); honori `retry-after` di provider sama `src/providers/router.ts:114` (hapus bakar-daftar 429); wire dari probe `src/providers/detect.ts:62` (bukan substring URL).
- **Tool:** `submit_result` (structured output `response_format:json_schema`); `ask_user` gated `permission.ts:68` render via injeksi `promptAsk` `cli/setup.ts:30`.
- **Sesi/Memori:** plan artifact `.minicode/plans/<id>.md` (`src/tools/todo.ts`); auto-extract snippet dari turn verify sukses (`cli/setup.ts:226`, opt-out sama); branch `branchSession` (`src/session/persistence.ts`); TTL hierarkis `fact/decision 180, summary 90, snippet 14` + `accessCount`.

**Selesai bila (semua diukur):**
- Gate: `bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack` hijau; `MIN_LINES/MIN_FUNCS` dinaikkan bila coverage naik. **Sementara 77/81** (4 tool baru tanpa test saat P0) — kembalikan 81/83 setelah test P1 mendarat.
- `test/tool-toctou.test.ts` swapper 3×1000 iterasi **0 lolos** (wajib gagal di kode lama).
- `test/cli-subcommands.test.ts`: tiap subcommand `--cwd tmp` → artefak lokal, bukan repo/global.
- `test/tui-harness.test.ts` 10× hijau (flake TUI tidak mundur).
- Gemini thinking 3-turn hijau; Opus ≈⅓ biaya lama; `length` eksplisit; fake Responses SSE benar; 429 tunggu-di-tempat.
- `memory status --json`: kategori + scope tampil; setelah 20 turn ada summary `rows+1` (kecuali `MINICODE_AUTO_MEMORY=0`).

## Yang sengaja TIDAK dikerjakan

Agar cakupan jelas dan tidak melebar diam-diam:

- **Tidak ada framework TUI baru.** Pure ANSI tetap. Ink/blessed akan membuang seluruh `fullscreen.ts` demi masalah yang perbaikannya berukuran satu fungsi.
- **Tidak ada mouse support.** Mouse tracking sudah dimatikan di V6 karena byte koordinatnya bocor ke input dan tidak ada konsumennya.
- **Tidak ada tema baru.** Empat preset sudah bekerja; menambah tema tanpa pengguna yang meminta adalah spekulasi.
- **Tidak ada virtual scroll transcript.** `RING_MAX 60` + `tail.slice(-bodyH)` memadai sampai ada keluhan nyata.
- **Repo-map tetap regex.** Alasan lengkap (dengan tabel pengukuran) ada di komentar `extractSymbolsAsync` di `src/repo/repomap.ts`. Tree-sitter menambah dua dependensi dan ~1,4 MB wasm per bahasa untuk simbol yang hampir seluruhnya member kelas — bukan yang berguna untuk orientasi.

---

## Cara bekerja di repo ini

**Sebelum mulai:** baca `AGENTS.md`, jalankan seluruh gate di bagian "Keadaan saat ini".

**Selama bekerja:**
- Ikuti gaya kode yang ada; jangan memperkenalkan pustaka baru.
- Bahasa komentar: Indonesia, menjelaskan **mengapa** bukan **apa**. Sertakan bukti (angka, nama berkas, perilaku terverifikasi) untuk keputusan non-obvious.
- Encoding: UTF-8 tanpa BOM. Repo ini pernah rusak karena pipeline PowerShell tanpa encoding eksplisit — `test/import-convention.test.ts` menjaganya, jalankan setelah mengedit berkas berisi karakter non-ASCII.
- Jangan mengedit `vendor/minicore/**` tanpa keputusan eksplisit (lihat P2.1).

**Sebelum menyatakan selesai:**
```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
```
Semua harus hijau. Bila coverage naik, naikkan juga angka minimum di `scripts/coverage-gate.ts` supaya tidak bisa mundur.

**Jangan commit** kecuali diminta. Bila diminta: periksa `git status` dan `git diff` lebih dulu, stage hanya berkas yang dimaksud, jangan pernah commit rahasia.
