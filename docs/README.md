# Minicode — Dokumentasi

Coding agent CLI berbahasa Indonesia (istilah teknis English) yang dibangun di atas kernel **MiniCore** yang di-vendor ke `vendor/minicore`.

> Mengapa dokumen ini dipecah? `docs/USAGE.md` adalah panduan monolit 526 baris yang lengkap tapi berat untuk web. Halaman-halaman di sini adalah versi web-nya: navigasi per topik, tetap merujuk ke sumber yang sama. `USAGE.md` tetap dipertahankan sebagai referensi tunggal.

## Apa itu Minicode?

- **MiniCore** = kernel runtime `STATE / MODEL / ACTION / LOOP` (inti di-freeze; satu-satunya patch = seam aditif `compactAsync` + `initialMessages` + `cwd`).
- **Minicode** = layer agencode: tools FS/bash/git/memory/todo/MCP/LSP, sub-agent, skills, hooks ask, CLI shell-first pure ANSI (output linier di scrollback, tanpa Ink/React), memory hybrid RAG, sessions sqlite, repo-map, verifier.
- Prinsip angka: jumlah test/tool/coverage **tidak ditulis permanen** di sini — jalankan `bun test`, `bun run gate:coverage`, atau lihat CI. Riwayat per versi ada di `CHANGELOG.md` (root repo).

```
vendor/minicore (zero-dep — inti di-freeze)
   ↑ di-resolve lewat subpath imports #minicore (bukan dependency)
minicode (self-contained, tanpa sibling clone)
  ├─ src/tools/     → 37 Tool fs/bash/git/memory/todo/task/mcp/lsp
  ├─ src/agents/    → Pool concurrency 3 (sub-agent isolasi)
  ├─ src/policy/    → permission, bash-guard, sandbox, pricing, executor
  ├─ src/providers/ → openai-compat + anthropic + router + OAuth device-code
  ├─ src/mcp/       → client stdio + Streamable HTTP/SSE · server
  ├─ src/lsp/       → diagnostics/definition/references/hover/symbols
  ├─ src/session/   → persistence sqlite + checkpoint shadow-git
  ├─ src/skills/    → loader .minicode/skills/*.md
  ├─ src/ui/        → presentation layer mandiri (tanpa impor core/#minicore)
  └─ cli/           → REPL + controller tipis (wiring DI ada di sini)
```

Detail peta hidup ada di [Arsitektur](architecture.md) + `ARCHITECTURE.html` (file pendamping di folder ini).

## Mulai dalam 5 menit

```bash
git clone https://github.com/ngodingsendiri/minicode && cd minicode
bun install && bun link

minicode                # mode chat interaktif + wizard setup pertama kali
minicode "buat http server" --verbose
minicode auth login     # OAuth device-code, tanpa API key
minicode providers      # daftar gateway (tanpa LLM)
minicode doctor         # diagnosis lokal bila ada yang aneh
```

Lanjut ke [Quickstart](quickstart.md) untuk alur wizard → prompt pertama → verify, atau [Instalasi](getting-started.md) untuk matriks OS dan update/uninstall.

## Navigasi

| Kamu mau apa? | Baca |
|---|---|
| Install, update, uninstall, Windows vs Linux/macOS | [Instalasi](getting-started.md) |
| Prompt pertama, wizard, verify | [Quickstart](quickstart.md) |
| Mode CLI, flags `--verbose --verify --sandbox --budget` | [CLI](cli.md) |
| Slash command `/help /model /sessions`, tombol keyboard | [REPL](repl.md) |
| Tambah provider, login OAuth, cari model, sync | [Config & Provider](config-providers.md) |
| Harga model, `--budget`, `--budget-strict` | [Pricing & Budget](pricing-budget.md) |
| Referensi 37 tools | [Tools](tools.md) |
| Permission, bash-guard, sandbox, keamanan | [Policy & Sandbox](policy-sandbox.md) |
| Memory RAG, sessions, undo/redo, recovery journal | [Memory & Sessions](memory-sessions.md) |
| MCP stdio/HTTP, LSP, `mcp serve` | [MCP & LSP](mcp-lsp.md) |
| Auto-verify, benchmark, SWE-bench Lite, harness audit | [Verify & Benchmark](verify-benchmark.md) |
| Error umum + `doctor` | [Troubleshooting](troubleshooting.md) |
| Ikut kontribusi, gate, batas lapisan | [Contributing](contributing.md) |
| Peta lapisan, kontrak terminal, riset harness | [Arsitektur](architecture.md) |
| Perubahan per versi | [Changelog](changelog.md) |
| Referensi tunggal (monolit) | `USAGE.md` (file pendamping) |

## Konvensi dokumen ini

- Bahasa: **Indonesia**, istilah teknis tetap English (`provider`, `checkpoint`, `sandbox`).
- Komentar kode di repo juga Indonesia (menjelaskan *mengapa*, bukan *apa*) — kecuali klaim `CONTRIBUTING.md` yang masih English-only dan sedang direkonsiliasi di halaman [Contributing](contributing.md).
- Setiap klaim perilaku merujuk ke `file:line` agar bisa diverifikasi dengan `read_file` + `offset`/`limit`.
- Encoding UTF-8 tanpa BOM. Jangan commit rahasia (API key, token OAuth).
