# Contributing to Minicode

Minicode dilisensikan **MIT** (lihat [LICENSE](LICENSE)) — kontribusi publik
diterima. Dokumen ini sebelumnya menyatakan proprietary/EULA; itu sudah tidak
berlaku sejak v0.7.0.

## Development Setup

```bash
git clone https://github.com/ngodingsendiri/minicode && cd minicode
git clone https://github.com/ngodingsendiri/minicore ../minicore   # dependensi sibling
bun install
bun test              # offline/hermetic (live & docker di-skip otomatis)
bun x tsc --noEmit    # typecheck strict — mencakup src cli test bench scripts
bun run lint          # biome check
bun run gate:coverage # gate coverage agregat
```

Requires `bun >=1.0` (`bun:sqlite` dipakai langsung — tidak jalan di Node).

## Code Style

- **Language:** Full English for code, comments, docs, and commit messages.
- **Formatting:** `biome format` — 2 spaces, 100 line width, double quotes.
- **Linting:** `biome check` — enabled, recommended rules.
- **Line endings:** LF only (enforced via `.editorconfig` + `.gitattributes`).
- Run `bun run lint:fix` before committing.

## Architecture

- Kernel MiniCore beku. `vendor/minicore/` adalah **salinan hasil sync** — jangan edit di sana.
  Perubahan kernel dilakukan di repo `minicore`, lalu `bun run vendor:minicore` (butuh clone
  sibling `../minicore`). CI menjaga kesinkronan lewat `bun run vendor:check`.
- Only additive seams (`compactAsync`, `initialMessages`) allowed on the kernel.
- New features as Tools / Providers / Policies in `minicode`, not core patches.
- Central limits live in `src/constants.ts` (`LIMITS`) — no scattered magic numbers.
- All process spawns go through `sanitizeSpawnEnv`; all file writes through `atomicWriteText`.
- ANSI escape pattern punya satu sumber: `ANSI_PATTERN`/`stripAnsi` di `src/tui/theme.ts`.
- Production code must contain zero `as never` / `as any`.

## Testing

- `bun test` offline & hermetic by default (fetch mocked, DB in tmpdir). Live tests require `MINICODE_LIVE=1` and API keys.
- Add regression tests alongside any security/correctness fix.
- Fuzz `prompt-engine` via `test/fuzz-prompt.test.ts`.
- Tool dengan dua jalur eksekusi (mis. `grep` ripgrep vs walker) harus diuji **kedua** jalurnya
  dan dibuktikan memberi hasil sama — `MINICODE_GREP_ENGINE=js` memaksa fallback.
- Gates before every commit: `bun test && bun x tsc --noEmit && bun run lint`.
- Angka yang bisa dihitung mesin (jumlah test/tool/coverage) **jangan** ditulis di
  markdown — biarkan CI atau perintah yang menghasilkannya. Dokumen yang
  over-claim membuat pembaca mendiskon klaim lain yang benar.
- Kalau menemukan angka lama yang salah, koreksi di dokumen dan sebutkan koreksinya.
  Jangan diam-diam menghapusnya.

## Pull Requests

- Keep the three gates green (`bun test`, `tsc --noEmit`, `bun run lint`).
- One logical change per commit; update `docs/ARCHITECTURE.md` when adding a layer.
- Kontribusi dilisensikan MIT seperti sisa proyek.
