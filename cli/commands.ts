import { listSessions, loadSession } from "../src/session/persistence.ts";
import { loadHistory } from "./input.ts";
import { loadConfig, detectAndSave, refreshProviderModels } from "../src/config.ts";
import type { Usage } from "../src/policy/usage.ts";
import type { Skill } from "../src/skills/loader.ts";

// SEMUA output = PLAIN TEXT tanpa ANSI.
// Readline + ANSI di Windows = karakter escape bocor jadi teks literal.

export interface CommandContext {
  cwd?: string;
  sessionId: string;
  currentModel?: string;
  usage: { get: (model?: string) => Usage; reset: () => void; modelUsed: () => { effective?: string; provider?: string } };
  skills: Skill[];
  toolsCount: number;
  providerHint?: string;
  setModelOverride: (model: string) => void;
}

export const BUILTIN_COMMANDS = [
  { name: "help", desc: "Show available slash commands" },
  { name: "providers", desc: "List configured LLM providers" },
  { name: "provider-add", desc: "Add a new LLM provider (interactive)" },
  { name: "provider-remove", args: "<id>", desc: "Remove a provider by id" },
  { name: "models", args: "[id]", desc: "List models for a provider" },
  { name: "model", args: "<name>", desc: "Switch current LLM model" },
  { name: "sync", desc: "Auto-refresh model list from all providers" },
  { name: "undo", desc: "Rollback file edits from last turn" },
  { name: "redo", desc: "Reapply undone file edits" },
  { name: "cost", desc: "Show token usage & session cost" },
  { name: "sessions", desc: "List recent sessions" },
  { name: "resume", args: "[id]", desc: "Resume a session (pick from list)" },
  { name: "status", desc: "Show runtime status" },
  { name: "history", desc: "Show recent prompt history" },
  { name: "exit", desc: "Quit Minicode" },
];

