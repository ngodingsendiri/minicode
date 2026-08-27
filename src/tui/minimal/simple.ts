// Simple logger — pengganti renderer klasik (tanpa Ink, tanpa alternate-screen)
// Untuk one-shot non-interaktif: streaming markdown per baris, wrap, diff ringkas
import type { EventBus } from "minicore/core/index.ts"
import { formatArgsPreview, formatProviderError, formatUsage } from "../format.ts"
import { decorateMarkdown } from "../markdown.ts"
import { c } from "../theme.ts"
import { runWithoutStatus } from "../statusline.ts"
import { formatWrapped } from "../wrap.ts"

export interface SimpleOptions {
  verbose?: boolean
}

const wOut = (s: string) => runWithoutStatus(() => process.stdout.write(s))
const wErr = (s: string) => runWithoutStatus(() => process.stderr.write(s))

export function attachSimpleLogger(bus: EventBus, opts: SimpleOptions = {}): () => void {
  let streamBuffer = ""
  let inFence = false

  const flushLine = (line: string) => {
    if (line.includes("```")) inFence = !inFence
    const w = process.stdout.columns || 80
    const dec = decorateMarkdown(line)
    if (!inFence) wOut(formatWrapped(dec, w, true))
    else wOut(dec)
    wOut("\n")
  }
  const flushBuf = () => {
    if (!streamBuffer) return
    const parts = streamBuffer.split("\n")
    for (let i = 0; i < parts.length - 1; i++) flushLine(parts[i]!)
    streamBuffer = parts[parts.length - 1] ?? ""
  }

  const offs: (() => void)[] = []
  offs.push(bus.on("turn:started", (e) => {
    if (opts.verbose) wErr(c.muted(`\n── Turn ${e.turn} ──\n`))
  }))
  offs.push(bus.on("turn:completed", () => {
    flushBuf()
    if (streamBuffer) { flushLine(streamBuffer); streamBuffer = "" }
    if (opts.verbose) wErr(c.muted(`\n  done\n`))
  }))
  offs.push(bus.on("provider:text", (e) => {
    streamBuffer += e.text
    flushBuf()
  }))
  offs.push(bus.on("provider:extension", (e) => {
    if (e.kind === "reasoning" && opts.verbose) {
      const d = e.data as { text?: string }
      if (d.text) wErr(c.muted(`\n${d.text}\n`))
    } else if (e.kind === "usage") {
      const u = e.data as { inputTokens?: number; outputTokens?: number }
      const txt = formatUsage(u)
      if (txt && opts.verbose) wErr(c.muted(`  ${txt}\n`))
    } else if (e.kind === "error") {
      const d = e.data as { message?: string; category?: string }
      wErr(c.error(`\n✗ ${formatProviderError(d)}\n`))
    } else if (e.kind === "content_filter") {
      wErr(c.warning(`\n! Content filter blocked\n`))
    }
  }))
  offs.push(bus.on("step:started", (e) => {
    if (!opts.verbose) return
    const calls = e.step.toolCalls.map((tc) => `${c.info(tc.name)}(${c.muted(formatArgsPreview(tc.args))})`).join(", ")
    wErr(c.muted(`  Step ${e.step.index}: ${calls}\n`))
  }))
  offs.push(bus.on("execution:started", (e) => {
    if (opts.verbose || !process.stderr.isTTY) wErr(c.muted(`  running ${e.execution.call.name}... `))
  }))
  offs.push(bus.on("execution:completed", (e) => {
    const r = e.execution.result
    const name = e.execution.call.name
    const args = (e.execution.call.args ?? {}) as Record<string, unknown>
    if (r.isError) {
      wErr(c.error(`  ✗ ${name}: ${String(r.content).slice(0,200)}\n`))
      return
    }
    const target = typeof args.path === "string" ? args.path : undefined
    if (name === "write_file" && target) {
      const size = typeof r.content === "string" ? `${(r.content as string).length} chars` : ""
      wOut(c.success(`  ✓ write_file ${target}${size ? c.muted(` (${size})`) : ""}\n`))
      return
    }
    if (name === "edit" && typeof args.path === "string") {
      wOut(c.success(`  ✓ edit ${args.path}\n`))
      return
    }
    if (name === "apply_patch" && target) {
      wOut(c.success(`  ✓ apply_patch ${target}\n`))
      return
    }
    const cmdStr = (args.cmd as string) ?? (args.command as string)
    if (name === "bash" && typeof cmdStr === "string") {
      const out = String(r.content).trim().split("\n").filter(Boolean)
      const preview = out.length > 3 ? out.slice(0,3).join("\n    ") + c.muted(`\n    ... (${out.length-3} more)`) : out.join("\n    ")
      wErr(c.success(`  ✓ $ ${String(cmdStr).slice(0,80)}\n`) + c.muted(`    ${preview}\n`))
      return
    }
    const raw = String(r.content).trim()
    const first = raw.split("\n")[0] ?? ""
    const preview = first.slice(0,80) + (raw.length>100 || raw.includes("\n") ? "..." : "")
    wErr(c.success(`  ✓ ${name}`) + c.muted(preview ? ` ${preview}` : "\n"))
  }))
  offs.push(bus.on("context:compacted", (e) => wErr(c.warning(`  ── compacted: ${e.reason}\n`))))

  return () => offs.forEach((f) => f())
}

export function formatError(e: unknown): string {
  if (e && typeof e === "object" && "kind" in (e as Record<string, unknown>)) {
    const ae = e as { kind: string; message?: string }
    return `${ae.kind}: ${ae.message ?? ""}`
  }
  if (e instanceof Error) return e.message
  return String(e)
}
