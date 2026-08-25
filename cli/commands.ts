import { renderTable } from "../src/tui/table.ts";
import { listSessions } from "../src/session/persistence.ts";
import { loadHistory } from "./input.ts";
import { loadConfig, detectAndSave } from "../src/config.ts";
import type { Usage } from "../src/policy/usage.ts";
import type { Skill } from "../src/skills/loader.ts";

// SEMUA output di sini = PLAIN TEXT tanpa ANSI.
// Readline + ANSI di Windows = karakter escape bocor jadi teks literal.

export interface CommandContext {
  cwd?: string;
  sessionId: string;
  currentModel?: string;
  usage: { get: (model?: string) => Usage; reset: () => void };
  skills: Skill[];
  toolsCount: number;
  providerHint?: string;
  setModelOverride: (model: string) => void;
}

export const BUILTIN_COMMANDS = [
  { name: "help", desc: "Show available slash commands" },
  { name: "providers", desc: "List configured LLM providers" },
  { name: "provider-add", desc: "Add a new LLM provider (interactive)" },
  { name: "provider-remove <id>", desc: "Remove a provider by id" },
  { name: "models [id]", desc: "List models for a provider" },
  { name: "model <name>", desc: "Switch current LLM model" },
  { name: "undo", desc: "Rollback file edits from last turn" },
  { name: "redo", desc: "Reapply undone file edits" },
  { name: "cost", desc: "Show token usage & session cost" },
  { name: "sessions", desc: "List recent sessions" },
  { name: "status", desc: "Show runtime status" },
  { name: "history", desc: "Show recent prompt history" },
  { name: "exit", desc: "Quit Minicode" },
];

function ok(msg: string): void {
  process.stdout.write(`[OK] ${msg}\n`);
}

function fail(msg: string): void {
  process.stdout.write(`[FAIL] ${msg}\n`);
}

