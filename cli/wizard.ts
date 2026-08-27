import { createInterface } from "node:readline"
import { detectAndSave } from "../src/config.ts"
import { GATEWAY_PRESETS } from "../src/providers/presets.ts"
import { formatError } from "../src/tui/minimal/simple.ts"
import { askSecret } from "./input.ts"

export async function runSetupWizard(): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, (a) => res(a.trim())))

  const fakeKey = "ollama"

  process.stdout.write("\nMinicode Setup\n")
  process.stdout.write("Connect your first AI provider.\n\n")

  const options = [
    ...GATEWAY_PRESETS.map((p) => ({ name: p.label, url: p.baseUrl, hint: "" })),
    { name: "Custom URL", url: "", hint: "Any OpenAI-compatible endpoint" },
  ]
  options.forEach((p, idx) => {
    process.stdout.write(`  ${idx + 1}. ${p.name}${p.hint ? ` (${p.hint})` : ""}\n`)
  })
  process.stdout.write("\n")

  const choice = await ask(`Choice [1-${options.length}, default 1]: `)
  const choiceNum = parseInt(choice, 10)
  const selected =
    choiceNum >= 1 && choiceNum <= options.length ? options[choiceNum - 1]! : options[0]!

  let targetUrl = selected.url
  if (!targetUrl) {
    targetUrl = await ask("Base URL: ")
  } else {
    const custom = await ask(`Base URL [${targetUrl}]: `)
    if (custom) targetUrl = custom
  }
  if (!targetUrl) {
    process.stdout.write("Setup canceled.\n")
    return false
  }

  rl.close()

  let apiKey = ""
  if (/^(https?:\/\/)(localhost|127\.0\.0\.1)(:|\/|$)/.test(targetUrl)) {
    apiKey = fakeKey
  } else {
    apiKey = await askSecret("API Key (masked): ")
  }

  if (!apiKey) {
    process.stdout.write("Setup canceled. Set OPENAI_API_KEY later.\n")
    return false
  }

  try {
    process.stdout.write("Detecting models...\n")
    const preset = GATEWAY_PRESETS.find(
      (p) => p.baseUrl.replace(/\/+$/, "") === targetUrl.replace(/\/+$/, ""),
    )
    const fallbackModels =
      preset?.fallbackModels ??
      (targetUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"])
    const entry = await detectAndSave(targetUrl, apiKey, undefined, { fallbackModels })
    process.stdout.write(
      `[OK] Provider "${entry.id}" saved - ${entry.models.length} models detected\n`,
    )
    process.stdout.write("Setup complete.\n\n")
    return true
  } catch (e) {
    process.stdout.write(`[FAIL] Detection failed: ${formatError(e)}\n\n`)
    return false
  }
}
