import { LIMITS } from "../constants.ts"

export interface DetectedModel {
  id: string
}

export interface DetectResult {
  models: string[]
  providerHint: "openai" | "anthropic" | "responses" | "unknown"
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
): Promise<{ models: string[] | null; contacted: boolean }> {
  const urls = [`${baseUrl.replace(/\/+$/, "")}/models`, `${baseUrl.replace(/\/+$/, "")}/v1/models`]
  let contacted = false
  for (const url of urls) {
    // timeout PER-ATTEMPT: satu fetch yang menggantung tidak memakan seluruh
    // budget sinyal luar — kombinasi via AbortSignal.any.
    const perAttempt = AbortSignal.timeout(LIMITS.DETECT_ATTEMPT_TIMEOUT_MS)
    const attemptSignal = signal ? AbortSignal.any([signal, perAttempt]) : perAttempt
    try {
      const res = await fetch(url, { headers, signal: attemptSignal })
      contacted = true // server menjawab (walau 404) — bukan jaringan mati
      if (!res.ok) continue
      const json = (await res.json()) as { data?: { id: string }[]; models?: { id: string }[] }
      const data = json.data ?? json.models ?? []
      if (Array.isArray(data) && data.length)
        return { models: data.map((m) => m.id).filter(Boolean), contacted }
      // anthropic format: {data: [{id, display_name}]}
      if (Array.isArray((json as unknown as { models: unknown }).models)) {
        return {
          models: (json as unknown as { models: { id: string }[] }).models.map((m) => m.id),
          contacted,
        }
      }
    } catch {}
  }
  return { models: null, contacted }
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
  let everContacted = false
  for (const h of hybridHeaders(apiKey)) {
    if (sig.aborted) break
    const { models, contacted } = await tryFetchModels(baseUrl, h, sig)
    everContacted = everContacted || contacted
    if (models?.length) {
      // P11 P1.4 — wire dari probe, bukan substring URL semata: path
      // /responses berarti endpoint Responses API (previous_response_id).
      // Substring host (anthropic) tetap dipakai hanya sebagai fallback
      // terakhir, bukan penentu utama.
      const path = baseUrl.toLowerCase()
      const hint = path.includes("/responses")
        ? "responses"
        : baseUrl.includes("anthropic")
          ? "anthropic"
          : "openai"
      const result = { models, providerHint: hint as DetectResult["providerHint"] }
      cache.set(key, { at: Date.now(), result })
      return result
    }
  }
  // Tak satu pun attempt mendapat respons HTTP = jaringan mati, bukan
  // "provider tanpa model" (Anthropic menjawab 404 tapi tetap kontak).
  // Lempar agar /sync mencatat failed, bukan diam.
  if (!everContacted) throw new Error(`unreachable: ${baseUrl}`)
  return { models: [], providerHint: "unknown" }
}
