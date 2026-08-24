import { c, glyphs } from "../src/tui/theme.ts";
import { renderTable } from "../src/tui/table.ts";
import { listSessions } from "../src/session/persistence.ts";
import { loadHistory } from "./input.ts";
import { loadConfig, detectAndSave } from "../src/config.ts";
import { formatError } from "../src/tui/renderer.ts";
import type { Usage } from "../src/policy/usage.ts";
import type { Skill } from "../src/skills/loader.ts";

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
  { name: "help", desc: "Show available slash commands and shortcuts" },
  { name: "providers", desc: "List configured LLM providers" },
  { name: "provider-add", desc: "Add a new LLM provider (interactive wizard)" },
  { name: "provider-remove <id>", desc: "Remove a provider by id" },
  { name: "models [id]", desc: "List models for a provider" },
  { name: "model <name>", desc: "Switch current LLM model" },
  { name: "undo", desc: "Rollback file edits made in the last turn" },
  { name: "redo", desc: "Reapply previously undone file edits" },
  { name: "cost", desc: "Show token usage & estimated session cost" },
  { name: "sessions", desc: "List recent session transcripts" },
  { name: "status", desc: "Show agent runtime status & active tools" },
  { name: "history", desc: "Show recent prompt history" },
  { name: "exit", desc: "Quit Minicode" },
];

