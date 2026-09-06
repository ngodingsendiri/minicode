# Harness Agent — Riset Fondasi & Acuan Minicode

Hasil riset mendalam 2026-09-06 (Harness-Engineering, Anthropic, OpenAI,
Fowler/Böckeler, Harness-Bench, studi source-code 11 harness
arXiv:2609.00006, ReAct/Toolformer). Dokumen hidup: perbarui bila temuan
baru mengubah keputusan di bawah.

## 1. Definisi

`Agent = Model + Harness`. Model menghasilkan teks; harness memutuskan apa
yang model lihat, apa yang boleh dilakukan, kapan berhenti, dan apa yang
terjadi saat gagal. Framework = blueprint/pustaka; harness = runtime yang
jalan di produksi. Dua tim bermodel identik bisa berbeda 40 poin completion
hanya karena harness.

Inti eksekusi = **loop ReAct** (`Thought → Action → Observation → …`)
sampai jawaban final atau batas tercapai. Terminasi harus berlapis:
tanpa tool-call, `maxSteps`, budget habis, guardrail tripwire, interupsi
user, safety refusal.

## 2. Model kontrol Fowler (guides × sensors)

| | Computational (CPU, deterministik, murah) | Inferential (GPU, probabilistik, mahal) |
|---|---|---|
| Guide (sebelum aksi) | permission filter, allowlist, schema validator | planning agent, AGENTS.md, Skills |
| Sensor (sesudah aksi) | test, compiler, typechecker, CI | self-reflection, evaluator/judge |

Aturan: yang bisa jadi aturan deterministik → computational; yang butuh
judgment → inferential. Tiga kategori regulasi: maintainability (termudah),
architecture fitness (fitness function), behaviour (belum terpecahkan —
jangan percaya buta pada test buatan AI). Operasi: steering loop (isu
berulang → perbaiki guide/sensor) + keep quality left (cek cepat
pra-commit, cek mahal pasca-integrasi).

## 3. Anatomi 7 subsistem (dari studi 11 harness)

Loop, integrasi LLM, tools, memori/konteks, safety/permission,
orkestrasi multi-agent, ekstensibilitas. Temuan keras:

- Kerumitan loop tidak memprediksi benchmark; scaffold ~90 baris sah.
- Tool scoping > tool count (Vercel: -80% tools = hasil naik).
- Harness produksi tidak memakai embedding retrieval (deterministik:
  ripgrep/tree-sitter/glob).
- Safety 4 lapis komposisional: policy deklaratif → hooks → reviewer LLM
  → OS sandbox; audit tiap lapis independen.
- Skills (`SKILL.md`) > MCP untuk adopsi lintas-harness.
- Batasan pindah dari prompt ke config terstruktur.

## 4. Long-running (Anthropic + OpenAI)

Anthropic: compaction saja tidak cukup. Initializer (sekali: `init.sh`,
`feature_list.json` `"passes": false`, progress file, commit awal) +
coding agent (tiap sesi: baca progress+git → pilih SATU fitur → smoke test
dulu → implement → verifikasi end-to-end → commit). JSON > Markdown.
Health-check awal iterasi wajib. Evolusi: split planner/generator/evaluator
(atasi self-praise bias).

OpenAI (1M LOC, 1500 PR): beri peta bukan manual — `AGENTS.md` ~100 baris
sebagai daftar isi; enforce invariant bukan micromanage (linter custom
yang pesannya berisi instruksi remediasi); garbage collection terjadwal;
pensiunkan scaffolding tiap model baru.

## 5. Bukti kuantitatif (Harness-Bench, 5194 trajektori)

Skor = `Security × Completion × Process`. Gap antar-harness 23,8 poin.
Lima gejala gagal: contract/format 36,4%, tool-tanpa-recovery 24,6%,
evidence/grounding 14,6%, artefak-tak-dicommit 11,1%, state 9,3%.
Yang membedakan = **execution alignment** (reasoning ↔ workspace ↔ aksi
tool ↔ kontrak evaluator tetap legibel).

## 6. Pola terbaik (ringkas)

Done machine-readable dulu; verifikasi computational tiap aksi +
inferential selektif; tool minimum per fase; state eksternal
path-addressable & compaction-stable; health-check awal; satu fitur per
sesi + clean-state commit; generator≠evaluator; budget/timeout berlapis +
fail-closed; observability per-step; GC debt kecil-kecil; mulai dari
harness tertipis yang lolos evaluasi.

## 7. Matriks kematangan

L1 demo (jalan, tanpa batas) → L2 terkendali (budget/abort/trace) →
L3 terverifikasi (sensor tiap aksi, evaluator terpisah) → L4 lintas-sesi
(progress+feature-list+git, resume tervalidasi) → L5 mengatur-diri
(GC, pensiun scaffolding, template per topologi).

## 8. Posisi minicode (2026-09-06)

Kuat L2–L3 di loop/state/safety-dasar. P0 mendarat: jail simetris
move/delete (`permission.ts`), strict sandbox (`bash.ts`), allowlist
`bun run`/`bun x`, scrub `exec --json` + flag `overBudget`.
Sisa menuju 9+: verify-gate default-on, trace per-step, audit-suite
anti-game, tool-scoping loop utama, `bench/docker/` per-era.
