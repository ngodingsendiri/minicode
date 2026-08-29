import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { atomicWriteText } from "./lib/atomic-write.ts"
import { clearDetectCache, detectModels } from "./providers/detect.ts"
import { GATEWAY_PRESETS } from "./providers/presets.ts"

export interface ProviderEntry {
  id: string
  baseUrl: string
  apiKey: string
  models: string[]
  providerHint?: string
}

export interface McpServerEntry {
  id: string
  /** stdio: perintah yang di-spawn. Kosong bila memakai `url` (HTTP). */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** Streamable HTTP / SSE endpoint. Bila diisi, `command` diabaikan. */
  url?: string
  /** Header tambahan untuk transport HTTP (mis. Authorization). */
  headers?: Record<string, string>
  /** Izinkan endpoint di host privat (server MCP lokal). Default: tolak (anti-SSRF). */
  allowPrivateHost?: boolean
}

export interface LspServerEntry {
  ext: string // ".ts"
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface MinicodeConfig {
  providers: ProviderEntry[]
  mcpServers?: McpServerEntry[]
  lspServers?: LspServerEntry[]
  verifyCommand?: string
  bashAllowlist?: string[]
}

const GLOBAL = join(homedir(), ".minicode", "config.json")
const LOCAL = ".minicode/config.json"

function normalizeConfig(raw: unknown): MinicodeConfig {
  const cfg = raw as Record<string, unknown>
  const providers = Array.isArray(cfg?.providers)
    ? (cfg.providers as ProviderEntry[]).filter(
        (p) => p && typeof p.id === "string" && typeof p.baseUrl === "string",
      )
    : []
  // Server MCP sah bila punya `command` (stdio) ATAU `url` (HTTP). Entri tanpa
  // keduanya dibuang di sini supaya kegagalan tampak saat config dibaca, bukan
  // sebagai error misterius saat connect.
  const mcpServers = Array.isArray(cfg?.mcpServers)
    ? (cfg.mcpServers as McpServerEntry[]).filter(
        (m) =>
          m &&
          typeof m.id === "string" &&
          (typeof m.command === "string" || typeof m.url === "string"),
      )
    : undefined
  const lspServers = Array.isArray(cfg?.lspServers)
    ? (cfg.lspServers as LspServerEntry[]).filter(
        (l) => l && typeof l.ext === "string" && typeof l.command === "string",
      )
    : undefined
  const verifyCommand =
    typeof cfg?.verifyCommand === "string" ? (cfg.verifyCommand as string) : undefined
  const bashAllowlist = Array.isArray(cfg?.bashAllowlist)
    ? (cfg.bashAllowlist as string[]).filter((s) => typeof s === "string")
    : undefined
  return {
    providers,
    ...(mcpServers ? { mcpServers } : {}),
    ...(lspServers ? { lspServers } : {}),
    ...(verifyCommand ? { verifyCommand } : {}),
    ...(bashAllowlist ? { bashAllowlist } : {}),
  }
}

async function writeConfigAtomic(path: string, cfg: MinicodeConfig): Promise<void> {
  await atomicWriteText(path, JSON.stringify(cfg, null, 2))
}

export async function loadConfig(cwd = process.cwd()): Promise<MinicodeConfig> {
  let globalCfg: MinicodeConfig = { providers: [] }
  let localCfg: MinicodeConfig = { providers: [] }
  try {
    const raw = await readFile(GLOBAL, "utf8")
    globalCfg = normalizeConfig(JSON.parse(raw))
  } catch (e) {
    const msg = e instanceof SyntaxError ? `invalid JSON in ${GLOBAL}: ${e.message}` : null
    if (msg) process.stderr.write(`[config] ${msg}\n`)
  }
  try {
    const localPath = resolve(cwd, LOCAL)
    const raw = await readFile(localPath, "utf8")
    localCfg = normalizeConfig(JSON.parse(raw))
  } catch (e) {
    const isSyntax = e instanceof SyntaxError
    if (isSyntax)
      process.stderr.write(
        `[config] invalid JSON in ${resolve(cwd, LOCAL)}: ${(e as Error).message}\n`,
      )
  }
  // generic merge helper — deduplicate DRY
  function mergeByKey<T>(global: T[], local: T[], keyFn: (v: T) => string): T[] {
    const map = new Map<string, T>()
    for (const v of global) map.set(keyFn(v), v)
    for (const v of local) {
      const k = keyFn(v)
      if (map.has(k)) map.delete(k)
      map.set(k, v)
    }
    return [...map.values()]
  }
  const mergedProviders = mergeByKey(globalCfg.providers, localCfg.providers, (p) => p.id)
  const mergedMcp = mergeByKey(globalCfg.mcpServers ?? [], localCfg.mcpServers ?? [], (m) => m.id)
  const mergedLsp = mergeByKey(globalCfg.lspServers ?? [], localCfg.lspServers ?? [], (l) =>
    l.ext.toLowerCase(),
  )
  return {
    providers: mergedProviders,
    mcpServers: mergedMcp,
    lspServers: mergedLsp,
    ...((localCfg.verifyCommand ?? globalCfg.verifyCommand)
      ? { verifyCommand: localCfg.verifyCommand ?? globalCfg.verifyCommand }
      : {}),
    ...((localCfg.bashAllowlist ?? globalCfg.bashAllowlist)
      ? { bashAllowlist: localCfg.bashAllowlist ?? globalCfg.bashAllowlist }
      : {}),
  }
}

export async function saveProvider(
  entry: ProviderEntry,
  opts: { global?: boolean; cwd?: string } = {},
) {
  if (!entry.id || !entry.baseUrl || !entry.apiKey)
    throw new Error("provider id/baseUrl/apiKey required")
  if (!entry.models || entry.models.length === 0) throw new Error("provider models required")
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

export async function saveMcpServer(
  entry: McpServerEntry,
  opts: { global?: boolean; cwd?: string } = {},
) {
  if (!entry.id || (!entry.command && !entry.url))
    throw new Error("mcp entry butuh id + (command untuk stdio atau url untuk http)")
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  let cfg: MinicodeConfig = { providers: [] }
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")))
  } catch {}
  cfg.mcpServers ??= []
  const idx = cfg.mcpServers.findIndex((m) => m.id === entry.id)
  if (idx >= 0) cfg.mcpServers[idx] = entry
  else cfg.mcpServers.push(entry)
  await writeConfigAtomic(path, cfg)
}

export async function removeMcpServer(id: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  let cfg: MinicodeConfig = { providers: [] }
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")))
  } catch {}
  cfg.mcpServers = (cfg.mcpServers ?? []).filter((m) => m.id !== id)
  await writeConfigAtomic(path, cfg)
}

function normalizeExt(ext: string): string {
  return ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`
}

export async function saveLspServer(
  entry: LspServerEntry,
  opts: { global?: boolean; cwd?: string } = {},
) {
  if (!entry.ext || !entry.command) throw new Error("lsp ext/command required")
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  let cfg: MinicodeConfig = { providers: [] }
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")))
  } catch {}
  cfg.lspServers ??= []
  const ext = normalizeExt(entry.ext)
  const idx = cfg.lspServers.findIndex((l) => l.ext.toLowerCase() === ext)
  if (idx >= 0) cfg.lspServers[idx] = { ...entry, ext }
  else cfg.lspServers.push({ ...entry, ext })
  await writeConfigAtomic(path, cfg)
}

export async function removeLspServer(ext: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  let cfg: MinicodeConfig = { providers: [] }
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")))
  } catch {}
  cfg.lspServers = (cfg.lspServers ?? []).filter((l) => l.ext.toLowerCase() !== normalizeExt(ext))
  await writeConfigAtomic(path, cfg)
}
