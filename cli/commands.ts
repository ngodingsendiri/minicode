import { c, glyphs, box } from "../src/tui/theme.ts";
import { renderTable } from "../src/tui/table.ts";
import { listSessions } from "../src/session/persistence.ts";
import { loadHistory } from "./input.ts";
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
  { name: "clear", desc: "Clear terminal screen" },
  { name: "undo", desc: "Rollback file edits made in the last turn" },
  { name: "redo", desc: "Reapply previously undone file edits" },
  { name: "model", desc: "View or switch current LLM model" },
  { name: "cost", desc: "Show token usage & estimated session cost" },
  { name: "compact", desc: "Force context compaction" },
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
      process.stdout.write(`\n${c.bold(c.cyan(glyphs.sparkle + " Minicode Commands"))}\n`);
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
      process.stdout.write(c.dim(`Goodbye! ${glyphs.sparkle}\n`));
      return { handled: true, shouldExit: true };
    }

    case "model": {
      if (args) {
        ctx.setModelOverride(args);
        process.stdout.write(`${c.green(glyphs.check)} Model switched to: ${c.bold(c.cyan(args))}\n`);
      } else {
        process.stdout.write(`${c.cyan(glyphs.sparkle)} Active model: ${c.bold(ctx.currentModel ?? "default")}\n${c.dim("Usage: /model <model-name> to switch")}\n`);
      }
      return { handled: true };
    }

    case "cost":
    case "usage": {
      const u = ctx.usage.get(ctx.currentModel);
      process.stdout.write(`\n${c.bold(c.cyan("Session Token & Cost Usage"))}\n`);
      process.stdout.write(
        `  ${box.vertical} Input Tokens:  ${c.bold(String(u.inputTokens.toLocaleString()))}\n` +
        `  ${box.vertical} Output Tokens: ${c.bold(String(u.outputTokens.toLocaleString()))}\n` +
        `  ${box.vertical} Total Tokens:  ${c.bold(String(u.totalTokens.toLocaleString()))}\n` +
        (u.cacheReadTokens ? `  ${box.vertical} Cache Read:   ${c.green(String(u.cacheReadTokens.toLocaleString()))}\n` : "") +
        (u.cacheWriteTokens ? `  ${box.vertical} Cache Write:  ${c.green(String(u.cacheWriteTokens.toLocaleString()))}\n` : "") +
        `  ${box.vertical} Estimated Cost: ${c.green(c.bold(u.cost != null ? `$${u.cost.toFixed(4)}` : "N/A"))}\n\n`
      );
      return { handled: true };
    }

    case "compact": {
      // Compaction berjalan otomatis di kernel (budget pressure / recovery).
      process.stdout.write(`${c.yellow(glyphs.sparkle)} Compaction is automatic (kernel budget policy). Manual trigger not supported yet.\n`);
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
      process.stdout.write(`\n${c.bold(c.cyan("Minicode Status"))}\n`);
      process.stdout.write(
        `  ${box.vertical} Session ID:   ${c.cyan(ctx.sessionId)}\n` +
        `  ${box.vertical} Model:        ${c.bold(ctx.currentModel ?? "default")}\n` +
        `  ${box.vertical} Provider:     ${c.dim(ctx.providerHint ?? "unknown")}\n` +
        `  ${box.vertical} Active Tools: ${c.bold(String(ctx.toolsCount))}\n` +
        `  ${box.vertical} Skills:       ${c.bold(String(ctx.skills.length))}\n\n`
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

    default:
      return { handled: false };
  }
}
