// Fullscreen REPL shell - alternate-screen Ink app, ala alur umum CLI agent:
// header 1 baris · transcript scrollable · status dots · input + dropdown · footer.
// Minimalis: tanpa border-box, tanpa gauge. Reasoning tidak pernah dicetak.
import { Box, Text, useInput, render } from "ink"
import { useEffect, useRef, useState } from "react"
import type { EventBus } from "minicore/core/index.ts"
import { decorateMarkdown } from "./markdown.ts"
import { getTerminalWidth } from "./theme.ts"

export interface TranscriptItem {
  id: number
  kind: "user" | "agent" | "tool" | "error" | "info"
  text: string
}

const RING_MAX = 200

function Spinner({ active }: { active: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setI((v) => v + 1), 150)
    return () => clearInterval(t)
  }, [active])
  if (!active) return null
  return <Text dimColor>{["·", "··", "···"][i % 3]} </Text>
}

interface AppProps {
  bus: EventBus
  model(): string | undefined
  cwdName: string
  budget?: number
  initialMode: string
  onCycleMode(): string
  suggestions(line: string): { text: string; group?: string }[]
  history(): string[]
  onLine(
    q: string,
    signal: AbortSignal,
  ): Promise<"handled" | "prompt">
  onOverlay(q: string): Promise<{ title: string; lines: string[] } | null>
  onExit(): Promise<void>
}

