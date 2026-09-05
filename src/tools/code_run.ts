import type { Tool } from "#minicore"
import { bashTool } from "./bash.ts"

// code_run: jalankan snippet python/js via bash yang sudah sandboxed.
// Bypass deny INLINE_INTERPRETER di bash-guard bila MINICODE_SANDBOX=os|docker.
export const codeRunTool: Tool = {
  name: "code_run",
  description:
    "Run a code snippet (python -c / node -e) inside the sandboxed bash. Requires MINICODE_SANDBOX=os|docker; otherwise use bash tool.",
  parameters: {
    type: "object",
    properties: {
      lang: { type: "string", enum: ["python", "node"], description: "runtime" },
      code: { type: "string", description: "snippet to run" },
      timeout: { type: "number", description: "ms, default 10000" },
    },
    required: ["lang", "code"],
    additionalProperties: false,
  },
  async execute({ lang, code, timeout }, ctx) {
    const sandbox = process.env.MINICODE_SANDBOX ?? ""
    if (sandbox !== "os" && sandbox !== "docker" && sandbox !== "bwrap" && sandbox !== "seatbelt") {
      throw new Error(
        `code_run requires MINICODE_SANDBOX=os|docker (current: ${sandbox || "none"})`,
      )
    }
    const cmd =
      lang === "python"
        ? `python3 -c ${JSON.stringify(code as string)}`
        : `node -e ${JSON.stringify(code as string)}`
    // delegate ke bashTool yang sudah memiliki jail + sandbox.
    // bash memakai `timeoutMs` — jangan `timeout` (akan diabaikan → hang).
    const timeoutMs =
      typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0 ? timeout : 10000
    return (bashTool.execute as unknown as (a: unknown, c: unknown) => Promise<unknown>)(
      { cmd, timeoutMs },
      ctx,
    )
  },
}
