# Sub-Agents & Tasks


## Konsep

Sub-agent = instans agent dengan **context terpisah** dari parent: memory, signal, dan budget sendiri. Pool concurrency 3 — maksimum 3 sub-agent hidup sekaligus — dan abort-aware (mewarisi AbortSignal parent; parent batal → anak berhenti).

Approval: `delegate_task` di-gate — TTY meminta persetujuan sekali per delegasi; non-TTY menolak. **Satu approval = delegasi ini saja**, tidak melebar ke delegasi lain.

## Mode anak: `explore` / `plan`

| Mode anak | Kemampuan |
|---|---|
| `explore` | Subset read-only (12 tool) — cari/pahami kode, kembalikan temuan |
| `plan` | Read-only + `todo_read` (baca rencana parent), tetap tanpa mutasi dan tanpa `todo_write` |

Restriksi anak (selalu, tanpa kecuali): **tanpa** MCP, `git_commit`, memory-tulis, todo-tulis, job background, nesting (anak tidak bisa mendelegasi lagi). Plan-parent dipaksa explore saat mendelegasi.

## Kenapa dibatasi

Sub-agent menjalankan task tanpa Anda di depan layar. Kalau anak bisa commit atau memanggil MCP, satu prompt parent bisa menghasilkan efek yang tak Anda persetujui. Dengan membatasi anak ke read-only, efek samping tetap satu: eksekusi di parent — yang ledger-nya selalu Anda lihat.

## Recovery

Turn parent gagal **setelah** anak `committed`: jurnal menandai delegasi; saat resume model diberi warning `[recovery]` agar tidak mendelegasi ulang buta (efek anak sudah terjadi — yang benar adalah verifikasi hasilnya). Lihat [Keamanan](security.md) untuk jurnal recovery lengkap.

## Lanjut

- [Tools](tools.md) — semua tool yang boleh dipakai anak.
- [Policy & Sandbox](policy-sandbox.md) — mode permission parent vs anak.
- [Otomasi & CI](exec.md) — delegasi di non-TTY (ditolak, fail-closed).
