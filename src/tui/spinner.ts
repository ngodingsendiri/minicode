import { c, glyphs } from "./theme.ts";

// Jaga agar kursor terminal selalu ter-restore meski proses dihentikan (SIGINT/dll).
process.on("exit", () => {
  if (process.stderr.isTTY) process.stderr.write("\x1b[?25h");
});

export interface Spinner {
  update: (message: string) => void;
  stop: (finalMessage?: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

export function createSpinner(initialMessage: string = ""): Spinner {
  const isTTY = process.stderr.isTTY;
  let message = initialMessage;
  let frameIdx = 0;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const frames = glyphs.spinnerFrames;

  if (isTTY) {
    // Hide cursor during spin
    process.stderr.write("\x1b[?25l");

    intervalId = setInterval(() => {
      const frame = c.cyan(frames[frameIdx % frames.length]!);
      frameIdx++;
      process.stderr.write(`\r${frame} ${message}\x1b[K`);
    }, 80);
  }

  const stopTimer = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
    if (isTTY) {
      process.stderr.write("\r\x1b[K\x1b[?25h");
    }
  };

  return {
    update(newMessage: string) {
      message = newMessage;
    },
    stop(finalMessage?: string) {
      stopTimer();
      if (finalMessage) {
        process.stderr.write(`${finalMessage}\n`);
      }
    },
    success(msg: string) {
      stopTimer();
      process.stderr.write(`${c.green(glyphs.check)} ${msg}\n`);
    },
    error(msg: string) {
      stopTimer();
      process.stderr.write(`${c.red(glyphs.cross)} ${msg}\n`);
    },
  };
}
