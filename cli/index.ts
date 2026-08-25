#!/usr/bin/env bun
import { getArg as rawGetArg, readPrompt, promptFromArgs } from "./args.ts";
import { attachRenderer, formatError } from "../src/tui/renderer.ts";
import { createRateLimiter } from "../src/policy/ratelimit.ts";
import { writeTrace } from "../src/telemetry/trace.ts";
import { createCliSession } from "./setup.ts";
import { runRepl } from "./repl.ts";
import { loadConfig, removeProvider, detectAndSave, saveMcpServer, removeMcpServer, saveLspServer, removeLspServer } from "../src/config.ts";
import { listSessions, loadSession } from "../src/session/persistence.ts";
import { loadSkills, findSkill, renderSkill } from "../src/skills/loader.ts";
import { c, glyphs } from "../src/tui/theme.ts";
import { renderTable } from "../src/tui/table.ts";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";

const HELP = `Minicode — coding agent on frozen MiniCore
Usage:
  minicode                        # mode chat interaktif (setup wizard saat pertama)
  minicode "prompt" [options]     # sekali jalan
  echo "prompt" | minicode        # via pipe
  minicode providers              # daftar provider gateway (tanpa LLM)
  minicode models [id]            # daftar model per provider (tanpa LLM)
  minicode sync                   # refresh daftar model dari semua provider
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
  --plan              read-only plan mode (no file writes / bash / sub-agents)
  --allowlist         bash allowlist only (git/bun/npm safe cmds; via MINICODE_BASH_ALLOWLIST)
  --max-steps <n>     max tool steps (default 50)
  --context-window <n> context window tokens
  --timeout <ms>      hard deadline per run (default 600000 = 10min; 0 = Infinity)
  --interactive       REPL loop
  --tui               Ink TUI dashboard (split-view, activity stream)
  --verify            auto-verify after run + self-heal (uses typecheck/test/tsconfig)
  --sandbox <mode>    bash sandbox: docker (ephemeral container, --network none)
  --ratelimit <rpm>   limit LLM requests per minute (token bucket) to avoid 429
  --budget <usd>      session cost limit (USD); warn at 80%, stop when exceeded

Commands in REPL:
  /help /clear /model /models /providers /provider-add /sync /cost /sessions /resume /status /history /exit
`;

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  return rawGetArg(args, name);
}

