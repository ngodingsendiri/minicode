// REPL loop — mode interaktif dengan prompt, history, slash commands, verify, budget.
import { c, glyphs } from "../src/tui/theme.ts";
import { formatError } from "../src/tui/renderer.ts";
import { findSkill, renderSkill } from "../src/skills/loader.ts";
import { createInteractivePrompt, appendHistory } from "./input.ts";
import { handleBuiltinCommand, BUILTIN_COMMANDS, type CommandContext } from "./commands.ts";
import { writeTrace } from "../src/telemetry/trace.ts";
import type { CliSession } from "./setup.ts";

export async function runRepl(ctx: CliSession): Promise<void> {
  const {
    session, cfg, cwd, sessionId, modelRef, effectiveInitialModel,
    permissionMode, sessionTools, allLoadedSkills, usage, budget,
    persistCurrent, runPromptWithVerify, close,
  } = ctx;

  // Tab completion: slash commands + skills
  const getCompletions = (line: string): string[] => {
    if (!line.startsWith("/")) return [];
    const candidates = [...BUILTIN_COMMANDS.map((b) => `/${b.name}`), ...allLoadedSkills.map((s) => `/${s.name}`)];
    return candidates.filter((c) => c.startsWith(line));
  };

  const interactivePrompt = createInteractivePrompt({
    modelName: modelRef.current ?? cfg.providers[0]?.models[0],
    getCompletions,
  });

  // Startup — satu baris status, langsung prompt
  const model = modelRef.current ?? cfg.providers[0]?.models[0] ?? "default";
  process.stdout.write(c.muted(`minicode v0.3.0 · ${model} · ${permissionMode} · ${sessionTools.length} tools\n\n`));

  const commandCtx: CommandContext = {
    cwd, sessionId,
    currentModel: modelRef.current ?? cfg.providers[0]?.models[0],
    usage, skills: allLoadedSkills, toolsCount: sessionTools.length,
    providerHint: cfg.providers[0]?.providerHint,
    setModelOverride: (m: string) => { modelRef.current = m; },
  };

  while (true) {
    const line = await interactivePrompt.ask();
    if (line == null) break;
    const q = line.trim();
    if (!q) continue;
    await appendHistory(q);

    const builtinResult = await handleBuiltinCommand(q, commandCtx);
    if (builtinResult.handled) {
      if (builtinResult.shouldExit) break;
      continue;
    }

    let overBudget = false;
    let hadError: string | undefined;
    const t0 = Date.now();
    try {
      let finalPrompt = q;
      if (q.startsWith("/")) {
        const spaceIdx = q.indexOf(" ");
        const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx);
        const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1);
        const skill = await findSkill(skillName, cwd).catch(() => undefined);
        if (skill) finalPrompt = await renderSkill(skill, skillArgs);
      }

      try {
        await runPromptWithVerify(finalPrompt);
        const u = usage.get(modelRef.current);

        // Status line — satu baris ringkas setelah selesai
        const costPart = u.cost != null ? ` · $${u.cost.toFixed(4)}` : "";
        process.stdout.write(c.muted(`\n  ${u.totalTokens.toLocaleString()} tokens${costPart} · ${session.state.stepCount} steps · ${Math.round((Date.now() - t0) / 1000)}s\n\n`));

        if (budget != null && u.cost != null) {
          if (u.cost > budget) { overBudget = true; }
          else if (u.cost > budget * 0.8) { /* warn already shown by renderer */ }
        }

        writeTrace(cwd, { sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost, model: modelRef.current, ok: true });
        await persistCurrent(u);
        usage.reset();
      } catch (e) {
        hadError = formatError(e);
        writeTrace(cwd, { sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: usage.get(modelRef.current).inputTokens, outputTokens: usage.get(modelRef.current).outputTokens, model: modelRef.current, ok: false, error: hadError });
      }
      if (overBudget) break;
    } catch (e) {
      hadError = formatError(e);
    }

    if (hadError) {
      process.stdout.write(c.error(`\n  ✗ ${hadError}\n\n`));
      // Actionable fix suggestions
      if (/429|rate.limit/i.test(hadError)) process.stdout.write(c.muted("  Fix: wait a moment or use --ratelimit to throttle.\n\n"));
      else if (/401|403|auth|balance|quota/i.test(hadError)) process.stdout.write(c.muted("  Fix: check your API key balance or use /provider-add to add a provider.\n\n"));
      else if (/timeout/i.test(hadError)) process.stdout.write(c.muted("  Fix: increase --timeout or use a faster model.\n\n"));
    }
  }

  interactivePrompt.close();
  await close();
  process.exit(0);
}
