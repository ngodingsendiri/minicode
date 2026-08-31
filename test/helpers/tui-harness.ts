// Harness TUI — fake TTY untuk menguji lapisan interaktif tanpa terminal nyata.
//
// Kenapa ada: `attachFullscreenMinimal`, `askLine`, `runPicker`, `runPanel`, dan
// `runProviderManager` semuanya menulis langsung ke process.stdout dan membaca
// process.stdin dalam raw mode. Tanpa harness, satu-satunya cara mengujinya
// adalah manual — dan itulah sebabnya bug rekursi spinner (REPL mati bisu pada
// prompt pertama) lolos ke main tanpa satu test pun menangkapnya.
//
// Cara pakai:
//   const tty = installFakeTty({ columns: 100, rows: 30 })
//   const shell = attachFullscreenMinimal({ ... })
//   await tty.send("/help")          // suntik keystroke
//   tty.lastFrame()                   // frame full-repaint terakhir (dengan ANSI)
//   tty.visibleFrame()                // frame tanpa ANSI, untuk assertion teks
//   tty.restore()                     // WAJIB di afterEach
//
// Catatan: setiap fungsi UI memanggil setRawMode/resume/pause pada stdin, jadi
// stub harus menyediakannya. `on("data")` mengumpulkan listener supaya send()
// bisa memanggilnya persis seperti Node memanggil saat ada input.

import { stripAnsi } from "../../src/tui/theme.ts"

export interface FakeTtyOptions {
  columns?: number
  rows?: number
  /** Simulasi non-TTY (untuk menguji fallback pipe/CI). */
  isTTY?: boolean
  /** Set false untuk membiarkan deteksi warna apa adanya (default: paksa truecolor). */
  color?: boolean
  /** Set false untuk mensimulasikan terminal TANPA dukungan VT (TERM=dumb). */
  vt?: boolean
  /** Set true untuk memaksa glyph ASCII (konsol Windows legacy). */
  ascii?: boolean
}

export interface FakeTty {
  /**
   * Tunggu sampai komponen memasang listener stdin.
   *
   * `askLine` dan `runProviderManager` melakukan `await` (dynamic import,
   * loadHistory, loadConfig) sebelum memasang listener. Mengirim keystroke
   * sebelum itu membuat input hilang tanpa jejak — test lolos/gagal tergantung
   * timing mesin. Selalu `await tty.ready()` setelah memanggil komponen async.
   */
  ready(timeoutMs?: number): Promise<void>
  /**
   * Berapa kali listener stdin sudah dipasang sejak harness dibuat.
   *
   * Dipakai untuk mendeteksi siklus suspend→resume: `runProviderManager`
   * melepas listener-nya, membiarkan `askLine`/`askSecret` memasang listener
   * sendiri, lalu memasangnya kembali. Setiap pemasangan menaikkan angka ini,
   * jadi ia berfungsi sebagai "prompt ke-berapa".
   */
  listenerEpoch(): number
  /** Tunggu sampai listener stdin BARU terpasang (epoch melewati `since`). */
  waitForNewListener(since: number, timeoutMs?: number): Promise<number>
  /**
   * Jawab prompt berurutan.
   *
   * Setiap kali komponen memasang listener stdin baru, jawaban berikutnya
   * dikirim (diakhiri Enter). Panggil SEBELUM keystroke yang memicu rangkaian
   * prompt, lalu `await` hasilnya:
   *
   *   const seq = tty.answerSequence(["0", "sk-key", "n"])
   *   await tty.send("a")
   *   await seq
   *
   * Tanpa ini, alur a/d/e di `provider-manager` tidak bisa diuji sama sekali:
   * `send()` hanya mengirim ke listener yang ada SEKARANG, sementara prompt
   * berikutnya baru memasang listener setelah yang sebelumnya selesai.
   */
  answerSequence(answers: string[], opts?: { timeoutMs?: number; settleMs?: number }): Promise<void>
  /** Kirim byte ke semua listener stdin, lalu beri kesempatan microtask jalan. */
  send(data: string | Uint8Array, settleMs?: number): Promise<void>
  /** Semua chunk yang ditulis ke stdout, apa adanya. */
  chunks(): string[]
  /** Semua output stdout digabung. */
  all(): string
  /**
   * Output stderr digabung. Renderer one-shot menulis ringkasan tool, error, dan
   * reasoning ke stderr (supaya stdout tetap bersih untuk pipe), jadi assertion
   * atasnya butuh aliran terpisah.
   */
  allErr(): string
  /** stdout + stderr digabung, urut sesuai penulisan. */
  combined(): string
  /**
   * Frame full-repaint terakhir. Fullscreen menulis satu string per render yang
   * dimulai dengan ESC[H ESC[2J — itu penanda batas frame.
   */
  lastFrame(): string
  /** lastFrame() tanpa sekuens ANSI, siap di-assert sebagai teks. */
  visibleFrame(): string
  /** Baris non-kosong dari visibleFrame(), untuk assertion yang toleran layout. */
  visibleLines(): string[]
  /** Buang riwayat output — dipakai untuk mengisolasi frame per langkah. */
  clear(): void
  /** Ubah ukuran terminal dan picu event resize. */
  resize(columns: number, rows: number): void
  /** Rejection/exception yang tertangkap selama test. Harus kosong. */
  failures(): string[]
  restore(): void
}