// ── subcommand: stats ──
if (args[0] === "stats") {
  const cwdArg = getArg("--cwd");
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const file = resolve(cwdArg ?? ".", ".minicode", "traces.jsonl");
  let traces: any[] = [];
  try {
    traces = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {}
  const total = traces.length;
  const ok = traces.filter((t) => t.ok).length;
  const input = traces.reduce((s, t) => s + (t.inputTokens ?? 0), 0);
  const output = traces.reduce((s, t) => s + (t.outputTokens ?? 0), 0);
  const cost = traces.reduce((s, t) => s + (t.cost ?? 0), 0);
  const avgMs = total ? Math.round(traces.reduce((s, t) => s + (t.durationMs ?? 0), 0) / total) : 0;
  console.log(`Runs: ${total} · Resolved: ${ok}/${total} · Tokens in=${input} out=${output} · Cost: $${cost.toFixed(4)} · Avg ${avgMs}ms`);
  process.exit(0);
}

// ── subcommand: sessions ──
if (args[0] === "sessions") {
  const sub = args[1];
  if (sub === "list" || !sub) {
    const cwdArg = getArg("--cwd");
    const rows = listSessions(cwdArg);
    if (rows.length === 0) console.log(c.dim("(no sessions recorded)"));
    else {
      const tableData = rows.map((r) => ({ id: c.cyan(r.id), date: new Date(r.created_at).toLocaleString(), cwd: c.dim(r.cwd) }));
      console.log(`\n${c.bold("Recent Sessions")}\n` + renderTable([
        { header: "Session ID", key: "id", width: 14 },
        { header: "Created At", key: "date", width: 22 },
        { header: "Workspace Directory", key: "cwd", width: 36 },
      ], tableData) + "\n");
    }
    process.exit(0);
  } else if (sub === "export") {
    const id = args[2];
    const asJsonl = args.includes("--jsonl");
    if (!id) { console.error("usage: minicode sessions export <id> [--jsonl]"); process.exit(1); }
    const sess = loadSession(id, getArg("--cwd"));
    if (!sess) { console.error(`session ${id} not found`); process.exit(1); }
    if (asJsonl) for (const m of sess.messages) console.log(JSON.stringify(m));
    else console.log(JSON.stringify(sess, null, 2));
    process.exit(0);
  } else { console.log(HELP); process.exit(0); }
}

// ── subcommand: mcp serve ──
if (args[0] === "mcp") {
  const sub = args[1];
  if (sub === "serve") {
    const { serveMcp } = await import("../src/mcp/server.ts");
    const cwdArg = getArg("--cwd");
    if (cwdArg) process.chdir(cwdArg);
    await serveMcp({ allowAll: args.includes("--allow-all"), allTools: args.includes("--all-tools"), root: cwdArg });
    process.exit(0);
  } else { console.log(HELP); process.exit(sub === undefined || sub === "--help" || sub === "-h" ? 0 : 1); }
}

// ── subcommand: config ──
if (args[0] === "config") {
  const sub = args[1];
  if (sub === "add") {
    const baseUrl = getArg("--baseUrl");
    const apiKey = getArg("--apiKey");
    const id = getArg("--id");
    if (!baseUrl || !apiKey) { console.error("usage: minicode config add --baseUrl <url> --apiKey <key> [--id <id>]"); process.exit(1); }
    const entry = await detectAndSave(baseUrl, apiKey, id, { global: args.includes("--global") });
    console.log(`${c.green(glyphs.check)} Saved provider "${c.bold(entry.id)}" (${entry.providerHint}) models: ${entry.models.slice(0, 5).join(", ")}${entry.models.length > 5 ? " ..." : ""} (${entry.models.length} total)`);
    process.exit(0);
  } else if (sub === "list") {
    const cfg = await loadConfig();
    if (cfg.providers.length === 0) console.log(c.dim("(no providers configured — add via minicode config add or setup wizard)"));
    else {
      const tableData = cfg.providers.map((p) => ({ id: c.cyan(p.id), url: p.baseUrl, models: String(p.models.length), hint: c.dim(p.providerHint ?? "?") }));
      console.log(`\n${c.bold("Configured LLM Providers")}\n` + renderTable([
        { header: "Provider ID", key: "id", width: 14 },
        { header: "Base URL", key: "url", width: 34 },
        { header: "Models", key: "models", width: 8, align: "right" },
        { header: "Type", key: "hint", width: 14 },
      ], tableData) + "\n");
    }
    process.exit(0);
  } else if (sub === "remove") {
    const id = args[2];
    if (!id) { console.error("usage: minicode config remove <id> [--global|--local] [--cwd <dir>]"); process.exit(1); }
    await removeProvider(id, { global: !args.includes("--local"), cwd: getArg("--cwd") });
    console.log(`${c.green(glyphs.check)} Removed provider ${id} (${!args.includes("--local") ? "global" : "local"})`);
    process.exit(0);
  } else if (sub === "detect") {
    const baseUrl = getArg("--baseUrl");
    const apiKey = getArg("--apiKey");
    if (!baseUrl || !apiKey) { console.error("usage: minicode config detect --baseUrl <url> --apiKey <key>"); process.exit(1); }
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
      if (!id || !command || !cmdArgsRaw) { console.error('usage: minicode config mcp add <id> --command <cmd> --args "<arg1,arg2>" [--env K=V] [--global|--local]'); process.exit(1); }
      const cmdArgs = cmdArgsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const env: Record<string, string> = {};
      for (const kv of (getArg("--env") ?? "").split(",")) { const [k, ...rest] = kv.split("="); if (k && rest.length) env[k.trim()] = rest.join("=").trim(); }
      await saveMcpServer({ id, command, args: cmdArgs, ...(Object.keys(env).length ? { env } : {}) }, { global: !args.includes("--local") });
      console.log(`${c.green(glyphs.check)} Saved MCP server "${c.bold(id)}": ${command} ${cmdArgs.join(" ")}`);
      process.exit(0);
    } else if (mcpSub === "list") {
      const cfg = await loadConfig();
      if (!cfg.mcpServers?.length) console.log(c.dim("(no MCP servers configured — add via minicode config mcp add)"));
      else {
        const tableData = cfg.mcpServers.map((m) => ({ id: c.cyan(m.id), command: m.command, args: c.dim(m.args.join(" ")) }));
        console.log(`\n${c.bold("Configured MCP Servers")}\n` + renderTable([
          { header: "Server ID", key: "id", width: 14 },
          { header: "Command", key: "command", width: 20 },
          { header: "Arguments", key: "args", width: 36 },
        ], tableData) + "\n");
      }
      process.exit(0);
    } else if (mcpSub === "remove") {
      const id = args[3];
      if (!id) { console.error("usage: minicode config mcp remove <id> [--global|--local]"); process.exit(1); }
      await removeMcpServer(id, { global: !args.includes("--local"), cwd: getArg("--cwd") });
      console.log(`${c.green(glyphs.check)} Removed MCP server ${id} (${!args.includes("--local") ? "global" : "local"})`);
      process.exit(0);
    } else { console.log(HELP); process.exit(0); }
  } else if (sub === "lsp") {
    const lspSub = args[2];
    if (lspSub === "add") {
      const ext = args[3];
      const command = getArg("--command");
      const cmdArgsRaw = getArg("--args") ?? "";
      if (!ext || !command) { console.error('usage: minicode config lsp add <ext> --command <cmd> [--args "<arg1,arg2>"] [--env K=V] [--global|--local]'); process.exit(1); }
      const cmdArgs = cmdArgsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      const env: Record<string, string> = {};
      for (const kv of (getArg("--env") ?? "").split(",")) { const [k, ...rest] = kv.split("="); if (k && rest.length) env[k.trim()] = rest.join("=").trim(); }
      await saveLspServer({ ext, command, args: cmdArgs, ...(Object.keys(env).length ? { env } : {}) }, { global: !args.includes("--local") });
      console.log(`${c.green(glyphs.check)} Saved LSP server for ${c.bold(ext)}: ${command} ${cmdArgs.join(" ")}`);
      process.exit(0);
    } else if (lspSub === "list") {
      const cfg = await loadConfig();
      if (!cfg.lspServers?.length) console.log(c.dim("(no LSP servers configured — add via minicode config lsp add)"));
      else {
        const tableData = cfg.lspServers.map((l) => ({ ext: c.cyan(l.ext), command: l.command, args: c.dim(l.args.join(" ")) }));
        console.log(`\n${c.bold("Configured LSP Language Servers")}\n` + renderTable([
          { header: "Extension", key: "ext", width: 12 },
          { header: "Command", key: "command", width: 22 },
          { header: "Arguments", key: "args", width: 36 },
        ], tableData) + "\n");
      }
      process.exit(0);
    } else if (lspSub === "remove") {
      const ext = args[3];
      if (!ext) { console.error("usage: minicode config lsp remove <ext> [--global|--local]"); process.exit(1); }
      await removeLspServer(ext, { global: !args.includes("--local"), cwd: getArg("--cwd") });
      console.log(`${c.green(glyphs.check)} Removed LSP server for ${ext} (${!args.includes("--local") ? "global" : "local"})`);
      process.exit(0);
    } else { console.log(HELP); process.exit(0); }
  } else { console.log(HELP); process.exit(0); }
}

