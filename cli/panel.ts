// Modal panel — jendela besar untuk output slash command.
// Konten bisa lebih panjang dari layar: scroll ↑/↓, Enter/Esc untuk tutup.
import { decodeKeys } from "./prompt-engine.ts";

export interface PanelOptions {
  title: string;
  lines: string[];
}

const DIM = "\x1b[2m", RESTORE = "\x1b[22m", CLEAR = "\x1b[2K", INV = "\x1b[7m";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

// Tangkap process.stdout.write + console.log sementara → array baris.
// Dipakai agar command yang menulis banyak teks bisa ditampilkan dalam panel.
export function captureOutput(fn: () => Promise<void>): Promise<{ lines: string[] }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    const origLog = console.log;
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      const s = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      for (const l of s.split("\n")) {
        const clean = stripAnsi(l.replace(/\s+$/, ""));
        if (clean.length) lines.push(clean);
      }
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
      lines.push(stripAnsi(String(args.join(" ")).trim()));
    };
    fn().then(
      () => {
        process.stdout.write = origWrite;
        console.log = origLog;
        resolve({ lines });
      },
      (e) => {
        process.stdout.write = origWrite;
        console.log = origLog;
        reject(e);
      },
    );
  });
}

// Jendela modal untuk menampilkan output command. Satu jendela utuh:
//
//   ─ Providers ─────────────────────────────
//      bai › 42 models ─ https://api.b.ai/v1
//   › …
//
// ↑/↓ scroll (bila melebihi layar), Enter/Esc tutup.
export async function runPanel(opts: PanelOptions): Promise<void> {
  if (!process.stdin.isTTY) {
    // non-TTY: print apa adanya
    console.log("\n" + opts.title);
    for (const l of opts.lines) console.log("  " + l);
    return;
  }

  return new Promise<void>((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let scroll = 0;
    const wrapWidth = () => Math.max(40, Math.min(process.stdout.columns - 4 || 76, 80));

    const totalLines = Math.max(1, opts.lines.length + 2); // + header/footer space
    const viewHeight = () => Math.max(5, Math.min(process.stdout.rows - 4 || 14, 20));

    const render = () => {
      const v = viewHeight();
      const maxScroll = Math.max(0, totalLines - v);
      if (scroll > maxScroll) scroll = maxScroll;
      const w = wrapWidth();
      const vis = opts.lines.slice(scroll, scroll + v - 2);

      process.stdout.write("\r" + CLEAR);
      // header
      process.stdout.write(`\r\n${DIM}─ ${opts.title} ─${RESTORE}\r\n`);
      for (let i = 0; i < v - 2; i++) {
        const text = vis[i] ?? "";
        process.stdout.write(`${CLEAR}   ${text.slice(0, w - 4)}`);
        if (i < v - 3) process.stdout.write("\r\n");
      }
      // footer: scroll hint
      const hint =
        maxScroll > 0 ? `↑/↓ scroll · ${scroll + 1}/${totalLines}` : `Enter/Esc close`;
      process.stdout.write(`\r\n${CLEAR}${DIM}${hint}${RESTORE}`);
    };

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\x1b[0m\x1b[?25h");
      process.stdout.write("\r\n");
    };

    const onData = (chunk: Buffer) => {
      for (const d of decodeKeys(chunk)) {
        switch (d.key.type) {
          case "up":
            scroll = Math.max(0, scroll - 1);
            render();
            break;
          case "down":
            scroll += 1;
            render();
            break;
          case "enter":
          case "esc":
          case "ctrl-c":
          case "ctrl-d":
            cleanup();
            resolve();
            return;
          default:
            break;
        }
      }
    };

    process.stdout.write("\x1b[?25l");
    process.stdin.on("data", onData);
    render();
  });
}