export async function handleBuiltinCommand(
  rawInput: string,
  ctx: CommandContext,
): Promise<{ handled: boolean; shouldExit?: boolean }> {
  const line = rawInput.trim();
  if (!line.startsWith("/")) return { handled: false };

  const spaceIdx = line.indexOf(" ");
  const cmd = spaceIdx === -1 ? line.slice(1).toLowerCase() : line.slice(1, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case "help": {
      console.log("\nMinicode Commands");
      const cmdTable = BUILTIN_COMMANDS.map((b) => ({
        command: `/${b.name}`,
        description: b.desc,
      }));
      console.log(renderTable([
        { header: "Command", key: "command", width: 24 },
        { header: "Description", key: "description", width: 46 },
      ], cmdTable));

      if (ctx.skills.length > 0) {
        console.log("\nLoaded Skills");
        const skillTable = ctx.skills.map((s) => ({
          skill: `/${s.name}`,
          description: s.description || "(no description)",
        }));
        console.log(renderTable([
          { header: "Skill", key: "skill", width: 18 },
          { header: "Description", key: "description", width: 46 },
        ], skillTable));
      }
      console.log("");
      return { handled: true };
    }

    case "clear": {
      process.stdout.write("\x1b[2J\x1b[H");
      return { handled: true };
    }

    case "undo": {
      const { undoLastCheckpoint } = await import("../src/session/checkpoint.ts");
      const res = await undoLastCheckpoint(ctx.sessionId, ctx.cwd);
      if (res.success) {
        ok("Undid file changes:");
        for (const f of res.restoredFiles) console.log(`  -> ${f}`);
      } else {
        fail(`Undo failed: ${res.message}`);
      }
      return { handled: true };
    }

    case "redo": {
      const { redoLastCheckpoint } = await import("../src/session/checkpoint.ts");
      const res = await redoLastCheckpoint(ctx.sessionId, ctx.cwd);
      if (res.success) {
        ok("Reapplied file changes:");
        for (const f of res.reappliedFiles) console.log(`  -> ${f}`);
      } else {
        fail(`Redo failed: ${res.message}`);
      }
      return { handled: true };
    }

    case "exit":
    case "quit": {
      console.log("Goodbye!");
      return { handled: true, shouldExit: true };
    }

    case "model": {
      if (args) {
        ctx.setModelOverride(args);
        ok(`Model switched to: ${args}`);
      } else {
        console.log(`Active model: ${ctx.currentModel ?? "default"}`);
        console.log("Usage: /model <model-name> or /models to browse");
      }
      return { handled: true };
    }

    case "providers": {
      const cfg = await loadConfig();
      if (cfg.providers.length === 0) {
        console.log("\n(no providers — use /provider-add)");
      } else {
        const tableData = cfg.providers.map((p) => ({
          id: p.id,
          url: p.baseUrl,
          models: String(p.models.length),
          hint: p.providerHint ?? "?",
        }));
        console.log(`\nConfigured LLM Providers`);
        console.log(renderTable([
          { header: "ID", key: "id", width: 14 },
          { header: "Base URL", key: "url", width: 30 },
          { header: "Models", key: "models", width: 8, align: "right" as const },
          { header: "Type", key: "hint", width: 10 },
        ], tableData));
      }
      console.log("");
      return { handled: true };
    }

    case "provider-add": {
      const { createInterface } = await import("node:readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) => new Promise<string>((res) => rl.question(q, (a) => res(a.trim())));

      console.log("\nAdd New Provider\n");
      const baseUrl = await ask("Base URL: ");
      rl.close();
      if (!baseUrl) { console.log("Base URL required."); return { handled: true }; }

      const { askSecret } = await import("./input.ts");
      const apiKey = await askSecret("API Key (masked): ");
      if (!apiKey) { console.log("API Key required."); return { handled: true }; }

      console.log("Detecting models...");
      try {
        const entry = await detectAndSave(baseUrl, apiKey, undefined, {
          global: false, cwd: ctx.cwd,
          fallbackModels: baseUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"],
        });
        ok(`Provider "${entry.id}" saved (${entry.models.length} models). Restart minicode to use.`);
      } catch (e) {
        fail(`Detection failed: ${(e as Error).message.slice(0, 80)}`);
      }
      return { handled: true };
    }

    case "provider-remove": {
      if (!args) { console.log("Usage: /provider-remove <id>"); return { handled: true }; }
      const { removeProvider } = await import("../src/config.ts");
      await removeProvider(args, ctx.cwd ? { global: false, cwd: ctx.cwd } : {});
      ok(`Removed provider "${args}"`);
      return { handled: true };
    }

    case "models": {
      const cfg = await loadConfig();
      const targets = args ? cfg.providers.filter((p) => p.id === args) : cfg.providers;
      for (const p of targets) {
        console.log(`\n${p.id} (${p.baseUrl})`);
        for (const m of p.models.slice(0, 20)) console.log(`  ${m}`);
        if (p.models.length > 20) console.log(`  ... +${p.models.length - 20} more`);
      }
      console.log("");
      return { handled: true };
    }

    case "cost":
    case "usage": {
      const u = ctx.usage.get(ctx.currentModel);
      console.log(`\nSession Usage`);
      console.log(`  Input Tokens:  ${u.inputTokens.toLocaleString()}`);
      console.log(`  Output Tokens: ${u.outputTokens.toLocaleString()}`);
      console.log(`  Total Tokens:  ${u.totalTokens.toLocaleString()}`);
      if (u.cacheReadTokens) console.log(`  Cache Read:    ${u.cacheReadTokens.toLocaleString()}`);
      if (u.cacheWriteTokens) console.log(`  Cache Write:   ${u.cacheWriteTokens.toLocaleString()}`);
      console.log(`  Estimated Cost: ${u.cost != null ? `$${u.cost.toFixed(4)}` : "N/A"}\n`);
      return { handled: true };
    }

    case "compact": {
      console.log("Compaction is automatic (kernel budget policy).");
      return { handled: true };
    }

    case "sessions": {
      const rows = listSessions(ctx.cwd).slice(0, 10);
      if (rows.length === 0) {
        console.log("(no previous sessions)");
      } else {
        console.log(`\nRecent Sessions`);
        const tableData = rows.map((r) => ({ id: r.id, date: new Date(r.created_at).toLocaleString(), cwd: r.cwd }));
        console.log(renderTable([
          { header: "ID", key: "id", width: 12 },
          { header: "Date", key: "date", width: 22 },
          { header: "Workspace", key: "cwd", width: 32 },
        ], tableData));
      }
      console.log("");
      return { handled: true };
    }

    case "status": {
      console.log(`\nMinicode Status`);
      console.log(`  Session ID:   ${ctx.sessionId}`);
      console.log(`  Model:        ${ctx.currentModel ?? "default"}`);
      console.log(`  Provider:     ${ctx.providerHint ?? "unknown"}`);
      console.log(`  Active Tools: ${ctx.toolsCount}`);
      console.log(`  Skills:       ${ctx.skills.length}\n`);
      return { handled: true };
    }

    case "history": {
      const hist = await loadHistory();
      const last10 = hist.slice(-10);
      console.log(`\nRecent History`);
      last10.forEach((h, i) => { console.log(`  ${String(i + 1).padStart(2, " ")}. ${h}`); });
      console.log("");
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}
