// OAuth 2.0 Device Authorization Grant (RFC 8628) untuk CLI.
//
// Kenapa device-code dan bukan authorization-code + PKCE? Device flow tidak
// butuh redirect URI, tidak butuh membuka port lokal, dan bekerja saat CLI
// dijalankan lewat SSH — tiga hal yang semuanya relevan untuk agent terminal.
// Tradeoff-nya user harus menyalin kode ke browser; itu wajar untuk login sekali.
//
// Alur:
//   1. POST device_authorization_endpoint → { device_code, user_code,
//      verification_uri, interval, expires_in }
//   2. Tampilkan user_code + URI ke user.
//   3. Poll token_endpoint dengan grant_type=device_code sampai:
//      - success → simpan token
//      - authorization_pending → tunggu `interval`
//      - slow_down → naikkan interval (RFC 8628 §3.5)
//      - access_denied / expired_token → berhenti dengan pesan jelas
//
// Provider dideklarasikan sebagai data (OAUTH_PROVIDERS) bukan kode, supaya
// menambah provider = menambah satu entri, bukan menulis alur baru.

import { LIMITS } from "../constants.ts"
import { type AuthCredentials, getAuth, saveAuth } from "./auth-store.ts"

export interface OAuthProviderSpec {
  id: string
  label: string
  /** Endpoint device authorization (RFC 8628 §3.1). */
  deviceUrl: string
  /** Endpoint token (dipakai untuk poll dan refresh). */
  tokenUrl: string
  clientId: string
  scope?: string
  /** baseUrl API setelah login berhasil — dipakai untuk mendaftarkan provider. */
  apiBaseUrl: string
  /** Model default bila detect gagal. */
  fallbackModels: string[]
  /** Catatan yang ditampilkan ke user sebelum login. */
  note?: string
}

// Qwen Code memakai device flow publik dengan free tier — kandidat paling masuk
// akal untuk "coba tanpa kartu kredit". clientId di bawah adalah client publik
// (RFC 8628 mengizinkan client publik tanpa secret).
//
// CATATAN JUJUR: nilai endpoint/clientId di sini belum bisa saya verifikasi
// dengan login sungguhan dari lingkungan ini (butuh interaksi browser).
// Mekanismenya diuji end-to-end terhadap server device-flow lokal; identitas
// provider-nya perlu dikonfirmasi saat pertama dipakai. `minicode auth login`
// akan melaporkan error server apa adanya bila nilainya salah, bukan gagal senyap.
export const OAUTH_PROVIDERS: OAuthProviderSpec[] = [
  {
    id: "qwen",
    label: "Qwen Code (free tier, device login)",
    deviceUrl: "https://chat.qwen.ai/api/v1/oauth2/device/code",
    tokenUrl: "https://chat.qwen.ai/api/v1/oauth2/token",
    clientId: "f0304373b74a44d2b584a3fb70ca9e56",
    scope: "openid profile email model.completion",
    apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    fallbackModels: ["qwen3-coder-plus", "qwen2.5-coder-32b-instruct"],
    note: "Free tier harian. Verifikasi endpoint saat login pertama.",
  },
]

export function findOAuthProvider(id: string): OAuthProviderSpec | undefined {
  return OAUTH_PROVIDERS.find((p) => p.id === id.toLowerCase())
}

export interface DeviceCodeStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  /** URI lengkap dengan kode ter-embed, bila server menyediakannya. */
  verificationUriComplete?: string
  /** Detik antar-poll yang diminta server. */
  interval: number
  /** Epoch ms saat device_code kedaluwarsa. */
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

