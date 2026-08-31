// Fullscreen minimal — alternate-screen REPL tanpa Ink/React, pure ANSI
// Header 1 baris · transcript ring 200 · status dots · input + dropdown · footer
import type { EventBus } from "#minicore/core/index.ts"
import {
  applyKey,
  decodeKeys,
  type PromptState,
  pointLength,
} from "../../../src/ui/input/prompt-engine.ts"
import { renderDiffCard } from "../../ui/render/diff.ts"
import { decorateMarkdown } from "../../ui/render/markdown.ts"
import { formatUsd } from "../../ui/render/money.ts"
import { reasoning, setReasoningVisible } from "../../ui/render/reasoning.ts"
import { sanitizeAnsi, sanitizeAnsiLine } from "../../ui/render/sanitize.ts"
import { c, glyphs, stripAnsi } from "../../ui/render/theme.ts"
import { displayWidth, truncateToWidth } from "../../ui/render/width.ts"
import {
  disableBracketedPaste,
  enableBracketedPaste,
  enterAlternate,
  exitAlternate,
  getSize,
  hideCursor,
  onResize,
  showCursor,
} from "../../ui/runtime/screen.ts"
import { formatProviderError } from "../format.ts"
import { formatError } from "./simple.ts"

const RING_MAX = 60
// Glyph memakai fallback ASCII dari theme.ts: conhost Windows lama tanpa UTF-8
// menampilkan "·" dan "›" sebagai kotak. glyphs sudah menyediakan "." dan ">".
//
// FUNGSI, bukan konstanta: `glyphs` adalah getter yang memeriksa dukungan UTF-8
// saat dipakai. Menyimpannya ke `const` di module scope membekukan nilai pada
// saat import — kesalahan yang sama seperti objek warna `c` dulu.
const glyphDot = () => glyphs.dot
const glyphArrow = () => glyphs.arrow
const sep = () => ` ${glyphs.dot} `

/**
 * Potong ke lebar KOLOM terminal, pertahankan sekuens ANSI, tutup atribut.
 *
 * Delegasi ke src/ui/render/width.ts: CJK/emoji memakan dua kolom dan combining mark
 * nol kolom. Versi sebelumnya menghitung code point, sehingga 38 karakter CJK
 * dilaporkan "38 kolom" padahal menempati 73 — baris membungkus sendiri dan
 * frame TUI (yang dihitung per baris) rusak.
 */
export function truncAnsi(s: string, width: number): string {
  return truncateToWidth(s, width)
}

/** Ringkasan token/biaya yang dibaca header — sumbernya usage collector. */
export interface UsageSnapshot {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost?: number
}

interface ExecutionCompletedEvent {
  execution: {
    call: { name: string; args?: unknown }
    result: { isError?: boolean; content?: unknown }
  }
}

export interface TranscriptItem {
  id: number
  kind: "user" | "agent" | "tool" | "error" | "info" | "todo"
  text: string
}

export interface FullscreenMinimalOpts {
  bus: EventBus
  model(): string | undefined
  cwdName: string
  budget?: number
  initialMode: string
  /**
   * Snapshot usage terbaru. Cost TIDAK datang dari event provider — tidak ada
   * provider yang mengirimnya; ia dihitung di usage collector dari tabel harga.
   * Sebelumnya header menunggu `provider:extension usage.cost` yang tak pernah
   * ada, jadi biaya tidak pernah muncul selama sesi interaktif.
   */
  usage(): UsageSnapshot
  onCycleMode(): string
  suggestions(line: string): { text: string; group?: string }[]
  history(): string[]
  onLine(q: string, signal: AbortSignal): Promise<"handled" | "prompt" | { note: string }>
  onPicker(q: string): Promise<{
    title: string
    items: { label: string; value: string }[]
    onPick(v: string): string | void
    onKey?(
      key: string,
      selectedValue?: string,
      openForm?: (label: string, submit: (value: string) => Promise<string | void>) => void,
    ): Promise<string | void> | string | void
  } | null>
  onOverlay(q: string): Promise<{ title: string; lines: string[] } | null>
  onExit(): Promise<void>
}

