// Setup CLI: orchestrator thin - delegates to src/app/* layers

import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import type { Message, Session, Tool } from "#minicore"
import { createProviderLayer } from "../src/app/provider-layer.ts"
import { createRagLayer } from "../src/app/rag-layer.ts"
import { createMinicodeSession, type PermissionControl } from "../src/app/session.ts"
import { setupToolLayer } from "../src/app/tool-layer.ts"
import type { MinicodeConfig } from "../src/config.ts"
import { loadLastModel } from "../src/config.ts"
import { runRunHooks } from "../src/hooks/run.ts"
import { homeDir } from "../src/lib/db-path.ts"
import { closeAllLsp as lspCloseAll } from "../src/lsp/client.ts"
import { closeAll as mcpCloseAll } from "../src/mcp/client.ts"
import { addMemory } from "../src/memory/vector.ts"
import { createLlmCompaction } from "../src/policy/compaction.ts"
import type { RateLimiter } from "../src/policy/ratelimit.ts"
import { createUsageCollector, primePricing } from "../src/policy/usage.ts"
import {
  buildBaselineNote,
  buildVerifySnippet,
  checkBaseline,
  detectVerifyCommand,
  runVerify,
  runWithSelfHeal,
} from "../src/policy/verifier.ts"
import {
  beginTurnSnapshot,
  recordCheckpointFromSnapshots,
  recordCheckpointFromTrees,
  snapshotWorkspace,
  validateResumeWorkspace,
} from "../src/session/checkpoint.ts"
import { loadSession, saveSession } from "../src/session/persistence.ts"
import { snapshotTree } from "../src/session/shadow-git.ts"
import type { Skill } from "../src/skills/loader.ts"
import { classifyToolResult, summarizeArgs, writeStepTrace } from "../src/telemetry/trace.ts"
import { setAskTextFn } from "../src/tools/ask_user.ts"
import { killAllBackgroundJobs } from "../src/tools/bash.ts"
import { todoSession } from "../src/tools/todo.ts"
import { promptAsk, promptAskText } from "../src/ui/approval/prompt.ts"
import { attachSimpleLogger } from "../src/ui/assistant/simple.ts"
import { c } from "../src/ui/render/theme.ts"
import { runSetupWizard } from "./wizard.ts"

export interface CliSessionOptions {
  cwd?: string
  sessionId: string
  resumeId?: string
  modelOverride?: string
  providerOverride?: string
  prompt: string
  enterRepl: boolean
  verbose: boolean
  allowAll: boolean
  ask: boolean
  plan: boolean
  allowlist: boolean
  verify: boolean
  budget?: number
  /** Harness-P1: fail-closed bila cost sesi tak dikenal (model tanpa harga). */
  budgetStrict?: boolean
  /** Harness-P2: scope tool sesi — explore = subset read-only. */
  toolScope?: "full" | "explore"
  maxSteps?: number
  contextWindowTokens?: number
  timeoutMs?: number
  rateLimiter?: RateLimiter
  concurrency?: number
  writeConcurrency?: number
  /** Notice sandbox — hanya bila user eksplisit meminta mode (flag/env tak
   * kosong): mis. daemon tak tersedia atau mode tak dikenal. Notice rutin
   * (auto-os / auto-allowlist) sengaja disembunyikan: mode sudah terlihat di
   * prefiks prompt. Dicetak di sini (setelah provider layer lolos) supaya
   * invokasi yang mati sebelumnya tetap senyap. */
  sandboxNotice?: string
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
  budgetStrict?: boolean
  /** P2.3: jumlah hit RAG memory yang di-inject ke system prompt sesi ini. */
  memoryHits: number
  detachSimple: () => void
  persistCurrent: (usageData: unknown) => Promise<void>
  runPromptWithVerify: (prompt: string, signal?: AbortSignal) => Promise<void>
  /** Kontrol mode permission saat runtime (Shift+Tab / /mode di REPL). */
  permissions?: PermissionControl
  close: () => Promise<void>
}

