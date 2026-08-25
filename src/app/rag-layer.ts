import type { MinicodeConfig } from "../config.ts"
import { searchHybrid } from "../memory/vector.ts"
import { loadSkills, type Skill, skillsToSystemPrompt } from "../skills/loader.ts"

export async function createRagLayer(opts: {
  cfg: MinicodeConfig
  prompt: string
  cwd?: string
}): Promise<{ systemExtra?: string; skills: Skill[] }> {
  let systemExtra: string | undefined
  try {
    const candidates: { baseUrl: string; apiKey: string }[] = []
    for (const p of opts.cfg.providers)
      if (p.apiKey) candidates.push({ baseUrl: p.baseUrl, apiKey: p.apiKey })
    if (process.env.AGENT_BASE_URL || process.env.OPENAI_API_KEY) {
      candidates.push({
        baseUrl: process.env.AGENT_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY ?? process.env.AGENT_API_KEY ?? "",
      })
    }
    if (candidates.length === 0 && (opts.cfg.providers[0]?.apiKey || process.env.OPENAI_API_KEY)) {
      candidates.push({
        baseUrl: opts.cfg.providers[0]?.baseUrl ?? "https://api.openai.com/v1",
        apiKey: opts.cfg.providers[0]?.apiKey ?? process.env.OPENAI_API_KEY ?? "",
      })
    }
    let hits: { text: string; score: number }[] = []
    for (const c of candidates) {
      if (!c.apiKey) continue
      try {
        hits = await searchHybrid(opts.prompt, {
          baseUrl: c.baseUrl,
          apiKey: c.apiKey,
          cwd: opts.cwd,
          topK: 5,
        })
        if (hits.length) break
      } catch {}
    }
    if (hits.length)
      systemExtra = `\n# Relevant memory (hybrid vector+keyword)\n${hits.map((h) => `- ${h.text.slice(0, 300)} (score ${h.score.toFixed(2)})`).join("\n")}`
    if (!hits.length && candidates.length === 0) {
      try {
        hits = await searchHybrid(opts.prompt, { cwd: opts.cwd, topK: 5 })
        if (hits.length)
          systemExtra = `\n# Relevant memory (keyword)\n${hits.map((h) => `- ${h.text.slice(0, 300)} (score ${h.score.toFixed(2)})`).join("\n")}`
      } catch {}
    }
  } catch {}

  const skills = await loadSkills(opts.cwd)
  try {
    const skillPrompt = skillsToSystemPrompt(skills)
    if (skillPrompt) systemExtra = (systemExtra ?? "") + skillPrompt
  } catch {}

  return { systemExtra, skills }
}