// ── subcommand: skills ──
if (args[0] === "skills") {
  const cwdArg = getArg("--cwd");
  const all = await loadSkills(cwdArg);
  if (args[1] === "list" || !args[1]) {
    if (all.length === 0) console.log(c.dim("(no skills found — add markdown files in .minicode/skills/*.md)"));
    else {
      const tableData = all.map((s) => ({ skill: c.yellow(`/${s.name}`), desc: s.description || "(no description)" }));
      console.log(`\n${c.bold("Installed Agent Skills")}\n` + renderTable([
        { header: "Skill Command", key: "skill", width: 18 },
        { header: "Description", key: "desc", width: 50 },
      ], tableData) + "\n");
    }
  } else if (args[1] === "show") {
    const s = await findSkill(args[2] ?? "", cwdArg);
    if (!s) { console.error(`skill ${args[2]} not found`); process.exit(1); }
    console.log(`${c.bold(c.cyan("/" + s.name))} ${c.dim("— " + s.description)}\n\n${s.body}`);
  }
  process.exit(0);
}

if (args.includes("-h") || args.includes("--help")) { console.log(HELP); process.exit(0); }

// ── subcommand: providers / models (tanpa LLM — lihat & kelola gateway cepat) ──
const firstArg = args[0];
if (firstArg === "providers" || firstArg === "models" || firstArg === "sync") {
  const { loadConfig, refreshProviderModels } = await import("../src/config.ts");
  const cwdArg = getArg("--cwd");
  const cfg = await loadConfig(cwdArg);
  if (firstArg === "providers") {
    if (cfg.providers.length === 0) {
      console.log("(no providers configured — run `minicode --interactive` then /provider-add, or `minicode config add --baseUrl <url> --apiKey <key>`)");
    } else {
      console.log("");
      for (const p of cfg.providers) {
        console.log(`  ${p.id.padEnd(16)} ${String(p.models.length).padStart(3)} models`);
        console.log(`  ${" ".repeat(16)} ${p.baseUrl}`);
      }
      console.log("\n  options: minicode models | minicode sync | minicode config add --baseUrl <url> --apiKey <key>");
    }
    process.exit(0);
  }
  if (firstArg === "models") {
    const pid = args[1];
    if (pid) {
      const p = cfg.providers.find((x) => x.id === pid);
      if (!p) { console.error(`provider "${pid}" not found — minicode providers`); process.exit(1); }
      p.models.forEach((m, i) => console.log(`  [${i}] ${m}`));
    } else {
      if (cfg.providers.length === 0) console.log("(no providers)");
      for (const p of cfg.providers) {
        console.log(`${p.id} (${p.baseUrl})`);
        p.models.slice(0, 10).forEach((m) => console.log(`  ${m}`));
        if (p.models.length > 10) console.log(`  … +${p.models.length - 10} more`);
      }
    }
    process.exit(0);
  }
  if (firstArg === "sync") {
    console.log("Syncing models from providers...");
    const results = await refreshProviderModels({ cwd: cwdArg, global: !cwdArg });
    for (const r of results) console.log(`  [OK] ${r.id}: ${r.from} → ${r.to} models`);
    if (!results.length) console.log("  (nothing updated)");
    process.exit(0);
  }
}

