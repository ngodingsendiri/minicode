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

// Auto-show slash command hints: saat line starts dengan "/", prompt jadi
// multiline yang menampilkan matching commands di baris atas prompt.
// Fully readline-managed — ZERO ANSI tulis tangan (aman di conhost Windows).
// Polling rl.line setiap 110ms: tidak bergantung pada keypress events runtime.
const BASE_PROMPT = "minicode❯ ";
const HINT_POLL_MS = 110;

function hintRender(hits: string[]): string {
  const width = process.stdout.columns || 80;
  let out = "";
  for (const h of hits) {
    if (out.length + h.length + 2 > width) {
      out += " …";
      break;
    }
    out += (out ? "  " : "") + h;
  }
  return out;
}

export function attachSlashHints(
  rl: Interface,
  getCompletions: (line: string) => string[],
): () => void {
  let last = BASE_PROMPT;
  const timer = setInterval(() => {
    const line = (rl as { line?: string }).line ?? "";
    let next = BASE_PROMPT;
    if (line.startsWith("/")) {
      const hits = getCompletions(line).filter((h) => h !== line);
      if (hits.length > 0) next = hintRender(hits) + "\n" + BASE_PROMPT;
    }
    if (next !== last) {
      last = next;
      try {
        rl.setPrompt(next);
        // prompt(true) = redraw tanpa reset cursor — menjaga input yang sudah diketik
        if (line.length > 0) rl.prompt(true);
      } catch {}
    }
  }, HINT_POLL_MS);
  return () => clearInterval(timer);
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
  const defaultPrompt = BASE_PROMPT;
  const continuationPrompt = "  ... ";

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    historySize: MAX_HISTORY,
    prompt: defaultPrompt,
  });

  const detachHints = opts.getCompletions ? attachSlashHints(rl, opts.getCompletions) : null;

  return {
    rl,
    ask(customPrompt?: string): Promise<string | null> {
      return new Promise((resolve) => {
        const lines: string[] = [];
        const initialPrompt = customPrompt && customPrompt.trim() ? customPrompt : defaultPrompt;
        rl.setPrompt(initialPrompt);

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
      if (detachHints) detachHints();
      rl.close();
    },
  };
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
