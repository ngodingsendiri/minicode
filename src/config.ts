import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { atomicWriteText } from "./lib/atomic-write.ts"

// In-process lock per path untuk mencegah lost-update saat Pool(3) sub-agent
// menulis config yang sama secara paralel. Untuk lintas proses, atomicWriteText
// sudah cegah torn write, tapi tanpa CAS tetap last-wins; lock ini menutup
// kasus 99% (same-process) dengan biaya nol.
const configLocks = new Map<string, Promise<void>>()

async function withConfigLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = configLocks.get(path) ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((res) => (release = res))
  configLocks.set(
    path,
    prev.then(() => next),
  )
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (configLocks.get(path) === next) configLocks.delete(path)
  }
}

export interface ProviderEntry {
  id: string
  baseUrl: string
  /** API key. Kosong bila provider memakai OAuth (`auth: "oauth"`). */
  apiKey: string
  models: string[]
  providerHint?: string
  /**
   * Sumber kredensial. `oauth` = ambil access token dari `~/.minicode/auth.json`
   * saat runtime, jangan simpan di config (config bisa ikut ter-commit).
   */
  auth?: "apikey" | "oauth"
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

// Diekspor agar lapisan provisioning (src/providers/provision.ts) membaca dan
// menulis berkas config yang sama tanpa menduplikasi path/normalisasi.
export const GLOBAL = join(homedir(), ".minicode", "config.json")
export const LOCAL = ".minicode/config.json"

export function normalizeConfig(raw: unknown): MinicodeConfig {
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

export async function writeConfigAtomic(path: string, cfg: MinicodeConfig): Promise<void> {
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

export async function saveMcpServer(
  entry: McpServerEntry,
  opts: { global?: boolean; cwd?: string } = {},
) {
  if (!entry.id || (!entry.command && !entry.url))
    throw new Error("mcp entry needs an id + (command for stdio or url for http)")
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  return withConfigLock(path, async () => {
    let cfg: MinicodeConfig = { providers: [] }
    let raw = ""
    try {
      raw = await readFile(path, "utf8")
      cfg = normalizeConfig(JSON.parse(raw))
    } catch (e) {
      if (e instanceof SyntaxError) {
        const backup = `${path}.corrupt.${Date.now()}`
        await atomicWriteText(backup, raw).catch(() => {})
        throw new Error(`config corrupt: ${path} — backup to ${backup}: ${e.message}`)
      }
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        cfg = { providers: [] }
      } else if ((e as Error).message?.includes("config corrupt")) {
        throw e
      } else if ((e as NodeJS.ErrnoException).code) {
        throw e
      } else {
        cfg = { providers: [] }
      }
    }
    cfg.mcpServers ??= []
    const idx = cfg.mcpServers.findIndex((m) => m.id === entry.id)
    if (idx >= 0) cfg.mcpServers[idx] = entry
    else cfg.mcpServers.push(entry)
    await writeConfigAtomic(path, cfg)
  })
}

export async function removeMcpServer(id: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  return withConfigLock(path, async () => {
    let cfg: MinicodeConfig = { providers: [] }
    let raw = ""
    try {
      raw = await readFile(path, "utf8")
      cfg = normalizeConfig(JSON.parse(raw))
    } catch (e) {
      if (e instanceof SyntaxError) {
        const backup = `${path}.corrupt.${Date.now()}`
        await atomicWriteText(backup, raw).catch(() => {})
        throw new Error(`config corrupt: ${path} — backup to ${backup}: ${e.message}`)
      }
      if ((e as NodeJS.ErrnoException).code === "ENOENT") cfg = { providers: [] }
      else if ((e as Error).message?.includes("config corrupt")) throw e
      else if ((e as NodeJS.ErrnoException).code) throw e
      else cfg = { providers: [] }
    }
    cfg.mcpServers = (cfg.mcpServers ?? []).filter((m) => m.id !== id)
    await writeConfigAtomic(path, cfg)
  })
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
  return withConfigLock(path, async () => {
    let cfg: MinicodeConfig = { providers: [] }
    let raw = ""
    try {
      raw = await readFile(path, "utf8")
      cfg = normalizeConfig(JSON.parse(raw))
    } catch (e) {
      if (e instanceof SyntaxError) {
        const backup = `${path}.corrupt.${Date.now()}`
        await atomicWriteText(backup, raw).catch(() => {})
        throw new Error(`config corrupt: ${path} — backup to ${backup}: ${e.message}`)
      }
      if ((e as NodeJS.ErrnoException).code === "ENOENT") cfg = { providers: [] }
      else if ((e as Error).message?.includes("config corrupt")) throw e
      else if ((e as NodeJS.ErrnoException).code) throw e
      else cfg = { providers: [] }
    }
    cfg.lspServers ??= []
    const ext = normalizeExt(entry.ext)
    const idx = cfg.lspServers.findIndex((l) => l.ext.toLowerCase() === ext)
    if (idx >= 0) cfg.lspServers[idx] = { ...entry, ext }
    else cfg.lspServers.push({ ...entry, ext })
    await writeConfigAtomic(path, cfg)
  })
}

export async function removeLspServer(ext: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL)
  return withConfigLock(path, async () => {
    let cfg: MinicodeConfig = { providers: [] }
    let raw = ""
    try {
      raw = await readFile(path, "utf8")
      cfg = normalizeConfig(JSON.parse(raw))
    } catch (e) {
      if (e instanceof SyntaxError) {
        const backup = `${path}.corrupt.${Date.now()}`
        await atomicWriteText(backup, raw).catch(() => {})
        throw new Error(`config corrupt: ${path} — backup to ${backup}: ${e.message}`)
      }
      if ((e as NodeJS.ErrnoException).code === "ENOENT") cfg = { providers: [] }
      else if ((e as Error).message?.includes("config corrupt")) throw e
      else if ((e as NodeJS.ErrnoException).code) throw e
      else cfg = { providers: [] }
    }
    cfg.lspServers = (cfg.lspServers ?? []).filter((l) => l.ext.toLowerCase() !== normalizeExt(ext))
    await writeConfigAtomic(path, cfg)
  })
}
