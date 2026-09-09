// Koordinasi status-line vs output lain + arbitrase SEMUA penulis transient
// stderr (garis status turn & spinner wizard) terhadap penulis asing.
//
// Dua masalah yang diselesaikan:
// 1. Sebelum menulis baris biasa, status spinner di-suspend agar tidak
//    tertinggal fragmen \r di scrollback (mekanisme lama, tetap di bawah).
// 2. Penulis asing (non-UI: router/providers/tool warnings, dsb.) yang menulis
//    MENTAH ke stderr saat painter transient sedang melukis akan (a) menempel
//    di tengah baris transient lalu (b) terhapus oleh tick berikutnya — pesan
//    diagnostik HILANG. Arbitrase: saat ada owner transient aktif, tulis asing
//    dikomit sebagai baris permanen yang bersih (hapus garis transient →
//    tulis → repaint), jadi tidak ada pesan yang hilang dan tidak ada fragmen.
//
// Lapisan: modul ini hanya UI (src/ui). Penulis non-UI tidak bisa impor ke
// sini (batas dependensi), jadi mereka tidak diubah — justru MEKANISME di sini
// yang membuat tulis mentah mereka aman tanpa mereka sadari.

type PaintOwner = { kind: string; paintNow(): void }
let owner: PaintOwner | null = null
let ownerWriting = false
let bound: RawWrite | null = null
let ourWrite: ((chunk: string | Uint8Array, ...rest: never[]) => boolean) | null = null
const warnedOverlap = new Set<string>()

// Pasang wrapper stderr HANYA bila owner transient pertama muncul. Wrapper
// inert (forward apa adanya) saat tidak ada owner — overhead nol untuk semua
// tulis biasa, dan identitas write yang di-patch harness test tetap dihormati
// (re-wrap bila property sudah diganti di antara dua acquire).
type RawWrite = (chunk: string | Uint8Array, ...rest: never[]) => boolean
function ensureWrap(): void {
  const cur = process.stderr.write
  if (ourWrite && (cur as unknown) === ourWrite) return
  bound = process.stderr.write.bind(process.stderr) as RawWrite
  ourWrite = ((chunk: string | Uint8Array, ...rest: never[]) => {
    if (ownerWriting || !owner) return bound!(chunk, ...rest)
    // Tulis ASING saat garis transient aktif: komit sebagai baris permanen.
    ownerWriting = true
    try {
      bound!("\r\x1b[2K")
    } finally {
      ownerWriting = false
    }
    const r = bound!(chunk, ...rest)
    try {
      owner.paintNow()
    } catch {
      // Painter yang error tidak boleh menggagalkan tulis asing.
    }
    return r
  }) as unknown as typeof process.stderr.write
  process.stderr.write = ourWrite
}

/** Tulis internal milik painter aktif (tanpa aturan "asing" di atas). */
export function paintWrite(s: string): void {
  ownerWriting = true
  try {
    // Pakai sink yang MASIH terpasang: bila wrapper sudah diganti/di-restore
    // (mis. antar test), painter zombie tidak boleh menulis ke buffer milik
    // sesi/harness lain.
    const cur = process.stderr.write
    if (ourWrite && (cur as unknown) === ourWrite && bound) bound(s)
    else cur(s)
  } finally {
    ownerWriting = false
  }
}
export interface TransientPaint {
  kind: string
  release(): void
}

// Token per klaim: release hanya membatalkan klaim MILIKNYA. Tanpa token,
// klaim kedua ber-kind sama lalu release akan mencabut klaim pemilik pertama
// (owner global null padahal pemilik asli masih hidup).
let seq = 0
type Claim = PaintOwner & { token: number }

/**
 * Klaim kepemilikan transient stderr. Satu owner pada satu waktu; owner kedua
 * dengan kind berbeda TIDAK ditolak (fail-safe: rendering tetap jalan) tapi
 * dicatat sekali lewat paintWrite — invariant mutual exclusion turn-painter vs
 * wizard-spinner di-enforce sebagai signal, bukan crash produksi.
 */
export function acquireTransientPaint(kind: string, paintNow: () => void): TransientPaint {
  ensureWrap()
  if (owner && owner.kind !== kind) {
    const key = `${owner.kind}->${kind}`
    if (!warnedOverlap.has(key)) {
      warnedOverlap.add(key)
      paintWrite(`[transient-paint] ${kind} starts while ${owner.kind} active (overlap)\n`)
    }
  }
  const claim: Claim = { kind, token: ++seq, paintNow }
  owner = claim
  return {
    kind,
    release() {
      if (owner === claim) owner = null
    },
  }
}

/** Sedang ada garis transient yang melukis? (dipakai guard/test) */
export function isTransientPainting(): boolean {
  return owner !== null
}

// ── Mekanisme lama: koordinasi suspend/resume status-line vs output UI ──
type StatusHandle = { suspend(): void; resume(): void }

let active: StatusHandle | null = null
let suspendDepth = 0

export function registerStatusLine(h: StatusHandle | null): void {
  active = h
  // Handle baru berarti lifecycle lama selesai — depth lama tidak relevan.
  suspendDepth = 0
}

export function runWithoutStatus<T>(fn: () => T): T {
  const handle = active
  if (!handle) return fn()

  // Waktu nested write terjadi, suspend/resume cukup sekali di level terluar
  // agar status line tidak flicker dan tidak melakukan repaint berulang.
  if (suspendDepth === 0) handle.suspend()
  suspendDepth++
  try {
    return fn()
  } finally {
    suspendDepth = Math.max(0, suspendDepth - 1)
    if (suspendDepth === 0 && active === handle) handle.resume()
  }
}
