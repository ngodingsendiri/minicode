// Fullscreen minimal — alternate-screen REPL tanpa Ink/React, pure ANSI
// Header 1 baris · transcript ring 200 · status dots · input + dropdown · footer
import type { EventBus } from "minicore/core/index.ts"
import { decorateMarkdown } from "../markdown.ts"
import { c } from "../theme.ts"
import { disableBracketedPaste, disableMouse, enableBracketedPaste, enableMouse, enterAlternate, exitAlternate, getSize, hideCursor, onResize, showCursor } from "./screen.ts"
import { applyKey, decodeKeys, type PromptState } from "../../../cli/prompt-engine.ts"
import { renderDiffCard } from "../diff.ts"

const RING_MAX = 100
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
const plain = (s: string, w: number) => {
  const clean = strip(s)
  return clean.length <= w ? s : s.slice(0, Math.max(0, w - 3)) + "..."
}
const trunc = plain

export interface TranscriptItem { id: number; kind: "user"|"agent"|"tool"|"error"|"info"; text: string }

export interface FullscreenMinimalOpts {
  bus: EventBus
  model(): string | undefined
  cwdName: string
  budget?: number
  initialMode: string
  onCycleMode(): string
  suggestions(line: string): { text: string; group?: string }[]
  history(): string[]
  onLine(q: string, signal: AbortSignal): Promise<"handled"|"prompt"|{note:string}>
  onPicker(q: string): Promise<{title:string; items:{label:string;value:string}[]; onPick(v:string):string|void}|null>
  onOverlay(q: string): Promise<{title:string; lines:string[]}|null>
  onExit(): Promise<void>
}

export const showThinking = { ref: false }

