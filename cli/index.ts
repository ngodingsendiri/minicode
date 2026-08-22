import { createDefaultRouter, createRouterProvider } from "../src/providers/router.ts";
import { createMinicodeSession } from "../src/session.ts";
import { allTools } from "../src/tools/index.ts";
import { attachRenderer, formatError } from "../src/tui/renderer.ts";
import { createUsageCollector } from "../src/policy/usage.ts";
import { loadConfig, saveProvider, removeProvider, detectAndSave } from "../src/config.ts";
import { createOpenAICompatProvider } from "../../minicore/src/providers/openai-compat.ts";
import { createAnthropicProvider } from "../src/providers/anthropic.ts";
import { saveSession, loadSession, listSessions } from "../src/session/persistence.ts";
import { searchHybrid } from "../src/memory/vector.ts";
import { createLlmCompaction } from "../src/policy/compaction.ts";
import { randomUUID } from "node:crypto";

const HELP = `minicode — coding agent on frozen MiniCore
usage:
  minicode "prompt" [options]
  minicode config <add|list|remove|detect> [options]
  minicode sessions <list|export> [id]
  echo "prompt" | minicode

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
  --interactive       REPL loop (readline)

Config:
  minicode config add --baseUrl <url> --apiKey <key> [--id <id>] [--global]
  minicode config list
  minicode config remove <id>
  minicode config detect --baseUrl <url> --apiKey <key>

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
    if (!id) {
      console.error("usage: minicode config remove <id>");
      process.exit(1);
    }
    await removeProvider(id);
    console.log(`removed ${id}`);
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
  } else {
    console.log(HELP);
    process.exit(0);
  }
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}
const verbose = args.includes("--verbose");
const allowAll = args.includes("--allow-all");
const ask = args.includes("--ask");
const interactive = args.includes("--interactive");
const cwdIdx = args.indexOf("--cwd");
const cwd = cwdIdx !== -1 ? args[cwdIdx + 1] : undefined;
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

const promptArgs = args.filter((a, i) => {
  if (a === "--verbose" || a === "--allow-all" || a === "--ask" || a === "--interactive") return false;
  if (a === "--cwd" || a === "--resume" || a === "--model" || a === "--session" || a === "--max-steps" || a === "--context-window") return false;
  if (cwdIdx !== -1 && i === cwdIdx + 1) return false;
  if (resumeIdx !== -1 && i === resumeIdx + 1) return false;
  if (modelIdx !== -1 && i === modelIdx + 1) return false;
  if (sessionIdx !== -1 && i === sessionIdx + 1) return false;
  if (maxStepsIdx !== -1 && i === maxStepsIdx + 1) return false;
  if (ctxWindowIdx !== -1 && i === ctxWindowIdx + 1) return false;
  if (a.startsWith("-")) return false;
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
    }, 200);
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
if (!prompt) {
  process.stderr.write("usage: bun cli/index.ts <prompt>\n");
  process.exit(1);
}

// --- provider: load config + env fallback (hybrid x-api-key) ---
const cfg = await loadConfig(cwd);
let providers: ReturnType<typeof createOpenAICompatProvider>[] = [];
for (const p of cfg.providers) {
  // hybrid: try to infer provider type
  if (p.providerHint === "anthropic" || p.baseUrl.includes("anthropic")) {
    providers.push(createAnthropicProvider({ apiKey: p.apiKey, baseUrl: p.baseUrl, models: p.models, defaultModel: p.models[0] }) as unknown as ReturnType<typeof createOpenAICompatProvider>);
  } else {
    providers.push(createOpenAICompatProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, models: p.models, defaultModel: p.models[0] }));
  }
}
// env fallback if no config
if (providers.length === 0) {
  const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY;
  if (apiKey) providers.push(createOpenAICompatProvider({ baseUrl, apiKey, models: [process.env.AGENT_MODEL ?? "gpt-4o-mini"], defaultModel: process.env.AGENT_MODEL ?? "gpt-4o-mini" }));
  const anthKey = process.env.ANTHROPIC_API_KEY;
  if (anthKey) providers.push(createAnthropicProvider({ apiKey: anthKey, models: [process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4"] }) as unknown as ReturnType<typeof createOpenAICompatProvider>);
}
if (providers.length === 0) {
  console.error("no provider configured — run: minicode config add --baseUrl <url> --apiKey <key>  or set OPENAI_API_KEY");
  process.exit(1);
}
const router = createRouterProvider({ providers });

// --- vector hybrid RAG ---
let systemExtra: string | undefined;
try {
  // try to use first provider's baseUrl/apiKey for embeddings (hybrid x-api-key)
  const firstCfg = cfg.providers[0];
  const baseUrl = firstCfg?.baseUrl ?? process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1";
  const apiKey = firstCfg?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (apiKey) {
    const hits = await searchHybrid(prompt, { baseUrl, apiKey, cwd, topK: 5 });
    if (hits.length) systemExtra = `\n# Relevant memory (hybrid vector+keyword)\n${hits.map((h) => `- ${h.text.slice(0, 300)} (score ${h.score.toFixed(2)})`).join("\n")}`;
  }
} catch {}