function App(p: AppProps) {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [streaming, setStreaming] = useState("")
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(p.initialMode)
  const [expanded, setExpanded] = useState(false)
  const [overlay, setOverlay] = useState<{ title: string; lines: string[] } | null>(null)
  const [cost, setCost] = useState<number | undefined>(undefined)
  // input
  const [line, setLine] = useState("")
  const [sel, setSel] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const [histIdx, setHistIdx] = useState(-1)
  const idRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const lastCtrlC = useRef(0)
  const histRef = useRef<string[]>([])
  const scrollRef = useRef(0)

  const add = (kind: TranscriptItem["kind"], text: string) =>
    setItems((prev) => [...prev.slice(-(RING_MAX - 1)), { id: ++idRef.current, kind, text }])
  const matches = () =>
    line.startsWith("/")
      ? p
          .suggestions(line)
          .filter((s) => s.text.startsWith(line))
          .map((s) => s.text)
      : []

  useEffect(() => {
    const offs: (() => void)[] = []
    offs.push(
      p.bus.on("provider:text", (e) => {
        setStreaming((t) => (t + e.text).slice(-30000))
      }),
    )
    offs.push(
      p.bus.on("provider:extension", (e) => {
        if (e.kind === "usage") {
          const d = e.data as { cost?: number }
          if (d.cost != null) setCost(d.cost)
        } else if (e.kind === "error") {
          const d = e.data as { message?: string }
          add("error", d.message ?? "unknown error")
        }
      }),
    )
    offs.push(
      p.bus.on("execution:completed", (e) => {
        const name = e.execution.call.name
        const args = (e.execution.call.args ?? {}) as Record<string, unknown>
        const target =
          typeof args.path === "string"
            ? args.path
            : typeof (args.cmd ?? args.command) === "string"
              ? String(args.cmd ?? args.command).slice(0, 60)
              : ""
        add(e.execution.result.isError ? "error" : "tool", `${name}${target ? ` ${target}` : ""}`)
      }),
    )
    offs.push(
      p.bus.on("turn:completed", () => {
        setStreaming((s) => {
          if (s.trim()) add("agent", s)
          return ""
        })
        setBusy(false)
        abortRef.current = null
      }),
    )
    return () => offs.forEach((f) => f())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.bus])

  const submit = async (raw: string) => {
    const q = raw.trim()
    setLine("")
    setSel(-1)
    setMenuOpen(false)
    setHistIdx(-1)
    if (!q) return
    add("user", q)
    histRef.current = [...histRef.current, q].slice(-200)

    if (q === "/exit" || q === "/quit") {
      await p.onExit()
      return
    }
    if (q === "/clear") {
      setItems([])
      return
    }
    if (q.startsWith("/")) {
      const cmd = q.slice(1).split(" ")[0]!.toLowerCase()
      if (cmd === "thinking") {
        const on = !showThinking.ref
        showThinking.ref = on
        add("info", `reasoning display: ${on ? "on" : "off"}`)
        return
      }
      const overlayRes = await p.onOverlay(q)
      if (overlayRes) {
        setOverlay(overlayRes)
        return
      }
      // bukan command lokal -> perlakukan sebagai skill/prompt
    }
    setBusy(true)
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      const res = await p.onLine(q, ctl.signal)
      if (res === "handled") setBusy(false)
    } catch (e) {
      add("error", (e as Error).message)
      setBusy(false)
    } finally {
      abortRef.current = null
    }
  }

  const doInterrupt = () => {
    if (busy && abortRef.current) {
      abortRef.current.abort()
      add("info", "(dihentikan)")
      setStreaming("")
      setBusy(false)
    }
  }

  useInput((input, key) => {
    if (overlay) {
      if (key.escape || input === "q") setOverlay(null)
      return
    }
    if (key.ctrl && input === "c") {
      if (busy) return doInterrupt()
      const now = Date.now()
      if (now - lastCtrlC.current < 2000) void p.onExit()
      else lastCtrlC.current = now
      return
    }
    if (key.escape) return doInterrupt()
    if (key.ctrl && input === "o") return setExpanded((v) => !v)
    if (key.shift && key.tab) return setMode(p.onCycleMode())
    if (busy) return

    if (key.upArrow) {
      if (menuOpen) return setSel((s) => (s <= 0 ? Math.max(0, matches().length - 1) : s - 1))
      const h = p.history()
      const next = Math.min(histIdx + 1, h.length)
      if (next >= 0 && h.length) {
        setHistIdx(next)
        setLine(h[h.length - next] ?? "")
      }
      return
    }
    if (key.downArrow) {
      if (menuOpen) return setSel((s) => (s + 1) % Math.max(1, matches().length))
      if (histIdx > 0) {
        setHistIdx(histIdx - 1)
        setLine(p.history()[p.history().length - histIdx + 1] ?? "")
      } else {
        setHistIdx(-1)
        setLine("")
      }
      return
    }
    if (key.tab && menuOpen) {
      const m = matches()
      if (m.length) {
        setLine(m[Math.max(0, sel)] ?? m[0]!)
        setSel(-1)
        setMenuOpen(false)
      }
      return
    }
    if (key.return) {
      const m = matches()
      if (menuOpen && sel >= 0 && m[sel]) {
        setLine(m[sel]!)
        setSel(-1)
        setMenuOpen(false)
        return
      }
      void submit(line.endsWith("\\") ? line.slice(0, -1) : line)
      return
    }
    if (key.ctrl && input === "u") {
      setLine("")
      setMenuOpen(false)
      return
    }
    if (key.ctrl && input === "w") {
      setLine((l) => l.replace(/\S+\s*$/, ""))
      return
    }
    if (key.backspace) {
      setLine((l) => l.slice(0, -1))
      setMenuOpen(line.slice(0, -1).startsWith("/"))
      return
    }
    if (input && !key.ctrl && !key.meta) {
      const next = line + (key.shift && input === "\r" ? "\n" : input)
      setLine(next)
      setMenuOpen(next.startsWith("/"))
    }
  })

  // ── render ──
  const width = getTerminalWidth()
  const rows = process.stdout.rows || 24
  const m = matches()
  const menuRows = menuOpen ? Math.min(m.length, 8) : 0
  const bodyH = Math.max(6, rows - 4 - menuRows)

  const flat: { kind: TranscriptItem["kind"]; text: string }[] = []
  for (const it of items) {
    if (it.kind === "agent" && !expanded) {
      for (const ln of it.text.split("\n")) flat.push({ kind: "agent", text: ln })
    } else if (it.kind === "user") {
      flat.push({ kind: "user", text: `> ${it.text}` })
    } else {
      flat.push(it)
    }
  }
  if (streaming) for (const ln of streaming.split("\n")) flat.push({ kind: "agent", text: ln })

  const collapsed: typeof flat = []
  for (const f of flat) {
    if ((f.kind === "tool" || f.kind === "agent") && !expanded && f.text.length > width - 6)
      collapsed.push({ ...f, text: f.text.slice(0, width - 9) + "..." })
    else collapsed.push(f)
  }
  const total = collapsed.length
  const follow = scrollRef.current === 0
  const start = Math.max(0, total - bodyH + (follow ? 0 : 0) - scrollRef.current)
  const visible = collapsed.slice(Math.max(0, start), start + bodyH - (total > bodyH ? 1 : 0))

  const modeColor = mode === "plan" ? "yellow" : mode === "auto" ? "green" : "cyan"

  return (
    <Box flexDirection="column" height={rows} paddingX={1}>
      <Text dimColor>
        {"✦ "}
        <Text color="cyan">minicode</Text>
        {" · "}
        <Text color="yellow">{p.model() ?? "-"}</Text>
        {" · "}
        <Text color={modeColor as "yellow"}>{mode}</Text>
        {p.budget != null && cost != null ? ` · $${cost.toFixed(4)}` : ""}
        {expanded ? " · EXPANDED" : ""}
      </Text>
      <Box flexDirection="column" marginTop={0}>
        {visible.map((f) => (
          <Text
            key={`${f.kind}:${f.text}`}
            color={
              f.kind === "user"
                ? "white"
                : f.kind === "tool"
                  ? "gray"
                  : f.kind === "error"
                    ? "red"
                    : f.kind === "info"
                      ? "magenta"
                      : undefined
            }
            bold={f.kind === "user"}
          >
            {decorateMarkdown(f.text)}
          </Text>
        ))}
        {busy && (
          <Text>
            <Spinner active />
            <Text dimColor>bekerja</Text>
          </Text>
        )}
      </Box>
      <Box flexGrow={1} />
      {overlay && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            ── {overlay.title} ──
          </Text>
          {overlay.lines.slice(0, rows - 8).map((l, i) => (
            <Text key={i} dimColor>
              {l || " "}
            </Text>
          ))}
          <Text dimColor>esc tutup</Text>
        </Box>
      )}
      {menuRows > 0 &&
        m.slice(0, menuRows).map((t, i) => (
          <Text key={t} color={i === sel ? "cyan" : "gray"}>
            {i === sel ? "› " : "  "}
            {t}
          </Text>
        ))}
      <Text>
        <Text color="cyan">{"❯ "} </Text>
        <Text>{line}</Text>
        <Text inverse> </Text>
      </Text>
      <Text dimColor>
        ctrl+c stop/keluar · esc stop · ctrl+o detail · shift+tab mode · /help perintah
      </Text>
    </Box>
  )
}

// flag modul utk /thinking (display-only)
export const showThinking = { ref: false }

export interface FullscreenHandle {
  detach(): void
}

export function attachFullscreenShell(opts: AppProps & {}): FullscreenHandle {
  let exited = false
  process.stdout.write("\x1b[?1049h\x1b[2J\x1b[H")
  const instance = render(<App {...opts} />, { exitOnCtrlC: false, patchConsole: true })
  return {
    detach() {
      if (exited) return
      exited = true
      instance.unmount()
      process.stdout.write("\x1b[?1049l")
    },
  }
}
