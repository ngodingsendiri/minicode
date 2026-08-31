import type { EventBus } from "#minicore/core/index.ts"
import { findPrice, loadPricingOverlay, type ModelPrice } from "./pricing.ts"

export interface Usage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
}

// Tabel harga pindah ke src/policy/pricing.ts: bawaan (offline) + overlay
// opsional dari models.dev yang HANYA ditarik lewat `minicode pricing sync`.
// Overlay dimuat sekali per proses; sebelum termuat, tabel bawaan tetap dipakai
// sehingga cost tak pernah mendadak jadi undefined.
let overlayLoaded = false
export function primePricing(): Promise<unknown> {
  if (overlayLoaded) return Promise.resolve()
  overlayLoaded = true
  return loadPricingOverlay().catch(() => ({}))
}

// cacheIncluded=true (Anthropic): input_tokens SUDAH termasuk cache_read+cache_write,
// jadi normal input = input - cacheRead - cacheWrite (hindari double-count).
// cacheIncluded=false (provider lain): input_tokens terpisah dari cache → jangan kurangi.
// Pencocokan harga per-segmen ada di findPrice() (kunci terpanjang menang,
// menolak false-positive seperti "my-gpt-4o-wrapper").
// Diekspor untuk test.
export function costFor(
  model: string,
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
  cacheIncluded = true,
): number | undefined {
  const p: ModelPrice | undefined = findPrice(model)
  if (!p) return undefined
  const normalInput = cacheIncluded ? Math.max(0, input - cacheRead - cacheWrite) : input
  const inputCost = (normalInput / 1_000_000) * p.input
  const readCost = p.cacheRead ? (cacheRead / 1_000_000) * p.cacheRead : 0
  const writeCost = p.cacheWrite ? (cacheWrite / 1_000_000) * p.cacheWrite : 0
  const outputCost = (output / 1_000_000) * p.output
  return inputCost + readCost + writeCost + outputCost
}

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

export function createUsageCollector(bus: EventBus, model?: string) {
  // DUA akumulator, bukan satu.
  //
  // `turn` di-reset setiap kali pemanggil menyimpan hasil satu turn
  // (REPL memanggil reset() setelah persistCurrent). `session`
  // TIDAK pernah di-reset. Tanpa pemisahan ini, satu-satunya total yang ada
  // ikut terhapus setiap turn, sehingga `/cost` yang berjudul "biaya sesi"
  // selalu melaporkan 0 setelah turn pertama selesai, header REPL kembali ke
  // $0.0000, dan `--budget` tidak akan pernah terpicu berapa pun yang dipakai.
  // Terlihat pada uji live: 51.915 token nyata dilaporkan sebagai 0 token.
  let turn: Usage = emptyUsage()
  // Tidak pernah di-assign ulang: field-nya yang diakumulasi. `turn` sebaliknya
  // diganti objek baru oleh reset() supaya pemanggil yang menyimpan hasil lama
  // tidak ikut ternol.
  const session: Usage = emptyUsage()
  let cacheIncluded = true
  // Cost attribution: kalau router fallback menyubstitusi model, harga harus
  // dihitung pakai model EFEKTIF yang benar-benar dipakai.
  let effectiveModel: string | undefined
  let effectiveProvider: string | undefined
  // Model efektif terakhir yang dipakai dalam sesi — tetap dikenang setelah
  // reset() supaya biaya sesi tidak kehilangan basis harganya.
  let sessionModel: string | undefined

  bus.on("provider:extension", (e) => {
    if (e.kind === "effective-model") {
      const d = e.data as { requested?: string; effective?: string; provider?: string }
      effectiveModel = d.effective ?? effectiveModel
      effectiveProvider = d.provider ?? effectiveProvider
      sessionModel = effectiveModel ?? sessionModel
      return
    }
    if (e.kind === "usage") {
      const d = e.data as {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
        cacheReadTokens?: number
        cacheWriteTokens?: number
        cacheIncluded?: boolean
      }
      const input = d.inputTokens ?? 0
      const output = d.outputTokens ?? 0
      const cRead = d.cacheReadTokens ?? 0
      const cWrite = d.cacheWriteTokens ?? 0
      if (typeof d.cacheIncluded === "boolean") cacheIncluded = d.cacheIncluded

      for (const acc of [turn, session]) {
        acc.inputTokens += input
        acc.outputTokens += output
        acc.totalTokens = acc.inputTokens + acc.outputTokens
        acc.cacheReadTokens = (acc.cacheReadTokens ?? 0) + cRead
        acc.cacheWriteTokens = (acc.cacheWriteTokens ?? 0) + cWrite
      }
    }
  })

  const withCost = (base: Usage, priceModel?: string): Usage => {
    if (!priceModel) return { ...base }
    return {
      ...base,
      cost: costFor(
        priceModel,
        base.inputTokens,
        base.outputTokens,
        base.cacheReadTokens ?? 0,
        base.cacheWriteTokens ?? 0,
        cacheIncluded,
      ),
    }
  }

  return {
    /** Pemakaian turn saat ini (di-reset oleh reset()). */
    get: (m?: string) => withCost(turn, effectiveModel ?? m ?? model),
    /**
     * Pemakaian KUMULATIF seluruh sesi — dipakai `/cost`, header REPL, dan
     * pemeriksaan `--budget`. Tidak terpengaruh reset().
     */
    getSession: (m?: string) => withCost(session, effectiveModel ?? sessionModel ?? m ?? model),
    modelUsed: () => ({ effective: effectiveModel, provider: effectiveProvider }),
    reset: () => {
      turn = emptyUsage()
      effectiveModel = undefined
      effectiveProvider = undefined
    },
  }
}
