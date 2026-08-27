import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadConfig, refreshProviderModels, type MinicodeConfig } from "../../src/config.ts"
import { c } from "../../src/tui/theme.ts"

interface TraceRow {
  model?: string
  ok?: boolean
  error?: string
  timestamp?: string
}

// 6.3 — health tanpa jaringan: ambil dari traces.jsonl (last run per provider)
function readTraces(cwd?: string): TraceRow[] {
  try {
    return readFileSync(resolve(cwd ?? ".", ".minicode", "traces.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TraceRow)
  } catch {
    return []
  }
}

export function providerOfTrace(cfg: MinicodeConfig, t: TraceRow): string | undefined {
  const m = t.model ?? ""
  if (m.includes("::")) return m.slice(0, m.indexOf("::"))
  const byModel = cfg.providers.find((p) => p.models.includes(m))
  if (byModel) return byModel.id
  const byId = cfg.providers.find((p) => p.id === m)
  if (byId) return byId.id
  return undefined
}

export function healthMap(cfg: MinicodeConfig, traces: TraceRow[]): Map<string, { ok: boolean; model: string; ts: string }> {
  const out = new Map<string, { ok: boolean; model: string; ts: string }>()
  for (const t of traces) {
    const pid = providerOfTrace(cfg, t)
    if (!pid) continue
    const prev = out.get(pid)
    if (prev && prev.ts > (t.timestamp ?? "")) continue
    out.set(pid, { ok: t.ok !== false, model: t.model ?? "-", ts: t.timestamp ?? "" })
  }
  return out
}

export async function handleProviders(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  const firstArg = args[0]
  if (firstArg !== "providers" && firstArg !== "models" && firstArg !== "sync") {
    process.exit(0)
  }
  const cwdArg = getArg("--cwd")
  const cfg = await loadConfig(cwdArg)
  if (firstArg === "providers") {
    if (cfg.providers.length === 0) {
      console.log(
        "(no providers configured - run `minicode --interactive` then /provider-add, or `minicode config add --baseUrl <url> --apiKey <key>`)",
      )
    } else {
      const health = healthMap(cfg, readTraces(cwdArg))
      console.log("")
      for (const p of cfg.providers) {
        console.log(`  ${p.id.padEnd(16)} ${String(p.models.length).padStart(3)} models`)
        console.log(`  ${" ".repeat(16)} ${p.baseUrl}`)
        const h = health.get(p.id)
        if (h) {
          const tag = h.ok ? c.green("ok ") : c.red("ERR")
          const when = h.ts ? new Date(h.ts).toISOString().slice(0, 10) : "-"
          console.log(`  ${" ".repeat(16)} ${tag} last: ${h.model} @ ${when}`)
        } else {
          console.log(`  ${" ".repeat(16)} ${c.dim("never used")}`)
        }
      }
      console.log(
        "\n  options: minicode models | minicode sync | minicode config add --baseUrl <url> --apiKey <key>",
      )
    }
    process.exit(0)
  }
  if (firstArg === "models") {
    const pid = args[1] && !args[1]!.startsWith("--") ? args[1] : undefined
    const matchIdx = args.indexOf("--match")
    const filter = (matchIdx >= 0 && args[matchIdx + 1] ? args[matchIdx + 1]! : "").toLowerCase()
    const match = (s: string) => (filter ? s.toLowerCase().includes(filter) : true)
    if (pid) {
      const p = cfg.providers.find((x) => x.id === pid)
      if (!p) {
        console.error(`provider "${pid}" not found - minicode providers`)
        process.exit(1)
      }
      const list = p.models.filter(match)
      if (!list.length) console.log(`  (no match for "${filter}")`)
      list.forEach((m, i) => console.log(`  [${i}] ${m}`))
    } else {
      if (cfg.providers.length === 0) console.log("(no providers)")
      for (const p of cfg.providers) {
        const list = p.models.filter(match)
        console.log(`${p.id} (${p.baseUrl})${filter ? ` - match "${filter}"` : ""}`)
        if (!list.length) console.log("  (no match)")
        list.slice(0, 10).forEach((m) => console.log(`  ${m}`))
        if (filter && list.length > 10) console.log(`  … +${list.length - 10} more`)
        if (!filter && p.models.length > 10) console.log(`  … +${p.models.length - 10} more`)
      }
    }
    process.exit(0)
  }
  if (firstArg === "sync") {
    console.log("Syncing models from providers...")
    const results = await refreshProviderModels({ cwd: cwdArg })
    for (const r of results) console.log(`  [OK] ${r.id}: ${r.from} -> ${r.to} models`)
    if (!results.length) console.log("  (no provider found - use `minicode config add` first)")
    process.exit(0)
  }
  process.exit(0)
}
