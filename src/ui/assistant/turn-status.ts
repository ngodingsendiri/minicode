import type { UiBus } from "../contract.ts"
import { c, glyphs } from "../render/theme.ts"
import { displayWidth, truncateToWidth } from "../render/width.ts"
import { acquireTransientPaint, paintWrite, registerStatusLine } from "../runtime/statusline.ts"

// Turn status line — satu baris transient di stderr, hidup hanya pada fase
// turn yang TIDAK memproduksi teks (berpikir / tool berjalan). Teks model
// adalah output utama; garis status tidak pernah menimpa area teks.
//
// Garis SELALU membawa elapsed timer (`Thinking··· 1m23s`) — heartbeat yang
// membedakan "masih jalan" dari "mati diam-diam" (provider stall, hang,
// atau crash proses). Tanpa ini user tak bisa bedakan turn lambat vs mati.
//
// Lifecycle deterministik:
//   turn:started          → state nyala, BELUM melukis. Lukisan baru mulai
//                           pada reasoning/execution pertama — jendela
//                           sebelum event pertama (mis. catatan [router] di
//                           awal stream) dibiarkan polos agar tidak ada tulis
//                           asing yang bisa tertimpa/terhapus garis ini.
//   reasoning (extension) → "Thinking"
//   execution:started     → label kerja nyata (nama tool + target)
//   provider:text         → garis HILANG (teks mengalir)
//   execution:completed   → kembali "Thinking" bila masih fase sunyi
//   turn:completed        → bersih + reset
//   endTurn()             → bersih + reset, DIPANGGIL DRIVER setelah turn
//                           settle apa pun (kernel TIDAK emit turn:completed
//                           pada gagal/abort — tanpa ini garis status basi
//                           melukis di atas prompt idle setelah error/Ctrl+C)
// Output lain memakai runWithoutStatus() (suspend sesaat → resume bila aturan
// masih terpenuhi), jadi garis tidak pernah tertinggal di scrollback.
export interface TurnStatusHandle {
  detach(): void
  /** Bersihkan + reset garis; aman dipanggil kapan pun (idempotent). */
  endTurn(): void
}