export async function createCliSession(opts: CliSessionOptions): Promise<CliSession> {
  const {
    cwd,
    sessionId,
    resumeId,
    modelOverride,
    providerOverride,
    prompt,
    enterRepl,
    verbose,
    allowAll,
    ask,
    plan,
    allowlist,
    verify,
    budget,
    budgetStrict,
    toolScope,
    maxSteps,
    contextWindowTokens,
    timeoutMs,
    rateLimiter,
    sandboxNotice,
  } = opts
  const modelRef = { current: modelOverride }

  // Timeout default: --timeout > MINICODE_TIMEOUT_MS env > 15 min. 0 = Infinity.
  const envTimeout = process.env.MINICODE_TIMEOUT_MS
  let effectiveTimeoutMs =
    timeoutMs ?? (envTimeout != null && envTimeout !== "" ? Number(envTimeout) : 900_000)
  if (!Number.isFinite(effectiveTimeoutMs) || effectiveTimeoutMs < 0) {
    process.stderr.write(`[warn] invalid timeout ${effectiveTimeoutMs}, fallback to 900000\n`)
    effectiveTimeoutMs = 900_000
  }

  const permissionMode = allowAll
    ? "allow-all"
    : ask
      ? "ask"
      : plan
        ? "plan"
        : allowlist
          ? "allowlist"
          : "auto"

  // Home guard: sesi dibuka di home berisiko (glob rame, write berbahaya).
  // Standar industri: percaya-tapi-ingatkan, jangan tolak diam-diam maupun
  // pindahkan workspace (menyesatkan resume/checkpoint).
  try {
    const home = homeDir()
    const cur = resolvePath(cwd ?? process.cwd())
    if (resolvePath(home) === cur) {
      process.stderr.write(
        c.yellow(
          `[warn] workspace is home directory — consider --cwd <project> to avoid scanning the entire home\n`,
        ),
      )
    }
  } catch {}

  const { cfg, router } = await createProviderLayer({
    cwd,
    prompt,
    enterRepl,
    rateLimiter,
    providerOverride,
    setupWhenEmpty: runSetupWizard,
  })
  if (sandboxNotice && !plan) process.stderr.write(`${sandboxNotice}\n`)
  // Default model = terakhir dipakai (global), bila tanpa --model dan masih
  // ada di config. Flag selalu menang; tak ada simpanan = provider pertama.
  if (!modelRef.current) {
    const saved = await loadLastModel().catch(() => undefined)
    if (saved && cfg.providers.some((p) => p.models.some((m) => `${p.id}::${m}` === saved))) {
      modelRef.current = saved
    }
  }
  const {
    systemExtra,
    skills: allLoadedSkills,
    memoryHits,
  } = await createRagLayer({ cfg, prompt, cwd })

  // resume: load full history from DB -> seed into kernel ContextStore
  let initialMessages: readonly Message[] | undefined
  let resumeTurnCount: number | undefined
  if (resumeId) {
    try {
      const prev = loadSession(resumeId, cwd)
      if (prev?.messages.length) {
        initialMessages = prev.messages as readonly Message[]
        resumeTurnCount = prev.turnCount
        console.error(c.dim(`[resumed session ${resumeId} (${prev.messages.length} messages)]\n`))
        // P3 — validasi resume: bukan replay buta. Bila workspace berubah
        // sejak checkpoint terakhir (edit manual / run lain), beri tahu —
        // /undo tersedia bila perlu kembali. Best-effort, tak menggagalkan resume.
        const div = await validateResumeWorkspace(cwd ?? ".", resumeId).catch(() => null)
        if (div && div.diverged > 0) {
          console.error(
            c.yellow(
              `[resume] workspace berubah sejak checkpoint terakhir (${div.diverged} file) — /undo tersedia bila perlu kembali\n`,
            ),
          )
        }
      } else {
        console.error(
          c.yellow(`[resume] session ${resumeId} not found - starting new ${sessionId}\n`),
        )
      }
    } catch (e) {
      process.stderr.write(`[warn] resume failed: ${(e as Error).message}\n`)
    }
  }

  const compaction = process.env.DEEPSEEK_API_KEY
    ? createLlmCompaction({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      })
    : undefined

  const { sessionTools } = await setupToolLayer(cfg, toolScope ?? "full", permissionMode)

  // todo_write/todo_read menyimpan state per sesi di .minicode/todos/<id>.json
  todoSession.id = sessionId
  todoSession.cwd = cwd
  // View pertanyaan ask_user — composition root meng-inject, tool menolak
  // jalan tanpanya (fail-closed, sama seperti `ask` pada permission).
  setAskTextFn(promptAskText)

  let permissions: PermissionControl | undefined
  // Validasi concurrency: 0, NaN, Infinity → fallback ke default (jangan teruskan 0 ke executor)
  const safeConcurrency = (() => {
    const v = opts.concurrency
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined
  })()
  const safeWriteConcurrency = (() => {
    const v = opts.writeConcurrency
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined
  })()
  const session = await createMinicodeSession({
    provider: router,
    tools: sessionTools,
    cwd,
    permissionMode,
    systemExtra,
    model: modelRef.current,
    ask: promptAsk,
    onPermissions: (ctl) => {
      permissions = ctl
    },
    ...(initialMessages ? { initialMessages } : {}),
    ...(resumeTurnCount !== undefined ? { turnCount: resumeTurnCount } : {}),
    ...(maxSteps ? { maxSteps } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(safeConcurrency ? { concurrency: safeConcurrency } : {}),
    ...(safeWriteConcurrency ? { writeConcurrency: safeWriteConcurrency } : {}),
    timeoutMs: effectiveTimeoutMs === 0 ? Infinity : effectiveTimeoutMs,
    ...(compaction ? { compaction } : {}),
  })

  const effectiveInitialModel = modelRef.current ?? cfg.providers[0]?.models[0] ?? "default"

  // ── Shadow checkpoint ──
  // Repo git: simpan SHA tree pre/post turn (O(delta), tanpa cap file, tidak
  // menyentuh index/HEAD user). Non-repo: fallback snapshot isi file seperti
  // sebelumnya. Keduanya menangkap perubahan dari bash/git juga, bukan cuma
  // edit/write_file.
  type TurnSnapshot = Awaited<ReturnType<typeof beginTurnSnapshot>>
  let preTurnPromise: Promise<TurnSnapshot> | null = null
  const postEditSnapshots = new Map<string, { path: string; content: string | null }>()
  session.events.on("turn:started", () => {
    preTurnPromise = beginTurnSnapshot(sessionId, cwd ?? ".")
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
    const pre = await preTurnPromise
    const redoSnapshots = [...postEditSnapshots.values()]
    preTurnPromise = null
    postEditSnapshots.clear()
    if (!pre) return
    const turn = e.result.usage.turns
    const desc = `turn ${turn}`
    if (pre.mode === "git") {
      // Tree post-turn diambil sekarang, setelah semua tool selesai.
      const after = await snapshotTree(cwd ?? ".", sessionId, `post-${turn}`)
      recordCheckpointFromTrees(sessionId, turn, pre.tree, after?.tree, desc, cwd).catch(() => {})
      return
    }
    if (pre.snapshots.length === 0) return
    // Non-git: redo harus menangkap SEMUA perubahan termasuk bash/git,
    // bukan hanya edit/write_file. Ambil snapshot penuh post-turn.
    let redo = redoSnapshots
    try {
      const { LIMITS } = await import("../src/constants.ts")
      const post = await snapshotWorkspace(cwd ?? ".", LIMITS.WORKSPACE_SNAPSHOT_LIMIT)
      if (post.length) redo = post
    } catch {}
    recordCheckpointFromSnapshots(sessionId, turn, pre.snapshots, desc, cwd, redo).catch(() => {})
  })

  // ── Step trace (Harness-P1) ──
  // Satu baris per tool + ringkasan per step ke .minicode/step-traces.jsonl.
  // Fire-and-forget: observability tak boleh menggagalkan turn (bus kernel
  // juga mengisolasi listener yang melempar). Deny diklasifikasi dari isi
  // observasi karena kernel hanya meng-emit execution:* untuk call yang lolos.
  const toolStarts = new Map<string, number>()
  session.events.on("execution:started", (e) => {
    try {
      toolStarts.set(e.execution.call.id, Date.now())
    } catch {}
  })
  session.events.on("execution:completed", (e) => {
    try {
      const { call, result } = e.execution
      const t0 = toolStarts.get(call.id)
      if (t0 !== undefined) toolStarts.delete(call.id)
      const kind = classifyToolResult(result)
      void writeStepTrace(cwd, {
        sessionId,
        timestamp: new Date().toISOString(),
        kind: "tool",
        step: session.state.stepCount,
        tool: call.name,
        ok: kind === "ok",
        ...(kind === "denied" ? { denied: true } : {}),
        ...(t0 !== undefined ? { durationMs: Date.now() - t0 } : {}),
        args: summarizeArgs(call.args),
        sandbox: process.env.MINICODE_SANDBOX ?? "none",
      }).catch(() => {})
    } catch {}
  })
  session.events.on("step:completed", (e) => {
    try {
      const s = e.step
      void writeStepTrace(cwd, {
        sessionId,
        timestamp: new Date().toISOString(),
        kind: "step",
        step: s.index,
        tools: s.toolCalls.length,
        errors: s.results.filter((r) => r.isError).length,
        sandbox: process.env.MINICODE_SANDBOX ?? "none",
      }).catch(() => {})
    } catch {}
  })

  // ── Auto-verify & self-heal ──
  const verifyCommand = verify
    ? (process.env.MINICODE_VERIFY_CMD ?? cfg.verifyCommand ?? detectVerifyCommand(cwd) ?? "")
    : ""
  const verifyActive = verifyCommand.length > 0

  async function runPromptWithVerify(p: string, signal?: AbortSignal): Promise<void> {
    await runRunHooks("pre", { phase: "pre", prompt: p, cwd })
    if (!verifyActive) {
      await session.run(p, { model: modelRef.current, signal })
      await runRunHooks("post", { phase: "post", prompt: p, cwd, result: session.state.turnCount })
      return
    }
    // P2.1 — baseline-first: bila baseline sudah merah sebelum agen menyentuh
    // apa pun, tempelkan catatan agar agen memperbaiki dulu, bukan menumpuk
    // fitur di atas baseline rusak (yang hanya memperparah keadaan).
    let firstPrompt = p
    const broken = await checkBaseline(() => runVerify(verifyCommand, cwd ?? process.cwd()))
    if (broken) {
      process.stderr.write(
        c.yellow(`\n[verify] baseline failing before agent run - fixing first\n`),
      )
      firstPrompt = buildBaselineNote(broken) + p
    }
    await runWithSelfHeal(firstPrompt, {
      run: async (prompt) => {
        await session.run(prompt, { model: modelRef.current, signal })
      },
      verify: () => runVerify(verifyCommand, cwd ?? process.cwd()),
      onCycle: (cycle, max, v) => {
        if (cycle === max) {
          process.stderr.write(
            c.red(`\n[verify] still failing after ${max} attempts - leaving for user\n`),
          )
          process.stderr.write(`${v.output.slice(0, 1200)}\n`)
        } else {
          process.stderr.write(
            c.yellow(`\n[verify] attempt ${cycle}/${max} failed - self-healing…\n`),
          )
        }
      },
      onOk: (cycles) => {
        process.stderr.write(c.green(`\n[verify] ok after ${cycles} fix cycles\n`))
        // P13 P1 — turn yang lolos verify adalah bukti cara kerja yang valid:
        // simpan ringkasnya sebagai snippet (opt-out sama seperti summary).
        // Fire-and-forget: memori tak boleh menggagalkan run yang sudah hijau.
        if (process.env.MINICODE_AUTO_MEMORY !== "0") {
          void addMemory(buildVerifySnippet(p, verifyCommand, session.state.turnCount), {
            category: "snippet",
            cwd: cwd ?? process.cwd(),
          }).catch(() => {})
        }
      },
    })
    await runRunHooks("post", { phase: "post", prompt: p, cwd, result: session.state.turnCount })
  }

  // Printer linier + status turn: dipakai one-shot DAN REPL linier — tidak ada
  // sudah tidak ada, jadi tidak ada lagi jalur renderer kedua untuk dibedakan.
  const detachSimple = attachSimpleLogger(session.events, { verbose })
  const { attachTurnStatus } = await import("../src/ui/assistant/turn-status.ts")
  const { formatUsd } = await import("../src/ui/render/money.ts")
  const usage = createUsageCollector(session.events, effectiveInitialModel)
  // Statusline kaya = opt-in (default mati, shell tetap bersih). Data biaya
  // disuntik sebagai callback agar UI tak mengimpor lapisan policy.
  const richStatus = process.env.MINICODE_STATUSLINE === "rich"
  const detachStatus = attachTurnStatus(session.events, {
    initialModel: effectiveInitialModel,
    getModel: () => modelRef.current ?? effectiveInitialModel,
    ...(richStatus
      ? {
          getStats: () => {
            const u = usage.getSession(modelRef.current)
            return `${u.totalTokens.toLocaleString()} tok${u.cost != null ? ` · ${formatUsd(u.cost)}` : ""}`
          },
        }
      : {}),
  })
  // Muat overlay harga dari cache lokal (bila user pernah `pricing sync`).
  // Tidak ada request jaringan di sini — hanya baca berkas.
  void primePricing()

  async function persistCurrent(usageData: unknown) {
    try {
      await saveSession(sessionId, cwd, undefined, session.state.history, usageData)
      if (resumeId) await saveSession(resumeId, cwd, undefined, session.state.history, usageData)
    } catch {}
  }

  async function close(): Promise<void> {
    detachStatus()
    detachSimple()
    // background job harus mati bersama CLI — jangan tinggalkan proses yatim
    killAllBackgroundJobs()
    await mcpCloseAll()
    await lspCloseAll()
  }

  return {
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
    budgetStrict,
    memoryHits,
    detachSimple,
    persistCurrent,
    runPromptWithVerify,
    permissions,
    close,
  }
}
