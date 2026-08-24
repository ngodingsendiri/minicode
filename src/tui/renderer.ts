import type { EventBus } from "../../../minicore/src/core/index.ts";
import { c, glyphs, box } from "./theme.ts";
import { renderDiffCard } from "./diff.ts";
import { createSpinner, type Spinner } from "./spinner.ts";
import { highlightCode } from "./highlight.ts";
import { formatArgsPreview, formatUsage, formatProviderError } from "./format.ts";

export interface RendererOptions {
  verbose?: boolean;
  quiet?: boolean;
}

export function attachRenderer(bus: EventBus, opts: RendererOptions = {}) {
  let activeSpinner: Spinner | null = null;

  bus.on("turn:started", (e) => {
    if (opts.verbose) {
      process.stderr.write(c.dim(`\n${box.horizontal.repeat(4)} ${c.bold(glyphs.sparkle + " Turn " + e.turn)} ${box.horizontal.repeat(40)}\n`));
    }
  });

  bus.on("provider:text", (e) => {
    if (activeSpinner) {
      activeSpinner.stop();
      activeSpinner = null;
    }
    process.stdout.write(e.text);
  });

  bus.on("provider:extension", (e) => {
    if (e.kind === "reasoning") {
      const d = e.data as { text?: string };
      if (opts.verbose && d.text) {
        if (activeSpinner) {
          activeSpinner.stop();
          activeSpinner = null;
        }
        process.stderr.write(c.dim(c.italic(`\n💭 ${d.text}\n`)));
      }
    } else if (e.kind === "usage") {
      const u = e.data as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      const parts = formatUsage(u);
      if (parts && opts.verbose) {
        process.stderr.write(c.dim(`  ${glyphs.dot} usage: ${parts}\n`));
      }
    } else if (e.kind === "error") {
      if (activeSpinner) {
        activeSpinner.stop();
        activeSpinner = null;
      }
      const d = e.data as { message?: string; category?: string };
      process.stderr.write(c.red(`\n${glyphs.cross} Provider Error ${formatProviderError(d)}\n`));
    } else if (e.kind === "content_filter") {
      if (activeSpinner) {
        activeSpinner.stop();
        activeSpinner = null;
      }
      process.stderr.write(c.yellow(`\n${glyphs.cross} Content filter triggered: response blocked by safety filter\n`));
    }
  });

  bus.on("step:started", (e) => {
    if (activeSpinner) {
      activeSpinner.stop();
      activeSpinner = null;
    }
    const calls = e.step.toolCalls.map((tc) => `${c.cyan(tc.name)}(${c.dim(formatArgsPreview(tc.args))})`).join(", ");

    process.stderr.write(`\n${c.dim(glyphs.arrow)} ${c.bold(`Step ${e.step.index}`)} ${glyphs.dot} ${calls}\n`);
  });

  bus.on("execution:started", (e) => {
    if (process.stderr.isTTY && !opts.verbose) {
      activeSpinner = createSpinner(c.dim(`executing ${e.execution.call.name}...`));
    } else {
      process.stderr.write(c.dim(`  ${box.vertical} ${e.execution.call.name}... `));
    }
  });

  bus.on("execution:completed", (e) => {
    if (activeSpinner) {
      activeSpinner.stop();
      activeSpinner = null;
    }

    const r = e.execution.result;
    const toolName = e.execution.call.name;
    const args = (e.execution.call.args ?? {}) as Record<string, unknown>;

    if (r.isError) {
      const preview = String(r.content).slice(0, 300);
      process.stderr.write(`  ${c.red(glyphs.cross)} ${c.red(toolName + " failed:")} ${c.dim(preview)}\n`);
      return;
    }

    // Specialized visualizers for file edits and diffs
    if ((toolName === "edit" || toolName === "write_file") && typeof args.path === "string") {
      if (toolName === "edit" && typeof args.oldString === "string" && typeof args.newString === "string") {
        const diffCard = renderDiffCard(String(args.path), args.oldString, args.newString, { maxLines: 15 });
        process.stderr.write(`  ${c.green(glyphs.check)} ${c.bold(toolName)} ${c.cyan(String(args.path))}\n${diffCard}\n`);
        return;
      }
      process.stderr.write(`  ${c.green(glyphs.check)} ${c.bold(toolName)} ${c.cyan(String(args.path))} ${c.dim("✓ updated")}\n`);
      return;
    }

    // Specialized visualizer for bash execution
    if (toolName === "bash" && typeof args.command === "string") {
      const raw = String(r.content).trim();
      const output = highlightCode(raw, "bash");
      const lines = output.split("\n");
      const preview = lines.length > 4
        ? [...lines.slice(0, 3), c.dim(`... (${lines.length - 3} more lines)`), lines[lines.length - 1]!].join("\n    ")
        : lines.join("\n    ");
      process.stderr.write(`  ${c.green(glyphs.check)} ${c.bold("$ " + String(args.command).slice(0, 80))}\n    ${preview}\n`);
      return;
    }

    // Highlighted preview for file reads
    if (toolName === "read_file" && typeof args.path === "string") {
      const raw = String(r.content);
      const lang = (() => {
        const ext = String(args.path).slice(String(args.path).lastIndexOf(".")).toLowerCase();
        if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "typescript";
        if (ext === ".py") return "python";
        if (ext === ".json") return "json";
        if ([".sh", ".bash", ".zsh"].includes(ext)) return "bash";
        return "typescript";
      })();
      const previewRaw = raw.slice(0, 600);
      const highlighted = highlightCode(previewRaw, lang);
      const previewLines = highlighted.split("\n").slice(0, 8);
      const more = raw.length > 600 || raw.split("\n").length > 8 ? c.dim(`\n    ... (${raw.length} chars)`) : "";
      process.stderr.write(`  ${c.green(glyphs.check)} ${c.bold(toolName)} ${c.cyan(String(args.path))}\n    ${previewLines.join("\n    ")}${more}\n`);
      return;
    }

    // Highlighted preview for grep (file:line: content)
    if (toolName === "grep" && typeof args.pattern === "string") {
      const raw = String(r.content);
      const previewLines = raw.split("\n").slice(0, 6).map((line) => {
        const m = /^([^:]+:[^:]+:\s*)(.*)$/.exec(line);
        if (!m) return line;
        const prefix = m[1]!;
        const code = m[2]!;
        const ext = prefix.slice(prefix.lastIndexOf(".")).toLowerCase();
        const lang = [".ts", ".tsx", ".js", ".jsx", ".py"].includes(ext) ? (ext === ".py" ? "python" : "typescript") : "";
        return prefix + (lang ? highlightCode(code, lang) : code);
      });
      const more = raw.split("\n").length > 6 ? c.dim(`\n    ... (${raw.split("\n").length - 6} more)`) : "";
      process.stderr.write(`  ${c.green(glyphs.check)} ${c.bold(toolName)} ${c.dim(`/${String(args.pattern).slice(0, 40)}/`)}\n    ${previewLines.join("\n    ")}${more}\n`);
      return;
    }

    // Default compact preview
    const rawContent = String(r.content).trim();
    const firstLine = rawContent.split("\n")[0] ?? "";
    const preview = firstLine.slice(0, 100) + (rawContent.length > 100 || rawContent.includes("\n") ? "..." : "");
    process.stderr.write(`  ${c.green(glyphs.check)} ${c.dim(preview || "ok")}\n`);
  });

  bus.on("context:compacted", (e) => {
    process.stderr.write(c.yellow(`\n${glyphs.sparkle} Context compacted: ${e.reason}\n`));
  });

  bus.on("turn:completed", (e) => {
    if (activeSpinner) {
      activeSpinner.stop();
      activeSpinner = null;
    }
    if (opts.verbose) {
      process.stderr.write(c.dim(`\n${glyphs.check} Completed [${e.result.usage.steps} steps · ${e.result.usage.turns} turns]\n`));
    }
  });
}

export function formatError(e: unknown): string {
  if (e && typeof e === "object" && "kind" in (e as Record<string, unknown>)) {
    const ae = e as { kind: string; message?: string };
    return `${ae.kind}: ${ae.message ?? ""}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
