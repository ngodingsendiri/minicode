#!/usr/bin/env bun
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { createRateLimiter } from "../src/policy/ratelimit.ts"
import { resolveSandbox } from "../src/policy/sandbox-policy.ts"
import { createMinicodeSession } from "../src/session.ts"
import { findSkill, renderSkill } from "../src/skills/loader.ts"
import { writeTrace } from "../src/telemetry/trace.ts"
import { setSubAgentSessionFactory } from "../src/tools/task.ts"
import { formatError } from "../src/ui/assistant/simple.ts"
import { formatUsd } from "../src/ui/render/money.ts"
import { c, glyphs } from "../src/ui/render/theme.ts"
import { promptFromArgs, getArg as rawGetArg, readPrompt } from "./args.ts"
import { dispatch } from "./router.ts"
import { createCliSession } from "./setup.ts"

/** Versi dibaca dari package.json — satu sumber, tidak di-hardcode dua tempat. */
function readVersion(): string {
  try {
    const pkgPath = resolvePath(import.meta.dir, "..", "package.json")
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

const HELP = `Minicode - coding agent on frozen MiniCore
Usage:
  minicode                        # interactive chat
  minicode "prompt" [options]     # one-shot run
  minicode exec "prompt" [--json] # headless CI mode (Codex/Gemini-like, JSON stream)
  echo "prompt" | minicode        # via pipe
  minicode sync                   # refresh models from all providers
Options:
  -h, --help          show help
  -v, --version       show version
  --verbose           show reasoning & usage
  --cwd <dir>         workspace root (default .)
  --resume <id>       resume session id
  --model <name>      override model (provider::model)
  --provider <id>     force provider id
  --session <id>      session id (default random)
  --allow-all         allow all tools (no sandbox)
  --ask               ask per tool (y/n/a) - human-in-loop
  --plan              read-only mode (no file writes / bash / sub-agents)
  --allowlist         bash allowlist only (git/bun/npm safe cmds; via MINICODE_BASH_ALLOWLIST)
  --max-steps <n>     max tool steps (default 50)
  --context-window <n> context window tokens
  --timeout <ms>      hard deadline per run (default 600000 = 10min; 0 = Infinity)
  --interactive       REPL loop (fullscreen)
  --verify            auto-verify after run + self-heal (uses typecheck/test/tsconfig)
  --sandbox <mode>    bash sandbox: docker (ephemeral container, --network none)
  --ratelimit <rpm>   limit LLM requests per minute (token bucket) to avoid 429
  --budget <usd>      session cost limit (USD)

Commands in REPL:
  /help /provider /model /sync /status /sessions /init /exit

Keyboard in REPL:
  Enter submit · Tab complete · Up/Down history · Esc stop · Ctrl+C twice exit
  akhiri baris dengan \\ untuk menyambung
`

const args = process.argv.slice(2)
function getArg(name: string): string | undefined {
  return rawGetArg(args, name)
}

// DI factory sesi sub-agen untuk delegate_task — dipasang di composition root
// sebelum dispatch agar semua jalur (REPL, one-shot, mcp serve) tercakup.
setSubAgentSessionFactory(createMinicodeSession)

// dispatch subcommands via registry (handlers call process.exit internally)
await dispatch(args, getArg, HELP)

if (args.includes("-v") || args.includes("--version")) {
  console.log(readVersion())
  process.exit(0)
}

if (args.includes("-h") || args.includes("--help")) {
  if (args.includes("--json")) {
    // machine-readable help for CI (minicode --help --json)
    console.log(
      JSON.stringify({
        name: "minicode",
        version: readVersion(),
        usage: [
          "minicode",
          'minicode "prompt" [options]',
          'minicode exec "prompt" [--json]',
          "minicode providers|models|sync|config|mcp|skills|sessions|stats",
        ],
        options: [
          { flag: "--version", desc: "show version" },
          { flag: "--verbose", desc: "show reasoning & usage" },
          { flag: "--cwd <dir>", desc: "workspace root" },
          { flag: "--resume <id>", desc: "resume session id" },
          { flag: "--model <name>", desc: "override model (provider::model)" },
          { flag: "--provider <id>", desc: "force provider id" },
          { flag: "--allow-all", desc: "allow all tools (no sandbox)" },
          { flag: "--ask", desc: "ask per tool" },
          { flag: "--plan", desc: "read-only plan mode" },
          { flag: "--allowlist", desc: "bash allowlist only" },
          { flag: "--max-steps <n>", desc: "max tool steps (default 50)" },
          { flag: "--timeout <ms>", desc: "hard deadline per run" },
          { flag: "--theme <name>", desc: "dark|dim|light|mono" },
          { flag: "--verify", desc: "auto-verify + self-heal" },
          { flag: "--sandbox <docker|os>", desc: "bash sandbox" },
          { flag: "--ratelimit <rpm>", desc: "LLM requests/min" },
          { flag: "--budget <usd>", desc: "session cost limit" },
        ],
      }),
    )
    process.exit(0)
  }
  console.log(HELP)
  process.exit(0)
}

// -- flag parsing --
const verbose = args.includes("--verbose")
const allowAll = args.includes("--allow-all")
const ask = args.includes("--ask")
const interactive = args.includes("--interactive")
const plan = args.includes("--plan") || process.env.MINICODE_PLAN === "1"
const allowlist = args.includes("--allowlist") || process.env.MINICODE_PERMISSION === "allowlist"
const verify = args.includes("--verify")
const cwdRaw = getArg("--cwd")
const cwd = cwdRaw ? resolvePath(cwdRaw) : undefined
const resumeId = getArg("--resume")
const modelOverride = getArg("--model")
const providerOverride = getArg("--provider")
const sessionId = getArg("--session") ?? randomUUID().slice(0, 8)
const maxStepsRaw = getArg("--max-steps")
const maxSteps = maxStepsRaw ? Number(maxStepsRaw) : undefined
const ctxWindowRaw = getArg("--context-window")
const contextWindowTokens = ctxWindowRaw ? Number(ctxWindowRaw) : undefined
const timeoutRaw = getArg("--timeout")
const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined

// Sandbox: OS-native dipakai otomatis bila tersedia. Bila tidak ada isolasi
// nyata dan user belum memilih mode permission sendiri, default diturunkan ke
// `allowlist` — lebih baik membatasi perintah daripada menjalankan apa pun
// sambil menampilkan label aman. Lihat src/policy/sandbox-policy.ts.
const explicitPermission = allowAll || ask || plan || allowlist
const sandbox = resolveSandbox(
  getArg("--sandbox") ?? process.env.MINICODE_SANDBOX,
  explicitPermission,
)
if (sandbox.mode === "none") delete process.env.MINICODE_SANDBOX
else process.env.MINICODE_SANDBOX = sandbox.mode
// Notice sandbox hanya relevan bila sesi ini berpotensi menjalankan perintah.
// Sebelumnya ia dicetak untuk SETIAP invokasi di Windows, termasuk yang tidak
// menyentuh tool sama sekali — kebisingan di setiap baris perintah.
const willRunTools = !args.includes("--plan")
if (sandbox.notice && willRunTools) process.stderr.write(`${sandbox.notice}\n`)
const effectiveAllowlist = allowlist || sandbox.fallbackPermission === "allowlist"
const budgetRaw = getArg("--budget")
const budget = budgetRaw ? Number(budgetRaw) : undefined
if (budgetRaw && !Number.isFinite(budget))
  process.stderr.write(`[warn] --budget requires a USD number, ignoring "${budgetRaw}"\n`)
const ratelimitRaw = getArg("--ratelimit")
const rateLimiter = ratelimitRaw ? createRateLimiter(Number(ratelimitRaw)) : undefined
const { applyTheme } = await import("../src/ui/render/theme.ts")
applyTheme("dark")

const prompt = promptFromArgs(args) || (await readPrompt())
const enterRepl = interactive || (!prompt && process.stdin.isTTY)
if (!prompt && !enterRepl) {
  process.stderr.write('usage: minicode "prompt"  |  minicode (interactive mode)\n')
  process.exit(1)
}

// -- skills: expand /name args --
let effectivePrompt = prompt
try {
  if (prompt.startsWith("/")) {
    const spaceIdx = prompt.indexOf(" ")
    const skillName = spaceIdx === -1 ? prompt.slice(1) : prompt.slice(1, spaceIdx)
    const skillArgs = spaceIdx === -1 ? "" : prompt.slice(spaceIdx + 1)
    const skill = await findSkill(skillName, cwd)
    if (skill) {
      effectivePrompt = await renderSkill(skill, skillArgs)
      console.error(c.dim(`[loaded skill /${skill.name}]`))
    }
  }
} catch {}

// -- build session --
const ctx = await createCliSession({
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
  allowlist: effectiveAllowlist,
  verify,
  budget,
  maxSteps,
  contextWindowTokens,
  timeoutMs,
  rateLimiter,
})

if (enterRepl) {
  const { runFullscreen } = await import("./fullscreen-driver.ts")
  await runFullscreen(ctx)
} else {
  const {
    session,
    usage,
    modelRef,
    budget: b,
    cwd: wcwd,
    sessionId: sid,
    persistCurrent,
    runPromptWithVerify,
    close,
  } = ctx
  const t0 = Date.now()
  try {
    await runPromptWithVerify(effectivePrompt)
    // Total SESI, bukan turn: satu one-shot hanya punya satu turn, tapi
    // --verify/self-heal bisa menjalankan beberapa dan reset() di antaranya.
    const u = usage.getSession(modelRef.current)
    let overBudget = false
    if (b != null && u.cost != null) {
      if (u.cost > b) {
        process.stderr.write(
          c.red(`[budget] ${formatUsd(u.cost)} > ${formatUsd(b)} - lewat batas, berhenti.\n`),
        )
        overBudget = true
      } else if (u.cost > b * 0.8)
        process.stderr.write(
          c.yellow(`[budget] ${formatUsd(u.cost)} / ${formatUsd(b)} (80% terpakai)\n`),
        )
    }
    await persistCurrent(u)
    if (overBudget) {
      await close()
      process.exit(1)
    }
    const statusLine = c.muted(
      `\n  ${u.totalTokens.toLocaleString()} token${u.cost != null ? ` · ${formatUsd(u.cost)}` : ""} · ${session.state.stepCount} langkah · ${Math.round((Date.now() - t0) / 1000)}s`,
    )
    process.stderr.write(`${statusLine}`)
    const mUsed = usage.modelUsed()
    if (mUsed.effective && mUsed.effective !== modelRef.current) {
      process.stderr.write(
        c.dim(
          `  (via ${mUsed.provider ?? "?"}/${mUsed.effective} - requested ${modelRef.current})`,
        ),
      )
    }
    process.stderr.write("\n")
    // Model untuk trace: `modelRef.current` kosong bila user tidak memberi
    // --model, dan trace bermodel kosong tidak bisa diatribusikan ke provider —
    // kolom Status di `minicode providers` jadi selalu "belum dipakai" meski
    // sudah dipakai. Pakai model efektif (hasil substitusi router) bila ada.
    const traceModel = mUsed.effective ?? modelRef.current ?? ctx.effectiveInitialModel
    await writeTrace(wcwd, {
      sessionId: sid,
      timestamp: new Date().toISOString(),
      prompt: effectivePrompt,
      durationMs: Date.now() - t0,
      steps: session.state.stepCount,
      turns: session.state.turnCount,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cost: u.cost,
      model: traceModel,
      ok: true,
    })
  } catch (e) {
    process.stderr.write(`\n${c.red(glyphs.cross)} ${formatError(e)}\n`)
    const uErr = usage.getSession(modelRef.current)
    await writeTrace(wcwd, {
      sessionId: sid,
      timestamp: new Date().toISOString(),
      prompt: effectivePrompt,
      durationMs: Date.now() - t0,
      steps: session.state.stepCount,
      turns: session.state.turnCount,
      inputTokens: uErr.inputTokens,
      outputTokens: uErr.outputTokens,
      model: usage.modelUsed().effective ?? modelRef.current ?? ctx.effectiveInitialModel,
      ok: false,
      error: formatError(e),
    })
    await close()
    process.exit(1)
  }
  await new Promise((r) => setTimeout(r, 200))
  await close()

  if (ctx.permissionMode === "plan" && process.stdin.isTTY) {
    const { createInterface } = await import("node:readline")
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ans = await new Promise<string>((res) =>
      rl.question(c.yellow("\nProceed to execute this plan? [y/N] "), res),
    )
    rl.close()
    if (ans.trim().toLowerCase() === "y") {
      const { spawn } = await import("node:child_process")
      const entry = process.argv[1]
      if (!entry) {
        process.stderr.write("[plan] cannot re-exec: argv[1] missing\n")
        process.exit(1)
      }
      const filtered = args.filter((a) => a !== "--plan")
      const child = spawn(process.execPath, [entry, ...filtered], { stdio: "inherit" })
      child.on("exit", (code: number | null) => process.exit(code ?? 0))
      process.stdin.resume()
    } else {
      process.exit(0)
    }
    process.exit(0)
  }
}
