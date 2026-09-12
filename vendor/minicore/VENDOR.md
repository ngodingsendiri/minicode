# vendor/minicore — JANGAN EDIT MANUAL

Salinan kernel MiniCore agar `bun install` tidak membutuhkan clone sibling
`../minicore`. Sumber kebenaran tetap repo minicore.

- source commit: `05fc595ad07ccbf3c85d9645948a0621bdce0353`
- files: 19
- hash: `99b17847ce5b4771`
- seam aditif lokal (belum ada di upstream — JANGAN sync membabi buta,
  `bun run vendor:minicore` akan MENGHAPUSnya): `cwd` + `permissionMode`
  (session→loop→executor→ToolContext), `turnCount`/`stepCount` seed,
  `provider_meta`/`thought_signature` side-map + `reasoningEffort` knob di
  openai-compat. Berkas tersentuh: `src/core/{session,loop,executor,tool}.ts`,
  `src/providers/openai-compat.ts`. (Kernel upstream 1eceea9 punya cap
  retryAfter sendiri; vendor ini belum mengambilnya — cap ditutup lapis-app
  minicode.) Hilirkan dulu ke repo minicore, baru sync ulang.

Perbarui dengan `bun run vendor:minicore` (butuh `../minicore`).
CI memverifikasi kesinkronan lewat `bun run vendor:check`.
