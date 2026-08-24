import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { lspDiagnostics, getConfiguredExts } from "../lsp/client.ts";

const execAsync = promisify(exec);

export interface VerifyResult {
  ok: boolean;
  output: string;
  command: string;
}

// Jalankan perintah verifikasi (typecheck/test/lint) dengan timeout.
export async function runVerify(command: string, cwd: string, timeoutMs = 30_000): Promise<VerifyResult> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: timeoutMs, encoding: "utf8" } as never);
    const output = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
    return { ok: true, output, command };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const output = `${err.stdout ?? ""}${err.stderr ? `\n${err.stderr}` : ""}`.trim() || String(e);
    return { ok: false, output: output.slice(0, 8000), command };
  }
}

// Deteksi perintah verify yang masuk akal untuk proyek di `cwd`.
export function detectVerifyCommand(cwd?: string): string | undefined {
  const pkg = resolve(cwd ?? ".", "package.json");
  if (existsSync(pkg)) {
    try {
      const raw = readFileSync(pkg, "utf8");
      const scripts = JSON.parse(raw)?.scripts as Record<string, string> | undefined;
      if (scripts?.typecheck) return scripts.typecheck; // prefer typecheck
      if (scripts?.test) return scripts.test; // fallback ke test
    } catch {}
  }
  const tsconfig = resolve(cwd ?? ".", "tsconfig.json");
  if (existsSync(tsconfig)) return "bun x tsc --noEmit";
  return undefined;
}

// Format LSP diagnostics items jadi string ringkas, maks 8 baris pertama.
function formatDiagnostics(items: Record<string, unknown>[], filePath: string): string {
  const SEVERITY = ["Error", "Warning", "Info", "Hint"];
  const errors = items.filter((d) => (d.severity as number ?? 1) <= 2); // Error/Warning
  if (errors.length === 0) return "";
  const lines = errors.slice(0, 8).map((d) => {
    const r = d.range as { start?: { line?: number; character?: number } } | undefined;
    const pos = r?.start ? `:${(r.start.line ?? 0) + 1}:${(r.start.character ?? 0) + 1}` : "";
    const sev = SEVERITY[((d.severity as number) ?? 1) - 1] ?? "?";
    return `${sev}${pos}: ${d.message}`;
  });
  const summary = `${filePath}: ${errors.length} issue(s)`;
  const extra = errors.length > 8 ? `\n  ... (+${errors.length - 8} more)` : "";
  return `[lsp] ${summary}\n  ${lines.join("\n  ")}${extra}`;
}

// Ambil LSP diagnostics untuk file yang baru ditulis, lalu tempelkan ke `base`
// bila ada error/warning. Best-effort: silent bila LSP tak terkonfigurasi/timeout.
export async function appendLspDiagnostics(
  absPath: string,
  newContent: string,
  base: string,
  timeoutMs = 2000,
): Promise<string> {
  try {
    const ext = extname(absPath).toLowerCase();
    if (!getConfiguredExts().includes(ext)) return base;
    const { items } = await lspDiagnostics(absPath, newContent, timeoutMs);
    const diag = formatDiagnostics(items, absPath);
    if (!diag) return base;
    return `${base}\n${diag}`;
  } catch {
    return base;
  }
}

// Loop self-heal: maks 3 siklus verify → fix → verify.
export interface SelfHealDeps {
  run: (prompt: string) => Promise<void>;
  verify: () => Promise<VerifyResult>;
  maxCycles?: number;
  onCycle?: (cycle: number, max: number, result: VerifyResult) => void;
  onOk?: (cycles: number) => void;
}

export async function runWithSelfHeal(initialPrompt: string, deps: SelfHealDeps): Promise<void> {
  await deps.run(initialPrompt);
  const max = deps.maxCycles ?? 3;
  for (let cycle = 1; cycle <= max; cycle++) {
    const v = await deps.verify();
    if (v.ok) {
      if (cycle > 1) deps.onOk?.(cycle);
      return;
    }
    if (cycle >= max) {
      deps.onCycle?.(cycle, max, v);
      return;
    }
    deps.onCycle?.(cycle, max, v);
    await deps.run(`[Auto-Verifier] Verification failed (cycle ${cycle}/${max}). Fix these errors:\n${v.output.slice(0, 4000)}`);
  }
}