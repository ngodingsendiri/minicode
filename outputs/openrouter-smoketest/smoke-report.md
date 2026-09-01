# OpenRouter Free Model Smoke Test

- Provider ID: openrouter-free
- Workspace: D:/git/minicode/outputs/openrouter-smoketest
- Prompt: Reply with exactly: OK_FREE_MODEL

| Model | Exit | Has token | Result |
|---|---:|---:|---|
| inclusionai/ling-3.0-flash-fin:free | 0 | 1 | PASS — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| dots-studio/dots-3-note-preview:free | 0 | 1 | PASS — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| liquid/lfm-2.5-2.6b:free | 0 | 1 | PASS — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| nvidia/nemotron-3.5-lightning:free | 0 | 1 | PASS — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| cohere/north-mini-code:free | 0 | 1 | PASS — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| z-ai/glm-5.2:free | 1 | 0 | FAIL — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| thinkingmachines/inkling-small:free | 1 | 0 | FAIL — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| minimax/minimax-m3:free | 0 | 1 | PASS — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
| poolside/laguna-xs-2.1:free | 0 | 1 | PASS — [sandbox] no OS sandbox on win32 — default permission = allowlist. Use --allow-all / --ask to choose yourself, or --sandbox docker for iso |
