# MCP & LSP

## MCP — dua transport

```bash
# stdio — server lokal yang di-spawn minicode
minicode config mcp add fs --command npx --args "-y,@modelcontextprotocol/server-filesystem,."

# Streamable HTTP — server remote (spec 2025-03-26, SSE juga ditangani)
minicode config mcp add ctx7 --url https://mcp.example.com/mcp --header "authorization=Bearer xxx"

# localhost butuh opt-in eksplisit (anti-SSRF)
minicode config mcp add lokal --url http://127.0.0.1:3000/mcp --allow-private
```

Setelah terdaftar, `mcp_list` menampilkan **tools, resources, prompts** sekaligus:

| Tool | Spec | Catatan |
|---|---|---|
| `mcp_list` | `tools/list` + `resources/list` + `prompts/list` | read-only, tidak di-gate |
| `mcp_call` | `tools/call` | di-gate |
| `mcp_read` | `resources/read` | di-gate (konten pihak ketiga = jalur prompt-injection). Biner diganti penanda ukuran |
| `mcp_prompt` | `prompts/get` | di-gate, server merender argumen |

Tool dinamis `serverId.toolName` otomatis muncul. `resources`/`prompts` opsional di spec: server "Method not found" tetap terhubung dengan tool utuh.

Keamanan HTTP: host privat ditolak kecuali `--allow-private` (penjaga sama dengan `web_fetch`: DNS pinning). Redirect tidak diikuti. Ukuran dibatasi. Balasan dicocokkan per request id. Header `Authorization` tidak masuk log.

Izin: semua MCP bertitik selalu di-gate — `auto` minta konfirmasi sekali per tool (`[a] Always` persist ke allowlist); `readonly`/`plan`/`allowlist` menolak. Tanpa wildcard auto-allow (proteksi supply-chain).

Model kepercayaan: permission hanya kontrol *pemanggilan*. Capability di balik server (filesystem, network, proses, API) tak bisa diketahui statis — anggap setiap `mcp_call` external capability arbitrer. Pembatalan hentikan penungguan, tapi tidak bunuh proses stdio maupun batalkan efek yang sudah terjadi.

Ekspos balik:

```bash
minicode mcp serve   # minicode sebagai MCP server (curated tools + permission aktif)
```

## LSP

```bash
minicode config lsp add .ts --command typescript-language-server --args --stdio
```

Setelah terdaftar: `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_hover`, `lsp_symbols`, `lsp_workspace_symbols`. Diagnostics otomatis di `edit`/`write_file` bila server terkonfigurasi. `didClose` cleanup.

Bila LSP tidak jalan: pastikan server terinstall dan command benar. Repo-map regex tetap jalan sebagai fallback (`MINICODE_REPOMAP=regex`).
