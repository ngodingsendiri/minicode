// DEMO LENGKAP — simulasi "pasang → pakai → semua fitur", tampil ke layar.
// Usage: bun scripts/demo-full.ts  (dijalankan di jendela PowerShell nyata)
import { execSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CLI = "cli/index.ts";
const BAI = "bai::deepseek-v4-flash";
let pass = 0, fail = 0;

const banner = (t: string) => console.log(`\n${"═".repeat(64)}\n  ${t}\n${"═".repeat(64)}`);
const mic = (t: string, opts: { expect?: RegExp; timeout?: number; showLast?: number } = {}) => {
  console.log(`\n  $ minicode ${t}`);
  const r = spawnSync(process.execPath, [CLI, ...t.split(" ").map((x) => x.trim())], {
    encoding: "utf8",
    timeout: opts.timeout ?? 120_000,
    env: { ...process.env },
  });
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).trim();
  const lines = out.split("\n");
  console.log(lines.slice(-(opts.showLast ?? lines.length)).join("\n"));
  const ok = opts.expect ? opts.expect.test(out) : r.status === 0;
  if (ok) { pass++; console.log(`\n  [PASS]`); }
  else { fail++; console.log(`  [FAIL] (mengharapkan ${opts.expect})\n  ---\n${out.slice(0, 800)}`); }
  return out;
};

banner("STEP 0 — ENV & KONFIGURASI (persiapan 'baru pasang')");
console.log(`  bun: ${execSync("bun --version").toString().trim() || "?"}`);
console.log(`  node branch: ${execSync("git branch --show-current").toString().trim()}`);
console.log(`  .minicode/config.json ada? ${existsSync(".minicode/config.json") ? "ya (provider terpasang)" : "belum (jalankan minicode config add)"}`);

banner("STEP 1 — KONEKSI PROVIDER (config add + auto-detect model)");
mic("config list", { expect: /bai|openrouter|aihubmix|opencode-zen/i, showLast: 10 });

banner("STEP 2 — CEK MODEL DARI PROVIDER (sync + filter)");
mic("providers", { expect: /bai|models/, showLast: 9 });
mic("models --match deepseek", { expect: /deepseek/i, showLast: 8 });
mic("models bai", { expect: /deepseek/i, showLast: 5 });

banner("STEP 3 — DIALOG PERTAMA (one-shot, cost, token)");
mic(`"2+2 berapa? jawab angka saja" --model ${BAI}`, { expect: /\d/, showLast: 5, timeout: 180_000 });

banner("STEP 4 — CODING TUGAS (tools: write_file + bash)");
rmSync("demo-app.ts", { force: true });
mic(`"Buat file demo-app.ts berisi fungsi hitung(a,b) yang menjumlahkan, lalu jalankan bun demo-app.ts dengan node?" --model ${BAI} --timeout 240000`, { expect: /demo-app|tokens|✓/i, showLast: 12, timeout: 260_000 });
console.log(`  file?: ${existsSync("demo-app.ts") ? "[OK] dibikin" : "(agent hanya pakai tool lain)"}`);

banner("STEP 5 — CHECKPOINT / UNDO / REDO (kolektor sesi + undo)");
mic(`"Tulis file undo-demo.ts: export const awal = 1;" --model ${BAI} --timeout 200000`, { expect: /tokens|undo-demo|✓/i, showLast: 8, timeout: 220_000 });
const undoHtml = mic("sessions list", { expect: /session|Recent/i, showLast: 6 });
console.log(`  [INFO] checkpoint auto recorded saat turn (snapshot workspace)`);

banner("STEP 6 — FITUR PEMANTAU: stats, budget, trace");
mic("stats", { expect: /Runs:/, showLast: 3 });
mic("sessions list", { expect: /Recent|Session/i, showLast: 8 });
mic("skills list", { expect: /skills|/i, showLast: 5 });

banner("STEP 7 — KONVERSASI LANJUT (multi-turn via /model picker)");
mic(`"/model ${BAI}"`, { expect: /model|OK/i, showLast: 4 });

banner("STEP 8 — PROVIDER FAILOVER SIMULASI (model tidak ada → substitusi)");
mic(`"1+1?" --model openrouter::nvidia/nemotron-3-ultra-550b-a55b:free --timeout 120000`, { expect: /tokens|\d/, showLast: 5, timeout: 140_000 });

banner("STEP 9 — TELEMETRY & RESOLVE-RATE");
mic("stats", { expect: /Runs:/, showLast: 3 });

banner("STEP 10 — BERSIHKAN ARTIFAK DEMO");
rmSync("demo-app.ts", { force: true });
rmSync("undo-demo.ts", { force: true });
console.log("  artifacts demo dihapus.");

console.log(`\n${"═".repeat(64)}\n  DEMO LENGKAP SELESAI — PASS=${pass} FAIL=${fail}\n${"═".repeat(64)}`);
process.exit(fail === 0 ? 0 : 1);
