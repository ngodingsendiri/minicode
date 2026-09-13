import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

// Penanda turn-aktif untuk deteksi mati-tak-wajar (segfault Bun, kill -9,
// hang yang dibunuh dari luar). Ditulis saat turn mulai, dihapus saat turn
// settle (sukses/gagal/abort) — jadi berkas yang TERSISA saat startup
// berarti proses sebelumnya mati di tengah turn. Berbeda dari jurnal
// recovery (yang melacak MUTASI): ini melacak KEHIDUPAN proses.
//
// Multi-sesi satu cwd: marker membawa pid + sessionId. Sesi baru menghormati
// marker milik proses yang MASIH hidup (tak disentuh); hanya marker yatim
// (pid mati) yang dilaporkan + dibersihkan. Hapus pun hanya bila sessionId
// cocok — sesi paralel tak saling menghapus.

export interface TurnMarker {
  sessionId: string
  pid: number
  startedAt: number
}

function markerPath(cwd: string): string {
  return resolve(cwd ?? ".", ".minicode", "turn.active.json")
}

function readMarker(cwd: string): TurnMarker | null {
  try {
    const raw = readFileSync(markerPath(cwd), "utf8")
    const m = JSON.parse(raw) as Partial<TurnMarker>
    if (
      typeof m.sessionId === "string" &&
      typeof m.pid === "number" &&
      typeof m.startedAt === "number"
    ) {
      return { sessionId: m.sessionId, pid: m.pid, startedAt: m.startedAt }
    }
  } catch {}
  return null
}

/** True bila pid (mungkin) masih hidup. Tak pernah melempar. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // ESRCH = mati pasti. Selain itu (EPERM = ada tapi tak boleh disinyal,
    // atau error tak dikenal) anggap hidup — jangan tuduh crash sesuatu
    // yang mungkin berjalan.
    return (e as NodeJS.ErrnoException)?.code !== "ESRCH"
  }
}

/** Tulis marker milik sesi ini — kecuali ada marker sesi lain yang hidup. */
export function markTurnActive(cwd: string | undefined, sessionId: string): void {
  try {
    const dir = cwd ?? "."
    const prev = readMarker(dir)
    if (prev && prev.sessionId !== sessionId && isPidAlive(prev.pid)) return
    mkdirSync(resolve(dir, ".minicode"), { recursive: true })
    writeFileSync(
      markerPath(dir),
      JSON.stringify({ sessionId, pid: process.pid, startedAt: Date.now() }),
    )
  } catch {}
}

/** Hapus marker — hanya bila milik sesi ini. Tak pernah melempar. */
export function clearTurnActive(cwd: string | undefined, sessionId: string): void {
  try {
    const dir = cwd ?? "."
    const prev = readMarker(dir)
    if (!prev || prev.sessionId !== sessionId) return
    rmSync(markerPath(dir), { force: true })
  } catch {}
}

/**
 * Cek marker yatim saat startup: ada + bukan milik sesi ini + pid mati.
 * Return info untuk notice, atau null bila bersih/ada pemilik hidup.
 * Tak pernah melempar; tak menghapus (penghapusan eksplisit via clear).
 */
export function checkStaleTurn(cwd: string | undefined, sessionId: string): TurnMarker | null {
  try {
    const prev = readMarker(cwd ?? ".")
    if (!prev || prev.sessionId === sessionId) return null
    if (isPidAlive(prev.pid)) return null
    return prev
  } catch {
    return null
  }
}

/** Hapus marker yatim yang sudah dilaporkan. Tak pernah melempar. */
export function clearStaleTurn(cwd: string | undefined, sessionId: string): void {
  try {
    const prev = readMarker(cwd ?? ".")
    if (!prev || prev.sessionId === sessionId) return
    if (isPidAlive(prev.pid)) return
    rmSync(markerPath(cwd ?? "."), { force: true })
  } catch {}
}

/** Satu baris notice English-only untuk marker yatim. Murni, teruji. */
export function formatStaleNotice(info: TurnMarker): string {
  const ageMs = Math.max(0, Date.now() - info.startedAt)
  let age: string
  if (ageMs < 60_000) age = `${Math.floor(ageMs / 1000)}s`
  else if (ageMs < 3600_000)
    age = `${Math.floor(ageMs / 60000)}m${String(Math.floor((ageMs % 60000) / 1000)).padStart(2, "0")}s`
  else
    age = `${Math.floor(ageMs / 3600000)}h${String(Math.floor((ageMs % 3600000) / 60000)).padStart(2, "0")}m`
  return (
    `[recovery] previous turn (session ${info.sessionId}, started ${age} ago) ` +
    `did not settle cleanly — possible crash or kill. ` +
    `Check /status, then /resume to continue or /undo to revert.`
  )
}
