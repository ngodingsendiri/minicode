import type { EventBus } from "../../../minicore/src/core/index.ts";
import { c, glyphs, box } from "./theme.ts";
import { renderDiffCard } from "./diff.ts";
import { createSpinner, type Spinner } from "./spinner.ts";
import { highlightCode } from "./highlight.ts";

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
      const parts = [
        u.inputTokens != null ? `in:${u.inputTokens}` : null,
        u.outputTokens != null ? `out:${u.outputTokens}` : null,
        u.totalTokens != null ? `total:${u.totalTokens}` : null,
      ].filter(Boolean) as string[];
      if (parts.length && opts.verbose) {
        process.stderr.write(c.dim(`  ${glyphs.dot} usage: ${parts.join(" ")}\n`));
      }
    } else if (e.kind === "error") {
      if (activeSpinner) {
        activeSpinner.stop();
        activeSpinner = null;
      }
      const d = e.data as { message?: string; category?: string };
      process.stderr.write(c.red(`\n${glyphs.cross} Provider Error [${d.category ?? "unknown"}]: ${d.message ?? ""}\n`));
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
    const calls = e.step.toolCalls.map((tc) => {
      let argPreview = "";
      try {
        const args = tc.args as Record<string, unknown>;
        if (args.path) argPreview = String(args.path);
        else if (args.command) argPreview = String(args.command).slice(0, 60);
        else if (args.query) argPreview = String(args.query);
        else if (args.prompt) argPreview = String(args.prompt).slice(0, 40);
        else argPreview = JSON.stringify(args).slice(0, 40);
      } catch {
        argPreview = "[args]";
      }
      return `${c.cyan(tc.name)}(${c.dim(argPreview)})`;
    }).join(", ");

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
