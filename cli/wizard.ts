import { createInterface } from "node:readline";
import { c, glyphs } from "../src/tui/theme.ts";
import { askSecret } from "./input.ts";
import { detectAndSave } from "../src/config.ts";
import { formatError } from "../src/tui/renderer.ts";

export const PRESETS = [
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1", hint: "Claude, GPT, DeepSeek, Llama" },
  { name: "OpenAI Direct", url: "https://api.openai.com/v1", hint: "Official OpenAI endpoints" },
  { name: "DeepSeek Direct", url: "https://api.deepseek.com/v1", hint: "DeepSeek V3 and R1" },
  { name: "Anthropic Direct", url: "https://api.anthropic.com/v1", hint: "Direct Anthropic Claude endpoints" },
  { name: "Ollama (Local)", url: "http://localhost:11434/v1", hint: "Run offline local models" },
  { name: "Custom URL", url: "", hint: "Any OpenAI-compatible endpoint" },
];

export async function runSetupWizard(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, (a) => res(a.trim())));

  process.stdout.write(`\n${c.bold("Minicode Setup")}\n`);
  process.stdout.write(`${c.muted("Connect your first AI provider.")}\n\n`);

  PRESETS.forEach((p, idx) => {
    process.stdout.write(`  ${c.bold(String(idx + 1) + ".")} ${p.name} ${c.dim(p.hint)}\n`);
  });
  process.stdout.write("\n");

  const choice = await ask(`${c.info("Choice")} [1-${PRESETS.length}, default 1]: `);
  const choiceNum = parseInt(choice, 10);
  const selected = (choiceNum >= 1 && choiceNum <= PRESETS.length) ? PRESETS[choiceNum - 1]! : PRESETS[0]!;

  let targetUrl = selected.url;
  if (!targetUrl) {
    targetUrl = await ask(`${c.info("Base URL")}: `);
  } else {
    const custom = await ask(`${c.info("Base URL")} [${targetUrl}]: `);
    if (custom) targetUrl = custom;
  }

  rl.close();

  let apiKey = "";
  if (selected.name.includes("Ollama")) {
    apiKey = "ollama";
  } else {
    apiKey = await askSecret(`${c.info("API Key")} (masked): `);
  }

  if (!apiKey) {
    process.stdout.write(`${c.warning("Setup canceled. Set OPENAI_API_KEY later.")}\n`);
    return false;
  }

  try {
    process.stdout.write(`${c.muted("Detecting models...")}\n`);
    const fallbackModels = targetUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"];
    const entry = await detectAndSave(targetUrl, apiKey, undefined, { fallbackModels });
    process.stdout.write(`${c.success(glyphs.check)} Provider "${entry.id}" saved — ${entry.models.length} models detected\n`);
    process.stdout.write(`${c.success("Setup complete.")}\n\n`);
    return true;
  } catch (e) {
    process.stdout.write(`${c.error(glyphs.cross)} Detection failed: ${formatError(e)}\n\n`);
    return false;
  }
}