/** Durasi ringkas untuk heartbeat (`12s`, `1m23s`, `2h05m`). Murni, teruji. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`
}

export function attachTurnStatus(
  bus: UiBus,
  opts: {
    initialModel?: string
    getModel?: () => string | undefined
    /**
     * Teks statistik tambahan (mis. token/biaya sesi) — DI dari composition
     * root agar UI tak perlu impor lapisan policy/usage. Undefined = mati
     * (default hemat: shell tetap bersih).
     */
    getStats?: () => string | undefined
  } = {},
): TurnStatusHandle {
  if (!process.stderr.isTTY) return { detach: () => {}, endTurn: () => {} }
  const isWinLegacy =
    process.platform === "win32" &&
    !(
      process.env.WT_SESSION ||
      process.env.TERM_PROGRAM ||
      process.env.ANSICON ||
      process.env.ConEmuANSI
    )
  if (isWinLegacy) return { detach: () => {}, endTurn: () => {} }

  let intervalId: ReturnType<typeof setInterval> | undefined
  let fi = 0
  // State mesin garis — interval hanya menulis ulang label terkini.
  let turnOn = false
  let textOn = false
  let label = "Thinking"
  // Awal turn untuk heartbeat elapsed. Null = tak ada turn aktif.
  let turnStartMs: number | null = null
  // Kepemilikan transient stderr selama interval hidup — lihat statusline.ts.
  let owned: { release(): void } | null = null

  const shouldPaint = (): boolean => turnOn && !textOn
  const paint = () => {
    let extra = ""
    try {
      const s = opts.getStats?.()
      if (s) extra = ` · ${s}`
    } catch {}
    // Titik animasi eksplisit · → ·· → ···, ganti tiap 2 tick (~300ms):
    // sinyal "masih hidup" yang tak ambigu. Denyut redup sebelumnya terbaca
    // beku/mati di sebagian terminal. Tak pernah bare: selalu ≥1 titik.
    const dots = glyphs.dot.repeat(1 + (Math.floor(fi / 2) % 3))
    const cols = process.stdout.columns || 80
    const body =
      label === "Thinking"
        ? `Thinking${dots}`
        : `${c.info(glyphs.spinnerFrames[fi % glyphs.spinnerFrames.length]!)} ${label}${dots}`
    const full =
      body + (turnStartMs != null ? ` · ${formatElapsed(Date.now() - turnStartMs)}` : "") + extra
    // Terminal sangat sempit: potongan label bisa tinggal 1 huruf ("t") —
    // dalam kasus itu tampilkan titiknya saja daripada label rusak.
    // Terminal normal: potong biasa (label terpotong tetap informatif).
    const maxW = Math.max(4, cols - 1)
    const shown =
      displayWidth(full) <= maxW ? full : maxW <= 12 ? dots : truncateToWidth(full, maxW)
    paintWrite(`\r\x1b[2K${shown}`)
    fi++
  }
  const stopPaint = () => {
    if (owned) {
      owned.release()
      owned = null
    }
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = undefined
    }
    paintWrite("\r\x1b[2K")
  }
  const startPaint = (next: string) => {
    label = next
    if (!shouldPaint()) return
    if (!intervalId) {
      fi = 0
      // Repaint segera setelah tulis asing dikomit (lihat statusline.ts).
      owned = acquireTransientPaint("turn", () => {
        if (shouldPaint()) startPaint(label)
      })
      paint()
      intervalId = setInterval(paint, 150)
    } else paint()
  }
  const resetTurn = () => {
    turnOn = false
    textOn = false
    label = "Thinking"
    turnStartMs = null
    stopPaint()
  }

  // Dipakai renderer via runWithoutStatus: hentikan repaint sebentar, lalu
  // hidupkan lagi bila aturan masih terpenuhi. Saat garis SEDANG TIDAK melukis
  // (mis. teks mengalir), suspend tidak menulis apa pun — \r\x1b[2K yang
  // serampangan bisa memotong baris parsial milik penulis lain.
  let paused = false
  const handle = {
    suspend() {
      paused = !!intervalId
      if (intervalId) stopPaint()
    },
    resume() {
      if (paused && shouldPaint()) startPaint(label)
      paused = false
    },
  }
  registerStatusLine(handle)

  const toolLabel = (e: { execution: { call: { name: string; args?: unknown } } }): string => {
    const name = e.execution.call.name
    const args = (e.execution.call.args ?? {}) as Record<string, unknown>
    let target = ""
    if (typeof args.path === "string") target = args.path
    else if (typeof args.file === "string") target = args.file
    else if (typeof args.cmd === "string") target = args.cmd.slice(0, 80)
    else if (typeof args.command === "string") target = args.command.slice(0, 80)
    // Potong panjang (bukan lebar) di sini; pemotongan LEBAR terjadi per-paint
    // agar resize langsung berefek.
    const label2 = target ? `${name} ${target}` : name
    return label2.length > 200 ? label2.slice(0, 200) : label2
  }

  const detach = [
    bus.on("turn:started", () => {
      turnOn = true
      textOn = false
      label = "Thinking"
      turnStartMs = Date.now()
      // Sengaja tidak langsung melukis — lihat komentar lifecycle di atas.
    }),
    bus.on("provider:text", () => {
      // Teks model = output utama; garis status tidak boleh menimpa area teks.
      textOn = true
      stopPaint()
    }),
    bus.on("provider:extension", (e: { kind: string }) => {
      if (e.kind === "reasoning") {
        textOn = false
        startPaint("Thinking")
      } else if (e.kind === "error") stopPaint()
    }),
    bus.on("execution:started", (e: { execution: { call: { name: string; args?: unknown } } }) => {
      textOn = false
      startPaint(toolLabel(e))
    }),
    bus.on("execution:completed", () => {
      // Tool selesai: kembali ke "Thinking" selama model belum mengeluarkan teks.
      if (shouldPaint()) startPaint("Thinking")
    }),
    bus.on("turn:completed", resetTurn),
  ]

  return {
    endTurn: resetTurn,
    detach: () => {
      resetTurn()
      registerStatusLine(null)
      for (const d of detach) d()
    },
  }
}
