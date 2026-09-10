#!/usr/bin/env bun
// Perakit styles.css web dari potongan part-*.css.
// Mengapa dipecah: tool editor membatasi ~6000 karakter per tulis, jadi CSS
// ditulis per bagian lalu digabung di sini. File gabungan yang di-commit
// tetap satu styles.css agar browser cukup unduh satu request.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(import.meta.dir, "..", "web")
const parts = readdirSync(dir)
  .filter((f) => /^part-.*\.css$/.test(f))
  .sort()
if (parts.length === 0) {
  console.error("[web-css] tidak ada part-*.css di web/")
  process.exit(1)
}
const out = parts.map((p) => readFileSync(join(dir, p), "utf8").trim()).join("\n")
writeFileSync(join(dir, "styles.css"), `${out}\n`, "utf8")
console.log(`[web-css] gabung ${parts.length} bagian -> web/styles.css`)
