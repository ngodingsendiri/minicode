// Fullscreen REPL shell - alternate-screen Ink app, ala alur umum CLI agent:
// header 1 baris · transcript scrollable · status dots · input + dropdown · footer.
// Minimalis: tanpa border-box, tanpa gauge. Reasoning tidak pernah dicetak.
// Layout menghitung baris SECARA EKSAK agar tidak pernah overflow layar.
import { Box, Text, useInput, render } from "ink"
import { useEffect, useRef, useState } from "react"
import type { EventBus } from "minicore/core/index.ts"
import { decorateMarkdown } from "./markdown.ts"

const getTerminalWidth = (): number => process.stdout.columns || 80

export interface TranscriptItem {
  id: number
  kind: "user" | "agent" | "tool" | "error" | "info"
  text: string
}

const RING_MAX = 200
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
const trunc = (s: string, w: number) => {
  const clean = strip(s)
  return clean.length <= w ? s : s.slice(0, Math.max(0, w - 3)) + "..."
}
const plain = (s: string, w: number) => trunc(strip(s), w)

function Spinner({ active }: { active: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setI((v) => v + 1), 150)
    return () => clearInterval(t)
  }, [active])
  if (!active) return null
  return (
    <Text dimColor>
      {["·", "··", "···"][i % 3]}
    </Text>
  )
}

export interface FullscreenProps {
  bus: EventBus
  model(): string | undefined
  cwdName: string
  budget?: number
  initialMode: string
  onCycleMode(): string
  suggestions(line: string): { text: string; group?: string }[]
  history(): string[]
  onLine(q: string, signal: AbortSignal): Promise<"handled" | "prompt" | { note: string }>
  onPicker(q: string): Promise<{
    title: string
    items: { label: string; value: string }[]
    onPick(v: string): string | void
  } | null>
  onOverlay(q: string): Promise<{ title: string; lines: string[] } | null>
  onExit(): Promise<void>
}