export function installFakeTty(opts: FakeTtyOptions = {}): FakeTty {
  const columns = opts.columns ?? 100
  const rows = opts.rows ?? 30
  const isTTY = opts.isTTY ?? true

  const chunks: string[] = []
  const errChunks: string[] = []
  const combinedChunks: string[] = []
  const dataListeners: ((chunk: Buffer) => void)[] = []
  const resizeListeners: (() => void)[] = []
  const failures: string[] = []
  // Naik setiap kali listener "data" dipasang. Tidak pernah turun — dipakai
  // sebagai jam logis untuk mendeteksi prompt berikutnya (lihat answerSequence).
  let listenerEpoch = 0

  const origStdin = process.stdin
  const origWrite = process.stdout.write.bind(process.stdout)
  const origErrWrite = process.stderr.write.bind(process.stderr)
  const origLog = console.log
  const origError = console.error
  const origColumns = process.stdout.columns
  const origRows = process.stdout.rows
  const origStdoutIsTty = process.stdout.isTTY
  const origStderrIsTty = process.stderr.isTTY
  const origColorterm = process.env.COLORTERM
  const origNoColor = process.env.NO_COLOR
  const origTerm = process.env.TERM
  const origWtSession = process.env.WT_SESSION
  const origAscii = process.env.MINICODE_ASCII
  const origStdoutOn = process.stdout.on.bind(process.stdout)
  const origStdoutOff = process.stdout.off.bind(process.stdout)
  const origStdoutRemove = process.stdout.removeListener.bind(process.stdout)

  const onFailure = (e: unknown) => {
    const err = e as { message?: string } | undefined
    failures.push(String(err?.message ?? e))
  }
  process.on("unhandledRejection", onFailure)
  process.on("uncaughtException", onFailure)

  const fakeStdin = {
    isTTY,
    setRawMode() {
      return fakeStdin
    },
    resume() {
      return fakeStdin
    },
    pause() {
      return fakeStdin
    },
    setEncoding() {
      return fakeStdin
    },
    setMaxListeners() {
      return fakeStdin
    },
    on(event: string, fn: (chunk: Buffer) => void) {
      if (event === "data") {
        dataListeners.push(fn)
        listenerEpoch++
      }
      return fakeStdin
    },
    once(event: string, fn: (chunk: Buffer) => void) {
      return fakeStdin.on(event, fn)
    },
    off(event: string, fn: (chunk: Buffer) => void) {
      if (event === "data") {
        const i = dataListeners.indexOf(fn)
        if (i >= 0) dataListeners.splice(i, 1)
      }
      return fakeStdin
    },
    removeListener(event: string, fn: (chunk: Buffer) => void) {
      return fakeStdin.off(event, fn)
    },
    removeAllListeners() {
      dataListeners.length = 0
      return fakeStdin
    },
  }

  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })
  Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true })
  Object.defineProperty(process.stdout, "rows", { value: rows, configurable: true })
  // Renderer memakai deteksi warna dari env + isTTY. Runner test biasanya bukan
  // TTY, jadi tanpa ini semua warna dimatikan dan assertion warna jadi tak ada
  // artinya. Paksa truecolor supaya yang diuji adalah keluaran terminal nyata.
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true })
  Object.defineProperty(process.stderr, "isTTY", { value: isTTY, configurable: true })
  if (opts.color !== false) {
    process.env.COLORTERM = "truecolor"
    delete process.env.NO_COLOR
  }
  // src/tui/minimal/screen.ts memeriksa dukungan VT sebelum menulis sekuens,
  // dan src/tui/theme.ts memeriksa dukungan UTF-8 untuk memilih glyph. Fake TTY
  // harus tampak seperti terminal modern, kalau tidak assertion gagal karena
  // alasan yang salah (sekuens tidak ditulis, glyph jadi ASCII).
  if (opts.vt !== false && isTTY) {
    process.env.TERM = process.env.TERM || "xterm-256color"
    process.env.WT_SESSION = process.env.WT_SESSION || "fake-tty"
  }
  if (opts.ascii === true) process.env.MINICODE_ASCII = "1"
  ;(process.stdout as unknown as { write: unknown }).write = (chunk: string | Uint8Array) => {
    const s = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    chunks.push(s)
    combinedChunks.push(s)
    return true
  }
  ;(process.stderr as unknown as { write: unknown }).write = (chunk: string | Uint8Array) => {
    const s = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    errChunks.push(s)
    combinedChunks.push(s)
    return true
  }
  // Di Bun, console.log TIDAK melewati process.stdout.write — ia menulis ke fd 1
  // langsung. Jadi menambal write saja membuat jalur fallback non-TTY (yang
  // memakai console.log) tampak tidak menghasilkan apa-apa.
  console.log = (...args: unknown[]) => {
    const s = `${args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")}\n`
    chunks.push(s)
    combinedChunks.push(s)
  }
  console.error = (...args: unknown[]) => {
    const s = `${args.map((a) => (typeof a === "string" ? a : String(a))).join(" ")}\n`
    errChunks.push(s)
    combinedChunks.push(s)
  }
  // Beberapa komponen mendengarkan "resize" pada stdout; tangkap tanpa
  // mengganggu listener asli milik test runner.
  ;(process.stdout as unknown as { on: unknown }).on = (event: string, fn: () => void) => {
    if (event === "resize") {
      resizeListeners.push(fn)
      return process.stdout
    }
    return origStdoutOn(event as never, fn as never)
  }
  const dropResize = (event: string, fn: () => void) => {
    if (event === "resize") {
      const i = resizeListeners.indexOf(fn)
      if (i >= 0) resizeListeners.splice(i, 1)
      return process.stdout
    }
    return origStdoutOff(event as never, fn as never)
  }
  ;(process.stdout as unknown as { off: unknown }).off = dropResize
  ;(process.stdout as unknown as { removeListener: unknown }).removeListener = dropResize

  const FRAME_MARK = "\x1b[H\x1b[2J"

  const tty: FakeTty = {
    async ready(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      while (dataListeners.length === 0) {
        if (Date.now() > deadline) {
          throw new Error("fake tty: tidak ada listener stdin terpasang dalam batas waktu")
        }
        await new Promise((r) => setTimeout(r, 5))
      }
      // Satu tick ekstra: komponen umumnya render() setelah memasang listener.
      await new Promise((r) => setTimeout(r, 5))
    },
    async send(data, settleMs = 15) {
      const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)
      for (const fn of [...dataListeners]) fn(buf)
      await new Promise((r) => setTimeout(r, settleMs))
    },
    listenerEpoch: () => listenerEpoch,
    async waitForNewListener(since, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs
      while (listenerEpoch <= since) {
        if (Date.now() > deadline) {
          throw new Error(
            `fake tty: tidak ada listener stdin baru dalam ${timeoutMs}ms (epoch tetap ${listenerEpoch})`,
          )
        }
        await new Promise((r) => setTimeout(r, 5))
      }
      // Satu tick: komponen menulis prompt-nya setelah memasang listener.
      await new Promise((r) => setTimeout(r, 5))
      return listenerEpoch
    },
    async answerSequence(answers, opts = {}) {
      const timeoutMs = opts.timeoutMs ?? 2000
      const settleMs = opts.settleMs ?? 15
      let epoch = listenerEpoch
      for (const answer of answers) {
        epoch = await tty.waitForNewListener(epoch, timeoutMs)
        // Karakter dikirim menyatu dengan Enter: askLine/askSecret keduanya
        // memproses seluruh chunk per byte, jadi ini setara dengan mengetik.
        await tty.send(`${answer}\r`, settleMs)
      }
    },
    chunks: () => [...chunks],
    all: () => chunks.join(""),
    allErr: () => errChunks.join(""),
    combined: () => combinedChunks.join(""),
    lastFrame() {
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i]!.includes(FRAME_MARK)) return chunks[i]!
      }
      return chunks.at(-1) ?? ""
    },
    visibleFrame() {
      return stripAnsi(tty.lastFrame())
    },
    visibleLines() {
      return tty
        .visibleFrame()
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .filter((l) => l !== "")
    },
    clear() {
      chunks.length = 0
      errChunks.length = 0
      combinedChunks.length = 0
    },
    resize(nextColumns, nextRows) {
      Object.defineProperty(process.stdout, "columns", {
        value: nextColumns,
        configurable: true,
      })
      Object.defineProperty(process.stdout, "rows", { value: nextRows, configurable: true })
      for (const fn of [...resizeListeners]) fn()
    },
    failures: () => [...failures],
    restore() {
      process.off("unhandledRejection", onFailure)
      process.off("uncaughtException", onFailure)
      Object.defineProperty(process, "stdin", { value: origStdin, configurable: true })
      Object.defineProperty(process.stdout, "columns", {
        value: origColumns,
        configurable: true,
      })
      Object.defineProperty(process.stdout, "rows", { value: origRows, configurable: true })
      Object.defineProperty(process.stdout, "isTTY", {
        value: origStdoutIsTty,
        configurable: true,
      })
      Object.defineProperty(process.stderr, "isTTY", {
        value: origStderrIsTty,
        configurable: true,
      })
      if (origColorterm == null) delete process.env.COLORTERM
      else process.env.COLORTERM = origColorterm
      if (origNoColor == null) delete process.env.NO_COLOR
      else process.env.NO_COLOR = origNoColor
      if (origTerm == null) delete process.env.TERM
      else process.env.TERM = origTerm
      if (origWtSession == null) delete process.env.WT_SESSION
      else process.env.WT_SESSION = origWtSession
      if (origAscii == null) delete process.env.MINICODE_ASCII
      else process.env.MINICODE_ASCII = origAscii
      ;(process.stdout as unknown as { write: unknown }).write = origWrite
      ;(process.stderr as unknown as { write: unknown }).write = origErrWrite
      console.log = origLog
      console.error = origError
      ;(process.stdout as unknown as { on: unknown }).on = origStdoutOn
      ;(process.stdout as unknown as { off: unknown }).off = origStdoutOff
      ;(process.stdout as unknown as { removeListener: unknown }).removeListener = origStdoutRemove
      dataListeners.length = 0
      resizeListeners.length = 0
      listenerEpoch = 0
    },
  }
  return tty
}

