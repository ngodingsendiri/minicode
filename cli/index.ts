import { createDefaultRouter } from "../src/providers/router.ts";
import { createMinicodeSession } from "../src/session.ts";
import { allTools } from "../src/tools/index.ts";
import { attachRenderer, formatError } from "../src/tui/renderer.ts";

const HELP = `minicode — coding agent on frozen MiniCore
usage: bun cli/index.ts [options] [prompt]
       echo "prompt" | bun cli/index.ts

Options:
  -h, --help     show help
  --verbose      show reasoning & usage
  --cwd <dir>    workspace root (default .)

Env:
  AGENT_BASE_URL      OpenAI base URL (default https://api.openai.com/v1)
  OPENAI_API_KEY      (fallback AGENT_API_KEY)
  ANTHROPIC_API_KEY   enable Anthropic provider
  AGENT_MODEL         default model (default gpt-4o-mini)
  ANTHROPIC_MODEL     default anthropic model (default claude-sonnet-4)
`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}
const verbose = args.includes("--verbose");
const cwdIdx = args.indexOf("--cwd");
const cwd = cwdIdx !== -1 ? args[cwdIdx + 1] : undefined;
const promptArgs = args.filter((a, i) => {
  if (a === "--verbose") return false;
  if (a === "--cwd") return false;
  if (cwdIdx !== -1 && (i === cwdIdx + 1)) return false;
  if (a.startsWith("-")) return false;
  return true;
});

function readPrompt(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

const prompt = promptArgs.join(" ") || (await readPrompt());
if (!prompt) {
  process.stderr.write("usage: bun cli/index.ts <prompt>\n");
  process.exit(1);
}

const provider = createDefaultRouter({
  openaiBaseUrl: process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY,
  openaiModels: process.env.AGENT_MODEL ? [process.env.AGENT_MODEL] : undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModels: process.env.ANTHROPIC_MODEL ? [process.env.ANTHROPIC_MODEL] : undefined,
});

const session = await createMinicodeSession({
  provider,
  tools: allTools,
  cwd,
  permissionMode: "auto",
  // minicode handles P2 cap, C5 estimator, C4 fix via router
});

attachRenderer(session.events, { verbose });

try {
  await session.run(prompt);
} catch (e) {
  process.stderr.write(`\n[error] ${formatError(e)}\n`);
  process.exit(1);
}
