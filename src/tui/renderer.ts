import type { EventBus } from "../../../minicore/src/core/index.ts";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

export function attachRenderer(bus: EventBus, opts: { verbose?: boolean } = {}) {
  bus.on("turn:started", (e) => {
    process.stderr.write(c.dim(`\n[turn ${e.turn}]\n`));
  });
  bus.on("provider:text", (e) => {
    process.stdout.write(e.text);
  });
  bus.on("provider:extension", (e) => {
    if (e.kind === "reasoning" && opts.verbose) {
      const d = e.data as { text?: string };
      process.stderr.write(c.dim(`\n[reasoning] ${d.text ?? ""}\n`));
    } else if (e.kind === "usage") {
      const u = e.data as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
      const parts = [
        u.inputTokens != null ? `in=${u.inputTokens}` : null,
        u.outputTokens != null ? `out=${u.outputTokens}` : null,
        u.totalTokens != null ? `total=${u.totalTokens}` : null,
      ].filter(Boolean) as string[];
      if (parts.length) process.stderr.write(c.dim(`\n[usage] ${parts.join(" ")}\n`));
    } else if (e.kind === "error") {
      const d = e.data as { message?: string; category?: string };
      process.stderr.write(c.red(`\n[provider error] ${d.category ?? ""} ${d.message ?? ""}\n`));
    } else if (e.kind === "content_filter") {
      process.stderr.write(c.yellow(`\n[content_filter] response blocked\n`));
    }
  });
  bus.on("step:started", (e) => {
    const calls = e.step.toolCalls.map((tc) => {
      let argStr: string;
      try {
        argStr = JSON.stringify(tc.args) ?? "";
      } catch {
        argStr = "[circular]";
      }
      return `${tc.name}(${argStr.slice(0, 80)})`;
    }).join(", ");
    process.stderr.write(c.cyan(`\n[step ${e.step.index}] tool_calls: ${calls}\n`));
  });
  bus.on("execution:started", (e) => {
    process.stderr.write(c.dim(`  → ${e.execution.call.name} ... `));
  });
  bus.on("execution:completed", (e) => {
    const r = e.execution.result;
    const preview = String(r.content).slice(0, 200).replace(/\n/g, " ");
    if (r.isError) process.stderr.write(c.red(`error: ${preview}\n`));
    else process.stderr.write(c.green(`ok: ${preview.slice(0, 80)}\n`));
  });
  bus.on("context:compacted", (e) => {
    process.stderr.write(c.yellow(`\n[compacted] ${e.reason}\n`));
  });
  bus.on("turn:completed", (e) => {
    process.stderr.write(c.dim(`\n[done] steps=${e.result.usage.steps} turns=${e.result.usage.turns}\n`));
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