// ── flag parsing ──
const verbose = args.includes("--verbose");
const allowAll = args.includes("--allow-all");
const ask = args.includes("--ask");
const interactive = args.includes("--interactive");
const useTui = args.includes("--tui");
const plan = args.includes("--plan") || process.env.MINICODE_PLAN === "1";
const allowlist = args.includes("--allowlist") || process.env.MINICODE_PERMISSION === "allowlist";
const verify = args.includes("--verify");
const cwdRaw = getArg("--cwd");
const cwd = cwdRaw ? resolvePath(cwdRaw) : undefined;
if (cwd) { try { process.chdir(cwd); } catch {} }
const resumeId = getArg("--resume");
const modelOverride = getArg("--model");
const sessionId = getArg("--session") ?? randomUUID().slice(0, 8);
const maxStepsRaw = getArg("--max-steps");
const maxSteps = maxStepsRaw ? Number(maxStepsRaw) : undefined;
const ctxWindowRaw = getArg("--context-window");
const contextWindowTokens = ctxWindowRaw ? Number(ctxWindowRaw) : undefined;
const timeoutRaw = getArg("--timeout");
const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
const sandboxMode = getArg("--sandbox");
if (sandboxMode === "docker") process.env.MINICODE_SANDBOX = "docker";
else if (sandboxMode) process.stderr.write(`[warn] unknown sandbox mode "${sandboxMode}" — only "docker"\n`);
const budgetRaw = getArg("--budget");
const budget = budgetRaw ? Number(budgetRaw) : undefined;
if (budgetRaw && !Number.isFinite(budget)) process.stderr.write(`[warn] --budget requires a USD number, ignoring "${budgetRaw}"\n`);
const ratelimitRaw = getArg("--ratelimit");
const rateLimiter = ratelimitRaw ? createRateLimiter(Number(ratelimitRaw)) : undefined;

