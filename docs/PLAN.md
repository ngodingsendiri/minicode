# Minicode — Plan Penyempurnaan Lengkap

Basis: audit berkelanjutan 2026-08-25 → 180 test pass · tsc bersih · live E2E 6/6.

Filosofi: **minimal, selalu verifikasi, jangan pecahkan kernel minicore** (satu-satunya pintu = seam additive).

---

# Bagian A — Selesai (Fase 1–4 + audit UI/UX) ✅

| Item | Status |
|---|---|
| Fase 1: Testable prompt engine (pure `prompt-engine.ts`), live test terpisah `test:live`, detectAnsi race fix | ✅ |
| Fase 2: Error category formal (`cli/errors.ts`), multi-byte input, cost attribution fallback | ✅ |
| Fase 3: `/resume` + `/sessions` interaktif, budget prompt, compaction faktual (tool results) | ✅ |
| Fase 4: CI fix (checkout minicore sibling + cache), telemetry gate, coverage 72.6% lines | ✅ |
| Audit UI/UX: `minicode providers/models/sync` tanpa LLM, help plain text, `/sync` auto-refresh, scope provider global/local, cap deteksi 6s | ✅ |

Bonus bugs yang sudah terfix sepanjang jalan: provider-id kolisi (routing `provider::model`), compaction buang tool results, `glyphs.sparkle` missing, ANSI leak, router first-match-wins.

---

# Bagian B — UI/UX Fase 5 (dari audit mendalam)

## 5.1 Preset gateway di `/provider-add`  (P1)
- [ ] Pilihan preset: OpenAI | Anthropic | OpenRouter | DeepSeek | OpenCode Zen | Google — user tinggal pilih, baseUrl terisi otomatis.
- [ ] Dukungan paste API key satu baris; auto-detect model; fallback `--id` ramah (penamaan `openrouter`, bukan hash acak).
- [ ] Output sukses menampilkan: id + jumlah model + halaman tersebut secara terskrol (tidak line panjang).

**Kenapa penting:** user bukan admin API — tidak harus tahu `https://openrouter.ai/api/v1`.

## 5.2 Transparansi fallback saat run  (P1)
- [ ] Setelah `session.run` selesai, jika `effective-model` terjadi: tampilkan satu baris
      `(via openrouter/nemotron — requested gpt-4o)` di summary turn.
- [ ] Baris yang sama di one-shot (`--model x` yang disubstitusi).
- [ ] Test: router fallback → event `effective-model` tetap muncul di akhir stream.

**Kenapa penting:** user harus tahu jika request-nya tidak benar-benar memakai model yang diminta.

## 5.3 Filter `/models <keyword>`  (P2)
- [x] `/models [id] [keyword]` — filter substring case-insensitive (REPL).
- [x] `minicode models [id] --match <substr>` (CLI), juga global match.
- [x] Output (no match) saat kosong + hint tetap `/model` untuk switch.
- [x] Test dasar substring case-insensitive.

**Kenapa penting:** opencode-go 61 model — daftar tak terfilter tidak berguna untuk mencari satu nama.

## 5.4 Indikator model aktif saat running  (P2)
- [ ] Spinner + nama model/provider di baris status turn (`› bai/deepseek-v4-flash …`).
- [ ] Jika fallback: label berubah halaman server-nya (`› openrouter/nemotron …`).
- [ ] Test snapshot dengan mock provider delay 100ms.

**Kenapa penting:** turn panjang → user butuh tahu sedang menunggu/provider apa.

## 5.5 Pemisahan visual command vs skill di dropdown  (P3)
- [x] Dropdown grouped: header dinamis `COMMANDS` / `SKILLS` saat kedua grup match.
- [x] `groupOf` opsional di askLine; RenderSpec row `header|item`; totalRows menghitung header.
- [x] Test grouped spec (header order, item picking).

**Kenapa penting:** `/` menghubungkan dua ruang nama yang beda semantik; pengguna berpikir cepat mana yang sistem.

---

# Bagian C — Teknis Fase 6

## 6.1 Persistence robust (P1)
- [x] TTL konfigurable: `MINICODE_SESSION_TTL_DAYS` (0 = forever, default 30) — `purgeExpired()` ter-ekstrak & reusable.
- [x] `minicode sessions purge` — hapus manual sesi basi + orphan rows.
- [x] Checkpoint pruning: 20 terbaru per session (dari 50) — manifest di-cap saat record.
- [x] Test: TTL env parsing, purge delete (mock DB), checkpoint cap 25→20.

## 6.2 Cache & kecepatan (P2)
- [ ] Startup tidak boleh >1s di mesin dingin — audit dynamic imports (`wizard.ts`, `formats`).
- [ ] `detectModels` sudah 6s cap; tambahkan memori cache per baseUrl (30 menit) supaya `/sync` cepat dan agresif.

## 6.3 Provider health (P2)
- [ ] `minicode providers` menampilkan status dari probe ringan (model terakhir berhasil dipakai / belum pernah).
- [ ] Ambil dari `traces.jsonl` — tanpa jaringan.

## 6.4 Sekuriti & governance (P3)
- [ ] Hooks: file global `~/.minicode/hooks/*.js` (pre/post run) — mungkin berguna untuk CI hooks user; evaluate apakah worth.
- [ ] `--allowlist` extend: `npm exec`, `npx` dengan arg known-good.

## 6.5 Pengujian keandalan (P2)
- [ ] Fuzz `applyKey`/`decodeKeys` (1000 iterasi acak byte → tidak throw).
- [ ] Seed test deterministik (mock provider idle delay) untuk timing-sensitive test.

---

# Bagian D — Rilis & Dokumentasi Fase 7

## 7.1 Rilis v0.4.0 (P2)
- [ ] Changelog versi baru (fitur 5.x + 6.x).
- [ ] README: quickstart 3 baris (minicode → /model → prompt) dengan contoh screenshot ASCII.
- [ ] Semua flag didokumentasikan; `--help` bisa jadi sumber.

## 7.2 Benchmark jangka panjang (P3)
- [ ] Tingkatkan `bench/runner.ts` — 10 task, dua run per task, delta yang di-print per commit.
- [ ] Threshold gate rate >= 0.3 di CI (bench saja, tidak live).

---

# Definisi Selesai (DoD) — revisi terakhir

- [ ] `bun test` tanpa jaringan: hijau (180 saat ini).
- [ ] `bun run test:live` hijau lokal.
- [ ] `bun x tsc --noEmit` bersih.
- [ ] Coverage `src/policy` + `src/providers` ≥ 90% (kecuali `detect.ts` butuh live).
- [ ] Slash commands testable via cli-commands (bukan hanya via manual).
- [ ] Docs sinkron (USAGE.md), changelog ter-update per rilis.

---

# Daftar Prioritas Singkat (untuk mulai eksekusi)

1. **5.1 Preset gateway** — UX terbesar
2. **5.2 Baris fallback setelah run** — transparansi cost
3. **6.1 Persistence TTL/prune** — kebersihan data
4. **5.3 Filter model** — utilitas harian
5. **5.4 Spinner model** — monitor turn
6. **6.2 Startup & cache** — kecepatan
7. **5.5 Pemisahan command/skill** — polish
8. **6.5 Fuzz test** — keandalan
9. **7.1 Rilis v0.4.0** — pengumuman
