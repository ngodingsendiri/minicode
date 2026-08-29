#!/usr/bin/env bun
import { randomUUID } from "node:crypto"
import { resolve as resolvePath } from "node:path"
import { createRateLimiter } from "../src/policy/ratelimit.ts"
import { resolveSandbox } from "../src/policy/sandbox-policy.ts"
import { findSkill, renderSkill } from "../src/skills/loader.ts"
import { writeTrace } from "../src/telemetry/trace.ts"
import { formatError } from "../src/tui/minimal/simple.ts"
import { c, glyphs } from "../src/tui/theme.ts"
import { promptFromArgs, getArg as rawGetArg, readPrompt } from "./args.ts"
import { dispatch } from "./router.ts"
import { createCliSession } from "./setup.ts"

const HELP = `Minicode - coding agent on frozen MiniCore
Usage:
  minicode                        # mode chat interaktif (setup wizard saat pertama)
  minicode "prompt" [options]     # sekali jalan
  minicode exec "prompt" [--json] # headless CI mode (Codex/Gemini-like, JSON stream)
  echo "prompt" | minicode        # via pipe
  minicode providers              # daftar provider gateway (tanpa LLM)
  minicode models [id]            # daftar model per provider (tanpa LLM)
  minicode sync                   # refresh daftar model dari semua provider
  minicode config <add|list|remove|detect> [options]
  minicode config mcp <add|list|remove> [options]
  minicode config lsp <add|list|remove> [options]
  minicode mcp serve [--allow-all] [--all-tools]
  minicode skills <list|show <name>>   # .minicode/skills/*.md, prompt /name args
  minicode sessions <list|export> [id]

Options:
  -h, --help          show help
  --verbose           show reasoning & usage
  --cwd <dir>         workspace root (default .)
  --resume <id>       resume session id
  --model <name>      override model (atau provider::model)
  --provider <id>     paksa provider id (agnostik, tanpa ubah config)
  --session <id>      session id (default random)
  --allow-all         allow all tools (no sandbox)
  --ask               ask per tool (y/n/a) - human-in-loop
  --plan              read-only plan mode (no file writes / bash / sub-agents)
  --allowlist         bash allowlist only (git/bun/npm safe cmds; via MINICODE_BASH_ALLOWLIST)
  --max-steps <n>     max tool steps (default 50)
  --context-window <n> context window tokens
  --timeout <ms>      hard deadline per run (default 600000 = 10min; 0 = Infinity)
  --interactive       REPL loop
  --tui               TUI minimal alternate-screen (pure ANSI)
  --verify            auto-verify after run + self-heal (uses typecheck/test/tsconfig)
  --sandbox <mode>    bash sandbox: docker (ephemeral container, --network none)
  --ratelimit <rpm>   limit LLM requests per minute (token bucket) to avoid 429
  --budget <usd>      session cost limit (USD); warn at 80%, stop when exceeded

Commands in REPL:
  /help /clear /model /models /providers /provider-add /sync /cost /sessions /resume /status /history /exit
`

const args = process.argv.slice(2)
function getArg(name: string): string | undefined {
  return rawGetArg(args, name)
}

// dispatch subcommands via registry (handlers call process.exit internally)
await dispatch(args, getArg, HELP)

if (args.includes("-h") || args.includes("--help")) {
  if (args.includes("--json")) {
    // machine-readable help for CI (minicode exec --help --json)
    console.log(
      JSON.stringify({
        name: "minicode",
        version: "0.7.0",
        usage: [
          "minicode",
          'minicode "prompt" [options]',
          'minicode exec "prompt" [--json]',
          "minicode providers|models|sync|config|mcp|skills|sessions",
        ],
        options: [
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
          { flag: "--tui", desc: "fullscreen TUI (pure ANSI)" },
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

// â”€â”€ flag parsing â”€â”€
const verbose = args.includes("--verbose")
const allowAll = args.includes("--allow-all")
const ask = args.includes("--ask")
const interactive = args.includes("--interactive")
const useTui = args.includes("--tui")
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
if (sandbox.notice) process.stderr.write(`${sandbox.notice}\n`)
const effectiveAllowlist = allowlist || sandbox.fallbackPermission === "allowlist"
const budgetRaw = getArg("--budget")
const budget = budgetRaw ? Number(budgetRaw) : undefined
if (budgetRaw && !Number.isFinite(budget))
  process.stderr.write(`[warn] --budget requires a USD number, ignoring "${budgetRaw}"\n`)
const ratelimitRaw = getArg("--ratelimit")
const rateLimiter = ratelimitRaw ? createRateLimiter(Number(ratelimitRaw)) : undefined
const uiRaw = getArg("--ui") ?? "auto"
const uiRaw2 = getArg("--theme") ?? ""
const themeName = ["dark", "dim", "light", "mono"].includes(uiRaw2)
  ? uiRaw2
  : (process.env.MINICODE_THEME ?? "")
const { applyTheme } = await import("../src/tui/theme.ts")
applyTheme(themeName)

const prompt = promptFromArgs(args) || (await readPrompt())
const enterRepl = interactive || (!prompt && process.stdin.isTTY)
if (!prompt && !enterRepl) {
  process.stderr.write('usage: minicode "prompt"  |  minicode (interactive mode)\n')
  process.exit(1)
}

// â”€â”€ skills: expand /name args â”€â”€
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

// â”€â”€ build session â”€â”€
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
  useTui,
  verify,
  budget,
  maxSteps,
  contextWindowTokens,
  timeoutMs,
  rateLimiter,
  ui: uiRaw as "auto" | "full" | "classic",
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
    const u = usage.get(modelRef.current)
    let overBudget = false
    if (b != null && u.cost != null) {
      if (u.cost > b) {
        process.stderr.write(
          c.red(`[budget] $${u.cost.toFixed(4)} > $${b.toFixed(2)} - over budget, exiting.\n`),
        )
        overBudget = true
      } else if (u.cost > b * 0.8)
        process.stderr.write(
          c.yellow(`[budget] $${u.cost.toFixed(4)} / $${b.toFixed(2)} (80% used)\n`),
        )
    }
    await persistCurrent(u)
    if (overBudget) {
      await close()
      process.exit(1)
    }
    const statusLine = c.muted(
      `\n  ${u.totalTokens.toLocaleString()} tokens${u.cost != null ? ` · $${u.cost.toFixed(4)}` : ""} · ${session.state.stepCount} steps · ${Math.round((Date.now() - t0) / 1000)}s`,
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
      model: modelRef.current,
      ok: true,
    })
  } catch (e) {
    process.stderr.write(`\n${c.red(glyphs.cross)} ${formatError(e)}\n`)
    await writeTrace(wcwd, {
      sessionId: sid,
      timestamp: new Date().toISOString(),
      prompt: effectivePrompt,
      durationMs: Date.now() - t0,
      steps: session.state.stepCount,
      turns: session.state.turnCount,
      inputTokens: usage.get(modelRef.current).inputTokens,
      outputTokens: usage.get(modelRef.current).outputTokens,
      model: modelRef.current,
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
