import { listSessions } from "../src/session/persistence.ts";
import { loadHistory } from "./input.ts";
import { loadConfig, saveActiveSelection } from "../src/config.ts";
import type { Usage } from "../src/policy/usage.ts";
import type { Skill } from "../src/skills/loader.ts";

// SEMUA output = PLAIN TEXT tanpa ANSI.
// Readline + ANSI di Windows conhost = karakter escape bocor jadi teks literal
// ("31", "39", "136ID3922", dst). REPL harus monochrome total.

export interface ModelPick {
  model: string;
  providers: string[];
}

export interface CommandContext {
  cwd?: string;
  sessionId: string;
  currentModel?: string;
  currentProviderId?: string;
  providerHint?: string;
  usage: { get: (model?: string) => Usage; reset: () => void };
  skills: Skill[];
  toolsCount: number;
  setModelOverride: (model: string, providerId?: string) => void;
  pick?: (prompt?: string) => Promise<string | null>;
  allModels?: () => ModelPick[];
}

export const BUILTIN_COMMANDS = [
  { name: "help", desc: "Show available slash commands" },
  { name: "providers", desc: "List providers & which is active" },
  { name: "models [query]", desc: "List & pick a model (all providers)" },
  { name: "model [name|index]", desc: "Show or switch the model" },
  { name: "cost", desc: "Show token usage & session cost" },
  { name: "undo", desc: "Rollback file edits from last turn" },
  { name: "redo", desc: "Reapply undone file edits" },
  { name: "sessions", desc: "List recent sessions" },
  { name: "status", desc: "Show runtime status" },
  { name: "history", desc: "Show recent prompt history" },
  { name: "clear", desc: "Clear the terminal" },
  { name: "provider-add", desc: "Add an LLM provider (interactive)" },
  { name: "provider-remove <id>", desc: "Remove a provider by id" },
  { name: "exit", desc: "Quit Minicode" },
];

function pad(text: string, width: number): string {
  const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  const diff = width - clean.length;
  return diff > 0 ? text + " ".repeat(diff) : text;
}

// Katalog model dedupe lintas provider. Model yang sama dari beberapa provider
// di-CRUSH jadi satu entri + tag daftar provider-nya.
export function buildModelCatalog(providers: { id: string; models: string[] }[], preferProviderId?: string): ModelPick[] {
  const map = new Map<string, string[]>();
  for (const p of providers) {
    for (const m of p.models) {
      const arr = map.get(m) ?? [];
      if (!arr.includes(p.id)) arr.push(p.id);
      map.set(m, arr);
    }
  }
  const entries = [...map.entries()].map(([model, providers]) => ({ model, providers }));
  if (preferProviderId) {
    entries.sort((a, b) => {
      const pa = a.providers.includes(preferProviderId) ? 0 : 1;
      const pb = b.providers.includes(preferProviderId) ? 0 : 1;
      return pa - pb;
    });
  }
  return entries;
}