const prompt = promptFromArgs(args) || (await readPrompt());
const enterRepl = interactive || (!prompt && process.stdin.isTTY);
if (!prompt && !enterRepl) { process.stderr.write("usage: minicode \"prompt\"  |  minicode (interactive mode)\n"); process.exit(1); }

// ── skills: expand /name args ──
let effectivePrompt = prompt;
try {
  if (prompt.startsWith("/")) {
    const spaceIdx = prompt.indexOf(" ");
    const skillName = spaceIdx === -1 ? prompt.slice(1) : prompt.slice(1, spaceIdx);
    const skillArgs = spaceIdx === -1 ? "" : prompt.slice(spaceIdx + 1);
    const skill = await findSkill(skillName, cwd);
    if (skill) { effectivePrompt = await renderSkill(skill, skillArgs); console.error(c.dim(`[loaded skill /${skill.name}]`)); }
  }
} catch {}

// ── build session ──
const ctx = await createCliSession({
  cwd, sessionId, resumeId, modelOverride, prompt, enterRepl, verbose, allowAll, ask, plan, allowlist, useTui, verify,
  budget, maxSteps, contextWindowTokens, timeoutMs, rateLimiter,
});

if (enterRepl) {
  await runRepl(ctx);
} else {
  const { session, usage, modelRef, budget: b, cwd: wcwd, sessionId: sid, persistCurrent, runPromptWithVerify, close } = ctx;
  const t0 = Date.now();
  try {
    await runPromptWithVerify(effectivePrompt);
    const u = usage.get(modelRef.current);
    let overBudget = false;
    if (b != null && u.cost != null) {
      if (u.cost > b) { process.stderr.write(c.red(`[budget] $${u.cost.toFixed(4)} > $${b.toFixed(2)} — over budget, exiting.\n`)); overBudget = true; }
      else if (u.cost > b * 0.8) process.stderr.write(c.yellow(`[budget] $${u.cost.toFixed(4)} / $${b.toFixed(2)} (80% used)\n`));
    }
    await persistCurrent(u);
    if (overBudget) { await close(); process.exit(1); }
    const statusLine = c.muted(`\n  ${u.totalTokens.toLocaleString()} tokens${u.cost != null ? ` · $${u.cost.toFixed(4)}` : ""} · ${session.state.stepCount} steps · ${Math.round((Date.now() - t0) / 1000)}s`);
    process.stderr.write(`${statusLine}\n`);
    writeTrace(wcwd, { sessionId: sid, timestamp: new Date().toISOString(), prompt: effectivePrompt, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost, model: modelRef.current, ok: true });
  } catch (e) {
    process.stderr.write(`\n${c.red(glyphs.cross)} ${formatError(e)}\n`);
    writeTrace(wcwd, { sessionId: sid, timestamp: new Date().toISOString(), prompt: effectivePrompt, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: usage.get(modelRef.current).inputTokens, outputTokens: usage.get(modelRef.current).outputTokens, model: modelRef.current, ok: false, error: formatError(e) });
    await close();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 200));
  await close();

  // ── plan workflow: tanya lanjut eksekusi (interaktif saja) ──
  if (ctx.permissionMode === "plan" && process.stdin.isTTY) {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await new Promise<string>((res) => rl.question(c.yellow("\nProceed to execute this plan? [y/N] "), res));
    rl.close();
    if (ans.trim().toLowerCase() === "y") {
      const { spawn } = await import("node:child_process");
      const filtered = args.filter((a) => a !== "--plan");
      const child = spawn(process.execPath, [process.argv[1], ...filtered], { stdio: "inherit" });
      child.on("exit", (code) => process.exit(code ?? 0));
      process.stdin.resume();
    } else {
      process.exit(0);
    }
    process.exit(0);
  }
}
