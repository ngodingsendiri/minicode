// View persetujuan tool — readline + warna, murni presentasi.
// Lapisan policy tidak mengimpor file ini; ia di-inject sebagai callback dari
// composition root (cli/setup.ts -> createMinicodeSession -> permission).
import { c } from "../render/theme.ts"

/** Subset struktural tool call yang dibutuhkan view — tanpa tipe kernel. */
export interface ApprovalRequest {
  name: string
  args?: unknown
}

export async function promptAsk(call: ApprovalRequest): Promise<"allow" | "deny" | "always"> {
  if (!process.stdin.isTTY) return "deny"
  // Attention bell (ala OpenCode): terminal bunyi saat butuh konfirmasi.
  process.stdout.write("\x07")

  const { createInterface } = await import("node:readline")
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  const toolName = call.name
  const args = (call.args ?? {}) as Record<string, unknown>

  let actionSummary = ""
  if (args.command) actionSummary = `Command: ${String(args.command).slice(0, 100)}`
  else if (args.path) actionSummary = `File: ${String(args.path)}`
  else if (args.query) actionSummary = `Query: ${String(args.query)}`
  else actionSummary = `Args: ${JSON.stringify(args).slice(0, 100)}`

  process.stdout.write(`\n${c.warning(c.bold("Permission required"))}\n`)
  process.stdout.write(`  ${c.bold("Tool:")} ${c.info(toolName)}\n`)
  process.stdout.write(`  ${actionSummary}\n`)

  const promptText = `${c.bold("[y]")} Allow once  ${c.bold("[a]")} Always  ${c.bold("[n]")} Deny: `
  const ans: string = await new Promise((resolve) => rl.question(promptText, resolve))
  rl.close()

  const a = ans.trim().toLowerCase()
  if (a === "a" || a === "always") return "always"
  if (a === "y" || a === "yes") return "allow"
  return "deny"
}
