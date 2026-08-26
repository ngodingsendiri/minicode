import type { EventBus } from "minicore/core/index.ts"
import { formatArgsPreview, formatProviderError, formatUsage } from "./format.ts"
import { decorateMarkdown } from "./markdown.ts"
import { c } from "./theme.ts"
import { formatWrapped } from "./wrap.ts"

export interface RendererOptions {
  verbose?: boolean
  quiet?: boolean
}

export function attachRenderer(bus: EventBus, opts: RendererOptions = {}) {
  // Streaming buffer: kumpulkan chunk provider:text sampai newline penuh supaya
  // markdown decoration + word-wrap bekerja per baris, tidak potong di tengah.
  let streamBuffer = ""
  let inStreamFence = false

  const flushStreamLine = (line: string) => {
    if (line.includes("```")) inStreamFence = !inStreamFence
    const width = process.stdout.columns || 80
    const decorated = decorateMarkdown(line)
    if (!inStreamFence) {
      process.stdout.write(formatWrapped(decorated, width, true))
    } else {
      process.stdout.write(decorated)
    }
    process.stdout.write("\n")
  }

  const flushStreamBuffer = () => {
    if (!streamBuffer) return
    const parts = streamBuffer.split("\n")
    for (let i = 0; i < parts.length - 1; i++) {
      flushStreamLine(parts[i]!)
    }
    streamBuffer = parts[parts.length - 1] ?? ""
  }

  bus.on("turn:started", (e) => {
    if (opts.verbose) {
      process.stderr.write(c.muted(`\n── Turn ${e.turn} ──\n`))
    }
  })

  bus.on("turn:completed", () => {
    flushStreamBuffer()
    if (streamBuffer) {
      flushStreamLine(streamBuffer)
      streamBuffer = ""
    }
  })

  // Agent text - streaming, per-baris markdown + wrap
  bus.on("provider:text", (e) => {
    streamBuffer += e.text
    flushStreamBuffer()
  })

  bus.on("provider:extension", (e) => {
    if (e.kind === "reasoning" && opts.verbose) {
      const d = e.data as { text?: string }
      if (d.text) process.stderr.write(c.muted(`\n${d.text}\n`))
    } else if (e.kind === "usage") {
      const u = e.data as { inputTokens?: number; outputTokens?: number; totalTokens?: number }
      const usage = formatUsage(u)
      if (usage && opts.verbose) process.stderr.write(c.muted(`  ${usage}\n`))
    } else if (e.kind === "error") {
      const d = e.data as { message?: string; category?: string }
      process.stderr.write(c.error(`\n✗ ${formatProviderError(d)}\n`))
    } else if (e.kind === "content_filter") {
      process.stderr.write(c.warning(`\n! Content filter blocked the response\n`))
    }
  })

  // Step header - hanya di verbose
  bus.on("step:started", (e) => {
    if (!opts.verbose) return
    const calls = e.step.toolCalls
      .map((tc) => `${c.info(tc.name)}(${c.muted(formatArgsPreview(tc.args))})`)
      .join(", ")
    process.stderr.write(c.muted(`  Step ${e.step.index}: ${calls}\n`))
  })

  // Tool execution - systemd-style result
  bus.on("execution:started", (e) => {
    if (opts.verbose || !process.stderr.isTTY) {
      process.stderr.write(c.muted(`  running ${e.execution.call.name}... `))
    }
  })

  bus.on("execution:completed", (e) => {
    const r = e.execution.result
    const name = e.execution.call.name
    const args = (e.execution.call.args ?? {}) as Record<string, unknown>

    if (r.isError) {
      const preview = String(r.content).slice(0, 200)
      process.stderr.write(c.error(`  ✗ ${name}: ${preview}\n`))
      return
    }

    const target = typeof args.path === "string" ? args.path : undefined

    // File writes - satu baris dengan ukuran
    if (name === "write_file" && target) {
      const size = typeof r.content === "string" ? `${r.content.length} chars` : ""
      process.stdout.write(
        c.success(`  ✓ write_file ${target}${size ? c.muted(` (${size})`) : ""}\n`),
      )
      return
    }

    // Edits - tampilkan diff ringkas
    if (name === "edit" && typeof args.path === "string" && typeof args.oldString === "string") {
      process.stdout.write(c.success(`  ✓ edit ${args.path}\n`))
      const oldLines = args.oldString.split("\n")
      const newLines = (args.newString as string).split("\n")
      for (const l of oldLines.slice(0, 3)) {
        if (l.trim()) process.stdout.write(c.error(`    - ${l.trim()}\n`))
      }
      for (const l of newLines.slice(0, 3)) {
        if (l.trim()) process.stdout.write(c.success(`    + ${l.trim()}\n`))
      }
      return
    }

    // apply_patch
    if (name === "apply_patch" && target) {
      process.stdout.write(c.success(`  ✓ apply_patch ${target}\n`))
      return
    }

    // Bash - tampilkan command + output singkat (support both cmd and command for compatibility)
    {
      const cmdStr = (args.cmd as string) ?? (args.command as string)
      if (name === "bash" && typeof cmdStr === "string") {
        const output = String(r.content).trim()
        const lines = output.split("\n").filter(Boolean)
        const preview =
          lines.length > 3
            ? lines.slice(0, 3).join("\n    ") + c.muted(`\n    ... (${lines.length - 3} more)`)
            : lines.join("\n    ")
        process.stderr.write(
          c.success(`  ✓ $ ${String(cmdStr).slice(0, 80)}\n`) + c.muted(`    ${preview}\n`),
        )
        return
      }
    }

    // Default: satu baris ringkas
    const raw = String(r.content).trim()
    const first = raw.split("\n")[0] ?? ""
    const preview = first.slice(0, 80) + (raw.length > 100 || raw.includes("\n") ? "..." : "")
    process.stderr.write(c.success(`  ✓ ${name}`) + c.muted(preview ? ` ${preview}` : "\n"))
  })

  bus.on("context:compacted", (e) => {
    process.stderr.write(c.warning(`  ── context compacted: ${e.reason}\n`))
  })

  bus.on("turn:completed", (e) => {
    if (opts.verbose) {
      process.stderr.write(
        c.muted(`\n  done · ${e.result.usage.steps} steps · ${e.result.usage.turns} turns\n`),
      )
    }
  })
}

export function formatError(e: unknown): string {
  if (e && typeof e === "object" && "kind" in (e as Record<string, unknown>)) {
    const ae = e as { kind: string; message?: string }
    return `${ae.kind}: ${ae.message ?? ""}`
  }
  if (e instanceof Error) return e.message
  return String(e)
}
