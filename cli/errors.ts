// Friendly error mapping — struktur formal (ProviderErrorCategory) di depan,
// regex hanya fallback untuk string mentah (AgentError non-provider dsb).

export interface FriendlyError {
  message: string
  fix?: string
}

// Mapping kategori formal → pesan user-friendly. Sisa detail teknis tidak
// ditampilkan — trace punya data mentahnya.
export function friendlyFromCategory(category: string, detail: string): FriendlyError {
  const truth = detail.trim()
  switch (category) {
    case "rate_limit":
      return {
        message: "Rate limited by the provider",
        fix: "Wait a moment and retry, or use --ratelimit to throttle.",
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
          message: "The API key has no remaining balance or quota",
          fix: "Use /model to switch to a working provider, or top up your credits.",
        }
      }
      return {
        message: "Authentication rejected by the provider",
        fix: "Check your API key or use /model to switch providers.",
      }
    }
    case "server":
      return {
        message: "The provider had a temporary server error",
        fix: "Wait a moment and retry, or switch provider with /model.",
      }
    case "network":
      return {
        message: "Network error reaching the provider",
        fix: "Check your connection and retry.",
      }
    case "invalid_request":
      return {
        message: "The request was rejected (bad model name or parameters)",
        fix: "Use /models to see exact model names, or /model to switch.",
      }
    case "context_length_exceeded":
      return {
        message: "Context window exceeded",
        fix: "Start a new session (/exit then minicode) or use a model with a bigger context.",
      }
    default: {
      // unknown & fallback — ambil field message dari JSON body jika ada
      const jsonMsg = truth.match(/"message"\s*:\s*"([^"]+)"/)
      if (jsonMsg) return { message: jsonMsg[1]!.slice(0, 140) }
      const cut = truth.length > 160 ? truth.slice(0, 157) + "…" : truth
      return { message: cut }
    }
  }
}

// Fallback string-only (AgentError: timeout/aborted/max_steps, dst.)
export function friendlyError(raw: string): FriendlyError {
  const lower = raw.toLowerCase()
  if (lower.includes("timed out") || lower.includes("timeout"))
    return {
      message: "The run hit the time limit",
      fix: "Increase --timeout or use a faster model.",
    }
  if (lower.includes("max steps") || lower.includes("max_steps"))
    return { message: "Tool-step limit reached", fix: "Split the task into smaller prompts." }
  if (lower.includes("budget"))
    return { message: "Session budget exceeded", fix: "Start a new session or raise --budget." }
  if (lower.includes("busy"))
    return { message: "Another run is in progress", fix: "Wait for the current run to finish." }
  if (lower.includes("aborted")) return { message: "Run was aborted" }
  const jsonMsg = raw.match(/"message"\s*:\s*"([^"]+)"/)
  if (jsonMsg) return { message: jsonMsg[1]!.slice(0, 140) }
  const cut = raw.length > 160 ? raw.slice(0, 157) + "…" : raw
  return { message: cut }
}
