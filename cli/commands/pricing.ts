import { readFile } from "node:fs/promises"
import {
  BUILTIN_PRICING,
  findPrice,
  loadPricingOverlay,
  pricingCachePath,
  pricingOverlayMeta,
  syncPricing,
} from "../../src/policy/pricing.ts"
import { c, glyphs } from "../../src/tui/theme.ts"

export async function handlePricing(args: string[]): Promise<never> {
  const sub = (args[1] ?? "status").toLowerCase()

  if (sub === "sync") {
    process.stderr.write("menarik harga dari models.dev…\n")
    try {
      const res = await syncPricing()
      console.log(
        `${c.green(glyphs.check)} ${res.count} model tersimpan (${Math.round(res.bytes / 1024)} KB)\n  ${c.dim(res.path)}`,
      )
      process.exit(0)
    } catch (e) {
      console.error(`${c.red(glyphs.cross)} gagal: ${(e as Error).message}`)
      console.error(c.dim("  tabel harga bawaan tetap dipakai — tidak ada yang rusak"))
      process.exit(1)
    }
  }

  if (sub === "status") {
    await loadPricingOverlay()
    const meta = pricingOverlayMeta()
    console.log(`\n${c.bold("Harga model")}`)
    console.log(`  bawaan       ${Object.keys(BUILTIN_PRICING).length} model (offline, selalu ada)`)
    if (!meta) {
      console.log(`  models.dev   ${c.dim("belum di-sync")} — jalankan: minicode pricing sync`)
    } else {
      const age = Math.round((Date.now() - meta.fetchedAt) / 3_600_000)
      console.log(
        `  models.dev   ${meta.count} model, ${age}j lalu${meta.stale ? c.yellow(" (kedaluwarsa, masih dipakai)") : ""}`,
      )
      console.log(`  ${c.dim(pricingCachePath())}`)
    }
    console.log(`\n  ${c.dim("Tidak ada fetch otomatis: sync hanya saat Anda meminta.")}\n`)
    process.exit(0)
  }

  if (sub === "show") {
    const model = args[2]
    if (!model) {
      console.error("usage: minicode pricing show <model>")
      process.exit(1)
    }
    const overlay = await loadPricingOverlay()
    const p = findPrice(model, overlay)
    if (!p) {
      console.log(`(harga "${model}" tidak diketahui — cost akan tampil N/A)`)
      process.exit(0)
    }
    const src = findPrice(model, {}) === p ? "bawaan" : "models.dev"
    console.log(`\n${c.bold(model)}  ${c.dim(`(${src})`)}`)
    console.log(`  input        $${p.input}/M token`)
    console.log(`  output       $${p.output}/M token`)
    if (p.cacheRead != null) console.log(`  cache read   $${p.cacheRead}/M`)
    if (p.cacheWrite != null) console.log(`  cache write  $${p.cacheWrite}/M`)
    console.log("")
    process.exit(0)
  }

  if (sub === "clear") {
    try {
      await readFile(pricingCachePath(), "utf8")
      const { rm } = await import("node:fs/promises")
      await rm(pricingCachePath(), { force: true })
      console.log(`${c.green(glyphs.check)} cache harga dihapus`)
    } catch {
      console.log("(tidak ada cache harga)")
    }
    process.exit(0)
  }

  console.log(`minicode pricing — tabel harga untuk estimasi biaya

  minicode pricing status        sumber harga yang aktif
  minicode pricing sync          tarik dari models.dev (eksplisit, tidak otomatis)
  minicode pricing show <model>  harga satu model
  minicode pricing clear         hapus cache, kembali ke bawaan`)
  process.exit(0)
}
