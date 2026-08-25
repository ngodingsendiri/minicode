import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createState, applyKey, buildRenderSpec, decodeKeys, type PromptAction } from "./prompt-engine.ts";

const HISTORY_FILE = join(homedir(), ".minicode", "history");
const MAX_HISTORY = 1000;

export async function loadHistory(): Promise<string[]> {
  try {
    const content = await readFile(HISTORY_FILE, "utf8");
    return content.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function appendHistory(entry: string): Promise<void> {
  const clean = entry.trim();
  if (!clean) return;
  try {
    const existing = await loadHistory();
    const filtered = existing.filter((e) => e !== clean);
    filtered.push(clean);
    const capped = filtered.slice(-MAX_HISTORY);
    await mkdir(join(homedir(), ".minicode"), { recursive: true }).catch(() => {});
    await writeFile(HISTORY_FILE, capped.join("\n") + "\n", "utf8");
  } catch {}
}

// ── ANSI support detection (sekali per process, cached) ──
// Windows legacy conhost tidak memproses VT sequences → dropdown tidak bisa
// digambar. Detect aktif via DSR probe (\x1b[6n) + env hints.
let ansiCache: Promise<boolean> | undefined;

function probeAnsi(): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(false), 100);
    const onProbe = (chunk: Buffer) => {
      // Strict DSR reply: ESC [ <digits>;... R . Jangan match "/" —
      // user bisa mengetik slash saat probe berjalan (false positive).
      if (/\x1b\[[0-9;]*R/.test(chunk.toString())) finish(true);
    };
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onProbe);
      resolve(v);
    };
    try {
      process.stdin.resume();
      process.stdin.on("data", onProbe);
      process.stdout.write("\x1b[6n");
    } catch {
      finish(false);
    }
  });
}

export async function detectAnsi(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const envHint = process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.ANSICON || process.env.ConEmuANSI;
  if (envHint) return true;
  if (!process.stdin.isTTY) return false;
  ansiCache ??= probeAnsi();
  return ansiCache;
}

export interface AskLineOptions {
  prompt?: string;
  hints?: (line: string) => string[];
}

// Input interaktif satu baris + floating dropdown suggestions (dimmed).
// - ANSI (Windows Terminal/VS Code/macOS/Linux): dropdown baris di bawah prompt,
//   seleksi › hijau, navigasi ↑/↓, Tab = complete tetap editing, Enter = complete + submit.
// - Legacy console (tanpa VT): fallback inline hints di baris yang sama.
// Semua logika transisi ada di prompt-engine.ts (pure) — di sini hanya IO + render.
export async function askLine(opts: AskLineOptions = {}): Promise<string | null> {
  const prompt = opts.prompt ?? "minicode❯ ";

  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (a) => { rl.close(); resolve(a.trim() || null); });
    });
  }

  const ansi = await detectAnsi();
  const DIM = "\x1b[2m", RESTORE = "\x1b[22m", CLEAR = "\x1b[2K", SEL = "\x1b[36m";
  const hints = (l: string) => opts.hints?.(l) ?? [];

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let state = createState();
    let prevRows = 0; // jumlah baris dropdown yang tergambar (untuk clear)
    let printedW = 0; // lebar teks yang ditulis (fallback inline)
    let pending: PromptAction = "none";

    const matches = (): string[] => hints(state.line);

    // ── render ANSI: dropdown floating di bawah prompt ──
    const renderAnsi = () => {
      const spec = buildRenderSpec(state, prompt, matches());
      const maxRows = Math.max(prevRows, spec.totalRows);

      process.stdout.write("\r" + CLEAR + spec.inputLine);

      if (maxRows > 0) {
        process.stdout.write("\r\n");
        for (let k = 0; k < maxRows; k++) {
          process.stdout.write(CLEAR);
          if (k < maxRows - 1) process.stdout.write("\r\n");
        }
        process.stdout.write(`\x1b[${maxRows}A`);
        process.stdout.write("\r" + spec.inputLine);
      }

      if (spec.rows.length > 0) {
        process.stdout.write("\r\n");
        for (let i = 0; i < spec.rows.length; i++) {
          const picked = spec.rows[i]!.picked;
          const prefix = picked ? "  › " : "    ";
          process.stdout.write(CLEAR + (picked ? SEL + prefix + spec.rows[i]!.text + RESTORE : DIM + prefix + spec.rows[i]!.text + RESTORE));
          if (i < spec.rows.length - 1) process.stdout.write("\r\n");
        }
        if (spec.moreCount > 0) {
          process.stdout.write("\r\n");
          process.stdout.write(CLEAR + DIM + `    … ${spec.moreCount} more` + RESTORE);
        }
        process.stdout.write(`\x1b[${spec.totalRows}A`);
        process.stdout.write("\r" + spec.inputLine);
      }

      prevRows = spec.totalRows;
    };

    // ── render inline (legacy console, tanpa ANSI) ──
    const renderInline = () => {
      const hs = matches();
      const content = hs.length ? `${prompt}${state.line}    ${hs.slice(0, 5).join("  ")}` : `${prompt}${state.line}`;
      const pad = printedW - content.length;
      process.stdout.write("\r" + " ".repeat(printedW) + "\r" + content + (pad > 0 ? " ".repeat(pad) : ""));
      printedW = content.length;
    };

    const render = ansi ? renderAnsi : renderInline;

    const onData = (chunk: Buffer) => {
      for (const d of decodeKeys(chunk)) {
        const r = applyKey(state, d.key, hints);
        state = r.state;
        pending = r.action;
        if (pending === "submit") {
          const v = state.line.trim() || null;
          if (ansi && prevRows > 0) {
            process.stdout.write("\r" + CLEAR + `${prompt}${state.line}`);
            for (let k = 0; k < prevRows; k++) process.stdout.write("\r\n" + CLEAR);
            process.stdout.write("\r\n");
          } else {
            process.stdout.write("\r" + CLEAR + `${prompt}${state.line}` + "\r\n");
          }
          finish(v);
          return;
        }
        if (pending === "cancel") {
          finish(null);
          return;
        }
        if (pending === "render") render();
      }
    };

    const finish = (v: string | null) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      resolve(v);
    };

    process.stdin.on("data", onData);
    render();
  });
}

export async function askSecret(promptText: string): Promise<string> {
  if (!process.stdin.isTTY) return "";

  return new Promise((resolve) => {
    process.stdout.write(promptText);
    let secret = "";

    const onData = (chunk: Buffer) => {
      const str = chunk.toString();

      for (let i = 0; i < str.length; i++) {
        const char = str[i]!;

        if (char === "\r" || char === "\n") {
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(secret.trim());
          return;
        } else if (char === "\u0003") {
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          process.exit(130);
        } else if (char === "\u007f" || char === "\b") {
          if (secret.length > 0) {
            secret = secret.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (char.charCodeAt(0) >= 32) {
          secret += char;
          process.stdout.write("*");
        }
      }
    };

    process.stdin.resume();
    process.stdin.setRawMode(true);
    process.stdin.on("data", onData);
  });
}
