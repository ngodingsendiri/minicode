// Gateway presets — satu sumber kebenaran untuk baseUrl umum.
// Dipakai /provider-add (REPL) & wizard setup (cli/wizard.ts).

export interface GatewayPreset {
  id: string
  label: string
  baseUrl: string
  fallbackModels: string[]
  hint?: string
  // beberapa gateway butuh header tambahan (x-api-key vs Bearer) —
  // deteksi hybrid sudah coba keduanya, preset cukup id+baseUrl.
}

export const GATEWAY_PRESETS: GatewayPreset[] = [
  {
    id: "openai",
    label: "OpenAI (gpt, o-series)",
    baseUrl: "https://api.openai.com/v1",
    fallbackModels: ["gpt-4o-mini"],
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    fallbackModels: ["claude-sonnet-4"],
  },
  {
    id: "openrouter",
    label: "OpenRouter (multi-model gateway)",
    baseUrl: "https://openrouter.ai/api/v1",
    fallbackModels: ["meta-llama/llama-3.1-8b-instruct:free"],
  },
  {
    id: "deepseek",
    label: "DeepSeek (deepseek-chat/reasoner)",
    baseUrl: "https://api.deepseek.com/v1",
    fallbackModels: ["deepseek-chat"],
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen (opencode.ai gateway)",
    baseUrl: "https://opencode.ai/zen/v1",
    fallbackModels: ["hy3-free"],
  },
  {
    id: "google",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    fallbackModels: ["gemini-2.0-flash"],
  },
]

// id preset → opsi "custom" di ujung daftar
export const CUSTOM_PRESET_ID = "custom"

export function findPreset(id: string): GatewayPreset | undefined {
  return GATEWAY_PRESETS.find((p) => p.id === id)
}
