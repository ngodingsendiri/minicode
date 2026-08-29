import { randomUUID } from "node:crypto"
import { resolve as resolvePath } from "node:path"
import { createRateLimiter } from "../../src/policy/ratelimit.ts"
import { resolveSandbox } from "../../src/policy/sandbox-policy.ts"
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
  const allowAll = args.includes("--allow-all")
  const ask = args.includes("--ask")
  const plan = args.includes("--plan")
  const allowlistFlag = args.includes("--allowlist")
  // Sama seperti jalur interaktif: OS sandbox otomatis, dan tanpa isolasi nyata
  // permission default turun ke allowlist. Headless CI justru paling butuh ini —
  // di sana tak ada manusia yang bisa menyetujui prompt.
  const sandbox = resolveSandbox(
    getArg("--sandbox") ?? process.env.MINICODE_SANDBOX,
    allowAll || ask || plan || allowlistFlag,
  )
  if (sandbox.mode === "none") delete process.env.MINICODE_SANDBOX
  else process.env.MINICODE_SANDBOX = sandbox.mode
  if (sandbox.notice) process.stderr.write(`${sandbox.notice}\n`)
  const allowlist = allowlistFlag || sandbox.fallbackPermission === "allowlist"
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
      "--allowlist",
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
    allowAll,
    ask,
    plan,
    allowlist,
    useTui: false,
    verify: args.includes("--verify"),
    budget,
    rateLimiter,
    ui: "auto" as const,
  })
  const t0 = Date.now()
  const events: unknown[] = []
  // EventBus kernel butuh (type, handler). Memanggil on(handler) 1-argumen
  // mendaftarkan listener di bawah key "function" → tidak pernah terpanggil,
  // sehingga --json tidak pernah stream apa pun. "*" = semua event.
  const unsub = ctx.session.events.on("*", (ev) => {
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
        type: "summary" as const,
        ok: true,
        sessionId,
        model: ctx.modelRef.current,
        prompt: effectivePrompt,
        durationMs: Date.now() - t0,
        steps: ctx.session.state.stepCount,
        turns: ctx.session.state.turnCount,
        usage: u,
        eventCount: events.length,
      }
      // Event sudah di-stream sebagai JSONL di stdout; summary jadi baris
      // terakhir di stdout juga (bukan stderr) supaya pipeline CI bisa
      // membaca satu stream saja.
      process.stdout.write(`${JSON.stringify(result)}\n`)
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
        `${JSON.stringify({ type: "summary", ok: false, error: formatError(e), prompt: effectivePrompt })}\n`,
      )
    else process.stderr.write(`\n${formatError(e)}\n`)
    unsub()
    await ctx.close()
    process.exit(1)
  }
}
