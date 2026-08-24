#!/usr/bin/env bun
import { createRouterProvider } from "../src/providers/router.ts";
import { buildProviderList } from "../src/providers/build.ts";
import { getArg as rawGetArg, readPrompt, promptFromArgs } from "./args.ts";
import { createMinicodeSession } from "../src/session.ts";
import { allTools, withMcpTools } from "../src/tools/index.ts";
import { attachRenderer, formatError } from "../src/tui/renderer.ts";
import { createUsageCollector } from "../src/policy/usage.ts";
import { attachInkRenderer } from "../src/tui/ink.tsx";
import { loadConfig, removeProvider, detectAndSave, saveMcpServer, removeMcpServer, saveLspServer, removeLspServer } from "../src/config.ts";
import { createOpenAICompatProvider } from "../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "../src/providers/anthropic.ts";
import { saveSession, loadSession, listSessions } from "../src/session/persistence.ts";
import { searchHybrid } from "../src/memory/vector.ts";
import { createLlmCompaction } from "../src/policy/compaction.ts";
import { connectAll as mcpConnectAll, closeAll as mcpCloseAll } from "../src/mcp/client.ts";
import { configureServers as lspConfigure, closeAllLsp as lspCloseAll } from "../src/lsp/client.ts";
import { loadSkills, findSkill, renderSkill, skillsToSystemPrompt } from "../src/skills/loader.ts";
import { c, glyphs, box } from "../src/tui/theme.ts";
import { renderTable } from "../src/tui/table.ts";
import { runSetupWizard } from "./wizard.ts";
import { createInteractivePrompt, appendHistory } from "./input.ts";
import { handleBuiltinCommand, BUILTIN_COMMANDS } from "./commands.ts";
import { recordCheckpointFromSnapshots } from "../src/session/checkpoint.ts";
import { runWithSelfHeal, runVerify, detectVerifyCommand } from "../src/policy/verifier.ts";
import { createRateLimiter } from "../src/policy/ratelimit.ts";
import { writeTrace } from "../src/telemetry/trace.ts";
import type { Tool, Message } from "minicore";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { readFileSync } from "node:fs";

const HELP = `${c.bold(c.cyan(glyphs.sparkle + " Minicode"))} — coding agent on frozen MiniCore
${c.bold("Usage:")}
  minicode                        # mode chat interaktif (setup wizard saat pertama)
  minicode "prompt" [options]     # sekali jalan
  echo "prompt" | minicode        # via pipe
  minicode config <add|list|remove|detect> [options]
  minicode config mcp <add|list|remove> [options]
  minicode config lsp <add|list|remove> [options]
  minicode mcp serve [--allow-all] [--all-tools]
  minicode skills <list|show <name>>   # .minicode/skills/*.md, prompt /name args
  minicode sessions <list|export> [id]

${c.bold("Options:")}
  -h, --help          show help
  --verbose           show reasoning & usage
  --cwd <dir>         workspace root (default .)
  --resume <id>       resume session id
  --model <name>      override model
  --session <id>      session id (default random)
  --allow-all         allow all tools (no sandbox)
  --ask               ask per tool (y/n/a) — human-in-loop
  --max-steps <n>     max tool steps (default 50)
  --context-window <n> context window tokens
  --timeout <ms>      hard deadline per run (default 600000 = 10min; 0 = Infinity)
  --interactive       REPL loop (readline)
  --tui               Ink TUI dashboard (split-view, activity stream)
  --verify            auto-verify after run + self-heal (bila ada typecheck/test/tsconfig)
  --sandbox <mode>    sandbox eksekusi bash: docker (container ephemeral, --network none)
  --ratelimit <rpm>   batas request LLM per menit (token bucket) untuk cegah 429
  --budget <usd>      batas biaya sesi (USD); warn bila 80%, stop bila lewat

${c.bold("Commands in REPL:")}
  /help, /clear, /model, /cost, /compact, /sessions, /status, /exit
`;

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  return rawGetArg(args, name);
}