// ── EventBus tiruan ──
// Kernel EventBus punya API on(type, handler) -> unsubscribe. Renderer hanya
// memakai itu, jadi stub ini cukup dan tidak menarik seluruh kernel ke test.
export interface FakeBus {
  on(type: string, fn: (e: unknown) => void): () => void
  emit(type: string, event: unknown): void
  listenerCount(type: string): number
}

export function createFakeBus(): FakeBus {
  const handlers = new Map<string, ((e: unknown) => void)[]>()
  return {
    on(type, fn) {
      const arr = handlers.get(type) ?? []
      arr.push(fn)
      handlers.set(type, arr)
      return () => {
        const cur = handlers.get(type)
        if (!cur) return
        const i = cur.indexOf(fn)
        if (i >= 0) cur.splice(i, 1)
      }
    },
    emit(type, event) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn(event)
    },
    listenerCount: (type) => (handlers.get(type) ?? []).length,
  }
}

// ── Keystroke: nama simbolis supaya test terbaca ──
export const KEY = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  homeVt: "\x1b[1~",
  endVt: "\x1b[4~",
  enter: "\r",
  tab: "\t",
  shiftTab: "\x1b[Z",
  esc: "\x1b",
  backspace: "\x7f",
  ctrlA: "\x01",
  ctrlC: "\x03",
  ctrlD: "\x04",
  ctrlE: "\x05",
  ctrlO: "\x0f",
  ctrlR: "\x12",
  ctrlU: "\x15",
  ctrlW: "\x17",
  /** Klik mouse mode X10: ESC [ M + tombol + kolom + baris. */
  mouseClick: "\x1b[M\x20\x30\x30",
  paste: (text: string) => `\x1b[200~${text}\x1b[201~`,
} as const
