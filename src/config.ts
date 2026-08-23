import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
}

const GLOBAL = join(homedir(), ".minicode", "config.json");
const LOCAL = ".minicode/config.json";

export async function loadConfig(cwd = process.cwd()): Promise<MinicodeConfig> {
  let globalCfg: MinicodeConfig = { providers: [] };
  let localCfg: MinicodeConfig = { providers: [] };
  try {
    globalCfg = JSON.parse(await readFile(GLOBAL, "utf8"));
  } catch {}
  try {
    const localPath = resolve(cwd, LOCAL);
    localCfg = JSON.parse(await readFile(localPath, "utf8"));
  } catch {}
  const map = new Map<string, ProviderEntry>();
  for (const p of globalCfg.providers) map.set(p.id, p);
  for (const p of localCfg.providers) map.set(p.id, p);
  // merge mcpServers (local override global by id)
  const mcpMap = new Map<string, McpServerEntry>();
  for (const m of globalCfg.mcpServers ?? []) mcpMap.set(m.id, m);
  for (const m of localCfg.mcpServers ?? []) mcpMap.set(m.id, m);
  // merge lspServers (local override global by ext)
  const lspMap = new Map<string, LspServerEntry>();
  for (const l of globalCfg.lspServers ?? []) lspMap.set(l.ext.toLowerCase(), l);
  for (const l of localCfg.lspServers ?? []) lspMap.set(l.ext.toLowerCase(), l);
  return {
    providers: [...map.values()],
    mcpServers: [...mcpMap.values()],
    lspServers: [...lspMap.values()],
  };
}

export async function saveProvider(entry: ProviderEntry, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  const idx = cfg.providers.findIndex((p) => p.id === entry.id);
  if (idx >= 0) cfg.providers[idx] = entry;
  else cfg.providers.push(entry);
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
}

export async function detectAndSave(baseUrl: string, apiKey: string, id?: string, opts: { global?: boolean; cwd?: string } = {}): Promise<ProviderEntry> {
  const detected = await detectModels(baseUrl, apiKey);
  const entry: ProviderEntry = {
    id: (id ?? baseUrl.replace(/https?:\/\//, "").replace(/[^a-z0-9]/gi, "-").slice(0, 30)) || "gateway",
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
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  cfg.providers = cfg.providers.filter((p) => p.id !== id);
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
}

export async function saveMcpServer(entry: McpServerEntry, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  cfg.mcpServers ??= [];
  const idx = cfg.mcpServers.findIndex((m) => m.id === entry.id);
  if (idx >= 0) cfg.mcpServers[idx] = entry;
  else cfg.mcpServers.push(entry);
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
}

export async function removeMcpServer(id: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  cfg.mcpServers = (cfg.mcpServers ?? []).filter((m) => m.id !== id);
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
}

function normalizeExt(ext: string): string {
  return ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}

export async function saveLspServer(entry: LspServerEntry, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  cfg.lspServers ??= [];
  const ext = normalizeExt(entry.ext);
  const idx = cfg.lspServers.findIndex((l) => l.ext.toLowerCase() === ext);
  if (idx >= 0) cfg.lspServers[idx] = { ...entry, ext };
  else cfg.lspServers.push({ ...entry, ext });
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
}

export async function removeLspServer(ext: string, opts: { global?: boolean; cwd?: string } = {}) {
  const path = (opts.global ?? true) ? GLOBAL : resolve(opts.cwd ?? process.cwd(), LOCAL);
  await mkdir(join(path, ".."), { recursive: true }).catch(() => {});
  let cfg: MinicodeConfig = { providers: [] };
  try {
    cfg = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  cfg.lspServers = (cfg.lspServers ?? []).filter((l) => l.ext.toLowerCase() !== normalizeExt(ext));
  await writeFile(path, JSON.stringify(cfg, null, 2), "utf8");
}
