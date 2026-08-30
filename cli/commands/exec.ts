import { randomUUID } from "node:crypto"
import { resolve as resolvePath } from "node:path"
import { createRateLimiter } from "../../src/policy/ratelimit.ts"
import { resolveSandbox } from "../../src/policy/sandbox-policy.ts"
import { formatError } from "../../src/tui/minimal/simple.ts"
import { promptFromArgs, getArg as rawGetArg } from "../args.ts"
import { createCliSession } from "../setup.ts"

export async function handleExec(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  // minicode exec "prompt" [--json] [--cwd <dir>] [--model <m>] [--sandbox docker|os] ...
  //
  // Prompt diambil lewat promptFromArgs() — satu implementasi yang sama dengan
  // jalur non-exec. Versi sebelumnya menyaring dengan `a !== getArg("--model")`,
  // yang hanya membuang NILAI dari dua flag (`--model`, `--cwd`); nilai flag lain
  // ikut masuk ke prompt. `exec "tes" --provider gorouter --timeout 60000` benar-
  // benar mengirim "tes gorouter 60000" ke model, dan model membalas dengan
  // menebak-nebak soal "gorouter" dan "60000".
  const prompt = promptFromArgs(args.slice(1)) || (rawGetArg(args, "--prompt") ?? "")
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

  const effectivePrompt = prompt.trim()
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
    verify: args.includes("--verify"),
    budget,
    rateLimiter,
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
