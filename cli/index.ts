#!/usr/bin/env bun
import { createDefaultRouter, createRouterProvider } from "../src/providers/router.ts";
import { createMinicodeSession } from "../src/session.ts";
import { allTools, withMcpTools } from "../src/tools/index.ts";
import { attachRenderer, formatError } from "../src/tui/renderer.ts";
import { createUsageCollector } from "../src/policy/usage.ts";
import { attachInkRenderer } from "../src/tui/ink.tsx";
import { loadConfig, saveProvider, removeProvider, detectAndSave, saveMcpServer, removeMcpServer, saveLspServer, removeLspServer } from "../src/config.ts";
import { createOpenAICompatProvider } from "../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "../src/providers/anthropic.ts";
import { saveSession, loadSession, listSessions } from "../src/session/persistence.ts";
import { searchHybrid } from "../src/memory/vector.ts";
import { createLlmCompaction } from "../src/policy/compaction.ts";
import { connectAll as mcpConnectAll, closeAll as mcpCloseAll } from "../src/mcp/client.ts";
import { configureServers as lspConfigure, closeAllLsp as lspCloseAll } from "../src/lsp/client.ts";
import { loadSkills, findSkill, renderSkill, skillsToSystemPrompt } from "../src/skills/loader.ts";
import type { Tool } from "minicore";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";

const HELP = `minicode — coding agent on frozen MiniCore
usage:
  minicode                        # mode chat interaktif (setup wizard saat pertama)
  minicode "prompt" [options]     # sekali jalan
  echo "prompt" | minicode        # via pipe
  minicode config <add|list|remove|detect> [options]
  minicode config mcp <add|list|remove> [options]
  minicode config lsp <add|list|remove> [options]
  minicode mcp serve [--allow-all] [--all-tools]
  minicode skills <list|show <name>>   # .minicode/skills/*.md, prompt /name args
  minicode sessions <list|export> [id]

Options:
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
  --tui               Ink TUI (efficient, selectable, token bar)

Config:
  minicode config add --baseUrl <url> --apiKey <key> [--id <id>] [--global]
  minicode config list
  minicode config remove <id>
  minicode config detect --baseUrl <url> --apiKey <key>

MCP:
  minicode config mcp add <id> --command <cmd> --args "<arg1,arg2>" [--env K=V] [--global|--local]
  minicode config mcp list
  minicode config mcp remove <id>

LSP:
  minicode config lsp add <ext> --command <cmd> [--args "<arg1,arg2>"] [--env K=V] [--global|--local]
  minicode config lsp list
  minicode config lsp remove <ext>

MCP Server (expose minicode tools ke app AI lain):
  minicode mcp serve                    # curated tools, permission auto
  minicode mcp serve --all-tools        # termasuk delegate_task dll
  minicode mcp serve --allow-all        # tanpa permission check (hati-hati)

Sessions:
  minicode sessions list
  minicode sessions export <id> [--jsonl]

Env fallback:
  AGENT_BASE_URL, OPENAI_API_KEY/AGENT_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY, AGENT_MODEL
`;

const args = process.argv.slice(2);