// --- resume: load previous messages as systemExtra ---
if (resumeId) {
  const prev = loadSession(resumeId, cwd);
  if (prev) {
    const transcript = prev.messages.map((m: unknown) => {
      const msg = m as { role: string; content: unknown };
      const txt = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content).slice(0, 200);
      return `${msg.role}: ${txt}`;
    }).join("\n").slice(0, 4000);
    systemExtra = (systemExtra ?? "") + `\n# Previous session ${resumeId}\n${transcript}`;
    console.error(`[resume ${resumeId} ${prev.messages.length} msgs]`);
  } else {
    console.error(`[resume] session ${resumeId} not found — starting new ${sessionId}`);
  }
}

const compaction = process.env.DEEPSEEK_API_KEY
  ? createLlmCompaction({ apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1", model: "deepseek-chat" })
  : undefined;

const session = await createMinicodeSession({
  provider: router,
  tools: allTools,
  cwd,
  permissionMode: allowAll ? "allow-all" : ask ? "ask" : "auto",
  systemExtra,
  model: modelOverride,
  ...(maxSteps ? { maxSteps } : {}),
  ...(contextWindowTokens ? { contextWindowTokens } : {}),
  ...(compaction ? { compaction } : {}),
} as never);

attachRenderer(session.events, { verbose });
const usage = createUsageCollector(session.events, modelOverride);

async function persistCurrent(usageData: unknown) {
  try {
    saveSession(sessionId, cwd, undefined, session.state.history, usageData);
    if (resumeId) saveSession(resumeId, cwd, undefined, session.state.history, usageData);
  } catch {}
}

if (interactive) {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "minicode> " });
  rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (!q) { rl.prompt(); continue; }
    if (q === "exit" || q === "quit") break;
    try {
      const res = await session.run(q, { model: modelOverride });
      const u = usage.get();
      process.stderr.write(`\n[session ${sessionId} saved] tokens in=${u.inputTokens} out=${u.outputTokens}\n`);
      await persistCurrent(res.usage);
    } catch (e) {
      process.stderr.write(`\n[error] ${formatError(e)}\n`);
    }
    rl.prompt();
  }
  rl.close();
  process.exit(0);
} else {
  try {
    const result = await session.run(prompt, { model: modelOverride });
    await persistCurrent(result.usage);
    const u = usage.get();
    process.stderr.write(`\n[session ${sessionId} saved] tokens in=${u.inputTokens} out=${u.outputTokens} cost=${u.cost?.toFixed(4) ?? "?"}\n`);
  } catch (e) {
    process.stderr.write(`\n[error] ${formatError(e)}\n`);
    process.exit(1);
  }
}
