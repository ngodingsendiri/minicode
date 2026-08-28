import { randomUUID } from "node:crypto"
import { resolve as resolvePath } from "node:path"
import { createRateLimiter } from "../../src/policy/ratelimit.ts"
import { formatError } from "../../src/tui/minimal/simple.ts"
import { getArg as rawGetArg } from "../args.ts"
import { createCliSession } from "../setup.ts"

export async function handleExec(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  // minicode exec "prompt" [--json] [--cwd <dir>] [--model <m>] [--sandbox docker|os] ...
  const prompt =
    args
      .slice(1)
      .filter((a) => !a.startsWith("-") && a !== getArg("--model") && a !== getArg("--cwd"))
      .join(" ")
      .trim() || rawGetArg(args, "--prompt") // fallback
  const jsonMode = args.includes("--json") || args.includes("--output-format=json")
  const cwdRaw = getArg("--cwd")
  const cwd = cwdRaw ? resolvePath(cwdRaw) : undefined
  const modelOverride = getArg("--model")
  const providerOverride = getArg("--provider")
  const sessionId = getArg("--session") ?? randomUUID().slice(0, 8)
  const sandboxMode = getArg("--sandbox")
  if (
    sandboxMode === "docker" ||
    sandboxMode === "os" ||
    sandboxMode === "bwrap" ||
    sandboxMode === "seatbelt"
  )
    process.env.MINICODE_SANDBOX = sandboxMode
  const budgetRaw = getArg("--budget")
  const budget = budgetRaw ? Number(budgetRaw) : undefined
  const ratelimitRaw = getArg("--ratelimit")
  const rateLimiter = ratelimitRaw ? createRateLimiter(Number(ratelimitRaw)) : undefined

  // collect prompt from args tail if not flagged
  let effectivePrompt = prompt
  if (!effectivePrompt) {
    // try promptFromArgs-like: join remaining non-flag tokens
    const BOOLEAN_FLAGS = new Set([
      "--json",
      "--verbose",
      "--allow-all",
      "--ask",
      "--plan",
      "--verify",
    ])
    const VALUE_FLAGS = new Set([
      "--cwd",
      "--model",
      "--provider",
      "--session",
      "--sandbox",
      "--budget",
      "--ratelimit",
      "--max-steps",
      "--timeout",
    ])
    const out: string[] = []
    for (let i = 1; i < args.length; i++) {
      const a = args[i] as string
      if (BOOLEAN_FLAGS.has(a)) continue
      if (VALUE_FLAGS.has(a)) {
        i++
        continue
      }
      if (a.includes("=") && VALUE_FLAGS.has(a.split("=")[0]!)) continue
      if (a.startsWith("-")) continue
      out.push(a)
    }
    effectivePrompt = out.join(" ")
  }
  if (!effectivePrompt) {
    console.error(
      'usage: minicode exec "prompt" [--json] [--cwd <dir>] [--model <m>] [--sandbox docker|os]',
    )
    process.exit(1)
  }

  const ctx = await createCliSession({
    cwd,
    sessionId,
    modelOverride,
    providerOverride,
    prompt: effectivePrompt,
    enterRepl: false,
    verbose: false,
    allowAll: args.includes("--allow-all"),
    ask: args.includes("--ask"),
    plan: args.includes("--plan"),
    useTui: false,
    verify: args.includes("--verify"),
    budget,
    rateLimiter,
    ui: "auto" as const,
  })
  const t0 = Date.now()
  const events: unknown[] = []
  const unsub = ctx.session.events.on((ev: unknown) => {
    events.push(ev)
    if (jsonMode) {
      // stream JSON lines like Codex/Gemini
      process.stdout.write(`${JSON.stringify(ev)}\n`)
    }
  })
  try {
    await ctx.runPromptWithVerify(effectivePrompt)
    const u = ctx.usage.get(ctx.modelRef.current)
    if (jsonMode) {
      const result = {
        ok: true,
        sessionId,
        model: ctx.modelRef.current,
        prompt: effectivePrompt,
        durationMs: Date.now() - t0,
        steps: ctx.session.state.stepCount,
        turns: ctx.session.state.turnCount,
        usage: u,
        events: events.slice(-20),
      }
      // already streamed events; final summary
      if (!events.length) process.stdout.write(`${JSON.stringify(result)}\n`)
      else process.stderr.write(`${JSON.stringify({ summary: result })}\n`)
    } else {
      process.stdout.write(
        `\n[exec] done model=${ctx.modelRef.current} steps=${ctx.session.state.stepCount} tokens=${u.totalTokens} ${Date.now() - t0}ms\n`,
      )
    }
    unsub()
    await ctx.close()
    process.exit(0)
  } catch (e) {
    if (jsonMode)
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: formatError(e), prompt: effectivePrompt })}\n`,
      )
    else process.stderr.write(`\n${formatError(e)}\n`)
    unsub()
    await ctx.close()
    process.exit(1)
  }
}