// --- sessions subcommand ---
if (args[0] === "sessions") {
  const sub = args[1];
  if (sub === "list") {
    const cwdArg = getArg("--cwd");
    const rows = listSessions(cwdArg);
    if (rows.length === 0) console.log("(no sessions)");
    else for (const r of rows) console.log(`${r.id}  ${new Date(r.created_at).toISOString().slice(0, 19)}  ${r.cwd}`);
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
    console.log(`saved ${entry.id} (${entry.providerHint}) models: ${entry.models.slice(0, 5).join(", ")}${entry.models.length > 5 ? " ..." : ""} (${entry.models.length})`);
    process.exit(0);
  } else if (sub === "list") {
    const cfg = await loadConfig();
    if (cfg.providers.length === 0) console.log("(no providers — add via minicode config add)");
    else for (const p of cfg.providers) console.log(`${p.id}  ${p.baseUrl}  models:${p.models.length} hint:${p.providerHint ?? "?"}`);
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
    console.log(`removed ${id} (${isGlobal ? "global" : "local"})`);
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
    console.log(`detected ${res.models.length} models (${res.providerHint}):\n${res.models.join("\n")}`);
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
      console.log(`saved mcp server ${id}: ${command} ${cmdArgs.join(" ")}`);
      process.exit(0);
    } else if (mcpSub === "list") {
      const cfg = await loadConfig();
      if (!cfg.mcpServers?.length) console.log("(no mcp servers — add via minicode config mcp add)");
      else for (const m of cfg.mcpServers) console.log(`${m.id}  ${m.command} ${m.args.join(" ")}`);
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
      console.log(`removed mcp server ${id} (${isGlobal ? "global" : "local"})`);
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
      console.log(`saved lsp server ${ext}: ${command} ${cmdArgs.join(" ")}`);
      process.exit(0);
    } else if (lspSub === "list") {
      const cfg = await loadConfig();
      if (!cfg.lspServers?.length) console.log("(no lsp servers — add via minicode config lsp add)");
      else for (const l of cfg.lspServers) console.log(`${l.ext}  ${l.command} ${l.args.join(" ")}`);
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
      console.log(`removed lsp server ${ext} (${isGlobal ? "global" : "local"})`);
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

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// --- skills subcommand ---
if (args[0] === "skills") {
  const cwdArg = getArg("--cwd");
  const all = await loadSkills(cwdArg);
  if (args[1] === "list" || !args[1]) {
    if (all.length === 0) console.log("(no skills — add .minicode/skills/*.md with frontmatter name/description)");
    else for (const s of all) console.log(`/${s.name}  ${s.description}`);
  } else if (args[1] === "show") {
    const s = await findSkill(args[2] ?? "", cwdArg);
    if (!s) { console.error(`skill ${args[2]} not found`); process.exit(1); }
    console.log(`${s.description}\n\n${s.body}`);
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
const modelOverride = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
const sessionIdx = args.indexOf("--session");
const sessionId = sessionIdx !== -1 ? args[sessionIdx + 1] : randomUUID().slice(0, 8);
const maxStepsIdx = args.indexOf("--max-steps");
const maxSteps = maxStepsIdx !== -1 ? Number(args[maxStepsIdx + 1]) : undefined;
const ctxWindowIdx = args.indexOf("--context-window");
const contextWindowTokens = ctxWindowIdx !== -1 ? Number(args[ctxWindowIdx + 1]) : undefined;
const timeoutIdx = args.indexOf("--timeout");
const timeoutMs = timeoutIdx !== -1 ? Number(args[timeoutIdx + 1]) : undefined;

const promptArgs = args.filter((a, i) => {
  if (a === "--verbose" || a === "--allow-all" || a === "--ask" || a === "--interactive" || a === "--tui") return false;
  if (a === "--cwd" || a === "--resume" || a === "--model" || a === "--session" || a === "--max-steps" || a === "--context-window" || a === "--timeout") return false;
  if (cwdIdx !== -1 && i === cwdIdx + 1) return false;
  if (resumeIdx !== -1 && i === resumeIdx + 1) return false;
  if (modelIdx !== -1 && i === modelIdx + 1) return false;
  if (sessionIdx !== -1 && i === sessionIdx + 1) return false;
  if (maxStepsIdx !== -1 && i === maxStepsIdx + 1) return false;
  if (ctxWindowIdx !== -1 && i === ctxWindowIdx + 1) return false;
  if (timeoutIdx !== -1 && i === timeoutIdx + 1) return false;
  // only filter known flags, not prompt words like "-123"
  const knownFlags = new Set(["-h","--help","--verbose","--allow-all","--ask","--interactive","--tui","--cwd","--resume","--model","--session","--max-steps","--context-window","--timeout"]);
  if (knownFlags.has(a)) return false;
  if (a.startsWith("-") && knownFlags.has(a.split("=")[0]!)) return false;
  return true;
});

function readPrompt(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve("");
      }
    }, 500);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      if (!done) {
        done = true;
        clearTimeout(t);
        resolve(data.trim());
      }
    });
    // if stdin already ended
    if (process.stdin.readableEnded) {
      clearTimeout(t);
      resolve("");
    }
  });
}

const prompt = promptArgs.join(" ") || (await readPrompt());
// no prompt + TTY → masuk mode chat interaktif otomatis (bukan error)
const enterRepl = interactive || (!prompt && process.stdin.isTTY);
if (!prompt && !enterRepl) {
  process.stderr.write("usage: minicode \"prompt\"  |  minicode (mode interaktif)\n");
  process.exit(1);
}
if (useTui && !prompt) {
  // TUI butuh satu run untuk render; tanpa prompt fallback ke REPL
  process.stderr.write("[tui] butuh prompt — fallback ke mode interaktif\n");
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
      console.error(`[skill /${skill.name}]`);
    }
  }
} catch {}

