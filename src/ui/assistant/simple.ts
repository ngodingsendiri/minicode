// Printer linier — satu-satunya renderer output agen (one-shot & REPL linier).
// Output append-only ke scrollback terminal, tanpa alternate screen. Tool call
// inline dan EXPANDED by default (transparansi shell); mode compact via
// MINICODE_COMPACT=1 atau setCompactMode (/compact).
import type { UiBus, UiStep } from "../contract.ts"
import { detail } from "../render/detail.ts"
import { renderDiffCard } from "../render/diff.ts"
import { formatFriendly, friendlyError, friendlyFromCategory } from "../render/errors.ts"
import { formatArgsPreview, formatProviderError, formatUsage } from "../render/format.ts"
import { highlightCode } from "../render/highlight.ts"
import { decorateMarkdown, type FenceMatch, parseFence } from "../render/markdown.ts"
import { reasoning } from "../render/reasoning.ts"
import { sanitizeAnsi, sanitizeAnsiLine } from "../render/sanitize.ts"
import { c, glyphs } from "../render/theme.ts"
import { formatWrapped } from "../render/wrap.ts"
import { runWithoutStatus } from "../runtime/statusline.ts"

export interface SimpleOptions {
  verbose?: boolean
}

const wOut = (s: string) => runWithoutStatus(() => process.stdout.write(s))
const wErr = (s: string) => runWithoutStatus(() => process.stderr.write(s))

// Batas tampilan expanded. Scrollback terminal tidak terbatas, tapi satu tool
// yang memuntahkan 10 ribu baris tetap tidak ramah dibaca — pangkas dengan
// penanda jumlah sisa, seperti `| head` yang disengaja.
const TOOL_OUT_MAX_LINES = 50
const CONTENT_PREVIEW_LINES = 20
const DIFF_MAX_LINES = 24
// Tool yang hasilnya adalah KONTEN yang memang ingin dilihat user (bukan cuma
// status aksi) — di mode expanded isinya ikut dicetak.
const CONTENT_TOOLS = new Set([
  "read_file",
  "grep",
  "glob",
  "web_fetch",
  "web_search",
  "bash_output",
])

/** Gabungkan blok search/replace apply_patch menjadi sepasang teks lama/baru. */
function patchBlocks(patches: unknown): [string, string] {
  const list = Array.isArray(patches) ? (patches as { search?: string; replace?: string }[]) : []
  return [list.map((p) => p.search ?? "").join("\n"), list.map((p) => p.replace ?? "").join("\n")]
}

