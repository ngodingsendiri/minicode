# Minicode

Coding agent built on **frozen MiniCore** (`../minicore` v0.1.0, 148 tests, 3a4f3fa FREEZE).

MiniCore = kernel runtime `STATE/MODEL/ACTION/LOOP` (tidak diubah lagi). Minicode = layer agencode: filesystem, shell, git, permission, LLM-compaction, memory, UI.

## Hubungan
```
minicore (frozen, zero-dep, 16 modul)  ← tidak disentuh
   ↑
minicode (coding-agent, depends file:../minicore)
  ├─ src/tools/  → Tool (read_file, bash, edit, git)
  ├─ src/providers/ → re-export openai-compat + future anthropic
  ├─ src/policy/ → permission interaktif, budget/compaction agencode
  └─ cli/        → TUI agencode
```

## Quickstart
```bash
bun install
bun test        # nanti: suite minicode
bun run typecheck
bun cli/index.ts "buat http server di src/server.ts"
```

## Aturan
- Jangan ubah `../minicore/src/core/*` — kalau butuh primitive baru, buktikan dulu tidak bisa sebagai Tool/Provider/Policy.
- P2/C4/C5 sisa minicore ditangani di sini sebagai policy/adapter agencode, bukan patch core.

Lihat `../minicore/docs/MINICORE-FINAL-AUDIT.md` untuk batas kernel.
