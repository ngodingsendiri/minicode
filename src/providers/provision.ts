// Provisioning provider: deteksi model, simpan/hapus/sinkron entri provider.
// Dipisah dari src/config.ts supaya lapisan config murni IO (baca/tulis/validasi
// berkas) dan tidak bergantung ke providers/ — arah dependensi jadi satu arah:
// providers → config.
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import {
  GLOBAL,
  LOCAL,
  loadConfig,
  type MinicodeConfig,
  normalizeConfig,
  type ProviderEntry,
  writeConfigAtomic,
} from "../config.ts"
import { clearDetectCache, detectModels } from "./detect.ts"
import { GATEWAY_PRESETS } from "./presets.ts"

export async function saveProvider(
  entry: ProviderEntry,
  opts: { global?: boolean; cwd?: string } = {},
) {
  // Provider OAuth sengaja TIDAK butuh apiKey: tokennya hidup di auth.json.
  const needsKey = entry.auth !== "oauth"
  if (!entry.id || !entry.baseUrl || (needsKey && !entry.apiKey))
    throw new Error("provider id/baseUrl/apiKey required")
  // A provider may temporarily have no models: `/model` can remove the last
  // entry before `/sync` discovers a new one.
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  let cfg: MinicodeConfig = { providers: [] }
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")))
  } catch {}
  const idx = cfg.providers.findIndex((p) => p.id === entry.id)
  if (idx >= 0) cfg.providers[idx] = entry
  else cfg.providers.push(entry)
  await writeConfigAtomic(path, cfg)
}

// 5.1 — id ramah: pakai id preset (openrouter/deepseek/generic/...) atau slug
// baseUrl; dedupe dengan indeks numerik, BUKAN hash acak.
export function deriveProviderId(baseUrl: string, existingIds: string[], id?: string): string {
  let baseId: string
  if (id) {
    baseId = id
  } else {
    const norm = baseUrl.replace(/\/+$/, "")
    const preset = GATEWAY_PRESETS.find((p) => p.baseUrl.replace(/\/+$/, "") === norm)
    baseId =
      (preset?.id ??
        norm
          .replace(/\/v1$/i, "") // OpenAI-compatible gateways: buang akhiran /v1
          .replace(/https?:\/\//, "")
          .replace(/[^a-z0-9]/gi, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 24)) ||
      "gateway"
  }
  let uniqId = baseId.slice(0, 30)
  if (!id) {
    let n = 2
    while (existingIds.includes(uniqId)) {
      uniqId = `${baseId}-${n}`.slice(0, 30)
      n++
    }
  }
  return uniqId
}

export async function detectAndSave(
  baseUrl: string,
  apiKey: string,
  id?: string,
  opts: { global?: boolean; cwd?: string; fallbackModels?: string[] } = {},
): Promise<ProviderEntry> {
  // Fallback model dipakai bila provider tidak punya endpoint GET /models
  // (mis. Anthropic) atau deteksi gagal — agar wizard tetap berhasil.
  let detected: { models: string[]; providerHint: "openai" | "anthropic" | "unknown" }
  try {
    detected = await detectModels(baseUrl, apiKey)
    if (detected.models.length === 0 && opts.fallbackModels?.length) {
      detected = { models: opts.fallbackModels, providerHint: detected.providerHint }
    }
  } catch (e) {
    if (!opts.fallbackModels) throw e
    const hint = baseUrl.includes("anthropic")
      ? "anthropic"
      : baseUrl.includes("deepseek")
        ? "unknown"
        : "unknown"
    detected = {
      models: opts.fallbackModels,
      providerHint: hint as "openai" | "anthropic" | "unknown",
    }
  }
  // dedup id: id ramah via preset/slug, tanpa hash acak (lihat deriveProviderId)
  const existing = (await loadConfig(opts.cwd)).providers.map((p) => p.id)
  const uniqId = deriveProviderId(baseUrl, existing, id)
  const entry: ProviderEntry = {
    id: uniqId,
    baseUrl,
    apiKey,
    models: detected.models,
    providerHint: detected.providerHint,
  }
  await saveProvider(entry, opts)
  return entry
}

export async function removeProvider(id: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  let cfg: MinicodeConfig = { providers: [] }
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")))
  } catch {}
  cfg.providers = cfg.providers.filter((p) => p.id !== id)
  await writeConfigAtomic(path, cfg)
}

// Re-detect models untuk provider yang ada (model baru otomatis tersinkron).
// Tidak menyentuh apiKey/baseUrl — hanya memperbarui daftar models.
// Membaca MERGED config (local prioritas atas global) dan menulis kembali ke
// KEDUA file tempat provider ternyata disimpan — mirip perilaku loadConfig,
// sehingga `/sync` bekerja walau provider disimpan di local (bukan global).
export async function refreshProviderModels(
  opts: { global?: boolean; cwd?: string } = {},
): Promise<{ id: string; from: number; to: number }[]> {
  // /sync harus benar-benar re-fetch — tanpa ini detectModels menyajikan cache
  // 30 menit dan /sync menjadi no-op ("from == to") padahal provider punya
  // model baru.
  clearDetectCache()
  const merged = await loadConfig(opts.cwd)
  const providers: ProviderEntry[] = merged.providers
  if (providers.length === 0 && (opts.global ?? true)) {
    // tidak ada provider di merge — coba file global secara eksplisit
    const g = await readFile(GLOBAL, "utf8")
      .then((raw) => normalizeConfig(JSON.parse(raw)).providers)
      .catch(() => [])
    providers.push(...g)
  }
  if (providers.length === 0) return []

  const updated = new Map<string, ProviderEntry>()
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!
    if (!p.apiKey || !p.baseUrl) continue
    try {
      const detected = await detectModels(p.baseUrl, p.apiKey)
      if (detected.models.length) {
        updated.set(p.id, { ...p, models: detected.models, providerHint: detected.providerHint })
      }
    } catch {
      // provider offline / auth gagal — biarkan daftar lama
    }
  }

  // Tulis kembali ke setiap file yang memuat provider yang diupdate — dalam
  // format yang sudah ada di file tersebut (global dan/atau local).
  const results: { id: string; from: number; to: number }[] = []
  // check existence via direct read attempt (no TOCTOU pre-check)
  const paths = new Set<string>()
  const checkPaths = [GLOBAL, resolve(opts.cwd ?? process.cwd(), LOCAL)]
  for (const p of checkPaths) {
    try {
      await readFile(p, "utf8")
      paths.add(p)
    } catch {}
  }
  for (const path of paths) {
    try {
      const cfg: MinicodeConfig = normalizeConfig(JSON.parse(await readFile(path, "utf8")))
      let changed = false
      for (const p of cfg.providers) {
        const nu = updated.get(p.id)
        if (nu) {
          p.models = nu.models
          p.providerHint = nu.providerHint
          changed = true
        }
      }
      if (changed) await writeConfigAtomic(path, cfg)
    } catch {
      // file corrupt/unreadable — lewati
    }
  }
  for (const [id, nu] of updated) {
    const orig = providers.find((p) => p.id === id)!
    results.push({ id, from: orig.models.length, to: nu.models.length })
  }
  return results
}
