import {
  detectAndSave,
  loadConfig,
  removeLspServer,
  removeMcpServer,
  removeProvider,
  saveLspServer,
  saveMcpServer,
} from "../../src/config.ts"
import { renderTable } from "../../src/tui/table.ts"
import { c, glyphs } from "../../src/tui/theme.ts"

export async function handleConfig(
  args: string[],
  getArg: (name: string) => string | undefined,
  HELP: string,
): Promise<never> {
  const sub = args[1]
  if (sub === "add") {
    const baseUrl = getArg("--baseUrl")
    const apiKey = getArg("--apiKey")
    const id = getArg("--id")
    if (!baseUrl || !apiKey) {
      console.error("usage: minicode config add --baseUrl <url> --apiKey <key> [--id <id>]")
      process.exit(1)
    }
    const entry = await detectAndSave(baseUrl, apiKey, id, {
      global: args.includes("--global"),
    })
    console.log(
      `${c.green(glyphs.check)} Saved provider "${c.bold(entry.id)}" (${entry.providerHint}) models: ${entry.models.slice(0, 5).join(", ")}${entry.models.length > 5 ? " ..." : ""} (${entry.models.length} total)`,
    )
    process.exit(0)
  } else if (sub === "list") {
    const cfg = await loadConfig()
    if (cfg.providers.length === 0)
      console.log(c.dim("(no providers configured - add via minicode config add or setup wizard)"))
    else {
      const tableData = cfg.providers.map((p) => ({
        id: c.cyan(p.id),
        url: p.baseUrl,
        models: String(p.models.length),
        hint: c.dim(p.providerHint ?? "?"),
      }))
      console.log(
        `\n${c.bold("Configured LLM Providers")}\n` +
          renderTable(
            [
              { header: "Provider ID", key: "id", width: 14 },
              { header: "Base URL", key: "url", width: 34 },
              { header: "Models", key: "models", width: 8, align: "right" },
              { header: "Type", key: "hint", width: 14 },
            ],
            tableData,
          ) +
          "\n",
      )
    }
    process.exit(0)
  } else if (sub === "remove") {
    const id = args[2]
    if (!id) {
      console.error("usage: minicode config remove <id> [--global|--local] [--cwd <dir>]")
      process.exit(1)
    }
    await removeProvider(id, { global: !args.includes("--local"), cwd: getArg("--cwd") })
    console.log(
      `${c.green(glyphs.check)} Removed provider ${id} (${!args.includes("--local") ? "global" : "local"})`,
    )
    process.exit(0)
  } else if (sub === "detect") {
    const baseUrl = getArg("--baseUrl")
    const apiKey = getArg("--apiKey")
    if (!baseUrl || !apiKey) {
      console.error("usage: minicode config detect --baseUrl <url> --apiKey <key>")
      process.exit(1)
    }
    const { detectModels } = await import("../../src/providers/detect.ts")
    const res = await detectModels(baseUrl, apiKey)
    console.log(
      `${c.green(glyphs.check)} Detected ${res.models.length} models (${res.providerHint}):\n${res.models.map((m) => `  ${glyphs.dot} ${m}`).join("\n")}`,
    )
    process.exit(0)
  } else if (sub === "mcp") {
    const mcpSub = args[2]
    if (mcpSub === "add") {
      const id = args[3]
      const command = getArg("--command")
      const cmdArgsRaw = getArg("--args")
      if (!id || !command || !cmdArgsRaw) {
        console.error(
          'usage: minicode config mcp add <id> --command <cmd> --args "<arg1,arg2>" [--env K=V] [--global|--local]',
        )
        process.exit(1)
      }
      const cmdArgs = cmdArgsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const env: Record<string, string> = {}
      for (const kv of (getArg("--env") ?? "").split(",")) {
        const [k, ...rest] = kv.split("=")
        if (k && rest.length) env[k.trim()] = rest.join("=").trim()
      }
      await saveMcpServer(
        { id, command, args: cmdArgs, ...(Object.keys(env).length ? { env } : {}) },
        { global: !args.includes("--local") },
      )
      console.log(
        `${c.green(glyphs.check)} Saved MCP server "${c.bold(id)}": ${command} ${cmdArgs.join(" ")}`,
      )
      process.exit(0)
    } else if (mcpSub === "list") {
      const cfg = await loadConfig()
      if (!cfg.mcpServers?.length)
        console.log(c.dim("(no MCP servers configured - add via minicode config mcp add)"))
      else {
        const tableData = cfg.mcpServers.map((m) => ({
          id: c.cyan(m.id),
          command: m.command,
          args: c.dim(m.args.join(" ")),
        }))
        console.log(
          `\n${c.bold("Configured MCP Servers")}\n` +
            renderTable(
              [
                { header: "Server ID", key: "id", width: 14 },
                { header: "Command", key: "command", width: 20 },
                { header: "Arguments", key: "args", width: 36 },
              ],
              tableData,
            ) +
            "\n",
        )
      }
      process.exit(0)
    } else if (mcpSub === "remove") {
      const id = args[3]
      if (!id) {
        console.error("usage: minicode config mcp remove <id> [--global|--local]")
        process.exit(1)
      }
      await removeMcpServer(id, { global: !args.includes("--local"), cwd: getArg("--cwd") })
      console.log(
        `${c.green(glyphs.check)} Removed MCP server ${id} (${!args.includes("--local") ? "global" : "local"})`,
      )
      process.exit(0)
    } else {
      console.log(HELP)
      process.exit(0)
    }
  } else if (sub === "lsp") {
    const lspSub = args[2]
    if (lspSub === "add") {
      const ext = args[3]
      const command = getArg("--command")
      const cmdArgsRaw = getArg("--args") ?? ""
      if (!ext || !command) {
        console.error(
          'usage: minicode config lsp add <ext> --command <cmd> [--args "<arg1,arg2>"] [--env K=V] [--global|--local]',
        )
        process.exit(1)
      }
      const cmdArgs = cmdArgsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const env: Record<string, string> = {}
      for (const kv of (getArg("--env") ?? "").split(",")) {
        const [k, ...rest] = kv.split("=")
        if (k && rest.length) env[k.trim()] = rest.join("=").trim()
      }
      await saveLspServer(
        { ext, command, args: cmdArgs, ...(Object.keys(env).length ? { env } : {}) },
        { global: !args.includes("--local") },
      )
      console.log(
        `${c.green(glyphs.check)} Saved LSP server for ${c.bold(ext)}: ${command} ${cmdArgs.join(" ")}`,
      )
      process.exit(0)
    } else if (lspSub === "list") {
      const cfg = await loadConfig()
      if (!cfg.lspServers?.length)
        console.log(c.dim("(no LSP servers configured - add via minicode config lsp add)"))
      else {
        const tableData = cfg.lspServers.map((l) => ({
          ext: c.cyan(l.ext),
          command: l.command,
          args: c.dim(l.args.join(" ")),
        }))
        console.log(
          `\n${c.bold("Configured LSP Language Servers")}\n` +
            renderTable(
              [
                { header: "Extension", key: "ext", width: 12 },
                { header: "Command", key: "command", width: 22 },
                { header: "Arguments", key: "args", width: 36 },
              ],
              tableData,
            ) +
            "\n",
        )
      }
      process.exit(0)
    } else if (lspSub === "remove") {
      const ext = args[3]
      if (!ext) {
        console.error("usage: minicode config lsp remove <ext> [--global|--local]")
        process.exit(1)
      }
      await removeLspServer(ext, { global: !args.includes("--local"), cwd: getArg("--cwd") })
      console.log(
        `${c.green(glyphs.check)} Removed LSP server for ${ext} (${!args.includes("--local") ? "global" : "local"})`,
      )
      process.exit(0)
    } else {
      console.log(HELP)
      process.exit(0)
    }
  } else {
    console.log(HELP)
    process.exit(0)
  }
}