async function postForm(url: string, body: Record<string, string>, timeoutMs: number) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "manual",
  })
  const text = await res.text()
  let json: TokenResponse = {}
  if (text.trim()) {
    try {
      json = JSON.parse(text) as TokenResponse
    } catch {
      // Server yang membalas HTML (proxy, captive portal) tidak boleh muncul
      // sebagai "undefined is not an object" di layar user.
      throw new Error(`response is not JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
    }
  }
  return { status: res.status, json }
}

/** Langkah 1: minta device code. Diekspor untuk test. */
export async function startDeviceFlow(spec: OAuthProviderSpec): Promise<DeviceCodeStart> {
  const { status, json } = await postForm(
    spec.deviceUrl,
    {
      client_id: spec.clientId,
      ...(spec.scope ? { scope: spec.scope } : {}),
    },
    LIMITS.OAUTH_REQUEST_TIMEOUT_MS,
  )
  const raw = json as TokenResponse & {
    device_code?: string
    user_code?: string
    verification_uri?: string
    verification_url?: string
    verification_uri_complete?: string
    interval?: number
    expires_in?: number
  }
  if (raw.error) {
    throw new Error(`device authorization rejected: ${raw.error_description ?? raw.error}`)
  }
  if (status >= 400) throw new Error(`device authorization failed (HTTP ${status})`)
  if (!raw.device_code || !raw.user_code) {
    throw new Error("server did not return device_code/user_code")
  }
  // Beberapa server memakai `verification_url` (non-standar, mis. Google lama).
  const uri = raw.verification_uri ?? raw.verification_url
  if (!uri) throw new Error("server did not return verification_uri")

  return {
    deviceCode: raw.device_code,
    userCode: raw.user_code,
    verificationUri: uri,
    ...(raw.verification_uri_complete
      ? { verificationUriComplete: raw.verification_uri_complete }
      : {}),
    // RFC 8628: default 5 detik bila server tak menyebut interval.
    interval: Math.max(1, Math.min(raw.interval ?? 5, 60)),
    expiresAt: Date.now() + (raw.expires_in ?? 600) * 1000,
  }
}

export type PollOutcome =
  | { state: "success"; creds: AuthCredentials }
  | { state: "pending"; nextIntervalSec: number }
  | { state: "denied"; message: string }
  | { state: "expired"; message: string }

/**
 * Satu iterasi poll. Dipisah dari loop agar bisa diuji tanpa menunggu.
 * Diekspor untuk test.
 */
export async function pollDeviceTokenOnce(
  spec: OAuthProviderSpec,
  deviceCode: string,
  currentIntervalSec: number,
): Promise<PollOutcome> {
  const { status, json } = await postForm(
    spec.tokenUrl,
    {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: spec.clientId,
    },
    LIMITS.OAUTH_REQUEST_TIMEOUT_MS,
  )

  if (json.access_token) {
    return {
      state: "success",
      creds: {
        type: "oauth",
        accessToken: json.access_token,
        ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
        ...(json.expires_in ? { expiresAt: Date.now() + json.expires_in * 1000 } : {}),
        ...(json.scope ? { scope: json.scope } : {}),
        tokenUrl: spec.tokenUrl,
        clientId: spec.clientId,
      },
    }
  }

  switch (json.error) {
    case "authorization_pending":
      return { state: "pending", nextIntervalSec: currentIntervalSec }
    case "slow_down":
      // RFC 8628 §3.5: klien WAJIB menaikkan interval, minimal +5 detik.
      return { state: "pending", nextIntervalSec: Math.min(currentIntervalSec + 5, 60) }
    case "access_denied":
      return { state: "denied", message: json.error_description ?? "user denied the request" }
    case "expired_token":
      return { state: "expired", message: json.error_description ?? "device code expired" }
    default:
      // Error tak dikenal: jangan diam-diam terus polling sampai timeout.
      return {
        state: "denied",
        message: json.error
          ? `${json.error}: ${json.error_description ?? ""}`.trim()
          : `HTTP ${status} without a token`,
      }
  }
}

export interface LoginCallbacks {
  /** Dipanggil sekali dengan instruksi untuk user. */
  onPrompt(info: DeviceCodeStart): void
  /** Progres opsional tiap poll. */
  onPoll?(elapsedSec: number): void
  /** Batalkan login. */
  signal?: AbortSignal
}

/** Alur lengkap: mulai device flow, tampilkan kode, poll sampai selesai. */
export async function loginWithDeviceFlow(
  spec: OAuthProviderSpec,
  cb: LoginCallbacks,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<AuthCredentials> {
  const start = await startDeviceFlow(spec)
  cb.onPrompt(start)

  let interval = start.interval
  const t0 = Date.now()
  while (true) {
    if (cb.signal?.aborted) throw new Error("login canceled")
    if (Date.now() >= start.expiresAt) {
      throw new Error("device code expired — run `minicode auth login` again")
    }
    await sleep(interval * 1000)
    if (cb.signal?.aborted) throw new Error("login canceled")

    const res = await pollDeviceTokenOnce(spec, start.deviceCode, interval)
    if (res.state === "success") {
      await saveAuth(spec.id, res.creds)
      return res.creds
    }
    if (res.state === "denied") throw new Error(`login rejected: ${res.message}`)
    if (res.state === "expired") throw new Error(`login expired: ${res.message}`)
    interval = res.nextIntervalSec
    cb.onPoll?.(Math.round((Date.now() - t0) / 1000))
  }
}

/**
 * Tukar refresh token dengan access token baru.
 *
 * Return null bila tidak ada refresh token atau server menolak — pemanggil
 * memutuskan apakah itu berarti "minta login ulang".
 */
export async function refreshAccessToken(
  providerId: string,
  creds: AuthCredentials,
): Promise<AuthCredentials | null> {
  if (!creds.refreshToken || !creds.tokenUrl || !creds.clientId) return null
  let res: { status: number; json: TokenResponse }
  try {
    res = await postForm(
      creds.tokenUrl,
      {
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
      },
      LIMITS.OAUTH_REQUEST_TIMEOUT_MS,
    )
  } catch {
    return null
  }
  if (!res.json.access_token) return null
  const next: AuthCredentials = {
    type: "oauth",
    accessToken: res.json.access_token,
    // Server boleh merotasi refresh token; bila tidak, pakai yang lama.
    refreshToken: res.json.refresh_token ?? creds.refreshToken,
    ...(res.json.expires_in ? { expiresAt: Date.now() + res.json.expires_in * 1000 } : {}),
    ...(res.json.scope ? { scope: res.json.scope } : creds.scope ? { scope: creds.scope } : {}),
    tokenUrl: creds.tokenUrl,
    clientId: creds.clientId,
  }
  await saveAuth(providerId, next)
  return next
}

/**
 * Access token yang pasti valid: refresh otomatis bila hampir kedaluwarsa.
 * Return null bila belum login atau refresh gagal.
 */
export async function getValidAccessToken(providerId: string): Promise<string | null> {
  const creds = await getAuth(providerId)
  if (!creds) return null
  const { isExpired } = await import("./auth-store.ts")
  if (!isExpired(creds)) return creds.accessToken
  const refreshed = await refreshAccessToken(providerId, creds)
  return refreshed?.accessToken ?? null
}
