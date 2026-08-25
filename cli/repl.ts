// REPL loop — mode interaktif dengan prompt, history, slash commands, verify, budget.
import { formatError } from "../src/tui/renderer.ts";
import { findSkill, renderSkill } from "../src/skills/loader.ts";
import { askLine, appendHistory } from "./input.ts";
import { handleBuiltinCommand, BUILTIN_COMMANDS, type CommandContext } from "./commands.ts";
import { friendlyError, friendlyFromCategory } from "./errors.ts";
import { writeTrace } from "../src/telemetry/trace.ts";
import type { CliSession } from "./setup.ts";

export async function runRepl(ctx: CliSession): Promise<void> {
  const {
    session, cfg, cwd, sessionId, modelRef,
    permissionMode, sessionTools, allLoadedSkills, usage, budget,
    persistCurrent, runPromptWithVerify, close,
  } = ctx;

  // Track kategori error terakhir dari event provider (formal, bukan regex)
  let lastCategory: string | undefined;
  session.events.on("provider:extension", (e) => {
    if (e.kind === "error") {
      const d = e.data as { category?: string } | undefined;
      if (d?.category) lastCategory = d.category;
    }
  });

  // Auto-suggest: slash commands + skills (dipakai askLine → render inline)
  const getSuggestions = (line: string): string[] => {
    if (!line.startsWith("/")) return [];
    const candidates = [...BUILTIN_COMMANDS.map((b) => `/${b.name}`), ...allLoadedSkills.map((s) => `/${s.name}`)];
    return candidates.filter((c) => c.startsWith(line));
  };

  // Clear screen — bersihkan semua, langsung prompt
  process.stdout.write("\x1b[2J\x1b[H");

  const commandCtx: CommandContext = {
    cwd, sessionId,
    currentModel: modelRef.current ?? cfg.providers[0]?.models[0],
    usage, skills: allLoadedSkills, toolsCount: sessionTools.length,
    providerHint: cfg.providers[0]?.providerHint,
    setModelOverride: (m: string) => { modelRef.current = m; },
  };

  while (true) {
    // Prompt menampilkan cutoff budget (hanya saat --budget aktif)
    let promptText = "minicode❯ ";
    if (budget != null) {
      const u = usage.get(modelRef.current);
      if (u.cost != null && budget > 0) {
        const pct = Math.min(100, Math.round((u.cost / budget) * 100));
        promptText = `minicode❯[${pct}%] `;
      }
    }
    const line = await askLine({ prompt: promptText, hints: getSuggestions });
    if (line == null) break;
    const q = line.trim();
    if (!q) continue;
    await appendHistory(q);

    const builtinResult = await handleBuiltinCommand(q, commandCtx);
    if (builtinResult.handled) {
      if (builtinResult.shouldExit) break;
      continue;
    }

    // Slash yang bukan command & bukan skill → jangan dipanggil ke LLM
    let finalPrompt = q;
    if (q.startsWith("/")) {
      const spaceIdx = q.indexOf(" ");
      const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx);
      const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1);
      const skill = await findSkill(skillName, cwd).catch(() => undefined);
      if (skill) {
        finalPrompt = await renderSkill(skill, skillArgs);
      } else {
        process.stdout.write(`\n  Unknown command: ${q.split(" ")[0]} — type /help\n\n`);
        continue;
      }
    }

    let overBudget = false;
    let hadError: string | undefined;
    const t0 = Date.now();
    try {
      try {
        await runPromptWithVerify(finalPrompt);
        const u = usage.get(modelRef.current);
        const costPart = u.cost != null ? ` · $${u.cost.toFixed(4)}` : "";
        process.stdout.write(`\n  ${u.totalTokens.toLocaleString()} tokens${costPart} · ${session.state.stepCount} steps · ${Math.round((Date.now() - t0) / 1000)}s\n\n`);

        if (budget != null && u.cost != null) {
          if (u.cost > budget) overBudget = true;
          else if (u.cost > budget * 0.8) process.stderr.write(`  ⚠ 80% of $${budget.toFixed(2)} budget used\n`);
        }

        writeTrace(cwd, { sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost, model: modelRef.current, ok: true });
        await persistCurrent(u);
        usage.reset();
      } catch (e) {
        hadError = formatError(e);
        writeTrace(cwd, { sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: usage.get(modelRef.current).inputTokens, outputTokens: usage.get(modelRef.current).outputTokens, model: modelRef.current, ok: false, error: hadError });
      }
      if (overBudget) {
        process.stdout.write(`\n  Budget exceeded. Ending session.\n`);
        break;
      }
    } catch (e) {
      hadError = formatError(e);
    }

    if (hadError) {
      // Prioritas: kategori formal dari event provider. Fallback ke string.
      const f = lastCategory ? friendlyFromCategory(lastCategory, hadError) : friendlyError(hadError);
      lastCategory = undefined;
      process.stdout.write(`\n  ${f.message}\n`);
      if (f.fix) process.stdout.write(`  → ${f.fix}\n\n`);
    }
  }

  await close();
  process.exit(0);
}