function printModelList(items: ModelPick[], activeModel?: string): void {
  const nameW = Math.min(Math.max(...items.map((i) => i.model.length), 12) + 2, 48);
  items.forEach((it, idx) => {
    const marker = it.model === activeModel ? "*" : " ";
    const tag = it.providers.join(",");
    console.log(` ${marker} ${String(idx + 1).padEnd(3)}${pad(it.model, nameW)}[${tag}]${it.model === activeModel ? "  (active)" : ""}`);
  });
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
      console.log("\nCommands:");
      for (const b of BUILTIN_COMMANDS) {
        console.log(`  /${pad(b.name, 22)}${b.desc}`);
      }
      if (ctx.skills.length > 0) {
        console.log("\nSkills:");
        for (const s of ctx.skills) {
          console.log(`  /${pad(s.name, 20)}${s.description || ""}`);
        }
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
        console.log("[OK] Undid file changes:");
        for (const f of res.restoredFiles) console.log(`  -> ${f}`);
      } else {
        console.log(`[FAIL] Undo failed: ${res.message}`);
      }
      return { handled: true };
    }

    case "redo": {
      const { redoLastCheckpoint } = await import("../src/session/checkpoint.ts");
      const res = await redoLastCheckpoint(ctx.sessionId, ctx.cwd);
      if (res.success) {
        console.log("[OK] Reapplied file changes:");
        for (const f of res.reappliedFiles) console.log(`  -> ${f}`);
      } else {
        console.log(`[FAIL] Redo failed: ${res.message}`);
      }
      return { handled: true };
    }

    case "exit":
    case "quit":
      console.log("Goodbye!");
      return { handled: true, shouldExit: true };

    case "model": {
      const items = ctx.allModels?.() ?? [];
      if (items.length === 0) {
        console.log("(no models discovered — use /provider-add)");
        return { handled: true };
      }
      if (!args) {
        printModelList(items, ctx.currentModel);
        console.log(`\n  Active: ${ctx.currentModel ?? "none"}` + (ctx.currentProviderId ? ` via ${ctx.currentProviderId}` : ""));
        console.log(`  Pick: /model <number>  or  /model <name[@provider]>`);
        return { handled: true };
      }
      // numeric — pilih dari daftar
      const num = Number(args);
      if (!Number.isNaN(num) && num >= 1 && num <= items.length) {
        const it = items[num - 1]!;
        const providerId = it.providers.includes(ctx.currentProviderId ?? "") ? ctx.currentProviderId! : it.providers[0]!;
        ctx.setModelOverride(it.model, providerId);
        void persistSelection(ctx, it.model, providerId);
        console.log(`[OK] model: ${it.model} (via ${providerId})`);
        return { handled: true };
      }
      // name[@provider]
      const [name, providerHintArg] = args.split("@").map((s) => s.trim());
      const entry = items.find((i) => i.model === name);
      if (!entry) {
        console.log(`[?] Model "${name}" not found — try /models or /model <number>`);
        return { handled: true };
      }
      let useId: string;
      if (providerHintArg) {
        if (!entry.providers.includes(providerHintArg)) {
          console.log(`[?] Provider "${providerHintArg}" does not have "${name}" — available: ${entry.providers.join(", ")}`);
          return { handled: true };
        }
        useId = providerHintArg;
      } else {
        useId = entry.providers.includes(ctx.currentProviderId ?? "") ? ctx.currentProviderId! : entry.providers[0]!;
      }
      ctx.setModelOverride(entry.model, useId);
      void persistSelection(ctx, entry.model, useId);
      console.log(`[OK] model: ${entry.model} (via ${useId})`);
      return { handled: true };
    }

    case "models": {
      const items = ctx.allModels?.() ?? [];
      if (items.length === 0) {
        console.log("(no models discovered — use /provider-add)");
        return { handled: true };
      }
      const query = args.toLowerCase();
      const filtered = query ? items.filter((i) => i.model.toLowerCase().includes(query)) : items;
      if (filtered.length === 0) {
        console.log(`[?] No model matches "${args}".`);
        return { handled: true };
      }
      printModelList(filtered.slice(0, 40), ctx.currentModel);
      if (filtered.length > 40) console.log(`  ... +${filtered.length - 40} more`);
      console.log(`\n${items.length} models (deduped) · Pick: /model <number>`);
      // Interactive pick: user tinggal ketik nomor
      if (ctx.pick && filtered.length <= 40) {
        const ans = await ctx.pick(`  Pick model [1-${filtered.length}] (Enter = cancel): `);
        const n = Number(ans);
        if (ans && !Number.isNaN(n) && n >= 1 && n <= filtered.length) {
          const it = filtered[n - 1]!;
          const providerId = it.providers.includes(ctx.currentProviderId ?? "") ? ctx.currentProviderId! : it.providers[0]!;
          ctx.setModelOverride(it.model, providerId);
          void persistSelection(ctx, it.model, providerId);
          console.log(`[OK] model: ${it.model} (via ${providerId})`);
        }
      }
      return { handled: true };
    }

    case "providers": {
      const cfg = await loadConfig(ctx.cwd);
      if (cfg.providers.length === 0) {
        console.log("\n(no providers — use /provider-add)\n");
        return { handled: true };
      }
      console.log("\nProviders:");
      cfg.providers.forEach((p, idx) => {
        const active = p.id === ctx.currentProviderId || (!ctx.currentProviderId && idx === 0);
        const tag = active ? "*" : " ";
        const models = p.models.length === 1 ? "1 model" : `${p.models.length} models`;
        const preview = p.models[0] ?? "";
        console.log(` ${tag} ${idx + 1}. ${pad(p.id, 16)} ${pad(p.providerHint ?? "openai", 8)} ${models.padEnd(8)} ${preview}`);
      });
      console.log("");
      console.log(`  Active: ${ctx.currentProviderId ?? cfg.providers[0]?.id ?? "?"} · use /models to pick a model`);
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
        const entry = await detectAndSaveForCtx(baseUrl, apiKey, ctx.cwd);
        console.log(`[OK] Provider "${entry.id}" saved (${entry.models.length} models). Restart minicode to use.`);
      } catch (e) {
        console.log(`[FAIL] Detection failed: ${(e as Error).message.slice(0, 80)}`);
      }
      return { handled: true };
    }

    case "provider-remove": {
      if (!args) { console.log("Usage: /provider-remove <id>"); return { handled: true }; }
      const { removeProvider } = await import("../src/config.ts");
      await removeProvider(args, ctx.cwd ? { global: false, cwd: ctx.cwd } : {});
      console.log(`[OK] Removed provider "${args}"`);
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

    case "sessions": {
      const rows = listSessions(ctx.cwd).slice(0, 10);
      if (rows.length === 0) {
        console.log("(no previous sessions)");
      } else {
        console.log("\nRecent Sessions:");
        for (const r of rows) {
          console.log(`  ${r.id.padEnd(14)} ${new Date(r.created_at).toLocaleString().padEnd(24)} ${r.cwd}`);
        }
      }
      console.log("");
      return { handled: true };
    }

    case "status": {
      console.log(`\nMinicode Status`);
      console.log(`  Session ID:   ${ctx.sessionId}`);
      console.log(`  Model:        ${ctx.currentModel ?? "default"}`);
      console.log(`  Provider:     ${ctx.currentProviderId ?? ctx.providerHint ?? "unknown"}`);
      console.log(`  Active Tools: ${ctx.toolsCount}`);
      console.log(`  Skills:       ${ctx.skills.length}\n`);
      return { handled: true };
    }

    case "history": {
      const hist = await loadHistory();
      const last10 = hist.slice(-10);
      console.log(`\nRecent History`);
      last10.forEach((h, i) => { console.log(`  ${(i + 1).toString().padStart(2)}. ${h}`); });
      console.log("");
      return { handled: true };
    }

    default: {
      // Skill command? — biar repl yang handle (render skill → prompt).
      const skill = ctx.skills.find((s) => s.name === cmd);
      if (skill) return { handled: false };

      // Unknown slash → friendly suggestion, TIDAK pernah dikirim ke LLM.
      const candidates = [
        ...BUILTIN_COMMANDS.map((b) => `/${b.name}`),
        ...ctx.skills.map((s) => `/${s.name}`),
      ];
      const near = candidates.filter((c) => c.slice(1).startsWith(cmd));
      const similar = near.slice(0, 4).join("  ") || candidates.slice(0, 4).join("  ");
      console.log(`\n[?] Unknown command: /${cmd}`);
      if (near.length > 0) console.log(`    did you mean: ${similar}?`);
      else console.log(`    available: ${similar}`);
      console.log("    type /help for all commands\n");
      return { handled: true };
    }
  }
}

async function persistSelection(ctx: CommandContext, model: string, providerId: string): Promise<void> {
  try {
    await saveActiveSelection(model, providerId, { global: false, cwd: ctx.cwd });
  } catch {}
}

async function detectAndSaveForCtx(baseUrl: string, apiKey: string, cwd?: string) {
  const { detectAndSave } = await import("../src/config.ts");
  return detectAndSave(baseUrl, apiKey, undefined, {
    global: false,
    cwd,
    fallbackModels: baseUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"],
  });
}