// --- provider: load config + env fallback (hybrid x-api-key) ---
const cfg = await loadConfig(cwd);
type Provider = ReturnType<typeof createOpenAICompatProvider>;
function buildProviders(list: typeof cfg.providers): Provider[] {
  const out: Provider[] = [];
  for (const p of list) {
    // hybrid: try to infer provider type
    if (p.providerHint === "anthropic" || p.baseUrl.includes("anthropic")) {
      out.push(createAnthropicProvider({ apiKey: p.apiKey, baseUrl: p.baseUrl, models: p.models, defaultModel: p.models[0] }) as unknown as Provider);
    } else {
      out.push(createOpenAICompatProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, models: p.models, defaultModel: p.models[0] }));
    }
  }
  return out;
}
let providers = buildProviders(cfg.providers);

// first-run wizard — guided setup saat belum ada provider sama sekali
async function setupWizard(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n╭─ minicode v0.1.3 — setup pertama kali");
  console.log("│ Butuh satu LLM provider. Enter = OpenRouter default.");
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, (a) => res(a.trim())));
  const baseUrl = await ask("│ Base URL [https://openrouter.ai/api/v1]: ");
  const apiKey = await ask("│ API Key (sk-...): ");
  rl.close();
  if (!apiKey) { console.log("│ Dibatalkan — set OPENAI_API_KEY nanti kalau mau.\n╰─"); return false; }
  try {
    const url = baseUrl || "https://openrouter.ai/api/v1";
    const entry = await detectAndSave(url, apiKey);
    console.log(`│ ✓ tersimpan "${entry.id}" — ${entry.models.length} model ditemukan (${entry.providerHint})`);
    console.log("╰─ siap! ketik prompt langsung.\n");
    return true;
  } catch (e) {
    console.log(`│ ✗ detect gagal: ${formatError(e)}`);
    console.log("╰─ cek apiKey/baseUrl lalu ulangi: minicode config add --baseUrl <url> --apiKey <key>\n");
    return false;
  }
}

