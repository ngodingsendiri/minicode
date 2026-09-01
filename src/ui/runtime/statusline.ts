// Koordinasi status-line vs output lain: sebelum menulis baris biasa,
// status spinner di-suspend agar tidak tertinggal fragmen \r di scrollback.
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
