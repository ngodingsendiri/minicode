// Controller wizard setup — pegang data preset & penyimpanan config;
// tampilannya di src/ui/screens/wizard.ts.
import { GATEWAY_PRESETS } from "../src/providers/presets.ts"
import { detectAndSave } from "../src/providers/provision.ts"
import { runSetupWizardView } from "../src/ui/screens/wizard.ts"

export async function runSetupWizard(): Promise<boolean> {
  return runSetupWizardView({
    presets: GATEWAY_PRESETS.map((p) => ({ label: p.label, baseUrl: p.baseUrl })),
    onSubmit: async (baseUrl, apiKey) => {
      const preset = GATEWAY_PRESETS.find(
        (p) => p.baseUrl.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, ""),
      )
      const fallbackModels =
        preset?.fallbackModels ??
        (baseUrl.includes("anthropic") ? ["claude-sonnet-4"] : ["gpt-4o-mini"])
      const entry = await detectAndSave(baseUrl, apiKey, undefined, { fallbackModels })
      return `Provider "${entry.id}" saved — ${entry.models.length} models`
    },
  })
}
