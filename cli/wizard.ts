import { createInterface } from "node:readline";
import { c, glyphs, box } from "../src/tui/theme.ts";
import { askSecret } from "./input.ts";
import { detectAndSave } from "../src/config.ts";
import { formatError } from "../src/tui/renderer.ts";

export const PRESETS = [
  { name: "OpenRouter (Recommended)", url: "https://openrouter.ai/api/v1", hint: "Access to Claude, DeepSeek, GPT-4, Llama" },
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

  process.stdout.write(`\n${c.cyan(box.topLeft + box.horizontal.repeat(4))} ${c.bold(glyphs.sparkle + " Minicode Setup Wizard")} ${c.cyan(box.horizontal.repeat(35))}\n`);
  process.stdout.write(`${c.cyan(box.vertical)} Welcome to Minicode! Let's connect your first AI provider.\n`);
  process.stdout.write(`${c.cyan(box.vertical)}\n`);
  process.stdout.write(`${c.cyan(box.vertical)} ${c.bold("Select a provider preset:")}\n`);

  PRESETS.forEach((p, idx) => {
    process.stdout.write(`${c.cyan(box.vertical)}   ${c.bold(String(idx + 1) + ".")} ${c.cyan(p.name)} ${c.dim(`(${p.hint})`)}\n`);
  });

  process.stdout.write(`${c.cyan(box.vertical)}\n`);
  const choice = await ask(`${c.cyan(box.vertical)} Choice [1-${PRESETS.length}, default 1]: `);
  const choiceNum = parseInt(choice, 10);
  const selected = (choiceNum >= 1 && choiceNum <= PRESETS.length) ? PRESETS[choiceNum - 1]! : PRESETS[0]!;

  let targetUrl = selected.url;
  if (!targetUrl) {
    targetUrl = await ask(`${c.cyan(box.vertical)} Base URL: `);
  } else {
    const custom = await ask(`${c.cyan(box.vertical)} Base URL [${targetUrl}]: `);
    if (custom) targetUrl = custom;
  }

  rl.close();

  let apiKey = "";
  if (selected.name.includes("Ollama")) {
    apiKey = "ollama";
  } else {
    apiKey = await askSecret(`${c.cyan(box.vertical)} API Key (masked): `);
  }

  if (!apiKey) {
    process.stdout.write(`${c.cyan(box.vertical)} ${c.yellow("Setup canceled. You can set OPENAI_API_KEY later.")}\n`);
    process.stdout.write(`${c.cyan(box.bottomLeft + box.horizontal.repeat(60))}\n\n`);
    return false;
  }

  try {
    process.stdout.write(`${c.cyan(box.vertical)} ${c.dim("Verifying connection and detecting models...")}\n`);
    // Anthropic tidak punya GET /models → pakai fallback model default bila deteksi gagal
    const fallbackModels = targetUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"];
    const entry = await detectAndSave(targetUrl, apiKey, undefined, { fallbackModels });
    process.stdout.write(`${c.cyan(box.vertical)} ${c.green(glyphs.check)} Saved provider "${c.bold(entry.id)}" (${entry.models.length} models detected)\n`);
    process.stdout.write(`${c.cyan(box.bottomLeft + box.horizontal.repeat(60))}\n`);
    process.stdout.write(`${c.green(c.bold("Setup complete!"))} ${c.dim("You can start prompting immediately.")}\n\n`);
    return true;
  } catch (e) {
    process.stdout.write(`${c.cyan(box.vertical)} ${c.red(glyphs.cross)} Model detection failed: ${formatError(e)}\n`);
    process.stdout.write(`${c.cyan(box.bottomLeft + box.horizontal.repeat(60))}\n\n`);
    return false;
  }
}
