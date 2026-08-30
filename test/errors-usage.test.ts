import { expect, test } from "bun:test"
import { createEventBus } from "#minicore/core/events.ts"
import { extractProviderDetail, friendlyError, friendlyFromCategory } from "../cli/errors.ts"
import { costFor, createUsageCollector } from "../src/policy/usage.ts"

test("friendlyFromCategory: auth + balance", () => {
  const f = friendlyFromCategory(
    "auth",
    'credits: {"message":"Insufficient balance. Manage billing here: https://opencode.ai/workspace/wrk_123/billing"}',
  )
  expect(f.message).toContain("Saldo atau kuota")
  expect(f.fix).toContain("/model")
})

test("friendlyFromCategory: auth tanpa saldo → pesan auth generik", () => {
  const f = friendlyFromCategory("auth", "auth failed (401): invalid api key")
  expect(f.message).toContain("menolak autentikasi")
})

test("friendlyFromCategory: rate_limit / server / network", () => {
  expect(friendlyFromCategory("rate_limit", "429").message).toContain("membatasi laju")
  expect(friendlyFromCategory("server", "500").message).toContain("gangguan sementara")
  expect(friendlyFromCategory("network", "socket hang up").message).toContain(
    "Gagal menghubungi provider",
  )
})

test("friendlyFromCategory: invalid_request & context_length", () => {
  expect(friendlyFromCategory("invalid_request", "400 model not found").message).toContain(
    "ditolak provider",
  )
  expect(friendlyFromCategory("context_length_exceeded", "").message).toContain("konteks")
})

test("friendlyFromCategory: unknown mengambil field message dari JSON", () => {
  const f = friendlyFromCategory("unknown", '{"error":{"message":"Some technical detail"}}')
  expect(f.message).toBe("Some technical detail")
  const cut = friendlyFromCategory("unknown", "x".repeat(200))
  expect(cut.message.length).toBeLessThanOrEqual(161)
})

test("friendlyError: string bergaya AgentError", () => {
  expect(friendlyError("timeout: run exceeded 600000ms").message).toContain("batas waktu")
  expect(friendlyError("max_steps_exceeded: 50 steps").message).toContain("langkah tool")
  expect(friendlyError("budget exceeded").message.toLowerCase()).toContain("biaya")
})

// ── Regresi dari uji live OpenRouter ────────────────────────────────────────
// Satu error 429 mencetak 400+ karakter berisi metadata, provider_error_code,
// limit_source, dan URL dokumentasi — di dalam frame TUI selebar 100 kolom.
// Body OpenRouter juga menyembunyikan alasan sebenarnya di metadata.raw,
// sementara field `message` hanya berbunyi "Provider returned error".

const OR_429 =
  'rate limited (429): {"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"z-ai/glm-5.2:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations","provider_name":"Decart","is_byok":false,"provider_error_code":"upstream_429","limit_source":"upstream_provider_shared_pool","remedy_hint":"Retry shortly, add your own provider key, or route to another provider."}}}'

const OR_403 =
  'auth failed (403): {"error":{"message":"thinkingmachines/inkling:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps","code":403}}'

const OR_404_NO_TOOLS =
  '404: {"error":{"message":"No endpoints found that support tool use. Try disabling \\"read_file\\". To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection","code":404}}'

const CF_502 =
  "<!DOCTYPE html><html><head><title>gorouter.app | 502: Bad gateway</title></head><body>Cloudflare</body></html>"

test("extractProviderDetail: metadata.raw dipilih di atas message generik", () => {
  const { detail, hint } = extractProviderDetail(OR_429)
  expect(detail).toContain("rate-limited upstream")
  expect(detail).not.toContain("Provider returned error")
  expect(hint).toContain("Retry shortly")
})

test("extractProviderDetail: ambil message biasa bila tidak ada metadata", () => {
  const { detail } = extractProviderDetail(OR_403)
  expect(detail).toContain("only available on agentic harnesses")
})

test("extractProviderDetail: judul HTML untuk error Cloudflare", () => {
  const { detail } = extractProviderDetail(CF_502)
  expect(detail).toBe("gorouter.app | 502: Bad gateway")
})

test("extractProviderDetail: body JSON terpotong tetap menghasilkan detail", () => {
  const truncated =
    'rate limited (429): {"error":{"message":"Provider returned error","metadata":{"raw":"model X limit tercapai'
  const { detail } = extractProviderDetail(truncated)
  expect(detail).toContain("limit tercapai")
})

test("extractProviderDetail: teks tanpa JSON/HTML tidak melempar", () => {
  expect(extractProviderDetail("socket hang up")).toEqual({})
  expect(extractProviderDetail("")).toEqual({})
})

