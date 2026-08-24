// REPL loop — mode interaktif dengan prompt, history, slash commands, verifiction, budget.
import { c, glyphs } from "../src/tui/theme.ts";
import { formatError } from "../src/tui/renderer.ts";
import { findSkill, renderSkill } from "../src/skills/loader.ts";
import { createInteractivePrompt, appendHistory } from "./input.ts";
import { handleBuiltinCommand, BUILTIN_COMMANDS, type CommandContext } from "./commands.ts";
import { writeTrace } from "../src/telemetry/trace.ts";
import type { CliSession } from "./setup.ts";

export async function runRepl(ctx: CliSession): Promise<void> {
  const { session, cfg, cwd, sessionId, modelRef, effectiveInitialModel, permissionMode, sessionTools, allLoadedSkills, usage, budget, persistCurrent, runPromptWithVerify, close } = ctx;

  const getCompletions = (line: string): string[] => {
    if (!line.startsWith("/")) return [];
    const candidates = [...BUILTIN_COMMANDS.map((b) => `/${b.name}`), ...allLoadedSkills.map((s) => `/${s.name}`)];
    return candidates.filter((c) => c.startsWith(line));
  };

  const interactivePrompt = createInteractivePrompt({ modelName: modelRef.current ?? cfg.providers[0]?.models[0], getCompletions });

  const banner = `${c.cyan(c.bold(glyphs.sparkle + " Minicode v0.2.0"))} ${c.dim(`[${modelRef.current ?? cfg.providers[0]?.models[0] ?? "default"} · ${permissionMode}]`)} — ${c.dim("type prompt or /help")}\n`;
  process.stdout.write(banner);

  const commandCtx: CommandContext = {
    cwd, sessionId, currentModel: modelRef.current ?? cfg.providers[0]?.models[0], usage, skills: allLoadedSkills, toolsCount: sessionTools.length, providerHint: cfg.providers[0]?.providerHint,
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
    try {
      let finalPrompt = q;
      if (q.startsWith("/")) {
        const spaceIdx = q.indexOf(" ");
        const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx);
        const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1);
        const skill = await findSkill(skillName, cwd).catch(() => undefined);
        if (skill) finalPrompt = await renderSkill(skill, skillArgs);
      }

      const t0 = Date.now();
      try {
        await runPromptWithVerify(finalPrompt);
        const u = usage.get(modelRef.current);
        const costBadge = u.cost != null ? ` · $${u.cost.toFixed(4)}` : "";
        if (budget != null && u.cost != null) {
          if (u.cost > budget) { process.stderr.write(c.red(`[budget] $${u.cost.toFixed(4)} > $${budget.toFixed(2)} — over budget, ending session.\n`)); overBudget = true; }
          else if (u.cost > budget * 0.8) process.stderr.write(c.yellow(`[budget] $${u.cost.toFixed(4)} / $${budget.toFixed(2)} (80% used)\n`));
        }
        process.stderr.write(c.dim(`\n[session ${sessionId} saved · ${u.totalTokens.toLocaleString()} tokens${costBadge}]\n\n`));
        writeTrace(cwd, { sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cost: u.cost, model: modelRef.current, ok: true });
        await persistCurrent(u);
        usage.reset();
      } catch (e) {
        process.stderr.write(`\n${c.red(glyphs.cross)} ${formatError(e)}\n\n`);
        writeTrace(cwd, { sessionId, timestamp: new Date().toISOString(), prompt: q, durationMs: Date.now() - t0, steps: session.state.stepCount, turns: session.state.turnCount, inputTokens: usage.get(modelRef.current).inputTokens, outputTokens: usage.get(modelRef.current).outputTokens, model: modelRef.current, ok: false, error: formatError(e) });
      }
      if (overBudget) break;
    } catch (e) {
      process.stderr.write(`\n${c.red(glyphs.cross)} ${formatError(e)}\n\n`);
    }
  }

  interactivePrompt.close();
  await close();
  process.exit(0);
}