import { loadConfig, refreshProviderModels } from "../../src/config.ts"

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
        "(no providers configured — run `minicode --interactive` then /provider-add, or `minicode config add --baseUrl <url> --apiKey <key>`)",
      )
    } else {
      console.log("")
      for (const p of cfg.providers) {
        console.log(`  ${p.id.padEnd(16)} ${String(p.models.length).padStart(3)} models`)
        console.log(`  ${" ".repeat(16)} ${p.baseUrl}`)
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
        console.error(`provider "${pid}" not found — minicode providers`)
        process.exit(1)
      }
      const list = p.models.filter(match)
      if (!list.length) console.log(`  (no match for "${filter}")`)
      list.forEach((m, i) => console.log(`  [${i}] ${m}`))
    } else {
      if (cfg.providers.length === 0) console.log("(no providers)")
      for (const p of cfg.providers) {
        const list = p.models.filter(match)
        console.log(`${p.id} (${p.baseUrl})${filter ? ` — match "${filter}"` : ""}`)
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
    for (const r of results) console.log(`  [OK] ${r.id}: ${r.from} → ${r.to} models`)
    if (!results.length) console.log("  (no provider found — use `minicode config add` first)")
    process.exit(0)
  }
  process.exit(0)
}
