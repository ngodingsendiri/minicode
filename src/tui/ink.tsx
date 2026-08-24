import { useState, useEffect, useRef } from "react";
import { Box, Text, render } from "ink";
import type { EventBus } from "../../../minicore/src/core/index.ts";
import { decorateMarkdown } from "./markdown.ts";

type Status = "idle" | "running" | "done" | "error";

interface LogItem {
  id: number;
  text: string;
  type: "tool" | "reasoning" | "error" | "compact" | "info";
}

function InkApp({ bus, verbose, model }: { bus: EventBus; verbose?: boolean; model?: string }) {
  const [rawText, setRawText] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [usage, setUsage] = useState<{ inTokens: number; outTokens: number; cost?: number }>({ inTokens: 0, outTokens: 0 });
  const [status, setStatus] = useState<Status>("idle");
  const [steps, setSteps] = useState(0);
  const [turn, setTurn] = useState(0);
  const [compact, setCompact] = useState(false);
  const doneRef = useRef(false);
  const logIdRef = useRef(0);

  const addLog = (logText: string, type: LogItem["type"] = "info") => {
    logIdRef.current += 1;
    const item: LogItem = { id: logIdRef.current, text: logText, type };
    setLogs((prev) => [...prev.slice(-30), item]);
  };

  useEffect(() => {
    const offs: (() => void)[] = [];

    offs.push(
      bus.on("turn:started", (e) => {
        setTurn(e.turn);
        setStatus("running");
      })
    );

    offs.push(
      bus.on("provider:text", (e) => {
        setRawText((t) => (t + e.text).slice(-30000));
        if (!doneRef.current) setStatus("running");
      })
    );

    offs.push(
      bus.on("provider:extension", (e) => {
        if (e.kind === "usage") {
          const u = e.data as { inputTokens?: number; outputTokens?: number };
          setUsage((prev) => ({
            inTokens: u.inputTokens ?? prev.inTokens,
            outTokens: u.outputTokens ?? prev.outTokens,
          }));
        } else if (e.kind === "reasoning" && verbose) {
          const d = e.data as { text?: string };
          if (d.text) addLog(`💭 ${d.text.slice(0, 100)}`, "reasoning");
        } else if (e.kind === "error") {
          const d = e.data as { message?: string };
          addLog(`✗ Error: ${d.message}`, "error");
          setStatus("error");
        }
      })
    );

    offs.push(
      bus.on("step:started", (e) => {
        setSteps(e.step.index);
        const calls = e.step.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 35)})`).join(", ");
        addLog(`Step ${e.step.index} › ${calls}`, "tool");
      })
    );

    offs.push(
      bus.on("execution:started", (e) => {
        addLog(`→ running ${e.execution.call.name}...`, "tool");
      })
    );

    offs.push(
      bus.on("execution:completed", (e) => {
        const isErr = e.execution.result.isError;
        const name = e.execution.call.name;
        addLog(isErr ? `✗ ${name} failed` : `✓ ${name} completed`, isErr ? "error" : "tool");
      })
    );

    offs.push(
      bus.on("context:compacted", (e) => {
        addLog(`✦ compacted: ${e.reason}`, "compact");
        setCompact(true);
      })
    );

    offs.push(
      bus.on("turn:completed", (e) => {
        doneRef.current = true;
        addLog(`✓ Done (${e.result.usage.steps} steps)`, "info");
        setStatus("done");
      })
    );

    return () => offs.forEach((fn) => fn());
  }, [bus, verbose]);

  const statusColor = status === "running" ? "cyan" : status === "done" ? "green" : status === "error" ? "red" : "yellow";

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header bar */}
      <Box justifyContent="space-between" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
        <Text bold color="cyan">
          ✦ MINICODE TUI
        </Text>
        <Text dimColor>
          Model: <Text color="yellow">{model ?? "default"}</Text>
        </Text>
        <Text bold color={statusColor}>
          {status === "idle" && "○ idle"}
          {status === "running" && "● running"}
          {status === "done" && "✔ completed"}
          {status === "error" && "✘ error"}
        </Text>
      </Box>

      {/* Main content body */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Response viewport */}
        <Box flexDirection="column" width="65%" borderStyle="round" borderColor={statusColor} padding={1} marginRight={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Response
            </Text>
          </Box>
          <Text wrap="wrap">{decorateMarkdown(rawText) || "(waiting for agent output...)"}</Text>
        </Box>

        {/* Activity & Tool logs */}
        <Box flexDirection="column" width="35%" borderStyle="round" borderColor="gray" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="yellow">
              Activity Stream
            </Text>
          </Box>
          {logs.length === 0 ? (
            <Text dimColor>(listening for events...)</Text>
          ) : (
            logs.slice(-12).map((l) => (
              <Text key={l.id} color={l.type === "error" ? "red" : l.type === "compact" ? "magenta" : l.type === "tool" ? "cyan" : "gray"}>
                {l.text}
              </Text>
            ))
          )}
        </Box>
      </Box>

      {/* Status & Token Gauge bar */}
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Box>
          <Text dimColor>Turn: </Text>
          <Text bold color="white">{turn} </Text>
          <Text dimColor>Step: </Text>
          <Text bold color="white">{steps} </Text>
          {compact && <Text color="magenta">✦ Compacted </Text>}
        </Box>
        <Box>
          <Text dimColor>Tokens: in=</Text>
          <Text color="yellow">{usage.inTokens.toLocaleString()}</Text>
          <Text dimColor> out=</Text>
          <Text color="yellow">{usage.outTokens.toLocaleString()}</Text>
        </Box>
      </Box>
    </Box>
  );
}

export function attachInkRenderer(bus: EventBus, opts: { verbose?: boolean; model?: string } = {}) {
  try {
    const instance = render(<InkApp bus={bus} verbose={opts.verbose} model={opts.model} />, {
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