test("429 OpenRouter: pesan ringkas, tidak menumpahkan metadata", () => {
  const f = friendlyFromCategory("rate_limit", OR_429)
  expect(f.message).toContain("rate-limited upstream")
  expect(f.message).not.toContain("metadata")
  expect(f.message).not.toContain("provider_error_code")
  expect(f.message).not.toContain("limit_source")
  // Cukup pendek untuk satu baris terminal, bukan 400 karakter.
  expect(f.message.length).toBeLessThanOrEqual(200)
  expect(f.fix).toContain("Retry shortly") // remedy_hint provider dipakai
})

test("403 OpenRouter: alasan sebenarnya tampil, bukan 'auth ditolak' saja", () => {
  const f = friendlyFromCategory("auth", OR_403)
  expect(f.message).toContain("agentic harnesses")
  expect(f.message.length).toBeLessThanOrEqual(220)
})

test("404 no-tool-support: menyebut tool, bukan JSON mentah", () => {
  const f = friendlyFromCategory("invalid_request", OR_404_NO_TOOLS)
  expect(f.message.toLowerCase()).toContain("tool")
  expect(f.message).not.toContain('\\"')
  expect(f.message).not.toContain("openrouter.ai/docs")
})

test("502 HTML Cloudflare: tidak ada tag HTML yang lolos ke pesan", () => {
  const f = friendlyFromCategory("server", CF_502)
  expect(f.message).not.toContain("<")
  expect(f.message).toContain("502")
})

test("semua kategori selalu memberi saran tindakan", () => {
  for (const cat of [
    "rate_limit",
    "auth",
    "server",
    "network",
    "invalid_request",
    "context_length_exceeded",
    "content_filter",
  ]) {
    const f = friendlyFromCategory(cat, "{}")
    expect(f.fix, cat).toBeTruthy()
  }
})

test("detail yang sama dengan pesan dasar tidak diulang dua kali", () => {
  const f = friendlyFromCategory(
    "rate_limit",
    '{"error":{"message":"Provider membatasi laju permintaan"}}',
  )
  const occurrences = f.message.split("membatasi laju").length - 1
  expect(occurrences).toBe(1)
})

// ── usage collector: effective model dari fallback ──
test("usage: effective-model event changes cost basis", () => {
  const bus = createEventBus()
  const collector = createUsageCollector(bus, "gpt-4o")

  // simulate substitution (router fallback): gpt-4o dipakai, tapi provider
  // hanya punya deepseek-chat → router memilih effective deepseek-chat
  bus.emit({
    type: "provider:extension",
    kind: "effective-model",
    data: { requested: "gpt-4o", effective: "deepseek-chat", provider: "fallback-x" },
  })
  bus.emit({
    type: "provider:extension",
    kind: "usage",
    data: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 },
  })

  const used = collector.modelUsed()
  expect(used.effective).toBe("deepseek-chat")
  expect(used.provider).toBe("fallback-x")

  const u = collector.get("gpt-4o")
  // deepseek-chat: input 0.14/m, output 0.28/m → 0.14 + 0.28 = 0.42
  expect(u.cost).toBeCloseTo(0.42, 3)
})

test("usage: reset clears effective model", () => {
  const bus = createEventBus()
  const collector = createUsageCollector(bus, "gpt-4o")
  bus.emit({
    type: "provider:extension",
    kind: "effective-model",
    data: { requested: "x", effective: "y", provider: "z" },
  })
  collector.reset()
  expect(collector.modelUsed().effective).toBeUndefined()
})

// ── C18: pricing boundary matching ──────────────────────────────────────────

test("pricing: exact and versioned model names match", () => {
  // exact — gpt-4o $2,50/M input. Tabel lama menulis $5,00 (harga peluncuran
  // Mei 2024, sudah dipotong separuh Agustus 2024), jadi estimasi biaya
  // selama ini 2× terlalu tinggi untuk model ini. Dikoreksi di Fase 4.3.
  expect(costFor("gpt-4o", 1_000_000, 0, 0, 0, false)).toBeCloseTo(2.5, 6)
  // sufiks versi (pemisah -)
  expect(costFor("gpt-4o-2024-11-20", 1_000_000, 0, 0, 0, false)).toBeCloseTo(2.5, 6)
  // prefix provider openrouter
  expect(costFor("deepseek/deepseek-chat", 1_000_000, 0, 0, 0, false)).toBeCloseTo(0.14, 6)
  // varian :free benar-benar gratis, bukan mewarisi harga varian berbayar
  expect(costFor("deepseek/deepseek-chat:free", 1_000_000, 0, 0, 0, false)).toBe(0)
  // longest-key menang: claude-sonnet-4-5, bukan claude-sonnet-4
  expect(costFor("claude-sonnet-4-5", 1_000_000, 0, 0, 0, false)).toBeCloseTo(3, 6)
})
