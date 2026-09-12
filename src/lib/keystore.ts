import { spawnSync } from "node:child_process"
import { chmod, mkdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { atomicWriteText } from "./atomic-write.ts"

// Penyimpanan rahasia berlapis (tanpa dependensi):
// - Windows: DPAPI user-scope via powershell bawaan (hanya user ini yang
//   bisa dekripsi, bahkan bila berkas dibaca pihak lain).
// - Selain itu: berkas chmod 600 (status quo — didokumentasikan, bukan
//   diklaim setara keyring).
//
// Desain: envelope — yang disimpan di disk SELALU `{enc, alg}`; `alg`
// `"dpapi"` berarti base64 blob DPAPI, `"plain"` berarti teks biasa.
// Fallback ke plain OTOMATIS bila backend OS tak tersedia (bukan error),
// supaya CLI tetap jalan di CI/container. Tak pernah melempar.

export type SecretRunner = (
  cmd: string,
  args: string[],
  input?: string,
) => { status: number | null; stdout: string }

let runnerOverride: SecretRunner | null = null

/** Seam uji: ganti eksekutor powershell. */
export function __setKeystoreRunnerForTest(r: SecretRunner | null): void {
  runnerOverride = r
}

const secretCache = new Map<string, string | null>()

/** Reset cache + runner (test saja). */
export function __resetKeystoreForTest(): void {
  secretCache.clear()
  runnerOverride = null
}

function defaultRunner(
  cmd: string,
  args: string[],
  input?: string,
): { status: number | null; stdout: string } {
  try {
    const r = spawnSync(cmd, args, {
      input,
      encoding: "utf8",
      timeout: 15000,
      shell: process.platform === "win32",
      windowsHide: true,
    })
    return { status: typeof r.status === "number" ? r.status : null, stdout: r.stdout ?? "" }
  } catch {
    return { status: null, stdout: "" }
  }
}

function storePath(): string {
  const home = process.env.MINICODE_HOME || homedir()
  return join(home, ".minicode", "secrets.json")
}

interface SecretStore {
  version: 1
  entries: Record<string, { enc: string; alg: "dpapi" | "plain" }>
}

async function loadStore(): Promise<SecretStore> {
  try {
    const raw = await readFile(storePath(), "utf8")
    const parsed = JSON.parse(raw) as Partial<SecretStore>
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.entries &&
      typeof parsed.entries === "object"
    )
      return { version: 1, entries: parsed.entries as SecretStore["entries"] }
  } catch {}
  return { version: 1, entries: {} }
}

async function saveStore(store: SecretStore): Promise<void> {
  try {
    await mkdir(join(storePath(), ".."), { recursive: true, mode: 0o700 }).catch(() => {})
    await atomicWriteText(storePath(), JSON.stringify(store))
    await chmod(storePath(), 0o600).catch(() => {})
  } catch {}
}

// DPAPI user-scope roundtrip via powershell bawaan (5.1 maupun 7.x).
// stdin: teks biasa (protect) / base64 blob (unprotect); stdout: hasilnya.
// Scope CurrentUser = hanya user Windows ini yang bisa membuka.
// `Add-Type System.Security` WAJIB eksplisit: assembly ProtectedData tidak
// di-load default oleh powershell (terbukti gagal tanpanya di Win 10/11).
const DPAPI_PRELUDE = "Add-Type -AssemblyName System.Security; "
const DPAPI_PROTECT = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  DPAPI_PRELUDE +
    "$t = [Console]::In.ReadToEnd(); " +
    "$b = [Text.Encoding]::UTF8.GetBytes($t); " +
    "$p = [Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'); " +
    "[Convert]::ToBase64String($p)",
].join(" ")

const DPAPI_UNPROTECT = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  DPAPI_PRELUDE +
    "$t = [Console]::In.ReadToEnd(); " +
    "$p = [Convert]::FromBase64String($t.Trim()); " +
    "$b = [Security.Cryptography.ProtectedData]::Unprotect($p, $null, 'CurrentUser'); " +
    "[Text.Encoding]::UTF8.GetString($b)",
].join(" ")

function dpapiAvailable(): boolean {
  if (process.env.MINICODE_KEYSTORE_DISABLE === "1") return false
  if (process.platform !== "win32" && !process.env.MINICODE_KEYSTORE_FORCE_DPAPI) return false
  return true
}

function dpapiProtect(plaintext: string): string | null {
  const run = runnerOverride ?? defaultRunner
  const exe = process.platform === "win32" ? "powershell" : "pwsh"
  const r = run(exe, DPAPI_PROTECT.split(" ").filter(Boolean), plaintext)
  if (r.status !== 0) return null
  const out = r.stdout.trim()
  return out ? out : null
}

function dpapiUnprotect(blob: string): string | null {
  const run = runnerOverride ?? defaultRunner
  const shell = process.platform === "win32" ? "powershell" : "pwsh"
  const r = run(shell, DPAPI_UNPROTECT.split(" ").filter(Boolean), blob)
  if (r.status !== 0) return null
  // powershell mengakhiri output dengan newline — hanya itu yang dibuang,
  // isi secret utuh (bisa mengandung newline di tengah).
  return r.stdout.replace(/\r?\n$/, "")
}

/** Simpan rahasia. Return backend yang dipakai ("dpapi"|"plain"), null bila gagal total. */
export async function setSecret(key: string, value: string): Promise<"dpapi" | "plain" | null> {
  if (!key || !value) return null
  const store = await loadStore()
  // Platform ber-DPAPI tapi proteksi GAGAL = jangan turun diam-diam ke
  // plaintext (user mengira secret-nya terproteksi OS). Tanpa backend
  // (non-Windows) = plain jujur berlabel.
  if (dpapiAvailable()) {
    const blob = dpapiProtect(value)
    if (!blob) return null
    store.entries[key] = { enc: blob, alg: "dpapi" }
    await saveStore(store)
    secretCache.set(key, value)
    return "dpapi"
  }
  store.entries[key] = { enc: value, alg: "plain" }
  await saveStore(store)
  secretCache.set(key, value)
  return "plain"
}

/** Baca rahasia. null = tak ada / tak bisa dibuka. Tak pernah melempar. */
export async function getSecret(key: string): Promise<string | null> {
  if (!key) return null
  if (secretCache.has(key)) return secretCache.get(key) ?? null
  let value: string | null = null
  try {
    const store = await loadStore()
    const entry = store.entries[key]
    if (entry) {
      if (entry.alg === "dpapi") {
        if (dpapiAvailable()) value = dpapiUnprotect(entry.enc)
      } else {
        value = entry.enc
      }
    }
  } catch {
    value = null
  }
  secretCache.set(key, value)
  return value
}

/** Hapus rahasia. Selalu "sukses" semu (idempoten, tak melempar). */
export async function deleteSecret(key: string): Promise<void> {
  secretCache.delete(key)
  try {
    const store = await loadStore()
    if (store.entries[key]) {
      delete store.entries[key]
      await saveStore(store)
    }
  } catch {}
}

/** Backend aktif untuk pesan/diagnostik (bukan rahasia). */
export function keystoreBackend(): "dpapi" | "plain-file" {
  return dpapiAvailable() ? "dpapi" : "plain-file"
}
