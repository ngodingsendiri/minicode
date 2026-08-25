# Contributing to Minicode

## Development Setup

```bash
git clone https://github.com/ngodingsendiri/minicode && cd minicode
git clone https://github.com/ngodingsendiri/minicore ../minicore
bun install
bun test              # 194 pass + 8 skip (offline)
bun x tsc --noEmit    # typecheck
bun run lint          # biome check
```

Requires `bun >=1.0`.

## Code Style

- **Language:** Full English for code, comments, docs, and commit messages.
- **Formatting:** `biome format` — 2 spaces, 100 line width, double quotes.
- **Linting:** `biome check` — enabled, recommended rules.
- **Line endings:** LF only (enforced via `.editorconfig` + `.gitattributes`).
- Run `bun run lint:fix` before committing.

## Architecture

- `minicore` is frozen — only additive seams (`compactAsync`, `initialMessages`) allowed.
- New features as Tools / Providers / Policies in `minicode`, not core patches.
- `cli/setup.ts` is thin orchestrator — heavy logic lives in `src/app/*` layers.

## Testing

- `bun test` offline by default. Live tests require `MINICODE_LIVE=1` and API keys.
- Add tests for new tools in `test/tools.test.ts` or dedicated file.
- Fuzz `prompt-engine` via `test/fuzz-prompt.test.ts`.

## Pull Requests

- Keep `bun x tsc --noEmit && bun test && bun run lint` green.
- Update `docs/ARCHITECTURE.md` if adding new layer.
