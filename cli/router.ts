import { flagNameOf, valueFlags } from "./args.ts"

export async function dispatch(
  args: string[],
  getArg: (name: string) => string | undefined,
  HELP: string,
): Promise<boolean> {
  let cmdIndex = -1
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (!token) continue
    if (token === "--") break
    const flag = flagNameOf(token)
    if (flag) {
      if (valueFlags.has(flag) && !token.includes("=")) i++
      continue
    }
    if (!token.startsWith("-")) {
      cmdIndex = i
      break
    }
  }
  const cmd = cmdIndex >= 0 ? args[cmdIndex] : undefined
  if (!cmd) return false

  if (cmd === "stats") {
    const { handleStats } = await import("./commands/stats.ts")
    await handleStats(getArg)
    return true
  }
  if (cmd === "sessions") {
    const { handleSessions } = await import("./commands/sessions.ts")
    await handleSessions(args, getArg)
    return true
  }
  if (cmd === "mcp") {
    const { handleMcp } = await import("./commands/mcp.ts")
    await handleMcp(args, getArg, HELP)
    return true
  }
  if (cmd === "config") {
    const { handleConfig } = await import("./commands/config.ts")
    await handleConfig(args, getArg, HELP)
    return true
  }
  if (cmd === "skills") {
    const { handleSkills } = await import("./commands/skills.ts")
    await handleSkills(args, getArg)
    return true
  }
  if (cmd === "providers" || cmd === "models" || cmd === "sync") {
    const { handleProviders } = await import("./commands/providers.ts")
    await handleProviders(args, getArg)
    return true
  }
  if (cmd === "auth") {
    const { handleAuth } = await import("./commands/auth.ts")
    await handleAuth(args)
    return true
  }
  if (cmd === "pricing") {
    const { handlePricing } = await import("./commands/pricing.ts")
    await handlePricing(args)
    return true
  }
  if (cmd === "exec") {
    const { handleExec } = await import("./commands/exec.ts")
    await handleExec(args, getArg)
    return true
  }
  return false
}
