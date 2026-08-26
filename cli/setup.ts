// Setup CLI: orchestrator thin - delegates to src/app/* layers

import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import type { Message, Session, Tool } from "minicore"
import { createProviderLayer } from "../src/app/provider-layer.ts"
import { createRagLayer } from "../src/app/rag-layer.ts"
import { setupToolLayer } from "../src/app/tool-layer.ts"
import type { MinicodeConfig } from "../src/config.ts"
import { closeAllLsp as lspCloseAll } from "../src/lsp/client.ts"
import { closeAll as mcpCloseAll } from "../src/mcp/client.ts"
import { createLlmCompaction } from "../src/policy/compaction.ts"
import type { RateLimiter } from "../src/policy/ratelimit.ts"
import { createUsageCollector } from "../src/policy/usage.ts"
import { detectVerifyCommand, runVerify, runWithSelfHeal } from "../src/policy/verifier.ts"
import { recordCheckpointFromSnapshots, snapshotWorkspace } from "../src/session/checkpoint.ts"
import { loadSession, saveSession } from "../src/session/persistence.ts"
import { createMinicodeSession } from "../src/session.ts"
import type { Skill } from "../src/skills/loader.ts"
import { attachRenderer } from "../src/tui/renderer.ts"
import { c } from "../src/tui/theme.ts"

export interface CliSessionOptions {
  ui?: "auto" | "full" | "classic"
  cwd?: string
  sessionId: string
  resumeId?: string
  modelOverride?: string
  prompt: string
  enterRepl: boolean
  verbose: boolean
  allowAll: boolean
  ask: boolean
  plan: boolean
  allowlist: boolean
  useTui: boolean
  verify: boolean
  budget?: number
  maxSteps?: number
  contextWindowTokens?: number
  timeoutMs?: number
  rateLimiter?: RateLimiter
}

export interface CliSession {
  session: Session
  cfg: MinicodeConfig
  cwd?: string
  sessionId: string
  modelRef: { current?: string }
  effectiveInitialModel: string
  effectiveTimeoutMs: number
  permissionMode: string
  sessionTools: Tool[]
  allLoadedSkills: Skill[]
  usage: ReturnType<typeof createUsageCollector>
  budget?: number
  detachInk?: () => void
  persistCurrent: (usageData: unknown) => Promise<void>
  useFullscreen: boolean
  runPromptWithVerify: (prompt: string, signal?: AbortSignal) => Promise<void>
  close: () => Promise<void>
}

