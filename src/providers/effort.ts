// Kemampuan thinking per KELUARGA model + fail-soft universal.
//
// Kondisi lapangan (bukan asumsi): effort low/medium/high hanya bermakna
// untuk keluarga reasoning yang terbukti; tiap keluarga beda param wire
// (OpenAI reasoning_effort string, Anthropic budget/adaptive); sisanya
// (DeepSeek, Gemini, Groq, Ollama, free-tier, custom gateway) TAK PUNYA
// konsep ini — dikirimi param = diabaikan atau 4xx/5xx. Default universal
// = omit (tanpa param): default bawaan tiap model sudah di-tune vendornya.
//
// Karena daftar 650+ model berubah tiap minggu dan provider baru tak punya
// metadata kapabilitas, kebenaran TIDAK digantungkan ke daftar: keluarga
// (stabil tahunan) mengatur APA yang dikirim, fail-soft menutup sisanya.
import { abortError, ProviderError } from "#minicore/core/errors.ts"
import type { ModelProvider } from "#minicore/core/provider.ts"

export type ThinkingFamily = "openai-reasoning" | "claude-legacy" | "claude-adaptive" | "none"

export type EffortLevel = "low" | "medium" | "high"

/**
 * Keluarga thinking dari id model. Heuristik prefix/versi, bukan daftar
 * model (daftar membusuk tiap minggu; keluarga stabil tahunan).
 */
export function thinkingFamily(modelId: string): ThinkingFamily {
  const m = modelId.toLowerCase()
  // OpenAI reasoning: o-series + gpt-5/6 (reasoning_effort).
  if (/^(o1|o3|o4|gpt-5|gpt-6)([-._]|$)/.test(m)) return "openai-reasoning"
  if (m.startsWith("claude-")) {
    // Format versi beda era: "claude-3-7-sonnet-..." vs "claude-sonnet-4-5".
    const nums = m
      .split(/[-._]/)
      .slice(1)
      .filter((p) => /^\d+$/.test(p))
      .map(Number)
    const major = nums[0]
    const minor = nums[1]
    if (major === 3) return minor === 7 ? "claude-legacy" : "none"
    if (major === 4) return minor != null && minor >= 6 ? "claude-adaptive" : "claude-legacy"
    if (major != null && major >= 5) return "claude-adaptive"
    // Nama non-numerik (mythos-preview): arah vendor = adaptive.
    if (major == null) return "claude-adaptive"
    return "none"
  }
  return "none"
}

/**
 * Level effort yang BOLEH ditawarkan/dikirim untuk model ini.
 * Truth-table ringkas riset lapangan (OpenAI): pro=hanya high; sisanya
 * low/med/high. Keluarga lain: full knob (dipetakan native di adapter).
 * "none" → [] (tak pernah dikirimi param thinking, titik).
 */
export function allowedEfforts(modelId: string): EffortLevel[] {
  const family = thinkingFamily(modelId)
  if (family === "none") return []
  if (family === "openai-reasoning" && /gpt-5-pro/.test(modelId.toLowerCase())) return ["high"]
  return ["low", "medium", "high"]
}

/** Opsi picker: selalu diawali "default" (= omit, tanpa param). */
export function effortOptionsForModel(modelId: string): ("default" | EffortLevel)[] {
  return ["default", ...allowedEfforts(modelId)]
}

// Ingatan strip per provider::model selama proses: model yang pernah
// menolak param (400 deterministik) langsung tanpa param di turn berikut.
// 500 TIDAK diingat (bisa transien). Reset saat proses restart.
const strippedModels = new Set<string>()

/** Reset ingatan strip (test saja). */
export function __resetEffortMemoryForTest(): void {
  strippedModels.clear()
}

const STRIP_TRIGGER: ReadonlySet<string> = new Set(["invalid_request", "server"])

export interface StrippedRetryOptions {
  providerId: string
  /**
   * Lewati primary untuk model ini (mis. keluarga yang pasti tak mendukung)
   * — langsung ke fallback tanpa request sia-sia.
   */
  skipPrimary?: (model: string) => boolean
  /** Kategori yang memicu ulangi-tanpa-param. Default: invalid_request+server. */
  triggerCategories?: ReadonlySet<string>
  /** Dipanggil tepat sebelum fallback (observability; default: diam). */
  onStrip?: (info: { model: string; category: string }) => void
}

/**
 * Inti fail-soft GENERIK: ulangi request sekali via fallback bila primary
 * menolak dengan kategori pemicu. Dipakai effort hari ini; param wire
 * berikutnya (verbosity, dsb.) tinggal pakai tanpa kode baru.
 * - Abort tak pernah ditelan. Kategori lain diteruskan apa adanya.
 * - 400 (invalid_request) deterministik → diingat; 500 mungkin transien.
 */
export function withStrippedRetry(
  primary: ModelProvider,
  fallback: ModelProvider,
  opts: StrippedRetryOptions,
): ModelProvider {
  const trigger = opts.triggerCategories ?? STRIP_TRIGGER
  return {
    id: primary.id,
    get models() {
      return primary.models
    },
    async *stream(request, signal) {
      if (signal.aborted) throw abortError(signal)
      const model = request.model ?? ""
      const key = `${opts.providerId}::${model}`
      if (strippedModels.has(key) || opts.skipPrimary?.(model)) {
        yield* fallback.stream(request, signal)
        return
      }
      try {
        yield* primary.stream(request, signal)
        return
      } catch (e) {
        if (signal.aborted) throw e
        if (e instanceof ProviderError && trigger.has(e.category)) {
          if (e.category === "invalid_request") strippedModels.add(key)
          try {
            opts.onStrip?.({ model: key || "model", category: e.category })
          } catch {}
          yield* fallback.stream(request, signal)
          return
        }
        throw e
      }
    },
  }
}

/**
 * Bungkus provider ber-effort dengan kembaran tanpa-effort. Dua lapis:
 * 1. `shouldSend(model)` false → langsung tanpa effort (tanpa request
 *    sia-sia; untuk keluarga yang pasti tak mendukung).
 * 2. 400/500 saat param thinking terkirim = param ditolak → ulangi sekali
 *    tanpa param. 400 deterministik diingat per provider::model; 500
 *    mungkin transien → tanpa ingatan.
 * Kategori lain (auth/network/rate_limit/budget) diteruskan apa adanya —
 * bukan penolakan param. Abort tak pernah ditelan.
 */
export function withEffortFallback(
  primary: ModelProvider,
  fallback: ModelProvider,
  opts: {
    providerId: string
    effort: string
    shouldSend?: (model: string) => boolean
  },
): ModelProvider {
  return withStrippedRetry(primary, fallback, {
    providerId: opts.providerId,
    skipPrimary: opts.shouldSend ? (model) => !opts.shouldSend!(model) : undefined,
    onStrip: ({ model }) => {
      try {
        process.stderr.write(
          `[thinking] effort ${opts.effort} unsupported by ${model} — retrying without it\n`,
        )
      } catch {}
    },
  })
}