export function attachFullscreenMinimal(opts: FullscreenMinimalOpts): { detach(): void } {
  // Non-TTY (pipe, CI, wrapper): alternate-screen dan raw mode tidak tersedia.
  // Sebelumnya setRawMode dipanggil tanpa cek dan `minicode --interactive` lewat
  // pipe melempar "setRawMode is not a function" beserta stack trace mentah.
  // Semua komponen lain (askLine/runPicker/runPanel) punya fallback ini.
  if (!process.stdin.isTTY) return attachNonTty(opts)

  let exited = false
  enterAlternate()
  hideCursor()
  enableBracketedPaste()

  let items: TranscriptItem[] = []
  let streamTail: string[] = []
  let busy = false
  let mode = opts.initialMode
  let expanded = false
  let overlay: { title: string; lines: string[] } | null = null
  let overlayScroll = 0
  let picker: {
    title: string
    items: { label: string; value: string }[]
    sel: number
    onPick: (v: string) => string | void
    onKey?: (
      key: string,
      selectedValue?: string,
      openForm?: (label: string, submit: (value: string) => Promise<string | void>) => void,
    ) => Promise<string | void> | string | void
    form?: { label: string; submit: (value: string) => Promise<string | void> }
  } | null = null
  let effModel: string | undefined
  let effProvider: string | undefined
  let line = ""
  let cursor = 0
  let sel = -1
  let menuOpen = false
  let idRef = 0
  let abortRef: AbortController | null = null
  let lastCtrlC = 0
  let histCache: string[] = opts.history()
  let histIdx = -1
  let budgetWarned = false

  const add = (kind: TranscriptItem["kind"], text: string) => {
    items = [...items.slice(-(RING_MAX - 1)), { id: ++idRef, kind, text }]
    render()
  }

  // Kegagalan async yang tak tertangkap dulu membuat layar diam tanpa pesan —
  // user tidak punya cara tahu apa pun terjadi. Tampilkan sebagai baris error.
  const onFailure = (e: unknown) => {
    const err = e as { message?: string } | undefined
    add("error", `kesalahan internal: ${err?.message ?? String(e)}`)
    busy = false
    abortRef = null
  }
  process.on("unhandledRejection", onFailure)
  const offFailure = () => {
    process.off("unhandledRejection", onFailure)
  }

  // bus subscriptions
  const offs: (() => void)[] = []
  offs.push(
    opts.bus.on("provider:text", (e: { text: string }) => {
      // Teks model adalah masukan TIDAK TERPERCAYA. Tanpa sanitasi, ia bisa
      // mengirim ESC[2J (bersihkan layar), ESC[?1049l (keluar dari alternate
      // screen), ESC]0; (ubah judul jendela), atau gerakan kursor yang membuat
      // frame tidak sinkron. Warna tetap lewat — hanya SGR yang diizinkan.
      streamTail = [...streamTail, ...sanitizeAnsi(e.text).split("\n")]
      streamTail = streamTail.slice(-40)
      render()
    }),
  )
  offs.push(
    opts.bus.on("turn:started", () => {
      streamTail = []
      render()
    }),
  )
  offs.push(
    opts.bus.on("provider:extension", (e: { kind: string; data: unknown }) => {
      if (e.kind === "usage") {
        // Biaya TIDAK diambil dari sini — provider hanya mengirim token. Cukup
        // render ulang; header membaca opts.usage() yang menghitung harga.
        render()
      } else if (e.kind === "reasoning") {
        // Konsumen nyata untuk /thinking: tanpa ini toggle tak berefek apa pun.
        if (!reasoning.visible) return
        const d = e.data as { text?: string }
        if (d.text?.trim()) add("info", d.text.trim())
      } else if (e.kind === "effective-model") {
        // 5.2/5.4: router substitusi/fallback → tampilkan model & provider efektif
        const d = e.data as { effective?: string; provider?: string }
        effModel = d.effective
        effProvider = d.provider
        render()
      } else if (e.kind === "error") {
        // Lewat formatter yang sama dengan jalur one-shot: pesan ringkas +
        // saran, bukan body JSON provider utuh di dalam frame 100 kolom.
        const d = e.data as { message?: string; category?: string }
        add("error", formatProviderError(d))
      }
    }),
  )
  offs.push(
    opts.bus.on("execution:completed", (e: ExecutionCompletedEvent) => {
      const name = e.execution.call.name
      const args = (e.execution.call.args ?? {}) as Record<string, unknown>
      const isErr = e.execution.result.isError
      // Hasil tool juga tidak terpercaya: isi berkas, keluaran bash, dan
      // balasan server MCP semuanya bisa memuat sekuens kontrol.
      const resTxt = sanitizeAnsi(String(e.execution.result.content ?? "")).slice(0, 400)
      const target = sanitizeAnsiLine(
        typeof args.path === "string"
          ? (args.path as string)
          : typeof (args.cmd ?? args.command) === "string"
            ? String(args.cmd ?? args.command).slice(0, 50)
            : "",
      )
      if (isErr) {
        add("error", `${name} ${target}: ${resTxt.slice(0, 120)}`)
        return
      }
      if ((name === "edit" || name === "apply_patch") && typeof args.path === "string") {
        const oldS = sanitizeAnsi(String(args.oldString ?? ""))
        const newS = sanitizeAnsi(String(args.newString ?? ""))
        // Diff card berwarna; truncAnsi di render() menjaga warnanya tetap utuh.
        const diffCard = renderDiffCard(target, oldS, newS, { maxLines: 6 })
        add("tool", diffCard)
        return
      }
      // Daftar todo dirender utuh sebagai panel sendiri — ini status rencana
      // kerja yang ingin dilihat user, bukan baris ringkasan satu tool.
      if (name === "todo_write" || name === "todo_read") {
        add("todo", sanitizeAnsi(String(e.execution.result.content ?? "")))
        return
      }
      add("tool", `${name} ${target}`.trim())
    }),
  )
  offs.push(
    opts.bus.on("turn:completed", () => {
      const joined = streamTail.join("\n").trim()
      if (joined) add("agent", joined)
      streamTail = []
      busy = false
      abortRef = null
      checkBudget()
      render()
    }),
  )

  /**
   * Batas biaya sesi. Jalur one-shot sudah memperingatkan di 80% dan berhenti
   * saat lewat; REPL sebelumnya tidak — `budget` diterima lalu di-void, jadi
   * sesi interaktif bisa membakar biaya tanpa satu pun peringatan.
   */
  function overBudget(): boolean {
    const b = opts.budget
    const cost = opts.usage().cost
    return b != null && cost != null && cost > b
  }
  function checkBudget() {
    const b = opts.budget
    const cost = opts.usage().cost
    if (b == null || cost == null) return
    if (cost > b) {
      add(
        "error",
        `biaya sesi ${formatUsd(cost)} melewati batas ${formatUsd(b)} — prompt baru ditolak`,
      )
      return
    }
    if (!budgetWarned && cost > b * 0.8) {
      budgetWarned = true
      add("info", `biaya sesi ${formatUsd(cost)} sudah 80% dari batas ${formatUsd(b)}`)
    }
  }

  const matches = (): string[] =>
    menuOpen || line.startsWith("/")
      ? opts
          .suggestions(line)
          .filter((s) => s.text.toLowerCase().startsWith(line.toLowerCase()))
          .map((s) => s.text)
      : []

  const doInterrupt = () => {
    if (busy && abortRef) {
      abortRef.abort()
      add("info", "(dihentikan)")
      streamTail = []
      busy = false
      abortRef = null
      render()
    }
  }

  const submit = async (raw: string) => {
    const q = raw.trim()
    line = ""
    cursor = 0
    sel = -1
    menuOpen = false
    if (!q) {
      render()
      return
    }
    add("user", q)
    histCache = [...histCache, q].slice(-200)
    histIdx = -1
    if (q === "/exit") return void (await opts.onExit())
    // Batas biaya berlaku juga di REPL: tolak prompt baru, jangan lanjut membakar.
    if (overBudget() && !q.startsWith("/")) {
      add("error", "batas biaya sesi terlampaui — mulai sesi baru atau naikkan --budget")
      render()
      return
    }
    busy = true
    const ctl = new AbortController()
    abortRef = ctl
    render()
    try {
      if (q.startsWith("/")) {
        const cmd = q.slice(1).split(" ")[0]!.toLowerCase()
        if (cmd === "thinking") {
          const next = setReasoningVisible()
          add("info", `tampilan reasoning: ${next ? "aktif" : "nonaktif"}`)
          return
        }
        // Validasi nama SEBELUM menjalankan apa pun. Sebelumnya perintah asing
        // menempuh onPicker → onOverlay (yang mengeksekusi builtin dengan stdout
        // dibajak) baru ditolak — kerja sia-sia untuk salah ketik.
        const spaceIdx = q.indexOf(" ")
        const name = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx)
        if (opts.suggestions(`/${name}`).length === 0) {
          add("info", `perintah tidak dikenal: ${cmd} - ketik /help`)
          return
        }
        const pk = await opts.onPicker(q)
        if (pk) {
          picker = { ...pk, sel: 0 }
          render()
          return
        }
        const ov = await opts.onOverlay(q)
        if (ov) {
          // Isi overlay dibersihkan dari ANSI (berasal dari captureOutput) lalu
          // dipotong per lebar layar; scroll di-reset ke atas.
          overlay = {
            title: ov.title,
            lines: ov.lines.map((l) => stripAnsi(l)),
          }
          overlayScroll = 0
          render()
          return
        }
        const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1)
        const res = await opts.onLine(`/${name}${skillArgs ? " " + skillArgs : ""}`, ctl.signal)
        if (typeof res === "object" && res.note) add("info", res.note)
        return
      }
      const res = await opts.onLine(q, ctl.signal)
      if (typeof res === "object" && res.note) add("info", res.note)
    } catch (e) {
      // Lewat formatter yang sama: `session.run()` melempar ProviderError yang
      // `message`-nya memuat body JSON provider utuh. Menampilkannya mentah
      // menumpahkan 400+ karakter metadata ke frame TUI.
      add("error", formatError(e))
    } finally {
      busy = false
      abortRef = null
      render()
    }
  }

  // render — diff repaint: hanya write bila output berubah (anti flicker)
  let spinnerIdx = 0
  let spinnerTimer: ReturnType<typeof setTimeout> | undefined
  let prevOut = ""
  // Spinner: satu timer, di-set SEBELUM render.
  //
  // Versi sebelumnya memanggil tickSpinner() langsung dari startSpinner(), dan
  // tickSpinner() memanggil render() yang memanggil startSpinner() lagi. Karena
  // spinnerTimer baru terisi SETELAH render() selesai, guard `if (spinnerTimer)`
  // selalu lolos → rekursi tak berbatas → RangeError. Efeknya di layar: REPL
  // mati bisu pada prompt pertama, onLine tidak pernah terpanggil.
  // Dijaga oleh test/tui-fullscreen.test.ts "Enter memanggil onLine tepat sekali".
  const startSpinner = () => {
    if (spinnerTimer) return
    spinnerTimer = setTimeout(tickSpinner, 150)
  }
  const stopSpinner = () => {
    if (spinnerTimer) {
      clearTimeout(spinnerTimer)
      spinnerTimer = undefined
    }
  }
  const tickSpinner = () => {
    spinnerIdx++
    spinnerTimer = undefined // biarkan startSpinner() menjadwalkan tick berikutnya
    render()
  }

  function render() {
    const { width: W, height: H } = getSize()
    if (busy) startSpinner()
    else stopSpinner()
    const m = matches()
    const narrow = W < 80
    // Header memakai 2 baris pada terminal sempit — harus ikut dihitung, kalau
    // tidak frame melebihi tinggi layar dan baris teratas terguling keluar.
    const headerRows = narrow ? 2 : 1
    const pickerLines = picker ? Math.min(picker.items.length, H - 5) : 0
    const menuLines = overlay || picker ? 0 : Math.min(m.length, Math.min(6, Math.floor(H * 0.3)))
    // Kapasitas overlay: total baris frame = header + judul + isi + hint +
    // input + footer. Agar tidak melebihi H: isi <= H - header - 4.
    const overlayCapacity = overlay ? Math.max(1, H - headerRows - 4) : 0
    const overlayLines = overlay ? Math.min(overlay.lines.length, overlayCapacity) : 0
    const bodyH = Math.max(
      1,
      H -
        headerRows -
        (overlay ? overlayLines + 2 : 0) -
        (picker ? pickerLines + 3 : 0) -
        menuLines -
        2 - // input + footer
        (busy ? 1 : 0),
    )

    // Transcript: warna DIPERTAHANKAN.
    //
    // Sebelumnya push() memanggil strip() pada semua isi, sehingga diff card
    // kehilangan hijau/merah dan decorateMarkdown() di bawah ini sia-sia —
    // bold/inline-code/syntax highlight dibuang tepat setelah dibuat.
    // truncAnsi() memotong berdasarkan lebar tampak dan menutup atribut.
    const lines: { c: string; t: string }[] = []
    const push = (color: string, raw: string) => {
      for (const ln of raw.split("\n")) lines.push({ c: color, t: truncAnsi(ln, W - 2) })
    }
    for (const it of items) {
      if (it.kind === "user") push("user", `> ${it.text}`)
      else if (it.kind === "tool")
        push("tool", it.text.includes("\n") ? it.text : `  ${glyphDot()} ${it.text}`)
      else if (it.kind === "error") push("error", `  x ${it.text}`)
      else if (it.kind === "info") push("info", `  ${it.text}`)
      else if (it.kind === "todo") push("todo", it.text)
      else push("", decorateMarkdown(it.text))
    }
    for (const ln of streamTail) push("", decorateMarkdown(ln))
    const tail = lines.slice(Math.max(0, lines.length - bodyH))
    while (tail.length < bodyH) tail.unshift({ c: "", t: "" })

    // build output
    let out = ""
    // header — narrow terminal (<80 cols) → brand di baris 1, model+mode baris 2
    const modeColored =
      mode === "plan" ? c.warning(mode) : mode === "ask" ? c.info(mode) : c.success(mode)
    const thinking = reasoning.visible ? "think:on" : "think:off"
    const dispModel = effModel ?? opts.model() ?? "-"
    const viaTag = effProvider ? ` ${c.muted(`(via ${effProvider})`)}` : ""
    out += `\x1b[H\x1b[2J`
    const headerModel = `${c.yellow(truncAnsi(dispModel, narrow ? Math.max(4, W - 8) : Math.max(20, W - 40)))}${viaTag}`
    const header = narrow
      ? `${c.cyan("minicode")} ${c.muted("-")} ${modeColored}${costTag()} ${c.muted(thinking)}${expanded ? ` ${c.muted("- DETAIL")}` : ""}\n ${headerModel}\n`
      : `${c.cyan("minicode")} ${c.muted("-")} ${headerModel} ${c.muted("-")} ${modeColored}${costTag()} ${c.muted(thinking)}${expanded ? ` ${c.muted("- DETAIL")}` : ""}\n`
    // Header dibangun dari beberapa bagian; potong per baris supaya terminal
    // sangat sempit (mis. 10 kolom) tidak membuatnya membungkus.
    out += header
      .split("\n")
      .map((l) => truncAnsi(l, W))
      .join("\n")

    if (picker) {
      out += `${c.cyan(`- ${picker.title} -`)}\n`
      const start = Math.max(0, picker.sel - bodyH + 3)
      const vis = picker.items.slice(start, start + bodyH - 2)
      for (let i = 0; i < vis.length; i++) {
        const idx = start + i
        const it = vis[i]!
        const isSel = idx === picker.sel
        out +=
          (isSel
            ? `${c.accent(`${glyphArrow()} `)}${c.accent(c.bold(truncAnsi(it.label, W - 6)))}`
            : `  ${truncAnsi(it.label, W - 6)}`) + "\n"
      }
      out += `${c.muted(`[atas/bawah] pilih${sep()}[enter] ok${sep()}[esc] batal`)}\n`
      if (picker.form) out += `${c.accent(picker.form.label)} ${truncAnsi(line, W - 2)}\n`
    } else if (overlay) {
      // Overlay di-SLICE ke kapasitas layar dan bisa di-scroll.
      // Sebelumnya seluruh overlay.lines dicetak apa pun tingginya, sehingga
      // overlay 30 baris di terminal 20 baris menggulingkan judul keluar layar
      // dan tidak ada cara melihat sisanya.
      const maxScroll = Math.max(0, overlay.lines.length - overlayCapacity)
      if (overlayScroll > maxScroll) overlayScroll = maxScroll
      if (overlayScroll < 0) overlayScroll = 0
      const vis = overlay.lines.slice(overlayScroll, overlayScroll + overlayCapacity)
      out += `${c.cyan(`- ${overlay.title} -`)}\n`
      for (const l of vis) out += `${truncAnsi(l, W - 1)}\n`
      const pos =
        maxScroll > 0
          ? `${c.accent(String(overlayScroll + 1))}-${Math.min(
              overlay.lines.length,
              overlayScroll + overlayCapacity,
            )}/${overlay.lines.length}${sep()}[atas/bawah] geser${sep()}`
          : ""
      out += `${c.muted(`${pos}[esc] tutup`)}\n`
    } else {
      for (const l of tail) {
        if (l.c === "user") out += `${c.bold(l.t)}\n`
        else if (l.c === "tool") out += `${c.muted(l.t)}\n`
        else if (l.c === "error") out += `${c.error(l.t)}\n`
        else if (l.c === "info") out += `${c.warning(l.t)}\n`
        else if (l.c === "todo") out += `${c.info(l.t)}\n`
        else out += `${l.t}\n`
      }
      if (busy)
        out += `${c.muted(glyphs.spinnerFrames[spinnerIdx % glyphs.spinnerFrames.length]!)}\n`
      if (menuLines > 0) {
        for (let i = 0; i < Math.min(m.length, menuLines); i++) {
          const t = m[i]!
          const isSel = i === sel
          out +=
            (isSel ? `  ${c.accent(glyphArrow())} ${c.accent(c.bold(t))}` : `    ${c.muted(t)}`) +
            "\n"
        }
      }
    }
    // Modal memiliki frame sendiri. Jangan menggambar prompt chat dan footer
    // global di bawahnya: itulah sumber output ganda seperti `- Models -`, `>`
    // lalu footer chat yang sebelumnya terlihat saat `/model` dibuka.
    if (picker || overlay) {
      if (out.endsWith("\n")) out = out.slice(0, -1)
    } else {
      // input — kursor sungguhan diposisikan setelah frame ditulis, bukan "_" palsu.
      //
      // Semua perhitungan di sini memakai KOLOM, bukan jumlah karakter: satu
      // karakter CJK/emoji memakan dua kolom, jadi jendela geser dan posisi kursor
      // harus menghitungnya. Versi sebelumnya memakai jumlah code point, sehingga
      // prompt berisi CJK menggeser kursor terminal ke tempat yang salah.
      const promptGlyph = "> "
      const promptCols = displayWidth(promptGlyph)
      const avail = Math.max(8, W - promptCols)
      const pts = Array.from(line)
      // Lebar kumulatif tiap posisi kursor (0..len) dalam kolom.
      const colAt: number[] = [0]
      for (const ch of pts) colAt.push(colAt[colAt.length - 1]! + displayWidth(ch))
      const totalCols = colAt[colAt.length - 1]!

      let start = 0
      if (totalCols > avail) {
        // Geser jendela sampai kursor masuk: cari `start` terkecil yang membuat
        // kolom kursor berada dalam `avail`.
        const cursorCols = colAt[Math.min(cursor, pts.length)]!
        while (start < pts.length && cursorCols - colAt[start]! >= avail) start++
      }
      const visibleLine = pts.slice(start, pts.length).join("")
      out += `${c.cyan(promptGlyph)}${truncateToWidth(visibleLine, avail, "")}\n`

      const footerHints = picker
        ? ["enter select", "esc close"]
        : ["ctrl+t thinking", "esc stop", "/help"]
      const u = opts.usage()
      if (u.cost != null && u.cost > 0) {
        footerHints.unshift(
          opts.budget != null
            ? `${formatUsd(u.cost)}/${formatUsd(opts.budget)}`
            : formatUsd(u.cost),
        )
      }
      // Terminal sempit: buang hint dari ekor sampai muat, jangan biarkan wrap.
      let footer = footerHints.join(sep())
      while (displayWidth(footer) > W && footerHints.length > 1) {
        footerHints.pop()
        footer = footerHints.join(sep())
      }
      out += `${c.muted(truncAnsi(footer, W))}`

      // Posisikan kursor pada baris input, kolom sesuai state kursor.
      const frameRows = out.split("\n").length
      const inputRow = frameRows - 1 // 1-based: baris terakhir adalah footer
      const cursorCol =
        promptCols + (colAt[Math.min(cursor, pts.length)]! - colAt[Math.min(start, pts.length)]!)
      out += `\x1b[${Math.max(1, inputRow)};${Math.max(1, cursorCol + 1)}H`
    }

    if (out !== prevOut) {
      process.stdout.write(out)
      prevOut = out
    }
  }

  /** Tag biaya di header; kosong bila belum ada biaya. */
  function costTag(): string {
    const u = opts.usage()
    if (u.cost == null) return ""
    const base = formatUsd(u.cost)
    if (opts.budget == null) return ` ${c.muted(base)}`
    const ratio = u.cost / opts.budget
    const text = `${base}/${formatUsd(opts.budget)}`
    return ` ${ratio >= 1 ? c.error(text) : ratio >= 0.8 ? c.warning(text) : c.muted(text)}`
  }

  // input handling — satu sumber: prompt-engine decodeKeys + applyKey.
  process.stdin.setRawMode(true)
  process.stdin.resume()

  /** Terapkan satu key ke state baris lewat prompt-engine (termasuk kursor). */
  const editLine = (key: Parameters<typeof applyKey>[1], hintRows?: string[]) => {
    const ps: PromptState = { line, cursor, sel, menuOpen }
    const hintsFn = hintRows
      ? () => hintRows
      : (l: string) => opts.suggestions(l).map((s) => s.text)
    const res = applyKey(ps, key, hintsFn)
    line = res.state.line
    cursor = res.state.cursor
    sel = res.state.sel
    menuOpen = res.state.menuOpen
    // matches() memfilter case-insensitive, jadi indeks seleksi harus dijepit
    // ulang terhadap daftar yang benar-benar ditampilkan.
    const m = matches()
    if (sel >= m.length) sel = m.length - 1
    render()
  }

  /** Ganti isi baris (history / pilih dari picker) dan taruh kursor di ujung. */
  const setLine = (text: string) => {
    line = text
    cursor = pointLength(text)
    menuOpen = false
    sel = -1
  }

  const onData = (chunk: Buffer) => {
    const raw = chunk.toString("utf8")
    // shift+tab raw early (before decode)
    if (raw.includes("\x1b[Z")) {
      mode = opts.onCycleMode()
      render()
      return
    }
    const keys = decodeKeys(chunk)
    for (const { key } of keys) {
      // Byte mouse dsb. — dibuang sebelum apa pun menyentuh baris.
      if (key.type === "ignore") continue

      // Ctrl+C
      if (key.type === "ctrl-c") {
        if (busy) {
          doInterrupt()
          return
        }
        const now = Date.now()
        if (now - lastCtrlC < 2000) void opts.onExit()
        else lastCtrlC = now
        return
      }
      // ESC
      if (key.type === "esc") {
        if (picker) {
          picker = null
          render()
          continue
        }
        if (overlay) {
          overlay = null
          overlayScroll = 0
          render()
          continue
        }
        doInterrupt()
        continue
      }
      // picker mode
      if (picker) {
        if (picker.form) {
          const result = applyKey({ line, cursor, sel: -1, menuOpen: false }, key, () => [])
          if (result.action === "cancel") {
            picker.form = undefined
            line = ""
            cursor = 0
            render()
            continue
          }
          if (result.action === "submit") {
            const form = picker.form
            const value = line.trim()
            line = ""
            cursor = 0
            picker.form = undefined
            void form.submit(value).then((message) => {
              if (message) add("info", message)
              render()
            })
            continue
          }
          line = result.state.line
          cursor = result.state.cursor
          render()
          continue
        }
        if (key.type === "up") {
          picker.sel = Math.max(0, picker.sel - 1)
          render()
          continue
        }
        if (key.type === "down") {
          picker.sel = Math.min(picker.items.length - 1, picker.sel + 1)
          render()
          continue
        }
        if (key.type === "enter" || (key.type === "char" && key.ch === " ")) {
          const cur = picker
          const picked = cur.items[cur.sel]
          picker = null
          if (picked) {
            const r = cur.onPick(picked.value)
            if (typeof r === "string") add("info", r)
          }
          render()
          continue
        }
        if (key.type === "char" && picker.onKey) {
          const openForm = (label: string, submit: (value: string) => Promise<string | void>) => {
            picker!.form = { label, submit }
            line = ""
            cursor = 0
            render()
          }
          const action = picker.onKey(key.ch, picker.items[picker.sel]?.value, openForm)
          if (action instanceof Promise) {
            void action.then((message) => {
              if (message) add("info", message)
              render()
            })
          } else if (action) add("info", action)
          continue
        }
        continue
      }
      // overlay mode — panah/PgUp/PgDn menggeser, Enter/q/Esc menutup
      if (overlay) {
        if (key.type === "up") {
          overlayScroll = Math.max(0, overlayScroll - 1)
          render()
          continue
        }
        if (key.type === "down") {
          overlayScroll += 1
          render()
          continue
        }
        if (key.type === "home") {
          overlayScroll = 0
          render()
          continue
        }
        if (key.type === "end") {
          const { width: w, height: hgt } = getSize()
          const cap = Math.max(1, hgt - (w < 80 ? 2 : 1) - 4)
          overlayScroll = Math.max(0, overlay.lines.length - cap)
          render()
          continue
        }
        if (key.type === "enter" || (key.type === "char" && key.ch === "q")) {
          overlay = null
          overlayScroll = 0
          render()
          continue
        }
        continue
      }
      // Ctrl+O / Ctrl+R (decodeKeys native)
      if (key.type === "ctrl-o") {
        expanded = !expanded
        render()
        continue
      }
      if (key.type === "ctrl-t") {
        setReasoningVisible()
        render()
        continue
      }
      if (key.type === "ctrl-r") {
        // history reverse picker
        const h = histCache.slice().reverse()
        if (!h.length) continue
        picker = {
          title: "history",
          items: h.slice(0, 30).map((t) => ({ label: t.slice(0, 80), value: t })),
          sel: 0,
          onPick: (v) => {
            setLine(v)
            return "history dimuat"
          },
        }
        render()
        continue
      }
      // up/down: navigasi dropdown bila terbuka, kalau tidak jelajahi history.
      // History MENGGANTI baris (tidak menggabungkan) — sama seperti shell.
      if (key.type === "up" || key.type === "down") {
        const m = matches()
        if (menuOpen && m.length) {
          editLine(key, m)
          continue
        }
        if (key.type === "up") {
          if (histCache.length) {
            histIdx = Math.min(histIdx + 1, histCache.length - 1)
            setLine(histCache[histCache.length - 1 - histIdx] ?? "")
            render()
          }
          continue
        }
        if (histIdx > 0) {
          histIdx--
          setLine(histCache[histCache.length - 1 - histIdx] ?? "")
          render()
        } else if (histIdx === 0) {
          histIdx = -1
          setLine("")
          render()
        }
        continue
      }
      // enter — pilih saran bila ada seleksi, kalau tidak kirim baris
      if (key.type === "enter") {
        const m = matches()
        if (menuOpen && sel >= 0 && sel < m.length) {
          setLine(m[sel]!)
          render()
          continue
        }
        const cont = line.endsWith("\\")
        const toSend = cont ? line.slice(0, -1) : line
        void submit(toSend)
        continue
      }
      // tab — lengkapi ke seleksi, atau ke kecocokan pertama bila belum memilih
      if (key.type === "tab") {
        const m = matches()
        if (m.length) {
          setLine(m[sel >= 0 && sel < m.length ? sel : 0]!)
          render()
        }
        continue
      }
      // sisanya = editing baris: char/backspace/delete/home/end/left/right/ctrl-u/ctrl-w
      editLine(key)
    }
  }
  process.stdin.on("data", onData)
  const offResize = onResize(() => render())
  render()

  return {
    detach() {
      if (exited) return
      exited = true
      stopSpinner()
      offFailure()
      for (const off of offs) off()
      process.stdin.off("data", onData)
      offResize()
      process.stdin.setRawMode(false)
      process.stdin.pause()
      showCursor()
      disableBracketedPaste()
      exitAlternate()
    },
  }
}

// Fallback non-TTY: tanpa alternate screen, tanpa raw mode, tanpa dropdown.
// Event tetap dilaporkan sebagai baris polos supaya `--interactive` lewat pipe
// tidak crash dan tetap memberi keluaran yang berguna.
function attachNonTty(opts: FullscreenMinimalOpts): { detach(): void } {
  const offs: (() => void)[] = []
  offs.push(
    opts.bus.on("provider:text", (e: { text: string }) => {
      process.stdout.write(e.text)
    }),
  )
  offs.push(
    opts.bus.on("execution:completed", (e: ExecutionCompletedEvent) => {
      const name = e.execution.call.name
      const isErr = e.execution.result.isError
      process.stderr.write(`  ${isErr ? "x" : glyphDot()} ${name}\n`)
    }),
  )
  offs.push(
    opts.bus.on("provider:extension", (e: { kind: string; data: unknown }) => {
      if (e.kind !== "error") return
      const d = e.data as { message?: string }
      process.stderr.write(`  x ${d.message ?? "unknown error"}\n`)
    }),
  )
  return {
    detach() {
      for (const off of offs) off()
    },
  }
}