// env fallback if no config
if (providers.length === 0) {
  const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY;
  if (apiKey) providers.push(createOpenAICompatProvider({ baseUrl, apiKey, models: [process.env.AGENT_MODEL ?? "gpt-4o-mini"], defaultModel: process.env.AGENT_MODEL ?? "gpt-4o-mini" }));
  const anthKey = process.env.ANTHROPIC_API_KEY;
  if (anthKey) providers.push(createAnthropicProvider({ apiKey: anthKey, models: [process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4"] }) as unknown as Provider);
}
// wizard fallback kalau masih kosong
if (providers.length === 0 && (enterRepl || prompt)) {
  const ok = await setupWizard();
  if (ok) {
    const cfg2 = await loadConfig(cwd);
    providers = buildProviders(cfg2.providers);
  }
}
if (providers.length === 0) {
  console.error("no provider configured — jalankan `minicode` untuk setup wizard,\natau: minicode config add --baseUrl <url> --apiKey <key>, atau set OPENAI_API_KEY");
  process.exit(1);
}
const router = createRouterProvider({ providers });

// --- vector hybrid RAG (try all providers until embedding succeeds) ---
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
  // fallback keyword-only if no embedding key worked but hits still possible via keyword
  if (!hits.length && candidates.length === 0) {
    try {
      hits = await searchHybrid(prompt, { cwd, topK: 5 });
      if (hits.length) systemExtra = `\n# Relevant memory (keyword)\n${hits.map((h) => `- ${h.text.slice(0, 300)} (score ${h.score.toFixed(2)})`).join("\n")}`;
    } catch {}
  }
} catch {}

// --- skills list into system prompt ---
try {
  const allSkills = await loadSkills(cwd);
  const skillPrompt = skillsToSystemPrompt(allSkills);
  if (skillPrompt) systemExtra = (systemExtra ?? "") + skillPrompt;
} catch {}

// --- resume: load previous messages as systemExtra (cap 2000 to keep total <8000) ---
if (resumeId) {
  const prev = loadSession(resumeId, cwd);
  if (prev) {
    const transcript = prev.messages.map((m: unknown) => {
      const msg = m as { role: string; content: unknown };
      const txt = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content).slice(0, 150);
      return `${msg.role}: ${txt}`;
    }).join("\n").slice(0, 2000);
    systemExtra = (systemExtra ?? "") + `\n# Previous session ${resumeId}\n${transcript}`;
    console.error(`[resume ${resumeId} ${prev.messages.length} msgs]`);
  } else {
    console.error(`[resume] session ${resumeId} not found — starting new ${sessionId}`);
  }
}

const compaction = process.env.DEEPSEEK_API_KEY
  ? createLlmCompaction({ apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1", model: "deepseek-chat" })
  : undefined;

// --- MCP: connect servers from config, merge tools ---
let sessionTools: Tool[] = allTools;
try {
  if (cfg.mcpServers?.length) {
    const mcpTools = await mcpConnectAll(cfg.mcpServers);
    if (mcpTools.length) sessionTools = withMcpTools(allTools, mcpTools);
  }
} catch (e) {
  process.stderr.write(`[mcp] init failed: ${formatError(e)}\n`);
}

// --- LSP: register servers from config (lazy spawn on first tool call) ---
try {
  if (cfg.lspServers?.length) lspConfigure(cfg.lspServers);
} catch (e) {
  process.stderr.write(`[lsp] init failed: ${formatError(e)}\n`);
}
// explicit cleanup is awaited at normal exit paths below; 'exit' is sync-only so no async here.
// keep sync best-effort for unexpected exit
process.on("exit", () => {
  // sync: abort signals already via killSignal in transports
});

const session = await createMinicodeSession({
  provider: router,
  tools: sessionTools,
  cwd,
  permissionMode: allowAll ? "allow-all" : ask ? "ask" : "auto",
  systemExtra,
  model: modelOverride,
  ...(maxSteps ? { maxSteps } : {}),
  ...(contextWindowTokens ? { contextWindowTokens } : {}),
  ...(timeoutMs !== undefined ? { timeoutMs: timeoutMs === 0 ? Infinity : timeoutMs } : {}),
  ...(compaction ? { compaction } : {}),
} as never);

const useInk = useTui && !enterRepl && !!prompt;
let detachInk: (() => void) | undefined;
if (useInk) {
  try {
    detachInk = attachInkRenderer(session.events, { verbose });
  } catch {
    attachRenderer(session.events, { verbose });
  }
} else attachRenderer(session.events, { verbose });
const usage = createUsageCollector(session.events, modelOverride);

async function persistCurrent(usageData: unknown) {
  try {
    saveSession(sessionId, cwd, undefined, session.state.history, usageData);
    if (resumeId) saveSession(resumeId, cwd, undefined, session.state.history, usageData);
  } catch {}
}

if (enterRepl) {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "minicode> " });
  process.stderr.write(`minicode v0.1.3 — ketik prompt, /skill, atau exit\n`);
  rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (!q) { rl.prompt(); continue; }
    if (q === "exit" || q === "quit") break;
    try {
      const res = await session.run(q.startsWith("/") ? (await (async () => {
        const spaceIdx = q.indexOf(" ");
        const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx);
        const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1);
        const skill = await findSkill(skillName, cwd).catch(() => undefined);
        return skill ? await renderSkill(skill, skillArgs) : q;
      })()) : q, { model: modelOverride });
      const u = usage.get();
      process.stderr.write(`\n[session ${sessionId} saved] tokens in=${u.inputTokens} out=${u.outputTokens}\n`);
      await persistCurrent(u);
      usage.reset();
    } catch (e) {
      process.stderr.write(`\n[error] ${formatError(e)}\n`);
    }
    rl.prompt();
  }
  rl.close();
  if (detachInk) detachInk();
  await mcpCloseAll();
  await lspCloseAll();
  process.exit(0);
} else {
  try {
    const result = await session.run(effectivePrompt, { model: modelOverride });
    const u = usage.get();
    await persistCurrent(u);
    process.stderr.write(`\n[session ${sessionId} saved] tokens in=${u.inputTokens} out=${u.outputTokens} cost=${u.cost?.toFixed(4) ?? "?"}\n`);
  } catch (e) {
    process.stderr.write(`\n[error] ${formatError(e)}\n`);
    if (detachInk) detachInk();
    await mcpCloseAll();
    await lspCloseAll();
    process.exit(1);
  }
  if (detachInk) {
    // give Ink a moment to render final frame
    await new Promise((r) => setTimeout(r, 200));
    detachInk();
  }
  await mcpCloseAll();
  await lspCloseAll();
}
