# OpenRouter Free Model Test Summary

## Run context
- Date: 2026-09-01
- Workspace: `D:/git/minicode/outputs/openrouter-smoketest`
- Provider endpoint: `https://openrouter.ai/api/v1`
- Prompt used: `Reply with exactly: OK_FREE_MODEL`

## Tested models

| Model | Status | Notes |
|---|---|---|
| inclusionai/ling-3.0-flash-fin:free | PASS | Returned expected token |
| dots-studio/dots-3-note-preview:free | PASS | Returned expected token |
| liquid/lfm-2.5-2.6b:free | PASS | Returned expected token |
| nvidia/nemotron-3.5-lightning:free | PASS | Returned expected token |
| cohere/north-mini-code:free | PASS | Returned expected token |
| minimax/minimax-m3:free | PASS | Returned expected token |
| poolside/laguna-xs-2.1:free | PASS | Returned expected token |
| z-ai/glm-5.2:free | FAIL | Upstream temporary rate-limit (429-like provider rejection) |
| thinkingmachines/inkling-small:free | FAIL | Model unavailable for this harness (`only available on agentic harnesses`) |

## Aggregated result
- Total tested: 9
- Passed: 7
- Failed: 2
- Success rate: 77.8%

## Notes
- Failures are provider/model availability constraints, not local CLI crash.
- Local smoke-test provider config containing API key has been removed after test.
- Raw logs per model are stored beside this file.