function App(p: FullscreenProps) {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [streamTail, setStreamTail] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(p.initialMode)
  const [expanded, setExpanded] = useState(false)
  const [overlay, setOverlay] = useState<{ title: string; lines: string[] } | null>(null)
  type PickerCfg = { title: string; items: { label: string; value: string }[]; sel: number; onPick(v: string): string | void }
  const [picker, setPicker] = useState<PickerCfg | null>(null)
  const [cost, setCost] = useState<number | undefined>(undefined)
  const [line, setLine] = useState("")
  const [sel, setSel] = useState(-1)
  const [menuOpen, setMenuOpen] = useState(false)
  const idRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const lastCtrlC = useRef(0)
  const histRef = useRef<string[]>([])
  const histIdx = useRef(-1)

  const add = (kind: TranscriptItem["kind"], text: string) =>
    setItems((prev) => [...prev.slice(-(RING_MAX - 1)), { id: ++idRef.current, kind, text }])

  useEffect(() => {
    const offs: (() => void)[] = []
    offs.push(
      p.bus.on("provider:text", (e) =>
        setStreamTail((prev) => {
          const merged = [...prev, ...e.text.split("\n")]
          merged[merged.length - 1] = (merged[merged.length - 1] ?? "") // keep partial
          return merged.slice(-40)
        }),
      ),
    )
    offs.push(
      p.bus.on("turn:started", () => setStreamTail([])),
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
              ? String(args.cmd ?? args.command).slice(0, 50)
              : ""
        add(e.execution.result.isError ? "error" : "tool", `${name} ${target}`.trim())
      }),
    )
    offs.push(
      p.bus.on("turn:completed", () => {
        setStreamTail((tail) => {
          const joined = tail.join("\n").trim()
          if (joined) add("agent", joined)
          return []
        })
        setBusy(false)
        abortRef.current = null
      }),
    )
    return () => offs.forEach((f) => f())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.bus])

  const matches = (): string[] =>
    menuOpen || line.startsWith("/")
      ? p.suggestions(line).filter((s) => s.text.startsWith(line)).map((s) => s.text)
      : []

  const doInterrupt = () => {
    if (busy && abortRef.current) {
      abortRef.current.abort()
      add("info", "(dihentikan)")
      setStreamTail([])
      setBusy(false)
      abortRef.current = null
    }
  }

  const submit = async (raw: string) => {
    const q = raw.trim()
    setLine("")
    setSel(-1)
    setMenuOpen(false)
    if (!q) return
    add("user", q)
    histRef.current = [...histRef.current, q].slice(-200)
    histIdx.current = -1

    if (q === "/exit" || q === "/quit") return void (await p.onExit())
    if (q === "/clear") return setItems([])

    setBusy(true)
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      if (q.startsWith("/")) {
        const cmd = q.slice(1).split(" ")[0]!.toLowerCase()
        if (cmd === "thinking") {
          showThinking.ref = !showThinking.ref
          add("info", `reasoning display: ${showThinking.ref ? "on" : "off"}`)
          return
        }
        const pk = await p.onPicker(q)
        if (pk) {
          setPicker({ ...pk, sel: 0 })
          return
        }
        const ov = await p.onOverlay(q)
        if (ov) {
          setOverlay({ title: ov.title, lines: ov.lines.map((l) => plain(l, getW() - 4)) })
          return
        }
        const spaceIdx = q.indexOf(" ")
        const skillName = spaceIdx === -1 ? q.slice(1) : q.slice(1, spaceIdx)
        const known = p.suggestions(`/${skillName}`).length > 0
        if (!known) {
          add("info", `perintah tidak dikenal: ${cmd} - ketik /help`)
          return
        }
        const skillArgs = spaceIdx === -1 ? "" : q.slice(spaceIdx + 1)
        const res = await p.onLine(`/${skillName}${skillArgs ? " " + skillArgs : ""}`, ctl.signal)
        if (typeof res === "object" && res.note) add("info", res.note)
        return
      }
      const res = await p.onLine(q, ctl.signal)
      if (typeof res === "object" && res.note) add("info", res.note)
    } catch (e) {
      add("error", (e as Error).message)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  useInput((input, key) => {
    if (picker) {
      if (key.upArrow) return setPicker((v) => (v ? { ...v, sel: Math.max(0, v.sel - 1) } : v))
      if (key.downArrow) return setPicker((v) => (v ? { ...v, sel: Math.min(v.items.length - 1, v.sel + 1) } : v))
      if (key.return || input === " ") {
        const cur = picker
        const picked = cur.items[cur.sel]
        setPicker(null)
        if (picked) {
          const r = cur.onPick(picked.value)
          if (typeof r === "string") add("info", r)
        }
      }
      if (key.escape) setPicker(null)
      return
    }
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

    const m = matches()
    if (key.upArrow) {
      if (menuOpen && m.length) return setSel((s) => (s <= 0 ? m.length - 1 : s - 1))
      const h = p.history()
      if (!h.length) return
      histIdx.current = Math.min(histIdx.current + 1, h.length)
      setLine(h[h.length - histIdx.current] ?? "")
      setMenuOpen(false)
      return
    }
    if (key.downArrow) {
      if (menuOpen && m.length) return setSel((s) => (s + 1) % m.length)
      const h = p.history()
      if (histIdx.current > 0) {
        histIdx.current -= 1
        setLine(h[h.length - histIdx.current] ?? "")
      } else {
        histIdx.current = -1
        setLine("")
      }
      return
    }
    if (key.tab) {
      if (m.length) {
        setLine(m[Math.max(0, sel)]!)
        setMenuOpen(false)
        setSel(-1)
      }
      return
    }
    if (key.return) {
      if (menuOpen && sel >= 0 && m[sel]) {
        setLine(m[sel]!)
        setMenuOpen(false)
        setSel(-1)
        return
      }
      const cont = line.endsWith("\\")
      void submit(cont ? line.slice(0, -1) : line)
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
    if (input && !key.ctrl && !key.meta && input !== "\t") {
      const next = line + input
      setLine(next)
      setMenuOpen(next.startsWith("/"))
      setSel(-1)
    }
  })

  // ── render: hitung baris eksak, tidak pernah melebihi layar ──
  const W = getTerminalWidth()
  const H = process.stdout.rows || 24
  const getW = () => W
  const m = matches()
  const pickerLines = picker ? Math.min(picker.items.length, H - 5) : 0
  const menuLines = overlay || picker ? 0 : Math.min(m.length, 8)
  const overlayLines = overlay ? Math.min(overlay.lines.length, H - 5) : 0
  const bodyH = Math.max(
    3,
    H - 1 /*header*/ - (overlay ? overlayLines + 2 : 0) - (picker ? pickerLines + 3 : 0) - menuLines - 2 /*input+footer*/ - (busy ? 1 : 0),
  )

  // flatten transcript -> baris pendek siap cetak
  const lines: { c: string; t: string }[] = []
  const pushLine = (c: string, raw: string) => {
    const src = expanded ? raw : raw
    for (const ln of src.split("\n")) lines.push({ c, t: plain(ln, W - 2) })
  }
  for (const it of items) {
    if (it.kind === "user") pushLine("white:bold", `> ${it.text}`)
    else if (it.kind === "tool") pushLine("gray", `  ${glyphDot} ${it.text}`)
    else if (it.kind === "error") pushLine("red", `  x ${it.text}`)
    else if (it.kind === "info") pushLine("magenta", `  ${it.text}`)
    else pushLine("", decorateMarkdown(it.text))
  }
  for (const ln of streamTail) pushLine("", decorateMarkdown(ln))

  const tail = lines.slice(Math.max(0, lines.length - bodyH))
  while (tail.length < bodyH) tail.unshift({ c: "", t: "" })

  const colorOf = (c: string): "white" | "gray" | "red" | "magenta" | undefined =>
    c === "white" ? "white" : c === "gray" ? "gray" : c === "red" ? "red" : c === "magenta" ? "magenta" : undefined

  const modeColor = mode === "plan" ? "yellow" : mode === "ask" ? "cyan" : "green"

  return (
    <Box flexDirection="column">
      {/* header */}
      <Text dimColor wrap="truncate-end">
        {"* "}
        <Text color="cyan">minicode</Text>
        {" - "}
        <Text color="yellow">{plain(p.model() ?? "-", 30)}</Text>
        {" - "}
        <Text color={modeColor as "yellow"}>{mode}</Text>
        {cost != null ? ` - $${cost.toFixed(4)}` : ""}
        {expanded ? " - DETAIL" : ""}
      </Text>

      {picker ? (
        <Box flexDirection="column">
          <Text bold color="cyan">
            -- {picker.title} --
          </Text>
          {picker.items.slice(Math.max(0, picker.sel - bodyH + 3), Math.max(0, picker.sel - bodyH + 3) + bodyH - 2).map((it, i) => {
            const idx = Math.max(0, picker.sel - bodyH + 3) + i
            return (
              <Text key={it.value} color={idx === picker.sel ? "cyan" : undefined} wrap="truncate-end">
                {idx === picker.sel ? "> " : "  "}
                {plain(it.label, W - 6)}
              </Text>
            )
          })}
          <Text dimColor>[up/down] pilih · [enter] ok · [esc] batal</Text>
        </Box>
      ) : overlay ? (
        <Box flexDirection="column">
          <Text bold color="cyan">
            -- {overlay.title} --
          </Text>
          {overlay.lines.map((l, i) => (
            <Text key={i}>{l}</Text>
          ))}
          <Text dimColor>[esc] tutup</Text>
        </Box>
      ) : (
        <>
          {tail.map((l, i) => (
            <Text key={i} color={colorOf(l.c)} bold={l.c === "white:bold"} wrap="truncate-end">
              {l.t || " "}
            </Text>
          ))}
          {busy && (
            <Text>
              <Spinner active />
            </Text>
          )}
          {menuLines > 0 &&
            m.slice(0, menuLines).map((t, i) => (
              <Text key={t} color={i === sel ? "cyan" : "gray"} wrap="truncate-end">
                {i === sel ? "  > " : "    "}
                {plain(t, W - 6)}
              </Text>
            ))}
        </>
      )}

      {/* input */}
      <Text wrap="truncate-end">
        <Text color="cyan">{"> "}</Text>
        {line}
        <Text dimColor>_</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        ctrl+c stop/keluar · esc stop · ctrl+o detail · shift+tab mode · /help perintah
      </Text>
    </Box>
  )
}

const glyphDot = "·"

// flag modul utk /thinking (display-only)
export const showThinking = { ref: false }

export interface FullscreenHandle {
  detach(): void
}

export function attachFullscreenShell(opts: FullscreenProps): FullscreenHandle {
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
