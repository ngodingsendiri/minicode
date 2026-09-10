---
title: "Repo-map vs context window 1M: orientasi murah sebelum reasoning mahal"
date: 2026-09-11
tags: [ai, llm, coding-agent]
desc: "Context besar tidak menggantikan orientasi. Repo-map regex Minicode memberi model peta simbol murah sebelum token mahal dipakai."
---

Model dengan context 1M menggoda kita untuk melempar seluruh repo ke prompt. Masalahnya: biaya, latensi, dan noise.

## Peta dulu, baca kemudian

Minicode menyuntik repo-map ringkas ke system prompt: simbol per file (regex, 9 bahasa), di-cache di `.minicode/repomap.json`, file diurut import-graph.

Tree-sitter sengaja tidak dipakai. Alasannya terukur di `extractSymbolsAsync` di `src/repo/repomap.ts`: dua dependensi dan wasm per bahasa untuk simbol yang hampir seluruhnya member kelas — bukan yang berguna untuk orientasi.

## Fallback berlapis

Bila repo-map kurang, LSP `workspace/symbol` jadi fallback. Bila keduanya buntu, barulah `grep` dan `read_file` dengan paging `offset/limit`.

Pola ini menekan token sebelum reasoning mahal dimulai — dan bisa kamu tiru di agent lain: orientasi murah dulu, baca dalam kemudian.
