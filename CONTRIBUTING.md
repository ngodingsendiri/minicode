# Contributing to Minicode

> **Penting:** Minicode adalah software **proprietary / closed source**
> (lihat [LICENSE](LICENSE) — EULA). Repository ini tidak menerima pull
> request publik. Bagian di bawah berlaku untuk kontributor internal /
> penerima lisensi sumber yang telah menandatangani perjanjian dengan
> pemegang hak cipta.

## Development Setup

```bash
git clone https://github.com/ngodingsendiri/minicode && cd minicode
git clone https://github.com/ngodingsendiri/minicore ../minicore
bun install
bun test              # 243 test (235 pass + 8 skip live/docker, offline)
bun x tsc --noEmit    # typecheck (strict)
bun run lint          # biome check
```

Requires `bun >=1.0` (`bun:sqlite` dipakai langsung — tidak jalan di Node).

## Code Style

- **Language:** Full English for code, comments, docs, and commit messages.
- **Formatting:** `biome format` — 2 spaces, 100 line width, double quotes.
- **Linting:** `biome check` — enabled, recommended rules.
- **Line endings:** LF only (enforced via `.editorconfig` + `.gitattributes`).
- Run `bun run lint:fix` before committing.

## Architecture

- `minicore` is frozen — only additive seams (`compactAsync`, `initialMessages`) allowed.
- New features as Tools / Providers / Policies in `minicode`, not core patches.
- Central limits live in `src/constants.ts` (`LIMITS`) — no scattered magic numbers.
- All process spawns go through `sanitizeSpawnEnv`; all file writes through `atomicWriteText`.
- Production code must contain zero `as never` / `as any`.

## Testing

- `bun test` offline & hermetic by default (fetch mocked, DB in tmpdir). Live tests require `MINICODE_LIVE=1` and API keys.
- Add regression tests alongside any security/correctness fix.
- Fuzz `prompt-engine` via `test/fuzz-prompt.test.ts`.
- Gates before every commit: `bun test && bun x tsc --noEmit && bun run lint`.

## Pull Requests (internal only)

- Keep the three gates green.
- One logical change per commit; update `docs/ARCHITECTURE.md` when adding a layer.
- By submitting a patch you assign exclusive rights to the copyright holder and
  agree the contribution is governed by the LICENSE (EULA).
