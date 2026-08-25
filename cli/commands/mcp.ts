import { resolve as resolvePath } from "node:path"

export async function handleMcp(
  args: string[],
  getArg: (name: string) => string | undefined,
  HELP: string,
): Promise<never> {
  const sub = args[1]
  if (sub === "serve") {
    const { serveMcp } = await import("../../src/mcp/server.ts")
    const cwdArg = getArg("--cwd")
    await serveMcp({
      allowAll: args.includes("--allow-all"),
      allTools: args.includes("--all-tools"),
      root: cwdArg ? resolvePath(cwdArg) : undefined,
    })
    process.exit(0)
  } else {
    console.log(HELP)
    process.exit(sub === undefined || sub === "--help" || sub === "-h" ? 0 : 1)
  }
}
