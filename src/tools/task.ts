import type { Tool } from "minicore";
import { createMinicodeSession } from "../session.ts";
import { createRouterProvider } from "../providers/router.ts";
import { createOpenAICompatProvider } from "../../../minicore/src/providers/openai-compat.ts";
import { buildProviderList } from "../providers/build.ts";
import { loadConfig } from "../config.ts";
import { Pool } from "../agents/pool.ts";

const pool = new Pool(3);

async function getProvider() {
  const cfg = await loadConfig();
  const providers = buildProviderList(cfg);
  if (providers.length === 0) {
    const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1";
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY ?? "";
    if (apiKey) providers.push(createOpenAICompatProvider({ baseUrl, apiKey, models: ["gpt-4o-mini"], defaultModel: "gpt-4o-mini" }));
  }
  if (providers.length === 0) throw new Error("no provider for sub-agent");
  return createRouterProvider({ providers });
}

export const delegateTaskTool: Tool = {
  name: "delegate_task",
  description: "Delegasikan sub-task ke agen isolasi (explore/plan). Prompt ringkas, return summary. Isolasi ContextStore, memory, signal, dan budget.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "instruksi untuk sub-agent" },
      mode: { type: "string", enum: ["explore", "plan"], description: "explore=read-only, plan=read+write" },
      maxSteps: { type: "number", description: "max steps untuk sub-agent (default explore=5 plan=15)" },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  async execute({ prompt, mode, maxSteps }, ctx) {
    const m = (mode as string) ?? "explore";
    const requested = Number(maxSteps);
    const cap = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 50) : m === "explore" ? 5 : 15;

    const { allTools } = await import("./index.ts");
    const base = allTools.filter((t) => t.name !== "delegate_task" && t.name !== "write_memory" && t.name !== "forget_memory");
    const subTools = m === "explore"
      ? base.filter((t) => ["read_file", "glob", "grep", "read_memory", "git_status", "git_log", "lsp_diagnostics", "lsp_definition", "lsp_hover", "mcp_list"].includes(t.name))
      : base;

    return await pool.run(async () => {
      ctx.signal.throwIfAborted();
      let provider;
      try {
        provider = await getProvider();
      } catch (e) {
        return `[sub-agent error] provider: ${(e as Error).message}`;
      }

      // inherit parent cwd if available (for --cwd case)
      const parentCwd = (ctx as unknown as { cwd?: string })?.cwd ?? process.cwd();
      const session = await createMinicodeSession({
        provider,
        tools: subTools,
        cwd: parentCwd,
        permissionMode: "auto",
        maxSteps: cap,
        timeoutMs: 120_000,
        systemExtra: `You are a sub-agent (${m}). Be concise, return summary only. Do not use write_memory or forget_memory (isolated). Parent task: ${String(prompt).slice(0, 200)}`,
      });

      // forward sub-agent observability to parent (usage + progress) so cost tracking
      // and TUI include sub-agent; text/history stay isolated
      const offUsage = session.events.on("provider:extension", (e) => {
        try { ctx.emit(e); } catch {}
      });
      const offExec = session.events.on("execution:completed", (e) => {
        try { ctx.emit(e); } catch {}
      });

      try {
        const res = await session.run(String(prompt), { signal: ctx.signal });
        return `sub-agent (${m}) done: ${res.finalText?.slice(0, 2000) ?? "(no output)"} [steps ${res.usage.steps}]`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `[sub-agent ${m} error] ${msg.slice(0, 500)}`;
      } finally {
        offUsage();
        offExec();
      }
    }, ctx.signal);
  },
};