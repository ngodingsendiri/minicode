// Live QA — jalankan fitur minicode satu per satu, tampilkan hasil ke layar.
// Usage: bun run test:qa  (butuh provider di config lokal/global)
import { execSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const BUN = process.execPath;
const CLI = "cli/index.ts";
let pass = 0, fail = 0;

function section(title: string) {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
}

function run(label: string, args: string[], opts: { timeout?: number; expect?: RegExp; showLast?: number } = {}): void {
  console.log(`\n── ${label} ──\n$ bun ${CLI} ${args.join(" ")}`);
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: opts.timeout ?? 120_000,
    env: { ...process.env },
  });
  const out = (r.stdout ?? "").trim() + (r.stderr ?? "").trim();
  const lines = out.split("\n");
  const shown = opts.showLast ?? lines.length;
  console.log(lines.slice(-shown).join("\n"));
  const ok = opts.expect ? opts.expect.test(out) : r.status === 0;
  if (ok) { pass++; console.log(`\n[PASS] ${label}`); }
  else { fail++; console.log(`\n[FAIL] ${label}${opts.expect ? ` (expect ${opts.expect})` : ""}\n--- full ---\n${out.slice(0, 900)}`); }
}

// ── 1. Provider list ──
section("1. minicode providers — daftar provider tanpa LLM");
run("providers", ["providers"], { expect: /bai|openrouter|aihubmix|opencode-zen/, showLast: 12 });

// ── 2. Models filter ──
section("2. minicode models --match → filter lintas provider");
run("models --match claude", ["models", "--match", "claude"], { expect: /claude/i, showLast: 14 });

// ── 3. One-shot ringan (bai) ──
section("3. one-shot: 2+2 (provider utama)");
run("2+2", ["2+2 berapa? jawab angka saja", "--model", "bai::deepseek-v4-flash"], { expect: /\d/ , showLast: 5 });

// ── 4. Fallback transparensi ──
section("4. fallback: model tidak ada di provider → substitusi + baris (via ...)");
run("substitusi", ["1+1 berapa? jawab angka saja", "--model", "openrouter::nvidia/nemotron-3-ultra-550b-a55b:free"], { expect: /via|tokens|\d/, showLast: 5 });

// ── 5. Tool calling (file) ──
section("5. tool calling: buat file sum.ts");
rmSync("sum.ts", { force: true });
run("write sum.ts", ["Buat file sum.ts: export function tambah(a: number, b: number): number { return a + b; }", "--model", "bai::deepseek-v4-flash", "--timeout", "180000"], { expect: /sum\.ts|tambah|tokens/, showLast: 10 });
console.log(`\n  file check: ${existsSync("sum.ts") ? "[OK] sum.ts terbuat" : "[FAIL] sum.ts tidak ada"}`);
if (existsSync("sum.ts")) { try { console.log(execSync("type sum.ts", { encoding: "utf8" })); } catch {} }
rmSync("sum.ts", { force: true });

// ── 6. Stats & sessions ──
section("6. telemetry: minicode stats + sessions list");
run("stats", ["stats"], { expect: /Runs:/, showLast: 3 });
run("sessions list", ["sessions", "list"], { expect: /Session ID|Recent|\(no sessions\)/, showLast: 8 });

// ── 7. Sync (refresh model, cache 30m) ──
section("7. minicode sync — refresh model dari semua provider");
run("sync", ["sync"], { expect: /OK|no provider/i, showLast: 8 });

// ── 8. Config add validation (tanpa API key) ──
section("8. config add — validasi argumen");
run("config add tanpa apiKey", ["config", "add", "--baseUrl", "https://x.ai/v1"], { expect: /apiKey|usage:/, showLast: 4 });

console.log(`\n${"=".repeat(60)}\nQA SELESAI — PASS=${pass} FAIL=${fail}\n${"=".repeat(60)}`);
process.exit(fail === 0 ? 0 : 1);
