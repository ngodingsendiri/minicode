import type { Tool } from "minicore"
import { createOpenAICompatProvider } from "minicore/providers/openai-compat.ts"
import { Pool } from "../agents/pool.ts"
import { loadConfig } from "../config.ts"
import { LIMITS } from "../constants.ts"
import { buildProviderListAsync } from "../providers/build.ts"
import { createRouterProvider } from "../providers/router.ts"
import { createMinicodeSession } from "../session.ts"

const pool = new Pool(LIMITS.SUB_AGENT_POOL_SIZE)

async function getProvider() {
  const cfg = await loadConfig()
  // Async: sub-agent juga harus bisa memakai provider OAuth milik parent.
  const providers = await buildProviderListAsync(cfg)
  if (providers.length === 0) {
    const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1"
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY ?? ""
    if (apiKey)
      providers.push(
        createOpenAICompatProvider({
          baseUrl,
          apiKey,
          models: ["gpt-4o-mini"],
          defaultModel: "gpt-4o-mini",
        }),
      )
  }
  if (providers.length === 0) throw new Error("no provider for sub-agent")
  return createRouterProvider({ providers })
}

export const delegateTaskTool: Tool = {
  name: "delegate_task",
  description:
    "Delegate sub-task ke agen isolasi (explore/plan). Prompt ringkas, return summary. Isolasi ContextStore, memory, signal, dan budget.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "instruksi untuk sub-agent" },
      mode: {
        type: "string",
        enum: ["explore", "plan"],
        description: "explore=read-only, plan=read+write",
      },
      maxSteps: {
        type: "number",
        description: "max steps untuk sub-agent (default explore=5 plan=15)",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  async execute({ prompt, mode, maxSteps }, ctx) {
    const m = (mode as string) ?? "explore"
    const requested = Number(maxSteps)
    const cap =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), LIMITS.DEFAULT_MAX_STEPS)
        : m === "explore"
          ? LIMITS.SUB_AGENT_BUDGET_EXPLORE
          : LIMITS.SUB_AGENT_BUDGET_PLAN

    const { allTools } = await import("./index.ts")
    // Sub-agent tidak boleh menulis state milik parent: memory (persisten) dan
    // todo (rencana parent). Juga tidak boleh bersarang (delegate_task).
    // bash_output/bash_kill dibuang karena job id milik parent.
    // git_commit dibuang: commit adalah keputusan tingkat-task, bukan sub-task.
    const base = allTools.filter(
      (t) =>
        ![
          "delegate_task",
          "write_memory",
          "forget_memory",
          "todo_write",
          "bash_output",
          "bash_kill",
          "git_commit",
        ].includes(t.name),
    )
    const subTools =
      m === "explore"
        ? base.filter((t) =>
            [
              "read_file",
              "glob",
              "grep",
              "read_memory",
              "todo_read",
              "git_status",
              "git_log",
              "lsp_diagnostics",
              "lsp_definition",
              "lsp_hover",
              "lsp_workspace_symbols",
              "mcp_list",
            ].includes(t.name),
          )
        : base

    return await pool.run(async () => {
      ctx.signal.throwIfAborted()
      let provider: Awaited<ReturnType<typeof getProvider>>
      try {
        provider = await getProvider()
      } catch (e) {
        return `[sub-agent error] provider: ${(e as Error).message}`
      }

      // inherit parent cwd if available (for --cwd case)
      const parentCwd = (ctx as unknown as { cwd?: string })?.cwd ?? process.cwd()
      const session = await createMinicodeSession({
        provider,
        tools: subTools,
        cwd: parentCwd,
        permissionMode: "auto",
        maxSteps: cap,
        timeoutMs: LIMITS.SUB_AGENT_TIMEOUT_MS,
        systemExtra: `You are a sub-agent (${m}). Be concise, return summary only. Do not use write_memory, forget_memory, or todo_write (isolated — those belong to the parent). Parent task: ${String(prompt).slice(0, 200)}`,
      })

      // forward sub-agent observability to parent (usage + progress) so cost tracking
      // dan TUI/checkpoint ikut; text/history tetap terisolasi
      const offUsage = session.events.on("provider:extension", (e) => {
        try {
          ctx.emit(e)
        } catch {}
      })
      const offExec = session.events.on("execution:completed", (e) => {
        try {
          ctx.emit(e)
        } catch {}
      })
      // forward execution:started juga → parent bisa capture pre-edit state untuk
      // /undo atas perubahan file yang dilakukan sub-agent
      const offExecStarted = session.events.on("execution:started", (e) => {
        try {
          ctx.emit(e)
        } catch {}
      })

      try {
        const res = await session.run(String(prompt), { signal: ctx.signal })
        return `sub-agent (${m}) done: ${res.finalText?.slice(0, 2000) ?? "(no output)"} [steps ${res.usage.steps}]`
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return `[sub-agent ${m} error] ${msg.slice(0, 500)}`
      } finally {
        offUsage()
        offExec()
        offExecStarted()
      }
    }, ctx.signal)
  },
}