export function attachFullscreenMinimal(opts: FullscreenMinimalOpts): { detach(): void } {
  let exited = false
  enterAlternate()
  hideCursor()
  enableBracketedPaste()
  enableMouse()

  let items: TranscriptItem[] = []
  let streamTail: string[] = []
  let busy = false
  let mode = opts.initialMode
  let expanded = false
  let overlay: {title:string; lines:string[]}|null = null
  let picker: {title:string; items:{label:string;value:string}[]; sel:number; onPick:(v:string)=>string|void}|null = null
  let cost: number|undefined
  let effModel: string|undefined
  let effProvider: string|undefined
  let line = ""
  let sel = -1
  let menuOpen = false
  let idRef = 0
  let abortRef: AbortController|null = null
  let lastCtrlC = 0
  let histCache: string[] = opts.history()
  let histIdx = -1

  const add = (kind: TranscriptItem["kind"], text: string) => {
    items = [...items.slice(-(RING_MAX-1)), {id: ++idRef, kind, text}]
    render()
  }

  // bus subscriptions
  const offs: (()=>void)[] = []
  offs.push(opts.bus.on("provider:text", (e:any) => {
    streamTail = [...streamTail, ...e.text.split("\n")]
    streamTail = streamTail.slice(-40)
    render()
  }))
  offs.push(opts.bus.on("turn:started", () => { streamTail = []; render() }))
  offs.push(opts.bus.on("provider:extension", (e:any) => {
    if (e.kind === "usage") {
      const d = e.data as {cost?:number}
      if (d.cost != null) cost = d.cost
      render()
    } else if (e.kind === "effective-model") {
      // 5.2/5.4: router substitusi/fallback → tampilkan model & provider efektif
      const d = e.data as {effective?:string; provider?:string}
      effModel = d.effective
      effProvider = d.provider
      render()
    } else if (e.kind === "error") {
      const d = e.data as {message?:string}
      add("error", d.message ?? "unknown error")
    }
  }))
  offs.push(opts.bus.on("execution:completed", (e:any) => {
    const name = e.execution.call.name
    const args = (e.execution.call.args ?? {}) as Record<string,unknown>
    const isErr = e.execution.result.isError
    const resTxt = String(e.execution.result.content ?? "").slice(0,400)
    const target = typeof args.path === "string" ? args.path as string : typeof (args.cmd ?? args.command) === "string" ? String(args.cmd ?? args.command).slice(0,50) : ""
    if (isErr) { add("error", `${name} ${target}: ${resTxt.slice(0,120)}`); return }
    if ((name==="edit"||name==="apply_patch") && typeof args.path==="string") {
      const oldS = String(args.oldString ?? "")
      const newS = String(args.newString ?? "")
      // Use diff card (Ubuntu style) — limited 6 lines for TUI compactness
      const diffCard = renderDiffCard(args.path as string, oldS, newS, { maxLines: 6 })
      add("tool", diffCard); return
    }
    add("tool", `${name} ${target}`.trim())
  }))
  offs.push(opts.bus.on("turn:completed", () => {
    const joined = streamTail.join("\n").trim()
    if (joined) add("agent", joined)
    streamTail = []
    busy = false
    abortRef = null
    render()
  }))

  const matches = (): string[] => menuOpen || line.startsWith("/") ? opts.suggestions(line).filter(s=>s.text.toLowerCase().startsWith(line.toLowerCase())).map(s=>s.text) : []

  const doInterrupt = () => {
    if (busy && abortRef) {
      abortRef.abort()
      add("info","(dihentikan)")
      streamTail = []
      busy = false
      abortRef = null
      render()
    }
  }

  const submit = async (raw:string) => {
    const q = raw.trim()
    line=""; sel=-1; menuOpen=false
    if (!q) { render(); return }
    add("user", q)
    histCache = [...histCache, q].slice(-200)
    histIdx=-1
    if (q==="/exit"||q==="/quit") return void (await opts.onExit())
    if (q==="/clear") { items=[]; render(); return }
    busy=true
    const ctl = new AbortController()
    abortRef=ctl
    render()
    try {
      if (q.startsWith("/")) {
        const cmd = q.slice(1).split(" ")[0]!.toLowerCase()
        if (cmd==="thinking") { showThinking.ref=!showThinking.ref; add("info",`reasoning display: ${showThinking.ref?"on":"off"}`); return }
        const pk = await opts.onPicker(q)
        if (pk) { picker={...pk, sel:0}; render(); return }
        const ov = await opts.onOverlay(q)
        if (ov) { overlay={title:ov.title, lines: ov.lines.map(l=> plain(strip(l), getSize().width-4))}; render(); return }
        const spaceIdx=q.indexOf(" ")
        const skillName= spaceIdx===-1 ? q.slice(1) : q.slice(1, spaceIdx)
        const known = opts.suggestions(`/${skillName}`).length>0
        if (!known) { add("info",`perintah tidak dikenal: ${cmd} - ketik /help`); return }
        const skillArgs= spaceIdx===-1 ? "" : q.slice(spaceIdx+1)
        const res = await opts.onLine(`/${skillName}${skillArgs? " "+skillArgs:""}`, ctl.signal)
        if (typeof res==="object" && (res as any).note) add("info",(res as any).note)
        return
      }
      const res = await opts.onLine(q, ctl.signal)
      if (typeof res==="object" && (res as any).note) add("info",(res as any).note)
    } catch(e:any){ add("error", e.message) }
    finally { busy=false; abortRef=null; render() }
  }

  // render
  let spinnerIdx=0
  let spinnerTimer: ReturnType<typeof setInterval>|undefined
  const startSpinner=()=>{ if(spinnerTimer) return; spinnerTimer=setInterval(()=>{spinnerIdx++; render()},150)}
  const stopSpinner=()=>{ if(spinnerTimer){clearInterval(spinnerTimer); spinnerTimer=undefined}}
  const glyphDot="·"

  function render() {
    const {width:W, height:H} = getSize()
    if (busy) startSpinner(); else stopSpinner()
    const m = matches()
    const pickerLines = picker ? Math.min(picker.items.length, H-5) : 0
    const menuLines = overlay || picker ? 0 : Math.min(m.length, 8)
    const overlayLines = overlay ? Math.min(overlay.lines.length, H-5) : 0
    const bodyH = Math.max(3, H -1 -(overlay?overlayLines+2:0) -(picker?pickerLines+3:0) -menuLines -2 -(busy?1:0))

    const lines: {c:string; t:string}[]=[]
    const push=(c:string, raw:string)=>{ for(const ln of raw.split("\n")) lines.push({c, t: plain(strip(ln), W-2)}) }
    for(const it of items){
      if(it.kind==="user") push("white:bold", `> ${it.text}`)
      else if(it.kind==="tool") push("gray", `  ${glyphDot} ${it.text}`)
      else if(it.kind==="error") push("red", `  x ${it.text}`)
      else if(it.kind==="info") push("magenta", `  ${it.text}`)
      else push("", decorateMarkdown(it.text))
    }
    for(const ln of streamTail) push("", decorateMarkdown(ln))
    const tail = lines.slice(Math.max(0, lines.length-bodyH))
    while(tail.length<bodyH) tail.unshift({c:"",t:""})

    // build output
    let out=""
    // header
    const modeColor = mode==="plan"?"\x1b[33m":mode==="ask"?"\x1b[36m":"\x1b[32m"
    const dispModel = effModel ?? opts.model() ?? "-"
    const viaTag = effProvider ? ` ${c.muted(`(via ${effProvider})`)}` : ""
    out+=`\x1b[H\x1b[2J`
    out+=`${c.cyan("minicode")} ${c.muted("-")} ${c.yellow(trunc(dispModel,30))}${viaTag} ${c.muted("-")} ${modeColor}${mode}\x1b[39m${cost!=null?` ${c.muted(`$${cost.toFixed(4)}`)}`:""}${expanded?" "+c.muted("- DETAIL"):""}\n`

    if(picker){
      out+=`${c.cyan(`- ${picker.title} -`)}\n`
      const start=Math.max(0, picker.sel - bodyH +3)
      const vis=picker.items.slice(start, start+bodyH-2)
      for(let i=0;i<vis.length;i++){
        const idx=start+i
        const it=vis[i]!
        const isSel=idx===picker.sel
        out+=(isSel?`${c.cyan("> ")}${c.cyan(trunc(it.label,W-6))}`:`  ${trunc(it.label,W-6)}`)+"\n"
      }
      out+=`${c.muted("[up/down] pilih · [enter] ok · [esc] batal")}\n`
    } else if(overlay){
      out+=`${c.cyan(`- ${overlay.title} -`)}\n`
      for(const l of overlay.lines) out+=`${l}\n`
      out+=`${c.muted("[esc] tutup")}\n`
    } else {
      for(const l of tail){
        if(l.c==="white:bold") out+=`${c.bold(l.t)}\n`
        else if(l.c==="gray") out+=`${c.muted(l.t)}\n`
        else if(l.c==="red") out+=`${c.error(l.t)}\n`
        else if(l.c==="magenta") out+=`${c.warning(l.t)}\n`
        else out+=`${l.t}\n`
      }
      if(busy) out+=`${c.muted(["·","··","···"][spinnerIdx%3]!)}\n`
      if(menuLines>0){
        for(let i=0;i<Math.min(m.length,menuLines);i++){
          const t=m[i]!
          const isSel=i===sel
          out+=(isSel?`  ${c.cyan("›")} ${c.cyan(t)}`:`    ${c.muted(t)}`)+"\n"
        }
      }
    }
    // input
    out+=`${c.cyan("> ")}${line}${c.muted("_")}\n`
    out+=`${c.muted("ctrl+c stop/keluar · esc stop · ctrl+o detail · shift+tab mode · /help")}`
    process.stdout.write(out)
  }

  // input handling — unified via prompt-engine decodeKeys + applyKey (single source)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  const onData = (chunk: Buffer) => {
    const raw = chunk.toString("utf8")
    // shift+tab raw early (before decode)
    if (raw.includes("\x1b[Z")) {
      mode = opts.onCycleMode()
      render()
      return
    }
    const keys = decodeKeys(chunk)
    for (const { key } of keys) {
      // Ctrl+C
      if (key.type === "ctrl-c") {
        if (busy) {
          doInterrupt()
          return
        }
        const now = Date.now()
        if (now - lastCtrlC < 2000) void opts.onExit()
        else lastCtrlC = now
        return
      }
      // ESC
      if (key.type === "esc") {
        if (picker) { picker = null; render(); continue }
        if (overlay) { overlay = null; render(); continue }
        doInterrupt()
        continue
      }
      // picker mode
      if (picker) {
        if (key.type === "up") { picker.sel = Math.max(0, picker.sel - 1); render(); continue }
        if (key.type === "down") { picker.sel = Math.min(picker.items.length - 1, picker.sel + 1); render(); continue }
        if (key.type === "enter" || (key.type === "char" && key.ch === " ")) {
          const cur = picker; const picked = cur.items[cur.sel]; picker = null
          if (picked) { const r = cur.onPick(picked.value); if (typeof r === "string") add("info", r) }
          render(); continue
        }
        continue
      }
      if (overlay) {
        if (key.type === "enter" || (key.type === "char" && key.ch === "q")) { overlay = null; render(); continue }
        continue
      }
      // Ctrl+O / Ctrl+R via char code (not in prompt-engine)
      if (key.type === "char" && key.ch.charCodeAt(0) === 15) { expanded = !expanded; render(); continue } // Ctrl+O
      if (key.type === "char" && key.ch.charCodeAt(0) === 18) { // Ctrl+R history
        const h = histCache.slice().reverse()
        if (!h.length) continue
        picker = { title: "history", items: h.slice(0, 30).map((t) => ({ label: t.slice(0, 80), value: t })), sel: 0, onPick: (v) => { line = v; return "history dimuat" } }
        render(); continue
      }
      // up/down: history when not in menu, else via prompt-engine
      if (key.type === "up" || key.type === "down") {
        const m = matches()
        if (menuOpen && m.length) {
          // delegate to prompt-engine for sel navigation
          const ps: PromptState = { line, sel, menuOpen }
          const res = applyKey(ps, key, (_l: string) => m)
          line = res.state.line; sel = res.state.sel; menuOpen = res.state.menuOpen
          render(); continue
        }
        // history navigation
        if (key.type === "up") {
          if (histCache.length) { histIdx = Math.min(histIdx + 1, histCache.length - 1); line = histCache[histCache.length - 1 - histIdx] ?? ""; menuOpen = false; sel = -1; render() }
          continue
        }
        if (key.type === "down") {
          const m2 = matches()
          if (menuOpen && m2.length) { const ps: PromptState = { line, sel, menuOpen }; const res = applyKey(ps, key, (_l: string) => m2); line = res.state.line; sel = res.state.sel; menuOpen = res.state.menuOpen; render(); continue }
          if (histIdx > 0) { histIdx--; line = histCache[histCache.length - 1 - histIdx] ?? ""; render(); continue }
          if (histIdx === 0) { histIdx = -1; line = ""; render(); continue }
          continue
        }
      }
      // enter
      if (key.type === "enter") {
        if (menuOpen && sel >= 0 && matches()[sel]) { line = matches()[sel]!; menuOpen = false; sel = -1; render(); continue }
        const cont = line.endsWith("\\")
        const toSend = cont ? line.slice(0, -1) : line
        void submit(toSend); continue
      }
      // tab
      if (key.type === "tab") {
        const m = matches()
        if (m.length) { line = m[Math.max(0, sel)]!; menuOpen = false; sel = -1; render() }
        continue
      }
      // delegate line editing to prompt-engine (char/backspace/ctrl-u/ctrl-w/left/right)
      if (key.type === "char" || key.type === "backspace" || key.type === "ctrl-u" || key.type === "ctrl-w" || key.type === "left" || key.type === "right") {
        const ps: PromptState = { line, sel, menuOpen }
        const hintsFn = (l: string) => opts.suggestions(l).map((s) => s.text)
        const res = applyKey(ps, key, hintsFn)
        // applyKey doesn't know about case-insensitive filter — keep fullscreen matches() for sel, but line comes from prompt-engine
        line = res.state.line; sel = res.state.sel; menuOpen = res.state.menuOpen
        // sync sel to fullscreen matches indices (prompt-engine sel is hint-index, but fullscreen matches is filtered)
        // Recompute sel to stay in range
        const m = matches()
        if (sel >= m.length) sel = m.length - 1
        render(); continue
      }
    }
  }
  process.stdin.on("data", onData)
  const offResize=onResize(()=>render())
  render()

  return {
    detach(){
      if(exited) return
      exited=true
      stopSpinner()
      offs.forEach(f=>f())
      process.stdin.off("data", onData)
      offResize()
      process.stdin.setRawMode(false)
      process.stdin.pause()
      showCursor()
      disableBracketedPaste()
      disableMouse()
      exitAlternate()
    }
  }
}
