import { LIMITS } from "../constants.ts"

export interface DetectedModel {
  id: string
}

export interface DetectResult {
  models: string[]
  providerHint: "openai" | "anthropic" | "unknown"
}

// Cache in-memory per baseUrl (30 menit) — /sync yang sering dipanggil tidak
// perlu re-deteksi network tiap kali. Key = url tanpa apiKey (secrets tidak
// pernah disimpan atau di-log).
const cache = new Map<string, { at: number; result: DetectResult }>()
const CACHE_TTL_MS = 30 * 60 * 1000

export function clearDetectCache(): void {
  cache.clear()
}

export function cacheKey(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").toLowerCase()
}

function hybridHeaders(apiKey: string): Record<string, string>[] {
  if (!apiKey) return [{}]
  // hybrid: coba Bearer dan x-api-key
  return [
    { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey },
    { Authorization: `Bearer ${apiKey}` },
    { "x-api-key": apiKey },
  ]
}

async function tryFetchModels(
  baseUrl: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<string[] | null> {
  const urls = [`${baseUrl.replace(/\/+$/, "")}/models`, `${baseUrl.replace(/\/+$/, "")}/v1/models`]
  for (const url of urls) {
    // timeout PER-ATTEMPT: satu fetch yang menggantung tidak memakan seluruh
    // budget sinyal luar — kombinasi via AbortSignal.any.
    const perAttempt = AbortSignal.timeout(LIMITS.DETECT_ATTEMPT_TIMEOUT_MS)
    const attemptSignal = signal ? AbortSignal.any([signal, perAttempt]) : perAttempt
    try {
      const res = await fetch(url, { headers, signal: attemptSignal })
      if (!res.ok) continue
      const json = (await res.json()) as { data?: { id: string }[]; models?: { id: string }[] }
      const data = json.data ?? json.models ?? []
      if (Array.isArray(data) && data.length) return data.map((m) => m.id).filter(Boolean)
      // anthropic format: {data: [{id, display_name}]}
      if (Array.isArray((json as unknown as { models: unknown }).models)) {
        return (json as unknown as { models: { id: string }[] }).models.map((m) => m.id)
      }
    } catch {}
  }
  return null
}

export async function detectModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<DetectResult> {
  // serve dari cache bila masih segar (anti request redundant dalam 30 menit)
  const key = cacheKey(baseUrl)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result

  // CAP global — jangan pernah biarkan user menunggu lama pada gateway offline
  const sig = signal ?? AbortSignal.timeout(LIMITS.DETECT_GLOBAL_TIMEOUT_MS)
  for (const h of hybridHeaders(apiKey)) {
    if (sig.aborted) break
    const models = await tryFetchModels(baseUrl, h, sig)
    if (models?.length) {
      // Prioritas: baseUrl (anthropic.com → anthropic) → nama model (claude/gpt)
      // Gateway seperti b.ai, OpenRouter: baseUrl TIDAK anthropic → openai-compat
      const hint = baseUrl.includes("anthropic") ? "anthropic" : "openai"
      const result = { models, providerHint: hint as DetectResult["providerHint"] }
      cache.set(key, { at: Date.now(), result })
      return result
    }
  }
  return { models: [], providerHint: "unknown" }
}
