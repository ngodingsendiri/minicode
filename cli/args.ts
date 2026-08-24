// Pure arg-parsing helpers — dipisah dari cli/index.ts agar mudah diuji.
const BOOLEAN_FLAGS = new Set(["--verbose", "--allow-all", "--ask", "--plan", "--interactive", "--tui", "--allowlist"]);
const VALUE_FLAGS = new Set(["--cwd", "--resume", "--model", "--session", "--max-steps", "--context-window", "--timeout", "--sandbox", "--ratelimit", "--budget"]);
const KNOWN_FLAGS = new Set(["-h", "--help", "--verbose", "--allow-all", "--ask", "--plan", "--allowlist", "--interactive", "--tui", "--cwd", "--resume", "--model", "--session", "--max-steps", "--context-window", "--timeout", "--verify", "--sandbox", "--ratelimit", "--budget"]);

export function getArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

export function promptFromArgs(argv: string[]): string {
  const idx = (flag: string) => argv.indexOf(flag);
  const cwdIdx = idx("--cwd");
  const resumeIdx = idx("--resume");
  const modelIdx = idx("--model");
  const sessionIdx = idx("--session");
  const maxStepsIdx = idx("--max-steps");
  const ctxWindowIdx = idx("--context-window");
  const timeoutIdx = idx("--timeout");
  const sandboxIdx = idx("--sandbox");
  const ratelimitIdx = idx("--ratelimit");
  const budgetIdx = idx("--budget");
  // only filter known flags, not prompt words like "-123"
  return argv
    .filter((a, i) => {
      if (BOOLEAN_FLAGS.has(a)) return false;
      if (VALUE_FLAGS.has(a)) return false;
      if (cwdIdx !== -1 && i === cwdIdx + 1) return false;
      if (resumeIdx !== -1 && i === resumeIdx + 1) return false;
      if (modelIdx !== -1 && i === modelIdx + 1) return false;
      if (sessionIdx !== -1 && i === sessionIdx + 1) return false;
      if (maxStepsIdx !== -1 && i === maxStepsIdx + 1) return false;
      if (ctxWindowIdx !== -1 && i === ctxWindowIdx + 1) return false;
      if (timeoutIdx !== -1 && i === timeoutIdx + 1) return false;
      if (sandboxIdx !== -1 && i === sandboxIdx + 1) return false;
      if (ratelimitIdx !== -1 && i === ratelimitIdx + 1) return false;
      if (budgetIdx !== -1 && i === budgetIdx + 1) return false;
      if (KNOWN_FLAGS.has(a)) return false;
      if (a.startsWith("-") && KNOWN_FLAGS.has(a.split("=")[0]!)) return false;
      return true;
    })
    .join(" ");
}

export function readPrompt(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve("");
      }
    }, 500);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      if (!done) {
        done = true;
        clearTimeout(t);
        resolve(data.trim());
      }
    });
    // if stdin already ended
    if (process.stdin.readableEnded) {
      clearTimeout(t);
      resolve("");
    }
  });
}