export async function createCliSession(opts: CliSessionOptions): Promise<CliSession> {
  const {
    cwd,
    sessionId,
    resumeId,
    modelOverride,
    prompt,
    enterRepl,
    verbose,
    allowAll,
    ask,
    plan,
    allowlist,
    useTui,
    verify,
    budget,
    maxSteps,
    contextWindowTokens,
    timeoutMs,
    rateLimiter,
  } = opts
  const modelRef = { current: modelOverride }

  // Timeout default: --timeout > MINICODE_TIMEOUT_MS env > 15 min. 0 = Infinity.
  const envTimeout = process.env.MINICODE_TIMEOUT_MS
  const effectiveTimeoutMs =
    timeoutMs ?? (envTimeout != null && envTimeout !== "" ? Number(envTimeout) : 900_000)

  const { cfg, router } = await createProviderLayer({ cwd, prompt, enterRepl, rateLimiter })
  const { systemExtra, skills: allLoadedSkills } = await createRagLayer({ cfg, prompt, cwd })

  // resume: load full history from DB -> seed into kernel ContextStore
  let initialMessages: readonly Message[] | undefined
  if (resumeId) {
    const prev = loadSession(resumeId, cwd)
    if (prev && prev.messages.length) {
      initialMessages = prev.messages as readonly Message[]
      console.error(c.dim(`[resumed session ${resumeId} (${prev.messages.length} messages)]\n`))
    } else {
      console.error(
        c.yellow(`[resume] session ${resumeId} not found - starting new ${sessionId}\n`),
      )
    }
  }

  const compaction = process.env.DEEPSEEK_API_KEY
    ? createLlmCompaction({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      })
    : undefined

  const { sessionTools } = await setupToolLayer(cfg)

  const permissionMode = allowAll
    ? "allow-all"
    : ask
      ? "ask"
      : plan
        ? "plan"
        : allowlist
          ? "allowlist"
          : "auto"

  const session = await createMinicodeSession({
    provider: router,
    tools: sessionTools,
    cwd,
    permissionMode,
    systemExtra,
    model: modelRef.current,
    ...(initialMessages ? { initialMessages } : {}),
    ...(maxSteps ? { maxSteps } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    timeoutMs: effectiveTimeoutMs === 0 ? Infinity : effectiveTimeoutMs,
    ...(compaction ? { compaction } : {}),
  })

  const effectiveInitialModel = modelRef.current ?? cfg.providers[0]?.models[0] ?? "default"

  // ── Shadow checkpoint ──
  // Pre-turn: snapshot seluruh workspace (menangkap perubahan bash/git, bukan cuma
  // edit/write_file). Post-edit: untuk /redo, dari tool yang mengubah file.
  let preTurnPromise: Promise<Awaited<ReturnType<typeof snapshotWorkspace>>> | null = null
  const postEditSnapshots = new Map<string, { path: string; content: string | null }>()
  session.events.on("turn:started", () => {
    preTurnPromise = snapshotWorkspace(cwd ?? ".", 200)
  })
  session.events.on("execution:completed", (e) => {
    const name = e.execution.call.name
    if (name !== "edit" && name !== "write_file" && name !== "apply_patch") return
    const p = (e.execution.call.args as { path?: string })?.path
    if (!p) return
    const abs = resolvePath(cwd ?? ".", p)
    try {
      postEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content: readFileSync(abs, "utf8") })
    } catch {
      postEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content: null })
    }
  })
  session.events.on("turn:completed", async (e) => {
    const snapshots = (await preTurnPromise) ?? []
    const redoSnapshots = [...postEditSnapshots.values()]
    preTurnPromise = null
    postEditSnapshots.clear()
    if (snapshots.length === 0) return
    recordCheckpointFromSnapshots(
      sessionId,
      e.result.usage.turns,
      snapshots,
      `turn ${e.result.usage.turns}`,
      cwd,
      redoSnapshots,
    ).catch(() => {})
  })

  // ── Auto-verify & self-heal ──
  const verifyCommand = verify
    ? (process.env.MINICODE_VERIFY_CMD ?? cfg.verifyCommand ?? detectVerifyCommand(cwd) ?? "")
    : ""
  const verifyActive = verifyCommand.length > 0

  async function runPromptWithVerify(p: string, signal?: AbortSignal): Promise<void> {
    if (!verifyActive) {
      await session.run(p, { model: modelRef.current, signal })
      return
    }
    await runWithSelfHeal(p, {
      run: (prompt) => session.run(prompt, { model: modelRef.current, signal }),
      verify: () => runVerify(verifyCommand, cwd ?? process.cwd()),
      onCycle: (cycle, max, v) => {
        if (cycle === max) {
          process.stderr.write(
            c.red(`\n[verify] still failing after ${max} attempts - leaving for user\n`),
          )
          process.stderr.write(v.output.slice(0, 1200) + "\n")
        } else {
          process.stderr.write(
            c.yellow(`\n[verify] attempt ${cycle}/${max} failed - self-healing…\n`),
          )
        }
      },
      onOk: (cycles) => process.stderr.write(c.green(`\n[verify] ok after ${cycles} fix cycles\n`)),
    })
  }

  const useFullscreen = !!enterRepl // classic REPL sudah dihapus - satu jalur UI
  // ── renderer ──
  // Ink butuh TTY (raw mode) - di non-TTY fallback ke renderer ANSI.
  const useInk = useTui && !enterRepl && !!prompt && !!process.stdout.isTTY && !useFullscreen
  let detachInk: (() => void) | undefined
  if (useInk) {
    try {
      // Lazy: ink/react hanya di-bundle saat --tui benar-benar dipakai.
      const { attachInkRenderer } = await import("../src/tui/ink.tsx")
      detachInk = attachInkRenderer(session.events, {
        verbose,
        model: effectiveInitialModel,
        budget,
      })
    } catch {
      attachRenderer(session.events, { verbose })
    }
  } else if (!useFullscreen) {
    attachRenderer(session.events, { verbose })
  }
  // Turn status line (spinner + model) - hanya membuat repot saat interaktif
  // non-verbose; di one-shot output tetap di stderr.
  const { attachTurnStatus } = await import("../src/tui/turn-status.ts")
  const detachStatus = useFullscreen ? () => {} : attachTurnStatus(session.events, {
    initialModel: effectiveInitialModel,
    getModel: () => modelRef.current ?? effectiveInitialModel,
  })

  const usage = createUsageCollector(session.events, effectiveInitialModel)

  async function persistCurrent(usageData: unknown) {
    try {
      saveSession(sessionId, cwd, undefined, session.state.history, usageData)
      if (resumeId) saveSession(resumeId, cwd, undefined, session.state.history, usageData)
    } catch {}
  }

  async function close(): Promise<void> {
    detachStatus()
    if (detachInk) detachInk()
    await mcpCloseAll()
    await lspCloseAll()
  }

  return {
    useFullscreen,
    session,
    cfg,
    cwd,
    sessionId,
    modelRef,
    effectiveInitialModel,
    effectiveTimeoutMs,
    permissionMode,
    sessionTools,
    allLoadedSkills,
    usage,
    budget,
    detachInk,
    persistCurrent,
    runPromptWithVerify,
    close,
  }
}
