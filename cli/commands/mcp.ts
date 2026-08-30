import { resolve as resolvePath } from "node:path"

const MCP_HELP = `minicode mcp — jalankan minicode sebagai server MCP

  minicode mcp serve [--allow-all] [--all-tools] [--cwd <dir>]

  --allow-all   izinkan semua tool tanpa gate permission
  --all-tools   ekspos seluruh tool, bukan hanya yang aman
  --cwd <dir>   akar workspace yang diekspos

  Daftar server MCP yang DIPAKAI minicode diatur lewat:
    minicode config mcp <add|list|remove>`

export async function handleMcp(
  args: string[],
  getArg: (name: string) => string | undefined,
  _help: string,
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
  }
  // Help kontekstual, bukan HELP global 45 baris. Subcommand asing = exit 1.
  const asking = sub === undefined || sub === "--help" || sub === "-h"
  if (!asking) console.error(`subcommand mcp tidak dikenal: ${sub}\n`)
  console.log(MCP_HELP)
  process.exit(asking ? 0 : 1)
}
