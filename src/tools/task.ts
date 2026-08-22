import type { Tool } from "minicore";
import { createMinicodeSession } from "../session.ts";
import { createRouterProvider } from "../providers/router.ts";
import { createOpenAICompatProvider } from "../../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "../providers/anthropic.ts";
import { loadConfig } from "../config.ts";
import { Pool } from "../agents/pool.ts";

const pool = new Pool(3);

async function getProvider() {
  const cfg = await loadConfig();
  const providers = [];
  for (const p of cfg.providers) {
    if (p.providerHint === "anthropic" || p.baseUrl.includes("anthropic")) {
      providers.push(createAnthropicProvider({ apiKey: p.apiKey, baseUrl: p.baseUrl, models: p.models, defaultModel: p.models[0] }) as unknown as ReturnType<typeof createOpenAICompatProvider>);
    } else {
      providers.push(createOpenAICompatProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, models: p.models, defaultModel: p.models[0] }));
    }
  }
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
  description: "Delegasikan sub-task ke agen isolasi (explore/plan). Prompt ringkas, return summary. Isolasi ContextStore.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "instruksi untuk sub-agent" },
      mode: { type: "string", enum: ["explore", "plan"], description: "explore=read-only, plan=read+write" },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  async execute({ prompt, mode }, ctx) {
    const m = (mode as string) ?? "explore";
    // isolasi: sub-agent pakai tools read-only jika explore, semua kecuali delegate_task untuk hindari rekursi
    const { allTools } = await import("./index.ts");
    const base = allTools.filter((t) => t.name !== "delegate_task");
    const subTools = m === "explore" ? base.filter((t) => ["read_file", "glob", "grep", "read_memory", "git_status", "git_log"].includes(t.name)) : base;

    return await pool.run(async () => {
      ctx.signal.throwIfAborted();
      const provider = await getProvider();
      const session = await createMinicodeSession({
        provider,
        tools: subTools,
        cwd: process.cwd(),
        permissionMode: "auto",
        systemExtra: `You are a sub-agent (${m}). Be concise, return summary only. Parent task: ${String(prompt).slice(0, 200)}`,
      });
      // sub-agent tidak pakai vector RAG parent untuk isolasi, tapi boleh pakai memory read
      const res = await session.run(String(prompt));
      // budget isolasi: sub-agent cost tidak double-count ke parent (hanya return text)
      return `sub-agent (${m}) done: ${res.finalText?.slice(0, 2000) ?? "(no output)"} [steps ${res.usage.steps}]`;
    });
  },
};
