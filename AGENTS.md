# AGENTS.md

Petunjuk untuk agent yang bekerja di repo ini.

## Struktur (repo-map)
```
cli/commands/config.ts:
  function handleConfig(...)
src/config.ts:
  interface ProviderEntry
  interface McpServerEntry
  interface LspServerEntry
  interface MinicodeConfig
  function normalizeConfig(...)
  function writeConfigAtomic(...)
  function loadConfig(...)
  function mergeByKey(...)
  function saveProvider(...)
  function deriveProviderId(...)
  function detectAndSave(...)
  function removeProvider(...)
  function refreshProviderModels(...)
  function saveMcpServer(...)
  function removeMcpServer(...)
  function normalizeExt(...)
  function saveLspServer(...)
  function removeLspServer(...)
src/constants.ts:
  const LIMITS
cli/commands/providers.ts:
  interface TraceRow
  function readTraces(...)
  function providerOfTrace(...)
  function healthMap(...)
  function handleProviders(...)
cli/index.ts:
  function getArg(...)
src/hooks/index.ts:
  interface Allowlist
  function loadAllowlist(...)
  function saveAllowlist(...)
  function matchAllowlist(...)
  function promptAsk(...)
cli/commands/skills.ts:
  function handleSkills(...)
cli/prompt-engine.ts:
  interface PromptState
  const MAX_VISIBLE
  interface RenderSpec
  function createState(...)
  type PromptKey
  type PromptAction
  function applyKey(...)
  function buildRenderSpec(...)
  function decodeKeys(...)
  interface DecodedKey
  function decodeKey(...)
  function scanCsi(...)
cli/router.ts:
  function dispatch(...)
cli/commands/mcp.ts:
  function handleMcp(...)
cli/input.ts:
  function loadHistory(...)
  function appendHistory(...)
  function detectAnsi(...)
  interface AskLineOptions
  function askLine(...)
  function askSecret(...)
cli/setup.ts:
  interface CliSessionOptions
  interface CliSession
  function createCliSession(...)
  function runPromptWithVerify(...)
  function persistCurrent(...)
  function close(...)
src/policy/jail.ts:
  const SENSITIVE_RE
  function isSensitive(...)
  function isPathOutsideRoot(...)
  function isRealPathOutsideRoot(...)
  function isCwdOutsideRoot(...)
cli/args.ts:
  function flagNameOf(...)
  function getArg(...)
  function promptFromArgs(...)
  function readPrompt(...)
src/lib/atomic-write.ts:
  function atomicWriteText(...)
src/lsp/client.ts:
  interface LspServerEntry
  function languageIdFor(...)
  function sleep(...)
  class LspConnection
  function configureServers(...)
  function getConfiguredExts(...)
  function getConnection(...)
  interface LspPositionResult
  function findSymbolPosition(...)
  function lspDiagnostics(...)
  function lspCa
```

## Konvensi
- Ikuti gaya kode existing.
- Jalankan typecheck/test sebelum menyatakan selesai.
- **Setiap agent yang menambah, menghapus, memindah modul/berkas, atau mengubah
  lapisan/ketergantungan antarlapisan WAJIB memperbarui `docs/ARCHITECTURE.html`
  dalam perubahan yang sama.** File itu peta struktur hidup repo ini dan harus
  selalu mencerminkan struktur terkini — jangan biarkan usang.

## Rencana kerja aktif

Baca [PLAN.md](PLAN.md) sebelum mulai. Itu satu-satunya rencana yang harus
dieksekusi; `docs/PLAN_V4.md`, `PLAN_V5.md`, dan `PLAN_UIUX_V6.md` adalah arsip
(semua itemnya sudah selesai).

Gate yang harus hijau sebelum menyatakan selesai:

```bash
bun x tsc --noEmit && bun run lint && bun test && bun run gate:coverage && bun run gate:pack
```

## Jebakan yang sudah tiga kali terulang

`c` dan `glyphs` di `src/tui/theme.ts` adalah **getter** yang membaca state
runtime (tema aktif, dukungan UTF-8, `NO_COLOR`). Menyimpannya ke `const` di
module scope membekukan nilainya saat import — `/theme` pernah tidak berefek
apa pun karena ini, dua kali. Lihat PLAN.md P0.1.

Lebar teks di terminal diukur dalam **kolom**, bukan karakter: pakai
`displayWidth`/`truncateToWidth`/`padToWidth` dari `src/tui/width.ts`, jangan
`.length` atau `.slice()`. CJK dan emoji memakan dua kolom.

Teks dari model, hasil tool, dan isi berkas adalah masukan **tidak terpercaya**:
lewatkan `sanitizeAnsi` (`src/tui/sanitize.ts`) sebelum ditampilkan. Tanpa itu
model bisa membersihkan layar atau keluar dari alternate screen.
