---
title: "Kenapa Minicode memilih shell-native, bukan TUI"
date: 2026-09-10
tags: [minicode, cli, desain]
desc: "Output append-only ke scrollback, pipe-safe, dan satu arbitrator transient — alasan Minicode tidak memakai alternate screen."
---

Minicode adalah shell-native CLI, bukan TUI. Tanpa alternate screen, tanpa panel permanen. Output bersifat append-only ke scrollback terminal.

## Kontrak stdout dan stderr

Aturan mainnya sederhana:

- `stdout` untuk output program yang bermakna: teks model, receipt perubahan, artefak perintah.
- `stderr` untuk progres dan diagnostik: ledger tool, reasoning verbose, warning, error.
- Warna hanya bila stream TTY. `NO_COLOR` selalu menang.

Di pipe atau redirect, output deterministik: nol cursor-control, nol animasi spinner.

## Satu arbitrator transient

Satu-satunya rendering transient (garis status turn, spinner wizard) lewat `src/ui/runtime/statusline.ts`. Painter aktif saling eksklusif. Writer non-UI boleh menulis mentah ke stderr — arbitrator mengkomitnya sebagai baris permanen yang bersih.

Detail lengkap ada di halaman [Arsitektur](/docs/architecture.html) dan kontrak terminal di repo.
