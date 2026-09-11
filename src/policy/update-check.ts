// Update notifier — cek versi terbaru di npm, cache 24 jam, tampil sekali.
// Tanpa dependensi, tanpa blocking startup (fire-and-forget, timeout 2 dtk).
// Hormat offline: gagal fetch = diam. Hormat NO_UPDATE_CHECK=1 / CI=1.

import { homedir } from "node:os"
import { join } from "node:path"

const PKG_NAME = "@miniroom/minicode"
const CACHE_FILE = join(homedir(), ".minicode", "update-check.json")
const TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 2000

interface Cache {
  checkedAt: number
  latest: string
}

function shouldSkip(): boolean {
  if (process.env.NO_UPDATE_CHECK === "1") return true
  if (process.env.CI === "1") return true
  // Jangan ganggu JSONL pipeline
  if (process.argv.includes("--json") || process.argv.includes("--output-format")) return true
  return false
}

function semverLt(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => Number(x) || 0)
  const pb = b.split(".").map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false
  }
  return false
}

async function readCache(): Promise<Cache | null> {
  try {
    // Lazy import — hindari top-level `node:fs/promises` bareng `bun:sqlite`
    // yang di Bun Windows nge-trigger `kWriteMonkeyPatchDefense` (lihat 0.9.7).
    const { readFile } = await import("node:fs/promises")
    const raw = await readFile(CACHE_FILE, "utf8")
    const j = JSON.parse(raw) as Cache
    if (typeof j.checkedAt === "number" && typeof j.latest === "string") return j
  } catch {}
  return null
}

async function writeCache(latest: string): Promise<void> {
  try {
    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(join(homedir(), ".minicode"), { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify({ checkedAt: Date.now(), latest }), "utf8")
  } catch {}
}

async function fetchLatest(): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PKG_NAME)}/latest`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    })
    clearTimeout(t)
    if (!res.ok) return null
    const j = (await res.json()) as { version?: string }
    return typeof j.version === "string" ? j.version : null
  } catch {
    return null
  }
}

export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  if (shouldSkip()) return null
  const cached = await readCache()
  let latest: string | null = null
  if (cached && Date.now() - cached.checkedAt < TTL_MS) {
    latest = cached.latest
  } else {
    latest = await fetchLatest()
    if (latest) await writeCache(latest)
    else if (cached) latest = cached.latest // offline: pakai cache lama
  }
  if (!latest) return null
  if (semverLt(currentVersion, latest)) return latest
  return null
}

export function formatUpdateMessage(current: string, latest: string): string {
  return `Update tersedia ${current} → ${latest} — jalankan: npm update -g ${PKG_NAME}`
}
