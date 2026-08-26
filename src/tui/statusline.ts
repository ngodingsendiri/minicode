// Koordinasi status-line vs output lain: sebelum menulis baris biasa,
// status spinner di-suspend agar tidak tertinggal fragmen \r di scrollback.
type StatusHandle = { suspend(): void; resume(): void }

let active: StatusHandle | null = null

export function registerStatusLine(h: StatusHandle | null): void {
  active = h
}

export function runWithoutStatus<T>(fn: () => T): T {
  if (!active) return fn()
  active.suspend()
  try {
    return fn()
  } finally {
    active.resume()
  }
}
