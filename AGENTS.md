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
  const GLOBAL
  const LOCAL
  function normalizeConfig(...)
  function writeConfigAtomic(...)
  function loadConfig(...)
  function mergeByKey(...)
  function saveMcpServer(...)
  function removeMcpServer(...)
  function normalizeExt(...)
  function saveLspServer(...)
  function removeLspServer(...)
src/providers/provision.ts:
  function saveProvider(...)
  function deriveProviderId(...)
  function detectAndSave(...)
  function removeProvider(...)
  function refreshProviderModels(...)
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
cli/repl.ts:
  function runRepl(...)
src/policy/allowlist.ts:
  interface Allowlist
  function loadAllowlist(...)
  function saveAllowlist(...)
  function matchAllowlist(...)
cli/commands/skills.ts:
  function handleSkills(...)
src/ui/input/prompt-engine.ts:
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
src/ui/input/input.ts:
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
src/lib/net.ts:
  function isPrivateHost(...)
  function isPrivateHostWithDns(...)
src/app/session.ts:
  type PermissionControl
  function createMinicodeSession(...)
src/tools/task.ts:
  interface SubAgentSpec
  interface SubAgentSession
  type SubAgentSessionFactory
  function setSubAgentSessionFactory(...)
  const delegateTaskTool
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
src/ui/contract.ts:
  interface UiToolCallRef(...)
  interface UiStep(...)
  interface UiExecution(...)
  type UiEvent(...)
  type UiEventType(...)
  interface UiBus(...)
src/ui/approval/prompt.ts:
  interface ApprovalRequest(...)
  function promptAsk(...)
src/ui/render/errors.ts:
  function friendlyError(...)
  function formatFriendly(...)
src/ui/screens/picker.ts:
  function runPicker(...)
src/ui/screens/wizard.ts:
  function runSetupWizardView(...)
src/ui/screens/model-manager.ts:
  function runModelManagerView(...)
src/ui/screens/provider-manager.ts:
  function runProviderManagerView(...)
src/ui/assistant/simple.ts:
  function attachSimpleLogger(...)
src/app/mentions.ts:
  function parseMentions(...)
  function resolveMentionContent(...)
  function expandMentions(...)
test/helpers/capture.ts:
  function captureOutput(...)
```

## Konvensi
- Ikuti gaya kode existing.
- Jalankan typecheck/test sebelum menyatakan selesai.
- **Arah dependensi**: `cli/` boleh mengimpor `src/ui/` dan `src/`; `src/`
  non-ui DILARANG mengimpor `src/ui/`; `src/ui/` DILARANG mengimpor `cli/`,
  `src/` non-ui, atau `#minicore`. UI adalah presentation layer mandiri —
  komunikasi lewat kontrak (`src/ui/contract.ts`) dan callback yang
  di-inject dari `cli/` (composition root: `cli/index.ts` & `cli/setup.ts`).
  Penjaganya: `test/ui-boundary.test.ts`.
- **DI lintas lapisan**: kebutuhan lintas-lapisan disuntikkan dari composition
  root, bukan diimpor langsung — `ask` (approval), `setupWhenEmpty` (wizard),
  `setSubAgentSessionFactory` (delegate_task; `src/tools/` tidak boleh
  mengimpor lapisan app/sesi). Tanpa injeksi default selalu aman (deny /
  fail-closed). Arah `providers → config` satu arah: provisioning provider
  hidup di `src/providers/provision.ts`, `src/config.ts` murni IO config.
- **Output shell-first**: tidak ada alternate screen (?1049h), redraw penuh,
  atau modal overlay — output mengalir append-only ke scrollback dan scrollback
  adalah satu-satunya transcript (REPL: `cli/repl.ts` loop `askLine` + printer
  `src/ui/assistant/simple.ts`). Tool call inline & expanded by default;
  compact = opt-in (`MINICODE_COMPACT=1`, `/compact`, Ctrl+O). Layar
  interaktif (manager/wizard/picker) transient — menghapus diri sendiri,
  tidak menyentuh scrollback.
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

`c` dan `glyphs` di `src/ui/render/theme.ts` adalah **getter** yang membaca state
runtime (tema aktif, dukungan UTF-8, `NO_COLOR`). Menyimpannya ke `const` di
module scope membekukan nilainya saat import — `/theme` pernah tidak berefek
apa pun karena ini, dua kali. Lihat PLAN.md P0.1.

Lebar teks di terminal diukur dalam **kolom**, bukan karakter: pakai
`displayWidth`/`truncateToWidth`/`padToWidth` dari `src/ui/render/width.ts`, jangan
`.length` atau `.slice()`. CJK dan emoji memakan dua kolom.

Teks dari model, hasil tool, dan isi berkas adalah masukan **tidak terpercaya**:
lewatkan `sanitizeAnsi` (`src/ui/render/sanitize.ts`) sebelum ditampilkan. Tanpa itu
model bisa membersihkan layar atau keluar dari alternate screen.