function pad(text: string, width: number): string {
  const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  const diff = width - clean.length;
  return diff > 0 ? text + " ".repeat(diff) : text;
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
        const withArgs = b.args ? `${b.name} ${b.args}` : b.name;
        console.log(`  /${pad(withArgs, 22)}${b.desc}`);
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
      // Tanpa argumen: picker interaktif pilih model dari semua provider
      if (!args) {
        const cfg = await loadConfig();
        const flat = cfg.providers.flatMap((p) => p.models.map((m) => `${p.id}::${m}`));
        if (flat.length === 0) { console.log("(no models — use /provider-add)"); return { handled: true }; }
        console.log("Active model: " + (ctx.currentModel ?? "default"));
        console.log("\nAvailable:");
        flat.forEach((m, i) => { console.log(`  [${i}] ${(m.split("::")[1] ?? m).padEnd(40)}  ${m.split("::")[0]}`); });
        const { askLine } = await import("./input.ts");
        const n = await askLine({ prompt: "select # or model name > " });
        if (n == null) return { handled: true };
        const pick = n.trim();
        const idx = Number(pick);
        const spec = Number.isInteger(idx) && Number.isFinite(idx) && idx >= 0 && idx < flat.length ? flat[idx]! : pick;
        ctx.setModelOverride(spec);
        console.log(`[OK] Model: ${spec}`);
        return { handled: true };
      }
      if (args.includes("::")) {
        ctx.setModelOverride(args);
        console.log(`[OK] Model: ${args}`);
      } else {
        // cari di semua provider, kalau unik langsung pakai
        const cfg = await loadConfig();
        const owners = cfg.providers.filter((p) => p.models.includes(args));
        if (owners.length === 1) {
          ctx.setModelOverride(`${owners[0]!.id}::${args}`);
          console.log(`[OK] ${args} (${owners[0]!.id})`);
        } else if (owners.length > 1) {
          ctx.setModelOverride(args);
          console.log(`[OK] ${args} (shared by ${owners.length} providers — default routing)`);
        } else {
          console.log(`[FAIL] Model "${args}" not found — /models to see available.`);
        }
      }
      return { handled: true };
    }

    case "providers": {
      const cfg = await loadConfig();
      if (cfg.providers.length === 0) {
        console.log("\n(no providers — /provider-add to add, or minicode sync via CLI)");
      } else {
        const active = (ctx.currentModel ?? "").split("::")[0];
        console.log("");
        for (const p of cfg.providers) {
          const activeMark = p.id === active ? " ▶ active" : "";
          console.log(`  ${p.id.padEnd(16)} ${String(p.models.length).padStart(3)} models${activeMark}`);
          console.log(`  ${" ".repeat(16)} ${p.baseUrl}`);
        }
        console.log(`\n  Active model: ${ctx.currentModel ?? "default"} — /model to switch, /sync to refresh models\n`);
      }
      return { handled: true };
    }

    case "provider-add": {
      const { askLine, askSecret } = await import("./input.ts");
      const { GATEWAY_PRESETS } = await import("../src/providers/presets.ts");

      console.log("\nAdd New Provider");
      console.log("");
      GATEWAY_PRESETS.forEach((p, i) => {
        console.log(`  [${i}] ${p.label}`);
        console.log(`      ${p.baseUrl}`);
      });
      const customIdx = GATEWAY_PRESETS.length;
      console.log(`  [${customIdx}] Custom baseUrl\n`);

      const sel = await askLine({ prompt: "select gateway # > " });
      if (sel == null) { console.log("canceled"); return { handled: true }; }
      const pick = sel.trim();
      const idx = Number(pick);

      let baseUrl: string;
      let fallbackModels: string[] = ["gpt-4o-mini"];
      let hintId: string | undefined;
      if (Number.isInteger(idx) && Number.isFinite(idx) && idx >= 0 && idx < customIdx) {
        const preset = GATEWAY_PRESETS[idx]!;
        baseUrl = preset.baseUrl;
        fallbackModels = preset.fallbackModels;
        hintId = preset.id;
        console.log(`  Using: ${preset.label}`);
      } else if (idx === customIdx || (pick && !Number.isInteger(idx))) {
        const url = await askLine({ prompt: "Base URL > " });
        if (url == null || !url.trim()) { console.log("Base URL required."); return { handled: true }; }
        baseUrl = url.trim();
      } else {
        console.log(`[FAIL] Unknown selection — /provider-add to retry`);
        return { handled: true };
      }

      const apiKey = await askSecret("API Key (masked): ");
      if (!apiKey) { console.log("API Key required."); return { handled: true }; }

      // Scope: global (default, ~/.minicode) atau local (proyek)
      let scope: "global" | "local" = "global";
      if (ctx.cwd) {
        const ans = await askLine({ prompt: "Save globally to ~/.minicode? [Y/n] " });
        scope = ans?.trim().toLowerCase() === "n" ? "local" : "global";
      }
      if (scope === "local" && !ctx.cwd) scope = "global";

      console.log("Detecting models...");
      try {
        const entry = await detectAndSave(baseUrl, apiKey, hintId, {
          global: scope === "global",
          cwd: ctx.cwd,
          fallbackModels,
        });
        console.log(`[OK] Provider "${entry.id}" saved (${entry.models.length} models, ${scope}).`);
        console.log("  Next: restart minicode, then /model to pick a model.\n");
      } catch (e) {
        console.log(`[FAIL] Detection failed: ${(e as Error).message.slice(0, 80)}`);
      }
      return { handled: true };
    }

    case "provider-remove": {
      if (!args) { console.log("Usage: /provider-remove <id>"); return { handled: true }; }
      const { removeProvider } = await import("../src/config.ts");
      const entry = await (async () => {
        const cfg = await loadConfig();
        return cfg.providers.find((p) => p.id === args);
      })();
      // Hapus dari kedua scope — user tidak perlu tahu di mana ia disimpan.
      await removeProvider(args, { global: true });
      if (ctx.cwd) await removeProvider(args, { global: false, cwd: ctx.cwd });
      console.log(`[OK] Removed provider "${args}"${entry ? "" : " (was not in merged config)"}`);
      return { handled: true };
    }

    case "models": {
      // /models [id] [keyword] — filter substring (case-insensitive)
      const cfg = await loadConfig();
      const spaceIdx = args.indexOf(" ");
      const pid = spaceIdx === -1 ? args : args.slice(0, spaceIdx);
      const filter = (spaceIdx === -1 ? "" : args.slice(spaceIdx + 1).trim()).toLowerCase();

      const filterModels = (ms: string[]) => filter ? ms.filter((m) => m.toLowerCase().includes(filter)) : ms;

      if (pid) {
        const p = cfg.providers.find((x) => x.id === pid);
        if (!p) { console.log(`Provider "${pid}" not found — /providers to list.`); return { handled: true }; }
        const list = filterModels(p.models);
        console.log(`\n${p.id} (${p.baseUrl})${filter ? ` — filter "${filter}"` : ""}`);
        if (list.length === 0) console.log("  (no match)");
        list.forEach((m, i) => { console.log(`  [${i}] ${m}`); });
      } else {
        console.log("");
        for (const p of cfg.providers) {
          const list = filterModels(p.models.slice(0, 12));
          console.log(`${p.id} (${p.baseUrl})${filter ? ` — filter "${filter}"` : ""}`);
          if (list.length === 0) console.log("  (no match)");
          list.forEach((m, i) => { console.log(`  [${i}] ${m}`); });
          if (!filter && p.models.length > 12) console.log(`  … +${p.models.length - 12} more`);
          console.log("");
        }
      }
      console.log(`(use /model to switch — interactive picker, or /model <provider>::<model>` + (pid ? ")" : ")\n"));
      return { handled: true };
    }
    case "cost":
    case "usage": {
      const u = ctx.usage.get(ctx.currentModel);
      const mUsed = ctx.usage.modelUsed();
      console.log(`\nSession Usage`);
      console.log(`  Input Tokens:  ${u.inputTokens.toLocaleString()}`);
      console.log(`  Output Tokens: ${u.outputTokens.toLocaleString()}`);
      console.log(`  Total Tokens:  ${u.totalTokens.toLocaleString()}`);
      if (u.cacheReadTokens) console.log(`  Cache Read:    ${u.cacheReadTokens.toLocaleString()}`);
      if (u.cacheWriteTokens) console.log(`  Cache Write:   ${u.cacheWriteTokens.toLocaleString()}`);
      console.log(`  Estimated Cost: ${u.cost != null ? `$${u.cost.toFixed(4)}` : "N/A"}`);
      if (mUsed.effective && mUsed.effective !== ctx.currentModel) {
        console.log(`  Model Used:    ${mUsed.effective} (${mUsed.provider ?? "?"} via fallback)`);
      }
      console.log("");
      return { handled: true };
    }

    case "compact": {
      console.log("Compaction is automatic (kernel budget policy).");
      return { handled: true };
    }

    case "sync": {
      // Re-detect model dari semua provider → config diperbarui otomatis
      console.log("\nSyncing models from providers...");
      const results = await refreshProviderModels({ cwd: ctx.cwd });
      if (results.length === 0) {
        console.log("  (no provider found — use /provider-add first)");
      } else {
        for (const r of results) {
          console.log(`  [OK] ${r.id}: ${r.from} → ${r.to} models`);
        }
      }
      console.log("  Restart minicode for the router to pick up new models.\n");
      return { handled: true };
    }

    case "sessions": {
      const rows = listSessions(ctx.cwd).slice(0, 25);
      if (rows.length === 0) {
        console.log("\n(no previous sessions)");
      } else {
        console.log("\nRecent Sessions:");
        rows.forEach((r, i) => {
          console.log(`  [${i}] ${r.id.padEnd(14)} ${new Date(r.created_at).toLocaleString().padEnd(24)} ${r.cwd || "(cwd)"}`);
        });
        console.log("  (type a number to resume, or /resume <id>)");
      }
      console.log("");
      return { handled: true };
    }

    case "resume": {
      const rows = listSessions(ctx.cwd);
      if (rows.length === 0) {
        console.log("(no previous sessions to resume)");
        return { handled: true };
      }
      let target = args;
      if (!target) {
        rows.slice(0, 15).forEach((r, i) => {
          console.log(`  [${i}] ${r.id.padEnd(14)} ${new Date(r.created_at).toLocaleString().padEnd(24)} ${r.cwd || "(cwd)"}`);
        });
        const { askLine } = await import("./input.ts");
        const n = await askLine({ prompt: "resume # or id > " });
        if (n == null) { console.log("canceled"); return { handled: true }; }
        const pick = n.trim();
        const idx = Number(pick);
        if (Number.isInteger(idx) && Number.isFinite(idx) && idx >= 0 && idx < rows.length) target = rows[idx]!.id;
        else target = pick;
      }
      if (!target) { console.log("canceled"); return { handled: true }; }
      const sess = loadSession(target, ctx.cwd);
      if (!sess || !sess.messages.length) {
        console.log(`[FAIL] session "${target}" not found or empty`);
        return { handled: true };
      }
      // Respawn dengan --resume: kernel mendukung initialMessages penuh
      // (seed context store). Proses lama bersih-bersih dan diganti.
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, ["cli/index.ts", `--resume=${target}`, ...(ctx.cwd ? [`--cwd=${ctx.cwd}`] : [])], {
        stdio: "inherit",
        env: { ...process.env, MINICODE_RESUME_NEW: "1" },
      });
      child.on("exit", (code) => process.exit(code ?? 0));
      process.stdin.pause();
      return { handled: true };
    }

    case "status": {
      const mUsed = ctx.usage.modelUsed();
      console.log(`\nMinicode Status`);
      console.log(`  Session ID:   ${ctx.sessionId}`);
      console.log(`  Model:        ${ctx.currentModel ?? "default"}`);
      if (mUsed.effective && mUsed.effective !== ctx.currentModel) {
        console.log(`  Model Used:   ${mUsed.effective} (${mUsed.provider ?? "?"} via fallback)`);
      }
      console.log(`  Provider:     ${ctx.providerHint ?? "unknown"}`);
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

    default:
      return { handled: false };
  }
}
