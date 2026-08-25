import { createInterface, type Interface } from "node:readline";
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

export interface PromptOptions {
  getCompletions?: (line: string) => string[];
}

export function createInteractivePrompt(opts: PromptOptions = {}): {
  rl: Interface;
  ask: (customPrompt?: string) => Promise<string | null>;
  close: () => void;
} {
  const completer = (line: string): [string[], string] => {
    if (!opts.getCompletions) return [[], line];
    const hits = opts.getCompletions(line);
    return [hits.length ? hits : [], line];
  };

  // Plain text prompt — TANPA ANSI escape codes.
  // Readline menghitung ANSI sebagai karakter terlihat → kursor kacau di Windows.
  const defaultPrompt = "minicode❯ ";
  const continuationPrompt = "  ... ";

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    historySize: MAX_HISTORY,
    prompt: defaultPrompt,
  });

  return {
    rl,
    ask(_customPrompt?: string): Promise<string | null> {
      return new Promise((resolve) => {
        const lines: string[] = [];
        rl.setPrompt(defaultPrompt);

        const onLine = (line: string) => {
          if (line.endsWith("\\")) {
            lines.push(line.slice(0, -1));
            rl.setPrompt(continuationPrompt);
            rl.prompt();
            return;
          }
          lines.push(line);
          cleanup();
          resolve(lines.join("\n").trim() || null);
        };

        const onClose = () => {
          cleanup();
          resolve(lines.length ? lines.join("\n").trim() || null : null);
        };

        function cleanup() {
          rl.removeListener("line", onLine);
          rl.removeListener("close", onClose);
          rl.setPrompt(defaultPrompt);
        }

        rl.on("line", onLine);
        rl.once("close", onClose);
        rl.prompt();
      });
    },
    close() {
      rl.close();
    },
  };
}

export interface AskLineOptions {
  prompt?: string;
  hints?: (line: string) => string[];
}

// Input interaktif satu baris — TANPA SATU PUN ANSI escape code.
// Render: \r → pad spasi (hapus isi baris lama) → \r → tulis ulang.
// Aman di conhost lama Windows (yang tidak mendukung VT sequences).
export async function askLine(opts: AskLineOptions = {}): Promise<string | null> {
  const prompt = opts.prompt ?? "minicode❯ ";

  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (a) => { rl.close(); resolve(a.trim() || null); });
    });
  }

  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let line = "";
    let printedW = 0;
    const hist: string[] = [];

    const content = () => {
      const hints = opts.hints?.(line) ?? [];
      return hints.length ? `${prompt}${line}   (${hints.slice(0, 6).join(", ")})` : `${prompt}${line}`;
    };

    const render = () => {
      const c = content();
      const pad = printedW - c.length;
      process.stdout.write("\r" + " ".repeat(printedW) + "\r" + c + (pad > 0 ? " ".repeat(pad) : ""));
      printedW = c.length;
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString();
      let i = 0;
      while (i < str.length) {
        const ch = str[i]!;
        if (ch === "\r" || ch === "\n") {
          process.stdout.write("\n");
          const v = line.trim() || null;
          line = "";
          printedW = 0;
          if (v) hist.push(v);
          finish(v);
          return;
        }
        if (ch === "\u0003" || ch === "\u0004") { finish(null); return; }
        if (ch === "\u007f" || ch === "\b") { if (line.length) line = line.slice(0, -1); i++; continue; }
        if (ch === "\t") {
          const hs = opts.hints?.(line) ?? [];
          if (hs.length) line = hs[0]!;
          i++;
          continue;
        }
        if (ch === "\x1b") {
          // arrow/escape sequences: consume & ignore (sementara)
          const next = str[i + 1];
          if (next === "[" || next === "O") { i += 3; continue; }
          i += 2;
          continue;
        }
        if (ch.charCodeAt(0) >= 32) line += ch;
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
