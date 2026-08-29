// Penyimpanan kredensial OAuth, terpisah dari config.json.
//
// Kenapa terpisah? `config.json` sering dibagikan / di-commit ke repo
// (`.minicode/config.json` lokal), sementara token OAuth adalah rahasia
// berumur pendek yang tak boleh ikut. Berkas ini selalu global
// (`~/.minicode/auth.json`), chmod 600, dan tak pernah dibaca dari cwd.
//
// Refresh token disimpan karena itu inti dari nilai OAuth: user login sekali,
// lalu access token diperbarui otomatis tanpa interaksi.

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { atomicWriteText } from "../lib/atomic-write.ts"

export interface AuthCredentials {
  /** Tipe kredensial; `oauth` = punya refresh flow. */
  type: "oauth"
  accessToken: string
  refreshToken?: string
  /** Epoch ms kedaluwarsa access token. */
  expiresAt?: number
  /** Scope yang diberikan server (informasional). */
  scope?: string
  /** Endpoint token untuk refresh — disimpan agar tak perlu hard-code ulang. */
  tokenUrl?: string
  clientId?: string
}

export interface AuthStore {
  /** key = provider id (mis. "qwen", "anthropic"). */
  [providerId: string]: AuthCredentials
}

const AUTH_PATH = join(homedir(), ".minicode", "auth.json")

export function authFilePath(): string {
  return AUTH_PATH
}

export async function loadAuthStore(): Promise<AuthStore> {
  try {
    const raw = await readFile(AUTH_PATH, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: AuthStore = {}
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const c = v as Partial<AuthCredentials>
      // Entri tanpa accessToken tak berguna; buang daripada menyebarkan
      // undefined ke header Authorization.
      if (c && c.type === "oauth" && typeof c.accessToken === "string" && c.accessToken) {
        out[id] = {
          type: "oauth",
          accessToken: c.accessToken,
          ...(typeof c.refreshToken === "string" ? { refreshToken: c.refreshToken } : {}),
          ...(typeof c.expiresAt === "number" ? { expiresAt: c.expiresAt } : {}),
          ...(typeof c.scope === "string" ? { scope: c.scope } : {}),
          ...(typeof c.tokenUrl === "string" ? { tokenUrl: c.tokenUrl } : {}),
          ...(typeof c.clientId === "string" ? { clientId: c.clientId } : {}),
        }
      }
    }
    return out
  } catch {
    // Tidak ada file / JSON rusak = belum login. Bukan kondisi error.
    return {}
  }
}

export async function saveAuth(providerId: string, creds: AuthCredentials): Promise<void> {
  const store = await loadAuthStore()
  store[providerId] = creds
  // atomicWriteText sudah chmod 600 + O_EXCL tmp; tak perlu perlakuan khusus.
  await atomicWriteText(AUTH_PATH, JSON.stringify(store, null, 2))
}

export async function removeAuth(providerId: string): Promise<boolean> {
  const store = await loadAuthStore()
  if (!store[providerId]) return false
  delete store[providerId]
  await atomicWriteText(AUTH_PATH, JSON.stringify(store, null, 2))
  return true
}

export async function getAuth(providerId: string): Promise<AuthCredentials | undefined> {
  return (await loadAuthStore())[providerId]
}

/** Daftar provider yang punya kredensial (untuk `minicode auth status`). */
export async function listAuth(): Promise<
  { providerId: string; expiresAt?: number; expired: boolean; hasRefresh: boolean }[]
> {
  const store = await loadAuthStore()
  return Object.entries(store).map(([providerId, c]) => ({
    providerId,
    ...(c.expiresAt ? { expiresAt: c.expiresAt } : {}),
    expired: isExpired(c),
    hasRefresh: Boolean(c.refreshToken),
  }))
}

/**
 * Kedaluwarsa dengan margin 60 detik.
 *
 * Margin penting: token yang kedaluwarsa 5 detik setelah kita memeriksanya akan
 * gagal di tengah request. Lebih baik refresh sedikit lebih awal.
 */
export function isExpired(creds: AuthCredentials, nowMs: number = Date.now()): boolean {
  if (!creds.expiresAt) return false // tanpa info kedaluwarsa: anggap masih valid
  return creds.expiresAt - 60_000 <= nowMs
}
