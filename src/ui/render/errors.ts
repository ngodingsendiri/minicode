// Pemetaan error provider/agent → pesan yang bisa ditindaklanjuti.
//
// PENTING: modul ini punya 10 test tapi dulu TIDAK dipanggil dari mana pun di
// kode produksi. Renderer memakai formatProviderError() yang mencetak
// `[kategori] <pesan mentah>`, sehingga body JSON provider tumpah utuh ke layar.
// Terlihat pada uji live OpenRouter: satu error 429 mencetak 400+ karakter
// berisi `metadata`, `provider_error_code`, `limit_source`, dan URL dokumentasi
// — di dalam frame TUI selebar 100 kolom.

export interface FriendlyError {
  message: string
  fix?: string
}

/**
 * Ambil kalimat paling berguna dari body error provider.
 *
 * Bentuk yang ditemui di lapangan:
 * - OpenAI/umum : {"error":{"message":"..."}}
 * - OpenRouter  : {"error":{"message":"Provider returned error","metadata":{"raw":"<alasan sebenarnya>","remedy_hint":"..."}}}
 *   Di sini `message` justru tidak informatif; `metadata.raw` yang menjelaskan.
 * - Cloudflare  : HTML dengan <title>host | 502: Bad gateway</title>
 */
export function extractProviderDetail(raw: string): { detail?: string; hint?: string } {
  const trimmed = raw.trim()
  // JSON: cari objek pertama yang bisa di-parse.
  const start = trimmed.indexOf("{")
  if (start !== -1) {
    try {
      const parsed = JSON.parse(trimmed.slice(start)) as {
        error?: {
          message?: string
          metadata?: { raw?: string; remedy_hint?: string; provider_name?: string }
        }
      }
      const err = parsed.error
      const meta = err?.metadata
      // metadata.raw lebih spesifik daripada message generik OpenRouter.
      const detail = firstSentence(meta?.raw ?? err?.message)
      const hint = firstSentence(meta?.remedy_hint)
      return { ...(detail ? { detail } : {}), ...(hint ? { hint } : {}) }
    } catch {
      // Body terpotong (streaming) — jatuh ke regex di bawah.
    }
  }
  // HTML: judul halaman error biasanya sudah menjelaskan.
  const title = /<title>([^<]{1,120})<\/title>/i.exec(trimmed)
  if (title) return { detail: title[1]!.trim() }
  // Regex terakhir untuk body yang TERPOTONG (stream terputus di tengah JSON).
  // `raw` didahulukan: pada OpenRouter itu yang memuat alasan sebenarnya,
  // sementara `message` hanya "Provider returned error". Kutip penutup dibuat
  // opsional — pada body terpotong ia memang belum ada.
  for (const field of ["raw", "message"]) {
    const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){1,300})"?`)
    const m = re.exec(trimmed)
    const value = m?.[1]?.replace(/\\"/g, '"').trim()
    if (value) return { detail: firstSentence(value) }
  }
  return {}
}

/** Satu kalimat pertama, dipangkas — bukan paragraf berisi URL dan kode. */
function firstSentence(s?: string, max = 150): string | undefined {
  if (!s) return undefined
  const clean = s.replace(/\s+/g, " ").trim()
  if (!clean) return undefined
  const cut = /^(.{20,}?[.!?])\s/.exec(clean)
  const one = cut ? cut[1]! : clean
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

// Mapping kategori formal -> pesan user-friendly. Detail provider disertakan
// sebagai satu kalimat bila ada (itu yang memberi tahu model mana yang limit,
// atau tool mana yang tidak didukung) — bukan seluruh body.
export function friendlyFromCategory(category: string, detail: string): FriendlyError {
  const truth = detail.trim()
  const { detail: providerDetail, hint } = extractProviderDetail(truth)
  const withDetail = (base: string) =>
    providerDetail && providerDetail.toLowerCase() !== base.toLowerCase()
      ? `${base}: ${providerDetail}`
      : base

  switch (category) {
    case "rate_limit":
      return {
        message: withDetail("Provider is rate-limiting requests"),
        fix: hint ?? "Wait a moment and try again, or use --ratelimit to throttle requests.",
      }
    case "auth": {
      const low = truth.toLowerCase()
      if (
        low.includes("insufficient balance") ||
        low.includes("credits") ||
        low.includes("billing") ||
        low.includes("quota") ||
        low.includes("credit limit")
      ) {
        return {
          message: withDetail("API key balance or quota is exhausted"),
          fix: hint ?? "Switch provider via /model, or top up credits.",
        }
      }
      return {
        message: withDetail("Provider rejected authentication"),
        fix: hint ?? "Check your API key, or switch provider via /model.",
      }
    }
    case "server":
      return {
        message: withDetail("Provider is temporarily unavailable"),
        fix: hint ?? "Wait a moment and try again, or switch provider via /model.",
      }
    case "network":
      return {
        message: withDetail("Failed to reach provider"),
        fix: hint ?? "Check your connection and try again.",
      }
    case "invalid_request":
      return {
        message: withDetail("Request was rejected by provider"),
        fix: hint ?? "Check the model name or select another model with /model.",
      }
    case "context_length_exceeded":
      return {
        message: withDetail("Context window exceeded"),
        fix:
          hint ?? "Start a new session (/exit then minicode), or use a model with a larger context window.",
      }
    case "content_filter":
      return {
        message: withDetail("Request was blocked by provider content filter"),
        fix: hint ?? "Rewrite the prompt, or switch provider via /model.",
      }
    default: {
      if (providerDetail) return { message: providerDetail, ...(hint ? { fix: hint } : {}) }
      const cut = truth.length > 160 ? `${truth.slice(0, 157)}…` : truth
      return { message: cut }
    }
  }
}

// Fallback string-only (AgentError: timeout/aborted/max_steps, dst.)
export function friendlyError(raw: string): FriendlyError {
  const lower = raw.toLowerCase()
  if (lower.includes("timed out") || lower.includes("timeout"))
    return {
      message: "Run exceeded timeout",
      fix: "Increase --timeout or use a faster model.",
    }
  if (lower.includes("max steps") || lower.includes("max_steps"))
    return {
      message: "Tool step limit reached",
      fix: "Split the task into smaller prompts.",
    }
  if (lower.includes("budget"))
    return { message: "Session budget exceeded", fix: "Start a new session or increase --budget." }
  if (lower.includes("busy"))
    return { message: "A run is still in progress", fix: "Wait for the current run to finish." }
  if (lower.includes("aborted")) return { message: "Run was aborted" }
  const { detail } = extractProviderDetail(raw)
  if (detail) return { message: detail }
  const cut = raw.length > 160 ? `${raw.slice(0, 157)}…` : raw
  return { message: cut }
}

/** Satu baris siap tampil: pesan + saran. Dipakai renderer TUI & one-shot. */
export function formatFriendly(e: FriendlyError): string {
  return e.fix ? `${e.message}\n  → ${e.fix}` : e.message
}
