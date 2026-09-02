// Regresi: "nilai beku saat import" — kelas bug yang sudah TIGA KALI terulang.
//
// Pola yang selalu sama: nilai yang bergantung pada state runtime (tema aktif,
// dukungan UTF-8, NO_COLOR) disimpan ke `const` di module scope, sehingga
// dievaluasi sekali saat modul di-import dan tidak pernah berubah lagi.
//
//   1. V6 — `src/ui/render/theme.ts`, objek `c` dibangun di module scope.
//      Akibat: `/theme` dan `--theme` tidak berefek apa pun. Test lolos karena
//      hanya memeriksa nilai kembalian `applyTheme`, bukan warna yang dipakai.
//   2. V6 — palet per-tema di module scope. Akibat: tema `mono` tidak pernah
//      benar-benar monokrom, padahal itu jalur aksesibilitasnya.
//   3. V8 — `glyphs` di `src/ui/render/theme.ts` dan `const OK = glyphs.check` di
//      `cli/commands.ts`. Akibat: fallback ASCII tidak berlaku, `MINICODE_ASCII=1`
//      diabaikan.
//
// Ketiganya lolos typecheck DAN lolos test yang ada. Karena itu penjaganya harus
// berupa pemeriksaan konvensi, bukan test perilaku: perilakunya benar sampai
// seseorang memindahkan satu ekspresi ke module scope.
//
// Objek yang dijaga (`c`, `glyphs`, `detail`, `reasoning`) adalah getter di
// `src/ui/render/{theme,detail,reasoning}.ts` (dulu termasuk `themeState`).
// Membacanya WAJIB terjadi saat pakai — di dalam fungsi,
// arrow, atau getter — bukan saat import.
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = process.cwd()

/** Objek yang nilainya bergantung state runtime (theme.ts + detail/reasoning). */
const RUNTIME_OBJECTS = ["c", "glyphs", "detail", "reasoning"] as const

/**
 * Buang komentar dan isi string literal supaya penyebutan `glyphs.` di dalam
 * dokumentasi atau pesan tidak dituduh sebagai kode. Panjang dipertahankan
 * (diganti spasi) agar nomor baris tetap akurat.
 */
function blankCommentsAndStrings(src: string): string {
  const out: string[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i] as string
    const next = src[i + 1]
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        out.push(" ")
        i++
      }
      continue
    }
    if (ch === "/" && next === "*") {
      out.push(" ", " ")
      i += 2
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ")
        i++
      }
      out.push(" ", " ")
      i += 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch
      out.push(quote)
      i++
      while (i < n) {
        const cur = src[i] as string
        if (cur === "\\") {
          out.push(" ", " ")
          i += 2
          continue
        }
        if (cur === quote) break
        out.push(cur === "\n" ? "\n" : " ")
        i++
      }
      out.push(quote)
      i++
      continue
    }
    out.push(ch)
    i++
  }
  return out.join("")
}

/** Akhir statement `const ...` dengan memperhitungkan tanda kurung berimbang. */
function statementEnd(src: string, from: number): number {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const ch = src[i] as string
    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") depth--
    else if (ch === "\n" && depth <= 0) return i
  }
  return src.length
}

/**
 * Potong bagian yang evaluasinya DITUNDA: apa pun setelah `=>`, `function`, atau
 * `get x()` dijalankan nanti, jadi membaca getter di sana justru benar.
 *
 * Sengaja konservatif (memotong sampai akhir statement, bukan sampai akhir body):
 * lebih baik melewatkan kasus eksotis `f(() => x) + glyphs.dot` daripada
 * menuduh `const OK = () => glyphs.check` yang justru bentuk yang dianjurkan.
 */
