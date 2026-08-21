import { createSession } from "../../minicore/src/core/index.ts";
import { createOpenAICompatProvider } from "../../minicore/src/providers/openai-compat.ts";
import { readFileTool } from "./tools/read_file.ts";
import { bashTool } from "./tools/bash.ts";

const baseUrl = process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1";
const apiKey = process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY;
const model = process.env.AGENT_MODEL ?? "gpt-4o-mini";

const provider = createOpenAICompatProvider({ baseUrl, apiKey, models: [model], defaultModel: model });
const session = createSession({
  provider,
  permissions: { check: async () => "allow" },
  tools: [readFileTool, bashTool],
  system: "You are Minicode, a coding agent built on MiniCore. Use tools to read/edit/run code.",
});

const prompt = process.argv.slice(2).join(" ") || "hello";
session.events.on("provider:text", (e) => process.stdout.write(e.text));
const result = await session.run(prompt);
process.stderr.write(`\n[done] steps=${result.usage.steps} turns=${result.usage.turns}\n`);