export async function handleBuiltinCommand(
  rawInput: string,
  ctx: CommandContext
): Promise<{ handled: boolean; shouldExit?: boolean }> {
  const line = rawInput.trim();
  if (!line.startsWith("/")) return { handled: false };

  const spaceIdx = line.indexOf(" ");
  const cmd = spaceIdx === -1 ? line.slice(1).toLowerCase() : line.slice(1, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1).trim();

  switch (cmd) {
    case "help": {
      process.stdout.write(`\n${c.bold("Minicode Commands")}\n`);
      const cmdTable = BUILTIN_COMMANDS.map((b) => ({
        command: c.cyan(`/${b.name}`),
        description: b.desc,
      }));
      process.stdout.write(
        renderTable(
          [
            { header: "Command", key: "command", width: 14 },
            { header: "Description", key: "description", width: 50 },
          ],
          cmdTable
        ) + "\n"
      );

      if (ctx.skills.length > 0) {
        process.stdout.write(`\n${c.bold(c.cyan("Loaded Skills"))}\n`);
        const skillTable = ctx.skills.map((s) => ({
          skill: c.yellow(`/${s.name}`),
          description: s.description || "(no description)",
        }));
        process.stdout.write(
          renderTable(
            [
              { header: "Skill", key: "skill", width: 18 },
              { header: "Description", key: "description", width: 46 },
            ],
            skillTable
          ) + "\n"
        );
      }
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
        process.stdout.write(`${c.green(glyphs.check)} Undid file changes:\n`);
        for (const f of res.restoredFiles) {
          process.stdout.write(`  ${c.dim(glyphs.arrow)} ${c.cyan(f)}\n`);
        }
      } else {
        process.stdout.write(`${c.yellow(glyphs.cross)} Undo failed: ${res.message}\n`);
      }
      return { handled: true };
    }

    case "redo": {
      const { redoLastCheckpoint } = await import("../src/session/checkpoint.ts");
      const res = await redoLastCheckpoint(ctx.sessionId, ctx.cwd);
      if (res.success) {
        process.stdout.write(`${c.green(glyphs.check)} Reapplied file changes:\n`);
        for (const f of res.reappliedFiles) {
          process.stdout.write(`  ${c.dim(glyphs.arrow)} ${c.cyan(f)}\n`);
        }
      } else {
        process.stdout.write(`${c.yellow(glyphs.cross)} Redo failed: ${res.message}\n`);
      }
      return { handled: true };
    }

    case "exit":
    case "quit": {
      process.stdout.write(c.dim(`Goodbye!\n`));
      return { handled: true, shouldExit: true };
    }

    case "model": {
      if (args) {
        ctx.setModelOverride(args);
        process.stdout.write(`${c.success(glyphs.check)} Model: ${c.bold(args)}\n`);
      } else {
        process.stdout.write(`Active model: ${c.bold(ctx.currentModel ?? "default")}\n${c.muted("Use /model <name> or /models to browse.")}\n`);
      }
      return { handled: true };
    }

    case "cost":
    case "usage": {
      const u = ctx.usage.get(ctx.currentModel);
      process.stdout.write(`\n${c.bold("Session Usage")}\n`);
      process.stdout.write(
        `  Input Tokens:  ${c.bold(String(u.inputTokens.toLocaleString()))}\n` +
        `  Output Tokens: ${c.bold(String(u.outputTokens.toLocaleString()))}\n` +
        `  Total Tokens:  ${c.bold(String(u.totalTokens.toLocaleString()))}\n` +
        (u.cacheReadTokens ? `  Cache Read:   ${c.success(String(u.cacheReadTokens.toLocaleString()))}\n` : "") +
        (u.cacheWriteTokens ? `  Cache Write:  ${c.success(String(u.cacheWriteTokens.toLocaleString()))}\n` : "") +
        `  Estimated Cost: ${c.success(c.bold(u.cost != null ? `$${u.cost.toFixed(4)}` : "N/A"))}\n\n`
      );
      return { handled: true };
    }

    case "compact": {
      process.stdout.write(c.muted("Compaction is automatic (kernel budget policy). Manual trigger not supported yet.\n"));
      return { handled: true };
    }

    case "sessions": {
      const rows = listSessions(ctx.cwd).slice(0, 10);
      if (rows.length === 0) {
        process.stdout.write(c.dim("(no previous sessions)\n"));
      } else {
        const tableData = rows.map((r) => ({
          id: c.cyan(r.id),
          date: new Date(r.created_at).toLocaleString(),
          cwd: c.dim(r.cwd.slice(-30)),
        }));
        process.stdout.write(`\n${c.bold("Recent Sessions")}\n`);
        process.stdout.write(
          renderTable(
            [
              { header: "ID", key: "id", width: 12 },
              { header: "Date", key: "date", width: 22 },
              { header: "Workspace", key: "cwd", width: 32 },
            ],
            tableData
          ) + "\n"
        );
      }
      return { handled: true };
    }

    case "status": {
      process.stdout.write(`\n${c.bold("Minicode Status")}\n`);
      process.stdout.write(
        `  Session ID:   ${c.info(ctx.sessionId)}\n` +
        `  Model:        ${c.bold(ctx.currentModel ?? "default")}\n` +
        `  Provider:     ${c.muted(ctx.providerHint ?? "unknown")}\n` +
        `  Active Tools: ${c.bold(String(ctx.toolsCount))}\n` +
        `  Skills:       ${c.bold(String(ctx.skills.length))}\n\n`
      );
      return { handled: true };
    }

    case "history": {
      const hist = await loadHistory();
      const last10 = hist.slice(-10);
      process.stdout.write(`\n${c.bold("Recent History")}\n`);
      last10.forEach((h, i) => {
        process.stdout.write(`  ${c.dim(String(i + 1).padStart(2, " ") + ".")} ${h}\n`);
      });
      process.stdout.write("\n");
      return { handled: true };
    }

    case "providers": {
      const cfg = await loadConfig();
      if (cfg.providers.length === 0) {
        process.stdout.write(c.muted("\n(no providers — use /provider-add)\n\n"));
      } else {
        const tableData = cfg.providers.map((p) => ({
          id: c.info(p.id),
          url: p.baseUrl,
          models: String(p.models.length),
          hint: c.muted(p.providerHint ?? "?"),
        }));
        console.log(`\n${c.bold("Configured LLM Providers")}\n` + renderTable([
          { header: "ID", key: "id", width: 14 },
          { header: "Base URL", key: "url", width: 30 },
          { header: "Models", key: "models", width: 8, align: "right" },
          { header: "Type", key: "hint", width: 10 },
        ], tableData) + "\n");
      }
      return { handled: true };
    }

    case "provider-add": {
      const { createInterface } = await import("node:readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) => new Promise<string>((res) => rl.question(q, (a) => res(a.trim())));

      process.stdout.write(`\n${c.bold("Add New Provider")}\n\n`);
      const baseUrl = await ask(`${c.info("Base URL")}: `);
      rl.close();
      if (!baseUrl) { process.stdout.write(c.error("Base URL required.\n")); return { handled: true }; }

      const { askSecret } = await import("./input.ts");
      const apiKey = await askSecret(`${c.info("API Key")} (masked): `);
      if (!apiKey) { process.stdout.write(c.error("API Key required.\n")); return { handled: true }; }

      process.stdout.write(c.muted("Detecting models...\n"));
      try {
        const entry = await detectAndSave(baseUrl, apiKey, undefined, {
          global: false,
          cwd: ctx.cwd,
          fallbackModels: baseUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"],
        });
        process.stdout.write(`${c.success(glyphs.check)} Provider "${entry.id}" saved (${entry.models.length} models)\n`);
        process.stdout.write(c.muted("Restart minicode to use the new provider.\n\n"));
      } catch (e) {
        process.stdout.write(`${c.error(glyphs.cross)} Detection failed: ${formatError(e)}\n`);
        process.stdout.write(c.muted("Provider saved with fallback model. Restart to use.\n\n"));
      }
      return { handled: true };
    }

    case "provider-remove": {
      if (!args) { process.stdout.write(c.error("Usage: /provider-remove <id>\n")); return { handled: true }; }
      const { removeProvider } = await import("../src/config.ts");
      await removeProvider(args, ctx.cwd ? { global: false, cwd: ctx.cwd } : {});
      process.stdout.write(`${c.success(glyphs.check)} Removed provider "${args}"\n`);
      return { handled: true };
    }

    case "models": {
      const cfg = await loadConfig();
      const targets = args ? cfg.providers.filter((p) => p.id === args) : cfg.providers;
      for (const p of targets) {
        process.stdout.write(`\n${c.bold(p.id)} ${c.muted(p.baseUrl)}\n`);
        for (const m of p.models.slice(0, 20)) process.stdout.write(`  ${glyphs.dot} ${m}\n`);
        if (p.models.length > 20) process.stdout.write(c.muted(`  ... +${p.models.length - 20} more\n`));
      }
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}