// --- sessions subcommand ---
if (args[0] === "sessions") {
  const sub = args[1];
  if (sub === "list" || !sub) {
    const cwdArg = getArg("--cwd");
    const rows = listSessions(cwdArg);
    if (rows.length === 0) {
      console.log(c.dim("(no sessions recorded)"));
    } else {
      const tableData = rows.map((r) => ({
        id: c.cyan(r.id),
        date: new Date(r.created_at).toLocaleString(),
        cwd: c.dim(r.cwd),
      }));
      console.log(`\n${c.bold("Recent Sessions")}\n` + renderTable(
        [
          { header: "Session ID", key: "id", width: 14 },
          { header: "Created At", key: "date", width: 22 },
          { header: "Workspace Directory", key: "cwd", width: 36 },
        ],
        tableData
      ) + "\n");
    }
    process.exit(0);
  } else if (sub === "export") {
    const id = args[2];
    const asJsonl = args.includes("--jsonl");
    if (!id) { console.error("usage: minicode sessions export <id> [--jsonl]"); process.exit(1); }
    const cwdArg = getArg("--cwd");
    const sess = loadSession(id, cwdArg);
    if (!sess) { console.error(`session ${id} not found`); process.exit(1); }
    if (asJsonl) for (const m of sess.messages) console.log(JSON.stringify(m));
    else console.log(JSON.stringify(sess, null, 2));
    process.exit(0);
  } else {
    console.log(HELP);
    process.exit(0);
  }
}

// --- mcp server mode ---
if (args[0] === "mcp") {
  const sub = args[1];
  if (sub === "serve") {
    const { serveMcp } = await import("../src/mcp/server.ts");
    const cwdArg = getArg("--cwd");
    if (cwdArg) process.chdir(cwdArg);
    await serveMcp({
      allowAll: args.includes("--allow-all"),
      allTools: args.includes("--all-tools"),
      root: cwdArg,
    });
    process.exit(0);
  } else {
    console.log(HELP);
    process.exit(sub === undefined || sub === "--help" || sub === "-h" ? 0 : 1);
  }
}

