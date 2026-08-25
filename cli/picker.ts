// Modal picker — selection window minimalis (Ubuntu Server style).
// Render ke area di bawah prompt: daftar + seleksi ›, ↑/↓ scroll, Enter pilih,
// Esc batal. Logika transisi pure; IO/render di sini.
import { decodeKeys } from "./prompt-engine.ts";

export interface PickerItem {
  name: string;          // tampil (mis. "deepseek-v4-flash")
  provider: string;      // dikelompokkan & ditampilkan dim ("bai")
  value: string;         // dikembalikan utk setModel ("bai::deepseek-v4-flash")
}

export interface PickerOptions {
  title: string;
  items: PickerItem[];
  onPick: (value: string) => void;
  onCancel: () => void;
}

const DIM = "\x1b[2m", RESTORE = "\x1b[22m", CLEAR = "\x1b[2K", INV = "\x1b[7m";

// Jendela modal selection. Menangkap stdin raw selama active, mengembalikan
// nilai pilihan lewat onPick / batal lewat onCancel; tidak mengembalikan value
// (callback-style, konsisten dengan pola command).
export async function runPicker(opts: PickerOptions): Promise<void> {
  if (!process.stdin.isTTY) {
    // non-TTY: print saja (tidak bisa modal)
    console.log("\n" + opts.title);
    opts.items.forEach((it, i) => console.log(`  [${i}] ${it.provider}::${it.name}`));
    console.log("");
    return;
  }

  return new Promise<void>((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let sel = 0;
    let scroll = 0;

    const visibleRows = () => Math.max(4, Math.min(process.stdout.rows - 3 || 10, 12));
    const width = () => Math.max(44, Math.min(process.stdout.columns - 2 || 78, 80));

    const render = () => {
      const v = visibleRows();
      if (sel < scroll) scroll = sel;
      if (sel >= scroll + v) scroll = sel - v + 1;
      // max items per layar — potong & tunjukan "…"
      const rows = opts.items.slice(scroll, scroll + v);
      const w = width();

      process.stdout.write("\r" + CLEAR);
      // header strip
      process.stdout.write(`\r\n${DIM}─ ${opts.title} ─${RESTORE}\r\n`);
      for (let i = 0; i < rows.length; i++) {
        const it = rows[i]!;
        const picked = i === sel - scroll;
        const label = `${it.provider ? it.provider + " › " : ""}${it.name}`.slice(0, w - 4);
        if (picked) {
          process.stdout.write(`${CLEAR} ${INV} › ${label}${RESTORE}`);
        } else {
          process.stdout.write(`${CLEAR}   ${DIM}${label}${RESTORE}`);
        }
        if (i < rows.length - 1) process.stdout.write("\r\n");
      }
      // footer lebih banyak?
      if (opts.items.length > scroll + v) {
        process.stdout.write(`\r\n${CLEAR}${DIM}… ${opts.items.length - scroll - v} more${RESTORE}`);
      }
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
            sel = Math.max(0, sel - 1);
            render();
            break;
          case "down":
            sel = Math.min(opts.items.length - 1, sel + 1);
            render();
            break;
          case "enter": {
            const item = opts.items[sel];
            cleanup();
            if (item) opts.onPick(item.value);
            else opts.onCancel();
            resolve();
            return;
          }
          case "esc":
          case "ctrl-c":
          case "ctrl-d":
            cleanup();
            opts.onCancel();
            resolve();
            return;
          default:
            break;
        }
      }
    };

    process.stdout.write("\x1b[?25l"); // hide cursor saat modal
    process.stdin.on("data", onData);
    render();
  });
}
