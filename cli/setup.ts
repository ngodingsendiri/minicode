// Setup CLI: bangun session (provider, RAG, skills, resume, MCP/LSP, permission,
// checkpoint, verify, renderer, usage) — dikonsumsi oleh mode one-shot & REPL.
import { createRouterProvider } from "../src/providers/router.ts";
import { buildProviderList } from "../src/providers/build.ts";
import { createMinicodeSession } from "../src/session.ts";
import { allTools, withMcpTools } from "../src/tools/index.ts";
import { attachRenderer, formatError } from "../src/tui/renderer.ts";
import { createUsageCollector } from "../src/policy/usage.ts";
import { attachInkRenderer } from "../src/tui/ink.tsx";
import { loadConfig, type MinicodeConfig } from "../src/config.ts";
import { createOpenAICompatProvider } from "../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "../src/providers/anthropic.ts";
import { saveSession, loadSession } from "../src/session/persistence.ts";
import { searchHybrid } from "../src/memory/vector.ts";
import { createLlmCompaction } from "../src/policy/compaction.ts";
import { connectAll as mcpConnectAll, closeAll as mcpCloseAll } from "../src/mcp/client.ts";
import { configureServers as lspConfigure, closeAllLsp as lspCloseAll } from "../src/lsp/client.ts";
import { loadSkills, skillsToSystemPrompt, type Skill } from "../src/skills/loader.ts";
import { c } from "../src/tui/theme.ts";
import { runSetupWizard } from "./wizard.ts";
import { recordCheckpointFromSnapshots } from "../src/session/checkpoint.ts";
import { runWithSelfHeal, runVerify, detectVerifyCommand } from "../src/policy/verifier.ts";
import { createRateLimiter, type RateLimiter } from "../src/policy/ratelimit.ts";
import type { Tool, Message, Session } from "minicore";
import { resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";

export interface CliSessionOptions {
  cwd?: string;
  sessionId: string;
  resumeId?: string;
  modelOverride?: string;
  prompt: string;
  enterRepl: boolean;
  verbose: boolean;
  allowAll: boolean;
  ask: boolean;
  plan: boolean;
  allowlist: boolean;
  useTui: boolean;
  verify: boolean;
  budget?: number;
  maxSteps?: number;
  contextWindowTokens?: number;
  timeoutMs?: number;
  rateLimiter?: RateLimiter;
}

export interface CliSession {
  session: Session;
  cfg: MinicodeConfig;
  cwd?: string;
  sessionId: string;
  modelRef: { current?: string };
  effectiveInitialModel: string;
  permissionMode: string;
  sessionTools: Tool[];
  allLoadedSkills: Skill[];
  usage: ReturnType<typeof createUsageCollector>;
  budget?: number;
  detachInk?: () => void;
  persistCurrent: (usageData: unknown) => Promise<void>;
  runPromptWithVerify: (prompt: string) => Promise<void>;
  close: () => Promise<void>;
}

export async function createCliSession(opts: CliSessionOptions): Promise<CliSession> {
  const { cwd, sessionId, resumeId, modelOverride, prompt, enterRepl, verbose, allowAll, ask, plan, allowlist, useTui, verify, budget, maxSteps, contextWindowTokens, timeoutMs, rateLimiter } = opts;
  const modelRef = { current: modelOverride };

  // ── provider: load config + env fallback ──
  const cfg = await loadConfig(cwd);
  type Provider = ReturnType<typeof createOpenAICompatProvider>;
  let providers = buildProviderList(cfg);
  if (providers.length === 0) {
    const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1";
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY;
    if (apiKey) providers.push(createOpenAICompatProvider({ baseUrl, apiKey, models: [process.env.AGENT_MODEL ?? "gpt-4o-mini"], defaultModel: process.env.AGENT_MODEL ?? "gpt-4o-mini" }));
    const anthKey = process.env.ANTHROPIC_API_KEY;
    if (anthKey) providers.push(createAnthropicProvider({ apiKey: anthKey, models: [process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4"] }) as unknown as Provider);
  }
  if (providers.length === 0 && (enterRepl || prompt)) {
    const ok = await runSetupWizard();
    if (ok) {
      const cfg2 = await loadConfig(cwd);
      providers = buildProviderList(cfg2);
    }
  }
  if (providers.length === 0) {
    console.error("no provider configured — jalankan `minicode` untuk setup wizard,\natau: minicode config add --baseUrl <url> --apiKey <key>, atau set OPENAI_API_KEY");
    process.exit(1);
  }
  const router = createRouterProvider({ providers, ...(rateLimiter ? { limiter: rateLimiter } : {}) });

  // ── vector hybrid RAG ──
  let systemExtra: string | undefined;
  try {
    const candidates: { baseUrl: string; apiKey: string }[] = [];
    for (const p of cfg.providers) if (p.apiKey) candidates.push({ baseUrl: p.baseUrl, apiKey: p.apiKey });
    if (process.env.AGENT_BASE_URL || process.env.OPENAI_API_KEY) {
      candidates.push({ baseUrl: process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1", apiKey: process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY ?? "" });
    }
    if (candidates.length === 0 && (cfg.providers[0]?.apiKey || process.env.OPENAI_API_KEY)) {
      candidates.push({ baseUrl: cfg.providers[0]?.baseUrl ?? "https://api.openai.com/v1", apiKey: cfg.providers[0]?.apiKey ?? process.env.OPENAI_API_KEY ?? "" });
    }
    let hits: { text: string; score: number }[] = [];
    for (const c of candidates) {
      if (!c.apiKey) continue;
      try {
        hits = await searchHybrid(prompt, { baseUrl: c.baseUrl, apiKey: c.apiKey, cwd, topK: 5 });
        if (hits.length) break;
      } catch {}
    }
    if (hits.length) systemExtra = `\n# Relevant memory (hybrid vector+keyword)\n${hits.map((h) => `- ${h.text.slice(0, 300)} (score ${h.score.toFixed(2)})`).join("\n")}`;
    if (!hits.length && candidates.length === 0) {
      try {
        hits = await searchHybrid(prompt, { cwd, topK: 5 });
        if (hits.length) systemExtra = `\n# Relevant memory (keyword)\n${hits.map((h) => `- ${h.text.slice(0, 300)} (score ${h.score.toFixed(2)})`).join("\n")}`;
      } catch {}
    }
  } catch {}

  // ── skills list into system prompt ──
  const allLoadedSkills = await loadSkills(cwd);
  try {
    const skillPrompt = skillsToSystemPrompt(allLoadedSkills);
    if (skillPrompt) systemExtra = (systemExtra ?? "") + skillPrompt;
  } catch {}

  // ── resume: muat history penuh dari DB → seed ke ContextStore kernel ──
  let initialMessages: readonly Message[] | undefined;
  if (resumeId) {
    const prev = loadSession(resumeId, cwd);
    if (prev && prev.messages.length) {
      initialMessages = prev.messages as readonly Message[];
      console.error(c.dim(`[resumed session ${resumeId} (${prev.messages.length} messages)]\n`));
    } else {
      console.error(c.yellow(`[resume] session ${resumeId} not found — starting new ${sessionId}\n`));
    }
  }

  const compaction = process.env.DEEPSEEK_API_KEY
    ? createLlmCompaction({ apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1", model: "deepseek-chat" })
    : undefined;

  // ── MCP ──
  let sessionTools: Tool[] = allTools;
  try {
    if (cfg.mcpServers?.length) {
      const mcpTools = await mcpConnectAll(cfg.mcpServers);
      if (mcpTools.length) sessionTools = withMcpTools(allTools, mcpTools);
    }
  } catch (e) {
    process.stderr.write(`[mcp] init failed: ${formatError(e)}\n`);
  }

  // ── LSP ──
  try {
    if (cfg.lspServers?.length) lspConfigure(cfg.lspServers);
  } catch (e) {
    process.stderr.write(`[lsp] init failed: ${formatError(e)}\n`);
  }

  const permissionMode = allowAll ? "allow-all" : ask ? "ask" : plan ? "plan" : allowlist ? "allowlist" : "auto";

  const session = await createMinicodeSession({
    provider: router,
    tools: sessionTools,
    cwd,
    permissionMode,
    systemExtra,
    model: modelRef.current,
    ...(initialMessages ? { initialMessages } : {}),
    ...(maxSteps ? { maxSteps } : {}),
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs: timeoutMs === 0 ? Infinity : timeoutMs } : {}),
    ...(compaction ? { compaction } : {}),
  } as never);

  const effectiveInitialModel = modelRef.current ?? cfg.providers[0]?.models[0] ?? "default";

  // ── Shadow checkpoint: capture pre/post-edit per turn ──
  const preEditSnapshots = new Map<string, { path: string; content: string | null }>();
  const postEditSnapshots = new Map<string, { path: string; content: string | null }>();
  session.events.on("execution:started", (e) => {
    const name = e.execution.call.name;
    if (name !== "edit" && name !== "write_file") return;
    const p = (e.execution.call.args as { path?: string })?.path;
    if (!p || preEditSnapshots.has(p)) return;
    const abs = resolvePath(cwd ?? ".", p);
    let content: string | null;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      content = null;
    }
    preEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content });
  });
  session.events.on("execution:completed", (e) => {
    const name = e.execution.call.name;
    if (name !== "edit" && name !== "write_file") return;
    const p = (e.execution.call.args as { path?: string })?.path;
    if (!p) return;
    const abs = resolvePath(cwd ?? ".", p);
    try {
      postEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content: readFileSync(abs, "utf8") });
    } catch {
      postEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content: null });
    }
  });
  session.events.on("turn:completed", (e) => {
    const snapshots = [...preEditSnapshots.values()];
    const redoSnapshots = [...postEditSnapshots.values()];
    preEditSnapshots.clear();
    postEditSnapshots.clear();
    if (snapshots.length === 0) return;
    recordCheckpointFromSnapshots(sessionId, e.result.usage.turns, snapshots, `turn ${e.result.usage.turns}`, cwd, redoSnapshots).catch(() => {});
  });

  // ── Auto-verify & self-heal ──
  const verifyCommand = verify
    ? (process.env.MINICODE_VERIFY_CMD ?? cfg.verifyCommand ?? detectVerifyCommand(cwd) ?? "")
    : "";
  const verifyActive = verifyCommand.length > 0;

  async function runPromptWithVerify(p: string): Promise<void> {
    if (!verifyActive) {
      await session.run(p, { model: modelRef.current });
      return;
    }
    await runWithSelfHeal(p, {
      run: (prompt) => session.run(prompt, { model: modelRef.current }),
      verify: () => runVerify(verifyCommand, cwd ?? process.cwd()),
      onCycle: (cycle, max, v) => {
        if (cycle === max) {
          process.stderr.write(c.red(`\n[verify] still failing after ${max} attempts — leaving for user\n`));
          process.stderr.write(v.output.slice(0, 1200) + "\n");
        } else {
          process.stderr.write(c.yellow(`\n[verify] attempt ${cycle}/${max} failed — self-healing…\n`));
        }
      },
      onOk: (cycles) => process.stderr.write(c.green(`\n[verify] ok after ${cycles} fix cycles\n`)),
    });
  }

  // ── renderer ──
  const useInk = useTui && !enterRepl && !!prompt;
  let detachInk: (() => void) | undefined;
  if (useInk) {
    try {
      detachInk = attachInkRenderer(session.events, { verbose, model: effectiveInitialModel, budget });
    } catch {
      attachRenderer(session.events, { verbose });
    }
  } else {
    attachRenderer(session.events, { verbose });
  }

  const usage = createUsageCollector(session.events, effectiveInitialModel);

  async function persistCurrent(usageData: unknown) {
    try {
      saveSession(sessionId, cwd, undefined, session.state.history, usageData);
      if (resumeId) saveSession(resumeId, cwd, undefined, session.state.history, usageData);
    } catch {}
  }

  async function close(): Promise<void> {
    if (detachInk) detachInk();
    await mcpCloseAll();
    await lspCloseAll();
  }

  return { session, cfg, cwd, sessionId, modelRef, effectiveInitialModel, permissionMode, sessionTools, allLoadedSkills, usage, budget, detachInk, persistCurrent, runPromptWithVerify, close };
}