// --- config subcommand ---
if (args[0] === "config") {
  const sub = args[1];
  if (sub === "add") {
    const baseUrl = getArg("--baseUrl");
    const apiKey = getArg("--apiKey");
    const id = getArg("--id");
    const isGlobal = args.includes("--global");
    if (!baseUrl || !apiKey) {
      console.error("usage: minicode config add --baseUrl <url> --apiKey <key> [--id <id>]");
      process.exit(1);
    }
    const entry = await detectAndSave(baseUrl, apiKey, id, { global: isGlobal });
    console.log(`${c.green(glyphs.check)} Saved provider "${c.bold(entry.id)}" (${entry.providerHint}) models: ${entry.models.slice(0, 5).join(", ")}${entry.models.length > 5 ? " ..." : ""} (${entry.models.length} total)`);
    process.exit(0);
  } else if (sub === "list") {
    const cfg = await loadConfig();
    if (cfg.providers.length === 0) {
      console.log(c.dim("(no providers configured — add via minicode config add or setup wizard)"));
    } else {
      const tableData = cfg.providers.map((p) => ({
        id: c.cyan(p.id),
        url: p.baseUrl,
        models: String(p.models.length),
        hint: c.dim(p.providerHint ?? "?"),
      }));
      console.log(`\n${c.bold("Configured LLM Providers")}\n` + renderTable(
        [
          { header: "Provider ID", key: "id", width: 14 },
          { header: "Base URL", key: "url", width: 34 },
          { header: "Models", key: "models", width: 8, align: "right" },
          { header: "Type", key: "hint", width: 14 },
        ],
        tableData
      ) + "\n");
    }
    process.exit(0);
  } else if (sub === "remove") {
    const id = args[2];
    const isGlobal = !args.includes("--local");
    const cwdArg = getArg("--cwd");
    if (!id) {
      console.error("usage: minicode config remove <id> [--global|--local] [--cwd <dir>]");
      process.exit(1);
    }
    await removeProvider(id, { global: isGlobal, cwd: cwdArg });
    console.log(`${c.green(glyphs.check)} Removed provider ${id} (${isGlobal ? "global" : "local"})`);
    process.exit(0);
  } else if (sub === "detect") {
    const baseUrl = getArg("--baseUrl");
    const apiKey = getArg("--apiKey");
    if (!baseUrl || !apiKey) {
      console.error("usage: minicode config detect --baseUrl <url> --apiKey <key>");
      process.exit(1);
    }
    const { detectModels } = await import("../src/providers/detect.ts");
    const res = await detectModels(baseUrl, apiKey);
    console.log(`${c.green(glyphs.check)} Detected ${res.models.length} models (${res.providerHint}):\n${res.models.map((m) => `  ${glyphs.dot} ${m}`).join("\n")}`);
    process.exit(0);
  } else if (sub === "mcp") {
    const mcpSub = args[2];
    if (mcpSub === "add") {
      const id = args[3];
      const command = getArg("--command");
      const cmdArgsRaw = getArg("--args");
      const isGlobal = !args.includes("--local");
      if (!id || !command || !cmdArgsRaw) {
        console.error('usage: minicode config mcp add <id> --command <cmd> --args "<arg1,arg2>" [--env K=V] [--global|--local]');
        process.exit(1);
      }
      const cmdArgs = cmdArgsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const env: Record<string, string> = {};
      for (const kv of (getArg("--env") ?? "").split(",")) {
        const [k, ...rest] = kv.split("=");
        if (k && rest.length) env[k.trim()] = rest.join("=").trim();
      }
      await saveMcpServer({ id, command, args: cmdArgs, ...(Object.keys(env).length ? { env } : {}) }, { global: isGlobal });
      console.log(`${c.green(glyphs.check)} Saved MCP server "${c.bold(id)}": ${command} ${cmdArgs.join(" ")}`);
      process.exit(0);
    } else if (mcpSub === "list") {
      const cfg = await loadConfig();
      if (!cfg.mcpServers?.length) {
        console.log(c.dim("(no MCP servers configured — add via minicode config mcp add)"));
      } else {
        const tableData = cfg.mcpServers.map((m) => ({
          id: c.cyan(m.id),
          command: m.command,
          args: c.dim(m.args.join(" ")),
        }));
        console.log(`\n${c.bold("Configured MCP Servers")}\n` + renderTable(
          [
            { header: "Server ID", key: "id", width: 14 },
            { header: "Command", key: "command", width: 20 },
            { header: "Arguments", key: "args", width: 36 },
          ],
          tableData
        ) + "\n");
      }
      process.exit(0);
    } else if (mcpSub === "remove") {
      const id = args[3];
      const isGlobal = !args.includes("--local");
      const cwdArg = getArg("--cwd");
      if (!id) {
        console.error("usage: minicode config mcp remove <id> [--global|--local]");
        process.exit(1);
      }
      await removeMcpServer(id, { global: isGlobal, cwd: cwdArg });
      console.log(`${c.green(glyphs.check)} Removed MCP server ${id} (${isGlobal ? "global" : "local"})`);
      process.exit(0);
    } else {
      console.log(HELP);
      process.exit(0);
    }
  } else if (sub === "lsp") {
    const lspSub = args[2];
    if (lspSub === "add") {
      const ext = args[3];
      const command = getArg("--command");
      const cmdArgsRaw = getArg("--args") ?? "";
      const isGlobal = !args.includes("--local");
      if (!ext || !command) {
        console.error('usage: minicode config lsp add <ext> --command <cmd> [--args "<arg1,arg2>"] [--env K=V] [--global|--local]');
        process.exit(1);
      }
      const cmdArgs = cmdArgsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const env: Record<string, string> = {};
      for (const kv of (getArg("--env") ?? "").split(",")) {
        const [k, ...rest] = kv.split("=");
        if (k && rest.length) env[k.trim()] = rest.join("=").trim();
      }
      await saveLspServer({ ext, command, args: cmdArgs, ...(Object.keys(env).length ? { env } : {}) }, { global: isGlobal });
      console.log(`${c.green(glyphs.check)} Saved LSP server for ${c.bold(ext)}: ${command} ${cmdArgs.join(" ")}`);
      process.exit(0);
    } else if (lspSub === "list") {
      const cfg = await loadConfig();
      if (!cfg.lspServers?.length) {
        console.log(c.dim("(no LSP servers configured — add via minicode config lsp add)"));
      } else {
        const tableData = cfg.lspServers.map((l) => ({
          ext: c.cyan(l.ext),
          command: l.command,
          args: c.dim(l.args.join(" ")),
        }));
        console.log(`\n${c.bold("Configured LSP Language Servers")}\n` + renderTable(
          [
            { header: "Extension", key: "ext", width: 12 },
            { header: "Command", key: "command", width: 22 },
            { header: "Arguments", key: "args", width: 36 },
          ],
          tableData
        ) + "\n");
      }
      process.exit(0);
    } else if (lspSub === "remove") {
      const ext = args[3];
      const isGlobal = !args.includes("--local");
      const cwdArg = getArg("--cwd");
      if (!ext) {
        console.error("usage: minicode config lsp remove <ext> [--global|--local]");
        process.exit(1);
      }
      await removeLspServer(ext, { global: isGlobal, cwd: cwdArg });
      console.log(`${c.green(glyphs.check)} Removed LSP server for ${ext} (${isGlobal ? "global" : "local"})`);
      process.exit(0);
    } else {
      console.log(HELP);
      process.exit(0);
    }
  } else {
    console.log(HELP);
    process.exit(0);
  }
}

