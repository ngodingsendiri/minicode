import { createInterface } from "node:readline";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

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

// ── ANSI support detection (sekali per process) ──
// Windows legacy conhost tidak memproses VT sequences → dropdown tidak bisa
// digambar. Detect aktif via DSR probe (\x1b[6n) + env hints.
let ansiCache: Promise<boolean> | undefined;

export async function detectAnsi(): Promise<boolean> {
  if (process.platform !== "win32") return true;
  const envHint = process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.ANSICON || process.env.ConEmuANSI;
  if (envHint) return true;
  ansiCache ??= new Promise((resolve) => {
    const timer = setTimeout(() => {
      process.stdin.removeListener("data", onProbe);
      resolve(false);
    }, 60);
    const onProbe = (chunk: Buffer) => {
      if (/\/|\x1b\[[0-9;]*R/.test(chunk.toString())) {
        clearTimeout(timer);
        process.stdin.removeListener("data", onProbe);
        resolve(true);
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onProbe);
    process.stdout.write("\x1b[6n");
  });
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
// Esc: tutup dropdown. Ctrl+C/D: keluar.
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

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let line = "";
    let sel = -1; // -1 = tidak ada seleksi dropdown
    let menuOpen = false;
    let prevRows = 0; // jumlah baris dropdown yang tergambar (untuk clear)
    let printedW = 0; // lebar teks yang ditulis (fallback inline)

    const matches = (): string[] => opts.hints?.(line) ?? [];

    // ── render ANSI: dropdown floating di bawah prompt ──
    const MAX_VISIBLE = 10;
    const renderAnsi = () => {
      const content = `${prompt}${line}`;
      const all = menuOpen ? matches() : [];
      const hidden = Math.max(0, all.length - MAX_VISIBLE);
      const rows = all.slice(0, MAX_VISIBLE);
      const maxRows = Math.max(prevRows, rows.length + (hidden > 0 ? 1 : 0));

      process.stdout.write("\r" + CLEAR + content);

      if (maxRows > 0) {
        process.stdout.write("\r\n");
        for (let k = 0; k < maxRows; k++) {
          process.stdout.write(CLEAR);
          if (k < maxRows - 1) process.stdout.write("\r\n");
        }
        process.stdout.write(`\x1b[${maxRows}A`);
        process.stdout.write("\r" + content);
      }

      if (rows.length > 0) {
        if (sel >= rows.length) sel = rows.length - 1;
        process.stdout.write("\r\n");
        for (let i = 0; i < rows.length; i++) {
          const picked = i === sel;
          const prefix = picked ? "  › " : "    ";
          process.stdout.write(CLEAR + (picked ? SEL + prefix + rows[i] + RESTORE : DIM + prefix + rows[i] + RESTORE));
          if (i < rows.length - 1) process.stdout.write("\r\n");
        }
        if (hidden > 0) {
          if (rows.length > 0) process.stdout.write("\r\n");
          process.stdout.write(CLEAR + DIM + `    … ${hidden} more` + RESTORE);
        }
        const total = rows.length + (hidden > 0 ? 1 : 0);
        process.stdout.write(`\x1b[${total}A`);
        process.stdout.write("\r" + content);
      }

      prevRows = maxRows;
    };

    // ── render inline (legacy console, tanpa ANSI) ──
    const renderInline = () => {
      const hints = matches();
      const content = hints.length ? `${prompt}${line}    ${hints.slice(0, 5).join("  ")}` : `${prompt}${line}`;
      const pad = printedW - content.length;
      process.stdout.write("\r" + " ".repeat(printedW) + "\r" + content + (pad > 0 ? " ".repeat(pad) : ""));
      printedW = content.length;
    };

    const render = ansi ? renderAnsi : renderInline;

    // Tab / Enter completion (menyelesaikan item, tetap di mode editing)
    const complete = (): boolean => {
      const rows = matches();
      if (!rows.length) return false;
      const pick = sel >= 0 ? rows[sel]! : rows[0]!;
      line = pick;
      sel = -1;
      menuOpen = false;
      render();
      return true;
    };

    // Enter final: tulis ulang baris bersih + newline, lalu submit
    const submit = () => {
      if (ansi && prevRows > 0) {
        process.stdout.write("\r" + CLEAR + `${prompt}${line}`);
        for (let k = 0; k < prevRows; k++) process.stdout.write("\r\n" + CLEAR);
        process.stdout.write("\r\n");
      } else {
        process.stdout.write("\r" + CLEAR + `${prompt}${line}` + "\r\n");
      }
      const v = line.trim() || null;
      line = "";
      finish(v);
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      let i = 0;
      while (i < str.length) {
        const ch = str[i]!;

        if (ch === "\r" || ch === "\n") {
          if (menuOpen) {
            const rows = matches();
            if (rows.length > 0) {
              const pick = sel >= 0 && sel < rows.length ? rows[sel]! : rows[0]!;
              if (pick !== line) line = pick;
            }
            menuOpen = false;
            sel = -1;
          }
          submit();
          return;
        }
        if (ch === "\u0003" || ch === "\u0004") { finish(null); return; }
        if (ch === "\u001b") {
          const next = str[i + 1];
          if (next === "[" || next === "O") {
            const name = str[i + 2];
            if (name === "A" && menuOpen) {
              sel = sel <= 0 ? matches().length - 1 : sel - 1;
              i += 3; render(); continue;
            }
            if (name === "B" && menuOpen) {
              sel = (sel + 1) % matches().length;
              i += 3; render(); continue;
            }
            i += 3;
            continue;
          }
          if (menuOpen) { menuOpen = false; sel = -1; i += 2; render(); continue; }
          i += 2;
          continue;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (line.length) line = line.slice(0, -1);
          if (!line.startsWith("/")) { menuOpen = false; sel = -1; }
          i++;
          continue;
        }
        if (ch === "\t") {
          if (menuOpen) complete();
          i++;
          continue;
        }
        if (ch.charCodeAt(0) >= 32) {
          line += ch;
          if (line.startsWith("/")) menuOpen = true;
        }
        i++;
      }
      render();
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
