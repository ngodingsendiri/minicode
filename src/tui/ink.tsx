import { useState, useEffect, useRef } from "react";
import { Box, Text, render } from "ink";
import type { EventBus } from "../../../minicore/src/core/index.ts";

type Status = "idle" | "running" | "done" | "error";

function InkApp({ bus, verbose }: { bus: EventBus; verbose?: boolean }) {
  const [text, setText] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [usage, setUsage] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [steps, setSteps] = useState(0);
  const [turn, setTurn] = useState(0);
  const [compact, setCompact] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const offs: (() => void)[] = [];
    offs.push(bus.on("provider:text", (e) => {
      setText((t) => (t + e.text).slice(-20000));
      if (!doneRef.current) setStatus("running");
    }));
    offs.push(
      bus.on("provider:extension", (e) => {
        if (e.kind === "usage") {
          const u = e.data as { inputTokens?: number; outputTokens?: number };
          setUsage(`in:${u.inputTokens ?? "?"} out:${u.outputTokens ?? "?"}`);
        } else if (e.kind === "reasoning" && verbose) {
          const d = e.data as { text?: string };
          setLogs((l) => [...l.slice(-20), `[reasoning] ${d.text?.slice(0, 80)}`]);
        } else if (e.kind === "error") {
          const d = e.data as { message?: string };
          setLogs((l) => [...l.slice(-20), `[error] ${d.message}`]);
          setStatus("error");
        }
      }),
    );
    offs.push(bus.on("turn:started", (e) => {
      setTurn(e.turn);
      setStatus("running");
    }));
    offs.push(bus.on("step:started", (e) => {
      setSteps(e.step.index);
      const calls = e.step.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 40)})`).join(", ");
      setLogs((l) => [...l.slice(-20), `[step ${e.step.index}] ${calls}`]);
    }));
    offs.push(bus.on("execution:started", (e) => setLogs((l) => [...l.slice(-20), `→ ${e.execution.call.name}`])));
    offs.push(bus.on("execution:completed", (e) => setLogs((l) => [...l.slice(-20), e.execution.result.isError ? `✗ ${e.execution.call.name}` : `✓ ${e.execution.call.name}`])));
    offs.push(bus.on("context:compacted", (e) => {
      setLogs((l) => [...l.slice(-20), `[compacted] ${e.reason}`]);
      setCompact(true);
    }));
    offs.push(bus.on("turn:completed", (e) => {
      doneRef.current = true;
      setLogs((l) => [...l.slice(-20), `[done] steps=${e.result.usage.steps}`]);
      setStatus("done");
    }));
    return () => offs.forEach((fn) => fn());
  }, [bus, verbose]);

  const statusColor = status === "running" ? "cyan" : status === "done" ? "green" : status === "error" ? "red" : "yellow";

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={statusColor} padding={1}>
        <Box flexDirection="column" flexGrow={1}>
          <Text>{text || "(waiting for response...)"}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={statusColor} bold>
          {status === "idle" && "○ idle"}
          {status === "running" && "● running"}
          {status === "done" && "✔ done"}
          {status === "error" && "✘ error"}
        </Text>
        <Text> </Text>
        <Text dimColor>turn:{turn} step:{steps}</Text>
        {usage && <Text> </Text>}
        {usage && <Text color="yellow">{usage}</Text>}
        {compact && <Text> </Text>}
        {compact && <Text color="magenta">compacted</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {logs.map((l, i) => (
          <Text key={i} dimColor>
            {l}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

export function attachInkRenderer(bus: EventBus, opts: { verbose?: boolean } = {}) {
  try {
    const instance = render(<InkApp bus={bus} verbose={opts.verbose} />, {
      exitOnCtrlC: false,
      patchConsole: true,
    });
    let unmounted = false;
    const detach = () => {
      if (unmounted) return;
      unmounted = true;
      instance.unmount();
    };
    return detach;
  } catch {
    return () => {};
  }
}