// --- skills subcommand ---
if (args[0] === "skills") {
  const cwdArg = getArg("--cwd");
  const all = await loadSkills(cwdArg);
  if (args[1] === "list" || !args[1]) {
    if (all.length === 0) {
      console.log(c.dim("(no skills found — add markdown files in .minicode/skills/*.md)"));
    } else {
      const tableData = all.map((s) => ({
        skill: c.yellow(`/${s.name}`),
        desc: s.description || "(no description)",
      }));
      console.log(`\n${c.bold("Installed Agent Skills")}\n` + renderTable(
        [
          { header: "Skill Command", key: "skill", width: 18 },
          { header: "Description", key: "desc", width: 50 },
        ],
        tableData
      ) + "\n");
    }
  } else if (args[1] === "show") {
    const s = await findSkill(args[2] ?? "", cwdArg);
    if (!s) { console.error(`skill ${args[2]} not found`); process.exit(1); }
    console.log(`${c.bold(c.cyan("/" + s.name))} ${c.dim("— " + s.description)}\n\n${s.body}`);
  }
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}

const verbose = args.includes("--verbose");
const allowAll = args.includes("--allow-all");
const ask = args.includes("--ask");
const interactive = args.includes("--interactive");
const useTui = args.includes("--tui");
const cwdIdx = args.indexOf("--cwd");
const cwdRaw = cwdIdx !== -1 ? args[cwdIdx + 1] : undefined;
const cwd = cwdRaw ? resolvePath(cwdRaw) : undefined;
if (cwd) {
  try {
    process.chdir(cwd);
  } catch {}
}
const resumeIdx = args.indexOf("--resume");
const resumeId = resumeIdx !== -1 ? args[resumeIdx + 1] : undefined;
const modelIdx = args.indexOf("--model");
let modelOverride = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
const sessionIdx = args.indexOf("--session");
const sessionId = sessionIdx !== -1 ? args[sessionIdx + 1] : randomUUID().slice(0, 8);
const maxStepsIdx = args.indexOf("--max-steps");
const maxSteps = maxStepsIdx !== -1 ? Number(args[maxStepsIdx + 1]) : undefined;
const ctxWindowIdx = args.indexOf("--context-window");
const contextWindowTokens = ctxWindowIdx !== -1 ? Number(args[ctxWindowIdx + 1]) : undefined;
const timeoutIdx = args.indexOf("--timeout");
const timeoutMs = timeoutIdx !== -1 ? Number(args[timeoutIdx + 1]) : undefined;

const prompt = promptFromArgs(args) || (await readPrompt());
const enterRepl = interactive || (!prompt && process.stdin.isTTY);
if (!prompt && !enterRepl) {
  process.stderr.write("usage: minicode \"prompt\"  |  minicode (mode interaktif)\n");
  process.exit(1);
}

// --- skills: expand /name args into rendered prompt ---
let effectivePrompt = prompt;
try {
  if (prompt.startsWith("/")) {
    const spaceIdx = prompt.indexOf(" ");
    const skillName = spaceIdx === -1 ? prompt.slice(1) : prompt.slice(1, spaceIdx);
    const skillArgs = spaceIdx === -1 ? "" : prompt.slice(spaceIdx + 1);
    const skill = await findSkill(skillName, cwd);
    if (skill) {
      effectivePrompt = await renderSkill(skill, skillArgs);
      console.error(c.dim(`[loaded skill /${skill.name}]`));
    }
  }
} catch {}

