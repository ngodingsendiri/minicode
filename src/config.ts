import { readFile, writeFile, mkdir, chmod, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { detectModels } from "./providers/detect.ts";

export interface ProviderEntry {
  id: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  providerHint?: string;
}

export interface McpServerEntry {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface LspServerEntry {
  ext: string; // ".ts"
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MinicodeConfig {
  providers: ProviderEntry[];
  mcpServers?: McpServerEntry[];
  lspServers?: LspServerEntry[];
  verifyCommand?: string;
}

const GLOBAL = join(homedir(), ".minicode", "config.json");
const LOCAL = ".minicode/config.json";

function normalizeConfig(raw: unknown): MinicodeConfig {
  const cfg = raw as Record<string, unknown>;
  const providers = Array.isArray(cfg?.providers) ? (cfg.providers as ProviderEntry[]).filter((p) => p && typeof p.id === "string" && typeof p.baseUrl === "string") : [];
  const mcpServers = Array.isArray(cfg?.mcpServers) ? (cfg.mcpServers as McpServerEntry[]).filter((m) => m && typeof m.id === "string" && typeof m.command === "string") : undefined;
  const lspServers = Array.isArray(cfg?.lspServers) ? (cfg.lspServers as LspServerEntry[]).filter((l) => l && typeof l.ext === "string" && typeof l.command === "string") : undefined;
  const verifyCommand = typeof cfg?.verifyCommand === "string" ? (cfg.verifyCommand as string) : undefined;
  return { providers, ...(mcpServers ? { mcpServers } : {}), ...(lspServers ? { lspServers } : {}), ...(verifyCommand ? { verifyCommand } : {}) };
}

async function writeConfigAtomic(path: string, cfg: MinicodeConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(cfg, null, 2), "utf8");
  try {
    await chmod(tmp, 0o600);
  } catch {}
  await rename(tmp, path);
  try {
    await chmod(path, 0o600);
  } catch {}
}

export async function loadConfig(cwd = process.cwd()): Promise<MinicodeConfig> {
  let globalCfg: MinicodeConfig = { providers: [] };
  let localCfg: MinicodeConfig = { providers: [] };
  try {
    const raw = await readFile(GLOBAL, "utf8");
    globalCfg = normalizeConfig(JSON.parse(raw));
  } catch (e) {
    const msg = e instanceof SyntaxError ? `invalid JSON in ${GLOBAL}: ${e.message}` : null;
    if (msg) process.stderr.write(`[config] ${msg}\n`);
  }
  try {
    const localPath = resolve(cwd, LOCAL);
    const raw = await readFile(localPath, "utf8");
    localCfg = normalizeConfig(JSON.parse(raw));
  } catch (e) {
    const isSyntax = e instanceof SyntaxError;
    if (isSyntax) process.stderr.write(`[config] invalid JSON in ${resolve(cwd, LOCAL)}: ${(e as Error).message}\n`);
  }
  // merge: local overrides global, and overridden id moves to end (local priority for router default)
  const map = new Map<string, ProviderEntry>();
  for (const p of globalCfg.providers) map.set(p.id, p);
  for (const p of localCfg.providers) {
    if (map.has(p.id)) map.delete(p.id);
    map.set(p.id, p);
  }
  // merge mcpServers (local override global by id, local wins order)
  const mcpMap = new Map<string, McpServerEntry>();
  for (const m of globalCfg.mcpServers ?? []) mcpMap.set(m.id, m);
  for (const m of localCfg.mcpServers ?? []) {
    if (mcpMap.has(m.id)) mcpMap.delete(m.id);
    mcpMap.set(m.id, m);
  }
  // merge lspServers (local override global by ext)
  const lspMap = new Map<string, LspServerEntry>();
  for (const l of globalCfg.lspServers ?? []) lspMap.set(l.ext.toLowerCase(), l);
  for (const l of localCfg.lspServers ?? []) {
    const k = l.ext.toLowerCase();
    if (lspMap.has(k)) lspMap.delete(k);
    lspMap.set(k, l);
  }
  return {
    providers: [...map.values()],
    mcpServers: [...mcpMap.values()],
    lspServers: [...lspMap.values()],
    ...(localCfg.verifyCommand ?? globalCfg.verifyCommand ? { verifyCommand: localCfg.verifyCommand ?? globalCfg.verifyCommand } : {}),
  };
}

export async function saveProvider(entry: ProviderEntry, opts: { global?: boolean; cwd?: string } = {}) {
  if (!entry.id || !entry.baseUrl || !entry.apiKey) throw new Error("provider id/baseUrl/apiKey required");
  if (!entry.models || entry.models.length === 0) throw new Error("provider models required");
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {}
  const idx = cfg.providers.findIndex((p) => p.id === entry.id);
  if (idx >= 0) cfg.providers[idx] = entry;
  else cfg.providers.push(entry);
  await writeConfigAtomic(path, cfg);
}

export async function detectAndSave(baseUrl: string, apiKey: string, id?: string, opts: { global?: boolean; cwd?: string; fallbackModels?: string[] } = {}): Promise<ProviderEntry> {
  // Fallback model dipakai bila provider tidak punya endpoint GET /models
  // (mis. Anthropic) atau deteksi gagal — agar wizard tetap berhasil.
  let detected: { models: string[]; providerHint: "openai" | "anthropic" | "unknown" };
  try {
    detected = await detectModels(baseUrl, apiKey);
    if (detected.models.length === 0 && opts.fallbackModels?.length) {
      detected = { models: opts.fallbackModels, providerHint: detected.providerHint };
    }
  } catch (e) {
    if (!opts.fallbackModels) throw e;
    const hint = baseUrl.includes("anthropic") ? "anthropic" : baseUrl.includes("deepseek") ? "unknown" : "unknown";
    detected = { models: opts.fallbackModels, providerHint: hint as "openai" | "anthropic" | "unknown" };
  }
  // dedup id: base + 4-char hash to avoid collision on slice(0,30)
  const baseId = (id ?? baseUrl.replace(/https?:\/\//, "").replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 24)) || "gateway";
  const suffix = id ? "" : `-${Math.random().toString(36).slice(2, 6)}`;
  const uniqId = `${baseId}${suffix}`.slice(0, 30);
  const entry: ProviderEntry = {
    id: uniqId,
    baseUrl,
    apiKey,
    models: detected.models,
    providerHint: detected.providerHint,
  };
  await saveProvider(entry, opts);
  return entry;
}

export async function removeProvider(id: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {}
  cfg.providers = cfg.providers.filter((p) => p.id !== id);
  await writeConfigAtomic(path, cfg);
}

export async function saveMcpServer(entry: McpServerEntry, opts: { global?: boolean; cwd?: string } = {}) {
  if (!entry.id || !entry.command) throw new Error("mcp id/command required");
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {}
  cfg.mcpServers ??= [];
  const idx = cfg.mcpServers.findIndex((m) => m.id === entry.id);
  if (idx >= 0) cfg.mcpServers[idx] = entry;
  else cfg.mcpServers.push(entry);
  await writeConfigAtomic(path, cfg);
}

export async function removeMcpServer(id: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {}
  cfg.mcpServers = (cfg.mcpServers ?? []).filter((m) => m.id !== id);
  await writeConfigAtomic(path, cfg);
}

function normalizeExt(ext: string): string {
  return ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

export async function saveLspServer(entry: LspServerEntry, opts: { global?: boolean; cwd?: string } = {}) {
  if (!entry.ext || !entry.command) throw new Error("lsp ext/command required");
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {}
  cfg.lspServers ??= [];
  const ext = normalizeExt(entry.ext);
  const idx = cfg.lspServers.findIndex((l) => l.ext.toLowerCase() === ext);
  if (idx >= 0) cfg.lspServers[idx] = { ...entry, ext };
  else cfg.lspServers.push({ ...entry, ext });
  await writeConfigAtomic(path, cfg);
}

export async function removeLspServer(ext: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = normalizeConfig(JSON.parse(await readFile(path, "utf8")));
  } catch {}
  cfg.lspServers = (cfg.lspServers ?? []).filter((l) => l.ext.toLowerCase() !== normalizeExt(ext));
  await writeConfigAtomic(path, cfg);
}
