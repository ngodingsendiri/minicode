import { createOpenAICompatProvider } from "minicore/providers/openai-compat.ts"
import { runSetupWizard } from "../../cli/wizard.ts"
import { loadConfig, type MinicodeConfig } from "../config.ts"
import type { RateLimiter } from "../policy/ratelimit.ts"
import { createAnthropicProvider } from "../providers/anthropic.ts"
import { buildProviderList } from "../providers/build.ts"
import { createRouterProvider } from "../providers/router.ts"

export async function createProviderLayer(opts: {
  cwd?: string
  prompt: string
  enterRepl: boolean
  rateLimiter?: RateLimiter
}): Promise<{ cfg: MinicodeConfig; router: ReturnType<typeof createRouterProvider> }> {
  const cfg = await loadConfig(opts.cwd)
  type Provider = ReturnType<typeof createOpenAICompatProvider>
  let providers = buildProviderList(cfg)
  if (providers.length === 0) {
    const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1"
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY
    if (apiKey)
      providers.push(
        createOpenAICompatProvider({
          baseUrl,
          apiKey,
          models: [process.env.AGENT_MODEL ?? "gpt-4o-mini"],
          defaultModel: process.env.AGENT_MODEL ?? "gpt-4o-mini",
        }),
      )
    const anthKey = process.env.ANTHROPIC_API_KEY
    if (anthKey)
      providers.push(
        createAnthropicProvider({
          apiKey: anthKey,
          models: [process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4"],
        }) as unknown as Provider,
      )
  }
  if (providers.length === 0 && (opts.enterRepl || opts.prompt)) {
    const ok = await runSetupWizard()
    if (ok) {
      const cfg2 = await loadConfig(opts.cwd)
      cfg.providers = cfg2.providers
      providers = buildProviderList(cfg2)
    }
  }
  if (providers.length === 0) {
    console.error(
      "no provider configured — run `minicode` for setup wizard,\nor: minicode config add --baseUrl <url> --apiKey <key>, or set OPENAI_API_KEY",
    )
    process.exit(1)
  }
  const router = createRouterProvider({
    providers,
    ...(opts.rateLimiter ? { limiter: opts.rateLimiter } : {}),
  })
  return { cfg, router }
}