// --- provider: load config + env fallback ---
const cfg = await loadConfig(cwd);
type Provider = ReturnType<typeof createOpenAICompatProvider>;
let providers = buildProviderList(cfg);

// env fallback if no config
if (providers.length === 0) {
  const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY;
  if (apiKey) providers.push(createOpenAICompatProvider({ baseUrl, apiKey, models: [process.env.AGENT_MODEL ?? "gpt-4o-mini"], defaultModel: process.env.AGENT_MODEL ?? "gpt-4o-mini" }));
  const anthKey = process.env.ANTHROPIC_API_KEY;
  if (anthKey) providers.push(createAnthropicProvider({ apiKey: anthKey, models: [process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4"] }) as unknown as Provider);
}

// wizard fallback if still empty
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

// ── sandbox & rate limiter & budget ──
const sandboxMode = getArg("--sandbox");
if (sandboxMode === "docker") process.env.MINICODE_SANDBOX = "docker";
else if (sandboxMode) process.stderr.write(`[warn] sandbox mode "${sandboxMode}" tidak dikenal — hanya "docker"\n`);
const budgetRaw = getArg("--budget");
const budget = budgetRaw ? Number(budgetRaw) : undefined;
if (budgetRaw && !Number.isFinite(budget)) process.stderr.write(`[warn] --budget butuh angka USD, abaikan "${budgetRaw}"\n`);

const ratelimitRaw = getArg("--ratelimit");
const rateLimiter = ratelimitRaw ? createRateLimiter(Number(ratelimitRaw)) : undefined;
if (rateLimiter && !Number.isFinite(Number(ratelimitRaw))) {
  process.stderr.write(`[warn] --ratelimit butuh angka (rpm), abaikan "${ratelimitRaw}"\n`);
}

const router = createRouterProvider({ providers, ...(rateLimiter ? { limiter: rateLimiter } : {}) });

// --- vector hybrid RAG ---
let systemExtra: string | undefined;
try {
  const candidates: { baseUrl: string; apiKey: string }[] = [];
  for (const p of cfg.providers) if (p.apiKey) candidates.push({ baseUrl: p.baseUrl, apiKey: p.apiKey });
  if (process.env.AGENT_BASE_URL || process.env.OPENAI_API_KEY) {
    candidates.push({
      baseUrl: process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY ?? "",
    });
  }
  if (candidates.length === 0 && (cfg.providers[0]?.apiKey || process.env.OPENAI_API_KEY)) {
    candidates.push({
      baseUrl: cfg.providers[0]?.baseUrl ?? "https://api.openai.com/v1",
      apiKey: cfg.providers[0]?.apiKey ?? process.env.OPENAI_API_KEY ?? "",
    });
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

// --- skills list into system prompt ---
const allLoadedSkills = await loadSkills(cwd);
try {
  const skillPrompt = skillsToSystemPrompt(allLoadedSkills);
  if (skillPrompt) systemExtra = (systemExtra ?? "") + skillPrompt;
} catch {}

// --- resume: muat history penuh dari DB → seed ke ContextStore kernel ---
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

// --- MCP ---
let sessionTools: Tool[] = allTools;
try {
  if (cfg.mcpServers?.length) {
    const mcpTools = await mcpConnectAll(cfg.mcpServers);
    if (mcpTools.length) sessionTools = withMcpTools(allTools, mcpTools);
  }
} catch (e) {
  process.stderr.write(`[mcp] init failed: ${formatError(e)}\n`);
}

// --- LSP ---
try {
  if (cfg.lspServers?.length) lspConfigure(cfg.lspServers);
} catch (e) {
  process.stderr.write(`[lsp] init failed: ${formatError(e)}\n`);
}

const permissionMode = allowAll ? "allow-all" : ask ? "ask" : "auto";

const session = await createMinicodeSession({
  provider: router,
  tools: sessionTools,
  cwd,
  permissionMode,
  systemExtra,
  model: modelOverride,
  ...(initialMessages ? { initialMessages } : {}),
  ...(maxSteps ? { maxSteps } : {}),
  ...(contextWindowTokens ? { contextWindowTokens } : {}),
  ...(timeoutMs !== undefined ? { timeoutMs: timeoutMs === 0 ? Infinity : timeoutMs } : {}),
  ...(compaction ? { compaction } : {}),
} as never);

const effectiveInitialModel = modelOverride ?? cfg.providers[0]?.models[0] ?? "default";

// ── Shadow checkpoint: capture state file SEBELUM edit → /undo bisa memulihkan ──
// Capture pre-edit (execution:started) dan post-edit (execution:completed) untuk
// tool edit/write_file, sekali per path per turn, lalu rekam saat turn selesai.
const preEditSnapshots = new Map<string, { path: string; content: string | null }>();
const postEditSnapshots = new Map<string, { path: string; content: string | null }>();
const cpCaptureOff = session.events.on("execution:started", (e) => {
  const name = e.execution.call.name;
  if (name !== "edit" && name !== "write_file") return;
  const p = (e.execution.call.args as { path?: string })?.path;
  if (!p || preEditSnapshots.has(p)) return;
  const abs = resolvePath(cwd ?? ".", p);
  let content: string | null;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    content = null; // file belum ada (write_file baru)
  }
  preEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content });
});
const cpPostOff = session.events.on("execution:completed", (e) => {
  const name = e.execution.call.name;
  if (name !== "edit" && name !== "write_file") return;
  const p = (e.execution.call.args as { path?: string })?.path;
  if (!p) return;
  // ambil state final (post-edit) — overwrite tiap kali, /redo memakai ini
  const abs = resolvePath(cwd ?? ".", p);
  try {
    postEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content: readFileSync(abs, "utf8") });
  } catch {
    postEditSnapshots.set(p, { path: p.replace(/\\/g, "/"), content: null });
  }
});
const cpTurnOff = session.events.on("turn:completed", (e) => {
  const snapshots = [...preEditSnapshots.values()];
  const redoSnapshots = [...postEditSnapshots.values()];
  preEditSnapshots.clear();
  postEditSnapshots.clear();
  if (snapshots.length === 0) return;
  recordCheckpointFromSnapshots(sessionId, e.result.usage.turns, snapshots, `turn ${e.result.usage.turns}`, cwd, redoSnapshots).catch(() => {});
});

// ── Auto-verify & self-heal ──
const verifyEnabled = args.includes("--verify");
const verifyCommand = verifyEnabled
  ? (process.env.MINICODE_VERIFY_CMD ?? cfg.verifyCommand ?? detectVerifyCommand(cwd) ?? "")
  : "";
const verifyActive = verifyCommand.length > 0;

async function runPromptWithVerify(p: string): Promise<void> {
  if (!verifyActive) {
    await session.run(p, { model: modelOverride });
    return;
  }
  await runWithSelfHeal(p, {
    run: (prompt) => session.run(prompt, { model: modelOverride }),
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

// Ink TUI hanya untuk one-shot run (punya prompt, bukan REPL) — hindari tabrakan
// dengan readline REPL di terminal yang sama.
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

if (enterRepl) {
  const getCompletions = (line: string): string[] => {
    if (!line.startsWith("/")) return [];
    const candidates = [
      ...BUILTIN_COMMANDS.map((b) => `/${b.name}`),
      ...allLoadedSkills.map((s) => `/${s.name}`),
    ];
    return candidates.filter((c) => c.startsWith(line));
  };

  const interactivePrompt = createInteractivePrompt({
    modelName: modelOverride ?? cfg.providers[0]?.models[0],
    getCompletions,
  });

  const banner = `${c.cyan(c.bold(glyphs.sparkle + " Minicode v0.2.0"))} ${c.dim(`[${modelOverride ?? cfg.providers[0]?.models[0] ?? "default"} · ${permissionMode}]`)} — ${c.dim("type prompt or /help")}\n`;
  process.stdout.write(banner);

  const commandCtx = {
    cwd,
    sessionId,
    currentModel: modelOverride ?? cfg.providers[0]?.models[0],
    usage,
    skills: allLoadedSkills,
    toolsCount: sessionTools.length,
    providerHint: cfg.providers[0]?.providerHint,
    setModelOverride: (m: string) => {
      modelOverride = m;
      commandCtx.currentModel = m;
    },
  };

  while (true) {
    const line = await interactivePrompt.ask();
    if (line == null) break;
    const q = line.trim();
    if (!q) continue;

    await appendHistory(q);

    // Check built-in commands
    const builtinResult = await handleBuiltinCommand(q, commandCtx);
    if (builtinResult.handled) {
      if (builtinResult.shouldExit) break;
      continue;
    }

    try {
      let finalPrompt = q;
      if (q.startsWith("/")) {
        const spaceIdx = q.indexOf(" ");
        const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx);
        const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1);
        const skill = await findSkill(skillName, cwd).catch(() => undefined);
        if (skill) {
          finalPrompt = await renderSkill(skill, skillArgs);
        }
      }

      const t0 = Date.now();
      try {
        await runPromptWithVerify(finalPrompt);
        const u = usage.get(modelOverride);
        const costBadge = u.cost != null ? ` · $${u.cost.toFixed(4)}` : "";
        if (budget != null && u.cost != null) {
          if (u.cost > budget) process.stderr.write(c.red(`[budget] $${u.cost.toFixed(4)} > $${budget.toFixed(2)} — over budget!\n`));
          else if (u.cost > budget * 0.8) process.stderr.write(c.yellow(`[budget] $${u.cost.toFixed(4)} / $${budget.toFixed(2)} (80% used)\n`));
        }
        process.stderr.write(c.dim(`\n[session ${sessionId} saved · ${u.totalTokens.toLocaleString()} tokens${costBadge}]\n\n`));
        writeTrace(cwd, {
          sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0,
          steps: session.state.stepCount, turns: session.state.turnCount,
          inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost, model: modelOverride, ok: true,
        });
        await persistCurrent(u);
        usage.reset();
      } catch (e) {
        process.stderr.write(`\n${c.red(glyphs.cross)} ${formatError(e)}\n\n`);
        writeTrace(cwd, {
          sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0,
          steps: session.state.stepCount, turns: session.state.turnCount,
          inputTokens: usage.get(modelOverride).inputTokens, outputTokens: usage.get(modelOverride).outputTokens,
          model: modelOverride, ok: false, error: formatError(e),
        });
      }
  }

  interactivePrompt.close();
  if (detachInk) detachInk();
  await mcpCloseAll();
  await lspCloseAll();
  process.exit(0);
} else {
  const t0 = Date.now();
  try {
    await runPromptWithVerify(effectivePrompt);
    const u = usage.get(modelOverride);
    if (budget != null && u.cost != null) {
      if (u.cost > budget) process.stderr.write(c.red(`[budget] $${u.cost.toFixed(4)} > $${budget.toFixed(2)} — over budget!\n`));
      else if (u.cost > budget * 0.8) process.stderr.write(c.yellow(`[budget] $${u.cost.toFixed(4)} / $${budget.toFixed(2)} (80% used)\n`));
    }
    await persistCurrent(u);
    const costBadge = u.cost != null ? ` cost=$${u.cost.toFixed(4)}` : "";
    process.stderr.write(c.dim(`\n[session ${sessionId} saved · in=${u.inputTokens} out=${u.outputTokens}${costBadge}]\n`));
    writeTrace(cwd, {
      sessionId, timestamp: new Date().toISOString(), prompt: effectivePrompt, durationMs: Date.now() - t0,
      steps: session.state.stepCount, turns: session.state.turnCount,
      inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost, model: modelOverride, ok: true,
    });
  } catch (e) {
    process.stderr.write(`\n${c.red(glyphs.cross)} ${formatError(e)}\n`);
    writeTrace(cwd, {
      sessionId, timestamp: new Date().toISOString(), prompt: effectivePrompt, durationMs: Date.now() - t0,
      steps: session.state.stepCount, turns: session.state.turnCount,
      inputTokens: usage.get(modelOverride).inputTokens, outputTokens: usage.get(modelOverride).outputTokens,
      model: modelOverride, ok: false, error: formatError(e),
    });
    if (detachInk) detachInk();
    await mcpCloseAll();
    await lspCloseAll();
    process.exit(1);
  }
  if (detachInk) {
    await new Promise((r) => setTimeout(r, 200));
    detachInk();
  }
  await mcpCloseAll();
  await lspCloseAll();
}
