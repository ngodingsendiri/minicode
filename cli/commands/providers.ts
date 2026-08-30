import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { loadConfig, type MinicodeConfig, refreshProviderModels } from "../../src/config.ts"
import { renderTable } from "../../src/tui/table.ts"
import { c, glyphs } from "../../src/tui/theme.ts"

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

export function healthMap(
  cfg: MinicodeConfig,
  traces: TraceRow[],
): Map<string, { ok: boolean; model: string; ts: string }> {
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
        "(belum ada provider - jalankan `minicode` untuk wizard, atau `minicode config add --baseUrl <url> --apiKey <key>`)",
      )
      process.exit(0)
    }
    // renderTable menjaga kolom tetap berbaris untuk id sepanjang apa pun;
    // padEnd(16) manual sebelumnya rusak begitu id lebih dari 16 karakter.
    const health = healthMap(cfg, readTraces(cwdArg))
    const rows = cfg.providers.map((p) => {
      const h = health.get(p.id)
      const status = !h
        ? c.dim("belum dipakai")
        : `${h.ok ? c.green("ok") : c.red("ERR")} ${c.dim(
            h.ts ? new Date(h.ts).toISOString().slice(0, 10) : "-",
          )}`
      return {
        id: c.cyan(p.id),
        models: String(p.models.length),
        url: p.baseUrl,
        status,
      }
    })
    console.log(
      `\n${c.bold("Provider LLM")}\n` +
        renderTable(
          [
            { header: "ID", key: "id", width: 24 },
            { header: "Model", key: "models", width: 6, align: "right" },
            { header: "Base URL", key: "url", width: 34 },
            { header: "Status", key: "status", width: 18 },
          ],
          rows,
        ) +
        "\n",
    )
    console.log(
      `  ${c.dim("lanjut: minicode models | minicode sync | minicode config add --baseUrl <url> --apiKey <key>")}\n`,
    )
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
        console.error(`provider "${pid}" tidak ditemukan - lihat: minicode providers`)
        process.exit(1)
      }
      const list = p.models.filter(match)
      if (!list.length) console.log(`  (tidak ada yang cocok dengan "${filter}")`)
      for (const [i, m] of list.entries()) console.log(`  [${i}] ${m}`)
    } else {
      if (cfg.providers.length === 0) console.log("(belum ada provider)")
      for (const p of cfg.providers) {
        const list = p.models.filter(match)
        console.log(`${p.id} (${p.baseUrl})${filter ? ` - cocok "${filter}"` : ""}`)
        if (!list.length) console.log("  (tidak ada yang cocok)")
        for (const m of list.slice(0, 10)) console.log(`  ${m}`)
        if (filter && list.length > 10) console.log(`  … +${list.length - 10} lagi`)
        if (!filter && p.models.length > 10) console.log(`  … +${p.models.length - 10} lagi`)
      }
    }
    process.exit(0)
  }
  if (firstArg === "sync") {
    console.log("Menyinkronkan daftar model dari provider…")
    const results = await refreshProviderModels({ cwd: cwdArg })
    for (const r of results)
      console.log(`  ${c.green(glyphs.check)} ${r.id}: ${r.from} -> ${r.to} model`)
    if (!results.length)
      console.log("  (belum ada provider - jalankan `minicode config add` lebih dulu)")
    process.exit(0)
  }
  process.exit(0)
}