export function attachSimpleLogger(bus: UiBus, opts: SimpleOptions = {}): () => void {
  let streamBuffer = ""
  // State fence dipegang DI SINI, bukan di decorateMarkdown: baris datang per
  // event streaming, sedangkan decorateMarkdown memproses satu teks utuh.
  // Sebelumnya `line.includes("```")` toggle naif → fence ~~~ tidak dikenal,
  // fence berbahasa kehilangan highlight, dan wrap salah setelah fence.
  let fence: FenceMatch | null = null

  const flushLine = (line: string) => {
    const w = process.stdout.columns || 80
    const f = parseFence(line)
    if (f) {
      if (fence === null) fence = f
      else if (f.char === fence.char && f.len >= fence.len) fence = null
      // Baris pembuka/penutup fence adalah delimiter — tidak dicetak.
      return
    }
    if (fence) {
      // Di dalam fence: isi TIDAK disentuh markdown; di-highlight bila ada
      // bahasa. Tanpa bahasa, tetap apa adanya (perbaikan V8: fence tanpa
      // bahasa tidak boleh kehilangan *value* karena dianggap italic).
      const content = fence.lang ? highlightCode(line, fence.lang) : line
      wOut(`  ${content}\n`)
      return
    }
    wOut(formatWrapped(decorateMarkdown(line), w, true))
    wOut("\n")
  }
  const flushBuf = () => {
    if (!streamBuffer) return
    const parts = streamBuffer.split("\n")
    for (let i = 0; i < parts.length - 1; i++) flushLine(parts[i]!)
    streamBuffer = parts[parts.length - 1] ?? ""
  }

  const offs: (() => void)[] = []
  offs.push(
    bus.on("turn:started", (e) => {
      if (opts.verbose) wErr(c.muted(`\n── Turn ${e.turn} ──\n`))
    }),
  )
  offs.push(
    bus.on("turn:completed", () => {
      flushBuf()
      if (streamBuffer) {
        flushLine(streamBuffer)
        streamBuffer = ""
      }
      if (opts.verbose) wErr(c.muted(`\n  done\n`))
    }),
  )
  offs.push(
    bus.on("provider:text", (e) => {
      // Teks model TIDAK terpercaya: tanpa sanitasi ia bisa menyisipkan sekuens
      // kontrol (bersihkan layar, ubah judul jendela) langsung ke scrollback.
      streamBuffer += sanitizeAnsi(e.text)
      flushBuf()
    }),
  )
  offs.push(
    bus.on("provider:extension", (e) => {
      if (e.kind === "reasoning") {
        // Tampilkan bila --verbose ATAU user mengaktifkan lewat /thinking.
        // Sebelumnya /thinking tidak punya konsumen sama sekali.
        if (!opts.verbose && !reasoning.visible) return
        const d = e.data as { text?: string }
        if (d.text) wErr(c.muted(`\n${d.text}\n`))
      } else if (e.kind === "usage") {
        const u = e.data as { inputTokens?: number; outputTokens?: number }
        const txt = formatUsage(u)
        if (txt && opts.verbose) wErr(c.muted(`  ${txt}\n`))
      } else if (e.kind === "bash-output") {
        // Progres bash inkremental — hanya di --verbose supaya output default
        // tidak dibanjiri log build. Ringkasan tetap muncul di execution:completed.
        if (opts.verbose) {
          const d = e.data as { text?: string }
          if (d.text) wErr(c.muted(sanitizeAnsi(d.text)))
        }
      } else if (e.kind === "error") {
        const d = e.data as { message?: string; category?: string }
        wErr(c.error(`\n✗ ${formatProviderError(d)}\n`))
      } else if (e.kind === "content_filter") {
        wErr(c.warning(`\n! Content filter blocked\n`))
      }
    }),
  )
  offs.push(
    bus.on("step:started", (e: { step: UiStep }) => {
      if (!opts.verbose) return
      const calls = e.step.toolCalls
        .map((tc) => `${c.info(tc.name)}(${c.muted(formatArgsPreview(tc.args))})`)
        .join(", ")
      wErr(c.muted(`  Step ${e.step.index}: ${calls}\n`))
    }),
  )
  offs.push(
    bus.on("execution:started", (e) => {
      if (detail.compact) {
        if (opts.verbose || !process.stderr.isTTY)
          wErr(c.muted(`  running ${e.execution.call.name}... `))
        return
      }
      // Expanded: user melihat tool apa yang mulai berjalan SEBELUM hasilnya,
      // inline di aliran output — transparansi ala shell (`set -x`).
      const args = (e.execution.call.args ?? {}) as Record<string, unknown>
      wErr(
        c.muted(
          `  ${glyphs.arrow} ${e.execution.call.name} ${sanitizeAnsiLine(formatArgsPreview(args))}\n`,
        ),
      )
    }),
  )
  offs.push(
    bus.on("execution:completed", (e) => {
      const r = e.execution.result
      const name = e.execution.call.name
      const args = (e.execution.call.args ?? {}) as Record<string, unknown>
      if (r.isError) {
        wErr(c.error(`  ✗ ${name}: ${sanitizeAnsi(String(r.content)).slice(0, 200)}\n`))
        return
      }
      const target = typeof args.path === "string" ? args.path : undefined
      if (name === "write_file" && target) {
        const size = typeof r.content === "string" ? `${(r.content as string).length} chars` : ""
        wOut(c.success(`  ✓ write_file ${target}${size ? c.muted(` (${size})`) : ""}\n`))
        return
      }
      if ((name === "edit" || name === "apply_patch") && target) {
        const [oldT, newT] =
          name === "edit"
            ? [String(args.oldString ?? ""), String(args.newString ?? "")]
            : patchBlocks(args.patches)
        // Expanded: diff adalah inti perubahan — tampilkan inline. Compact
        // jatuh ke baris ringkasan seperti sebelumnya.
        if (!detail.compact && (oldT || newT)) {
          wOut(
            `${renderDiffCard(target, sanitizeAnsi(oldT), sanitizeAnsi(newT), {
              maxLines: DIFF_MAX_LINES,
            })}\n`,
          )
          return
        }
        wOut(c.success(`  ✓ ${name} ${target}\n`))
        return
      }
      // todo_write: tampilkan daftarnya utuh — ini rencana kerja, bukan noise.
      if (name === "todo_write" || name === "todo_read") {
        wErr(c.success(`  ✓ ${name}\n`) + c.muted(`${sanitizeAnsi(String(r.content))}\n`))
        return
      }
      const cmdStr = (args.cmd as string) ?? (args.command as string)
      if (name === "bash" && typeof cmdStr === "string") {
        const cmdLabel = sanitizeAnsiLine(String(cmdStr)).slice(0, 80)
        const lines = String(r.content).trim().split("\n").filter(Boolean)
        if (detail.compact) {
          const preview =
            lines.length > 3
              ? lines.slice(0, 3).join("\n    ") + c.muted(`\n    ... (${lines.length - 3} more)`)
              : lines.join("\n    ")
          wErr(c.success(`  ✓ $ ${cmdLabel}\n`) + c.muted(`    ${preview}\n`))
          return
        }
        const shown = lines.slice(0, TOOL_OUT_MAX_LINES).map((l) => `    ${sanitizeAnsi(l)}`)
        const more =
          lines.length > TOOL_OUT_MAX_LINES
            ? c.muted(`\n    … (${lines.length - TOOL_OUT_MAX_LINES} more lines)`)
            : ""
        wErr(
          c.success(`  ✓ $ ${cmdLabel}\n`) +
            (shown.length ? `${c.muted(shown.join("\n")) + more}\n` : ""),
        )
        return
      }
      if (!detail.compact && CONTENT_TOOLS.has(name)) {
        // Hasil berupa KONTEN (isi berkas, hasil cari) ikut mengalir expanded.
        const raw = sanitizeAnsi(String(r.content ?? "")).trim()
        const lines = raw ? raw.split("\n") : []
        const preview = lines
          .slice(0, CONTENT_PREVIEW_LINES)
          .map((l) => `    ${l}`)
          .join("\n")
        const more =
          lines.length > CONTENT_PREVIEW_LINES
            ? c.muted(`\n    … (${lines.length - CONTENT_PREVIEW_LINES} more lines)`)
            : ""
        const label = sanitizeAnsiLine(target ?? formatArgsPreview(args))
        wErr(c.success(`  ✓ ${name} ${label}\n`) + (preview ? `${c.muted(preview) + more}\n` : ""))
        return
      }
      const raw = sanitizeAnsi(String(r.content)).trim()
      const first = raw.split("\n")[0] ?? ""
      const preview = first.slice(0, 80) + (raw.length > 100 || raw.includes("\n") ? "..." : "")
      wErr(c.success(`  ✓ ${name}`) + c.muted(preview ? ` ${preview}` : "\n"))
    }),
  )
  offs.push(bus.on("context:compacted", (e) => wErr(c.warning(`  ── compacted: ${e.reason}\n`))))

  return () => {
    for (const off of offs) off()
  }
}

/**
 * Error apa pun → satu pesan siap tampil.
 *
 * Sebelumnya mengembalikan `${kind}: ${message}` mentah, sehingga baris terakhir
 * yang dilihat user setelah run gagal adalah dump JSON provider — pada uji live
 * OpenRouter: `provider: rate limited (429): {"error":{...400 karakter...}}`.
 * Kini kategori dipetakan lewat src/ui/render/errors.ts, sama seperti event error.
 */
export function formatError(e: unknown): string {
  const obj = e as { kind?: string; category?: string; message?: string } | undefined
  // ProviderError punya `category`; AgentError punya `kind`.
  if (obj?.category) return formatFriendly(friendlyFromCategory(obj.category, obj.message ?? ""))
  if (obj?.kind) {
    const friendly = friendlyError(`${obj.kind}: ${obj.message ?? ""}`)
    return formatFriendly(friendly)
  }
  if (e instanceof Error) return formatFriendly(friendlyError(e.message))
  return String(e)
}
