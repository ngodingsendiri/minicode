// REPL loop — mode interaktif dengan prompt, history, slash commands, verify, budget.
import { formatError } from "../src/tui/renderer.ts";
import { findSkill, renderSkill } from "../src/skills/loader.ts";
import { createInteractivePrompt, appendHistory } from "./input.ts";
import { handleBuiltinCommand, buildModelCatalog, BUILTIN_COMMANDS, type CommandContext, type ModelPick } from "./commands.ts";
import { writeTrace } from "../src/telemetry/trace.ts";
import { setPlainMode } from "../src/tui/theme.ts";
import { saveActiveSelection } from "../src/config.ts";
import type { CliSession } from "./setup.ts";

// Kompak & friendly: singkirkan JSON body mentah + potong panjang.
function compactError(raw: string): string {
  const msg = raw.match(/"message"\s*:\s*"([^"]{1,160})"/);
  if (msg?.[1]) return msg[1];
  const withoutJson = raw.replace(/\{[\s\S]*\}/, "").trim();
  if (withoutJson) return withoutJson.slice(0, 200);
  return raw.slice(0, 200);
}

export async function runRepl(ctx: CliSession): Promise<void> {
  // REPL = monochrome total. Windows conhost mangle ANSI saat readline aktif
  // (\x1b[31m → "31"): matikan semua warna, semua output plain text.
  setPlainMode(true);

  const {
    session, cfg, cwd, sessionId, modelRef, providerRef,
    permissionMode, sessionTools, allLoadedSkills, usage, budget,
    persistCurrent, runPromptWithVerify, close,
  } = ctx;

  // Tab completion: slash commands + skills
  const getCompletions = (line: string): string[] => {
    if (!line.startsWith("/")) return [];
    const candidates = [...BUILTIN_COMMANDS.map((b) => `/${b.name}`), ...allLoadedSkills.map((s) => `/${s.name}`)];
    return candidates.filter((c) => c.startsWith(line));
  };

  // Katalog model dedupe (cross-provider, provider aktif diprioritas)
  const allModels = (): ModelPick[] => buildModelCatalog(cfg.providers, providerRef.current);

  const persistSelection = async (model: string, providerId: string): Promise<void> => {
    try { await saveActiveSelection(model, providerId, { global: false, cwd }); } catch {}
  };

  // Clear screen — bersihkan semua, langsung prompt
  process.stdout.write("\x1b[2J\x1b[H");

  const interactivePrompt = createInteractivePrompt({ getCompletions });

  const commandCtx: CommandContext = {
    cwd, sessionId,
    currentModel: modelRef.current,
    currentProviderId: providerRef.current,
    usage, skills: allLoadedSkills, toolsCount: sessionTools.length,
    providerHint: cfg.providers.find((p) => p.id === providerRef.current)?.providerHint ?? cfg.providers[0]?.providerHint,
    setModelOverride: (m: string, p?: string) => {
      modelRef.current = m;
      if (p) providerRef.current = p;
    },
    pick: (prompt?: string) => interactivePrompt.ask(prompt),
    allModels,
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
        else {
          // Unknown slash command — jangan pernah kirim ke LLM
          console.log(`\n[?] Unknown command: /${skillName} — type /help\n`);
          continue;
        }
      }

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
      const short = compactError(hadError);
      process.stdout.write(`\n  ✗ ${short}\n`);
      if (/\b429\b|rate.limit/i.test(hadError)) {
        process.stdout.write(`  Fix: rate limited — wait a moment and retry (or add --ratelimit).\n\n`);
      } else if (/\b40[13]\b|auth|api key|balance|quota|insufficient/i.test(hadError)) {
        process.stdout.write(`  Fix: check API key / balance for active provider, or switch: /model <name> to another provider.\n\n`);
      } else if (/\btimeout\b/i.test(hadError)) {
        process.stdout.write(`  Fix: timed out — retry (or increase --timeout, or pick a faster model).\n\n`);
      } else if (/\b5\d\d\b|server|network|econn/i.test(hadError)) {
        process.stdout.write(`  Fix: provider/server error — retry, or switch provider: /model <name>.\n\n`);
      } else {
        process.stdout.write(`\n`);
      }
    }
  }

  interactivePrompt.close();
  await close();
  process.exit(0);
}