function eagerPart(decl: string): string {
  const lazy = /=>|\bfunction\b|\bget\s+\w+\s*\(/.exec(decl)
  return lazy ? decl.slice(0, lazy.index) : decl
}

interface Offense {
  file: string
  line: number
  text: string
}

/** Cari `const` di module scope yang membaca objek runtime secara eager. */
export function findFrozenRuntimeValues(file: string, source: string): Offense[] {
  const src = blankCommentsAndStrings(source)
  const objects = RUNTIME_OBJECTS.join("|")
  // Akses properti (`glyphs.dot`) maupun destructuring (`const { dot } = glyphs`).
  const access = new RegExp(`(?<![\\w.$])(?:${objects})\\s*(?:\\.\\s*\\w|\\b\\s*$)`)
  const destructure = new RegExp(`^(?:export\\s+)?const\\s*[{\\[][^=]*=\\s*(?:${objects})\\s*$`)
  const offenses: Offense[] = []
  // Module scope = deklarasi yang mulai di kolom 0. Yang ter-indentasi berada di
  // dalam fungsi/blok, jadi dievaluasi saat dipanggil.
  const declRe = /^(?:export\s+)?const\s/gm
  let m: RegExpExecArray | null = declRe.exec(src)
  while (m !== null) {
    const start = m.index
    const decl = src.slice(start, statementEnd(src, start))
    const eq = decl.indexOf("=")
    if (eq !== -1) {
      const rhs = eagerPart(decl.slice(eq + 1))
      const isDestructure = destructure.test(decl.replace(/\s+/g, " ").trim())
      if (access.test(rhs) || isDestructure) {
        const line = src.slice(0, start).split("\n").length
        offenses.push({ file, line, text: decl.split("\n")[0]?.trim() ?? "" })
      }
    }
    m = declRe.exec(src)
  }
  return offenses
}

function trackedFiles(): string[] {
  const r = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 })
  if (r.status !== 0) return []
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.endsWith(".ts"))
    .filter((s) => s.startsWith("src/ui/") || s.startsWith("cli/"))
}

describe("detektor nilai beku (unit)", () => {
  test("menolak `const X = glyphs.dot` di module scope", () => {
    const bad = 'import { glyphs } from "./theme.ts"\nconst DOT = glyphs.dot\n'
    expect(findFrozenRuntimeValues("x.ts", bad)).toHaveLength(1)
  })

  test("menolak `const X = c.dim(...)` di module scope", () => {
    const bad = 'const HEADER = c.dim("judul")\n'
    expect(findFrozenRuntimeValues("x.ts", bad)).toHaveLength(1)
  })

  test("menolak deklarasi multi-baris", () => {
    const bad = 'const ROWS = [\n  c.bold("a"),\n  glyphs.check,\n]\n'
    expect(findFrozenRuntimeValues("x.ts", bad).length).toBeGreaterThan(0)
  })

  test("menolak destructuring `const { check } = glyphs`", () => {
    const bad = "const { check, cross } = glyphs\n"
    expect(findFrozenRuntimeValues("x.ts", bad)).toHaveLength(1)
  })

  test("menolak `const X = c.success` di module scope", () => {
    expect(findFrozenRuntimeValues("x.ts", "const NAME = c.success\n")).toHaveLength(1)
  })

  test("menerima arrow yang menunda pembacaan", () => {
    const ok = "const OK = () => glyphs.check\nconst GAGAL = () => glyphs.cross\n"
    expect(findFrozenRuntimeValues("x.ts", ok)).toEqual([])
  })

  test("menerima getter di dalam objek", () => {
    const ok = "const marks = {\n  get ok() {\n    return glyphs.check\n  },\n}\n"
    expect(findFrozenRuntimeValues("x.ts", ok)).toEqual([])
  })

  test("menerima pembacaan di dalam fungsi (ter-indentasi)", () => {
    const ok = "export function render(): string {\n  const s = glyphs.dot\n  return s\n}\n"
    expect(findFrozenRuntimeValues("x.ts", ok)).toEqual([])
  })

  test("menerima penyebutan di komentar dan string", () => {
    const ok = '// pakai glyphs.dot, jangan c.dim\nconst HINT = "glyphs.check"\n'
    expect(findFrozenRuntimeValues("x.ts", ok)).toEqual([])
  })

  test("tidak tertipu properti bernama sama (`opts.c.dim`)", () => {
    expect(findFrozenRuntimeValues("x.ts", "const X = opts.c.dim\n")).toEqual([])
  })
})

describe("konvensi: tak ada nilai runtime yang dibekukan saat import", () => {
  const files = trackedFiles()

  test("ada berkas untuk diperiksa (sanity)", () => {
    expect(files.length).toBeGreaterThan(10)
  })

  test("src/ui/** dan cli/** bersih", () => {
    const offenses: string[] = []
    for (const f of files) {
      // Berkas ini memuat pola pelanggaran sebagai fixture — ia akan menuduh
      // dirinya sendiri.
      if (f.endsWith("no-frozen-runtime-value.test.ts")) continue
      const src = readFileSync(join(repoRoot, f), "utf8")
      for (const o of findFrozenRuntimeValues(f, src)) {
        offenses.push(`${o.file}:${o.line} ${o.text}`)
      }
    }
    // Pesan kegagalan sengaja panjang: pelanggarnya tidak akan tahu kenapa.
    expect(offenses, "lihat PLAN.md P0.1 — bungkus dalam fungsi/getter").toEqual([])
  })
})
