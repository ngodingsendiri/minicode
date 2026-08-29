import { readFile, realpath, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { Tool } from "minicore"
import { LIMITS } from "../constants.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"
import { scrubSecrets } from "../policy/scrub.ts"

// defense-in-depth: also jail inside tool (permission layer is primary)

/**
 * Format isi file sebagai `N: <line>` dengan paging.
 *
 * Sebelum ini tool hanya bisa membaca file utuh, jadi file di atas
 * READ_FILE_MAX_BYTES sama sekali tak terjangkau. Nomor baris juga penting:
 * tanpa itu model harus menghitung sendiri saat menyusun `edit`/`apply_patch`
 * dan sering salah rujuk.
 *
 * Diekspor untuk test.
 */
export function formatLines(
  raw: string,
  opts: { offset?: number; limit?: number } = {},
): { text: string; totalLines: number; from: number; to: number } {
  // File yang diakhiri newline tidak menghasilkan baris kosong tambahan.
  const all = raw.split("\n")
  if (all.length > 1 && all[all.length - 1] === "") all.pop()
  const totalLines = all.length

  const rawOffset = Number(opts.offset ?? 1)
  // 1-indexed; offset 0 diperlakukan sebagai 1 supaya model tak perlu menebak.
  const from = Number.isFinite(rawOffset) ? Math.max(1, Math.floor(rawOffset)) : 1
  const rawLimit = Number(opts.limit ?? LIMITS.READ_FILE_DEFAULT_LINE_LIMIT)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.floor(rawLimit)), LIMITS.READ_FILE_MAX_LINE_LIMIT)
    : LIMITS.READ_FILE_DEFAULT_LINE_LIMIT

  if (from > totalLines) {
    return {
      text: `(offset ${from} melewati akhir file — total ${totalLines} baris)`,
      totalLines,
      from,
      to: from,
    }
  }

  const to = Math.min(totalLines, from + limit - 1)
  const width = String(to).length
  const body = all
    .slice(from - 1, to)
    .map((line, i) => {
      const n = String(from + i).padStart(width, " ")
      const capped =
        line.length > LIMITS.READ_FILE_MAX_LINE_CHARS
          ? `${line.slice(0, LIMITS.READ_FILE_MAX_LINE_CHARS)}… [line truncated]`
          : line
      return `${n}: ${capped}`
    })
    .join("\n")

  const remaining = totalLines - to
  const footer =
    remaining > 0
      ? `\n… ${remaining} baris lagi (lanjut: offset=${to + 1})`
      : from > 1
        ? "\n(akhir file)"
        : ""
  return { text: body + footer, totalLines, from, to }
}

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Baca isi file teks dalam workspace, diberi nomor baris. Gunakan offset/limit untuk membaca file besar per bagian (default 2000 baris pertama).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "path relatif" },
      offset: { type: "number", description: "baris awal (1-indexed, default 1)" },
      limit: { type: "number", description: "jumlah baris (default 2000, max 5000)" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute({ path, offset, limit }, ctx) {
    ctx.signal.throwIfAborted()
    const p = path as string
    const root = process.cwd()
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`)
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`)
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
    // resolve symlink target — prevent symlink escape out of workspace
    const real = await realpath(abs).catch(() => abs)
    if (isPathOutsideRoot(real, root)) throw new Error(`symlink points outside workspace: ${p}`)
    const st = await stat(abs).catch(() => null)
    if (!st) throw new Error(`file not found: ${p}`)
    if (st.isDirectory()) throw new Error(`path is a directory, not a file: ${p}`)

    const paged = offset != null || limit != null
    // File raksasa tetap bisa dibaca SELAMA pemanggil menyebut rentang baris.
    // Tanpa offset/limit kita menolak seperti sebelumnya agar tidak diam-diam
    // memotong konteks yang model kira utuh.
    if (st.size > LIMITS.READ_FILE_MAX_BYTES && !paged) {
      throw new Error(
        `file too large: ${p} (${st.size} bytes > ${LIMITS.READ_FILE_MAX_BYTES}) — baca per bagian dengan offset/limit`,
      )
    }
    const raw = await readFile(abs, "utf8")
    const { text } = formatLines(raw, {
      offset: offset as number | undefined,
      limit: limit as number | undefined,
    })
    return scrubSecrets(text)
  },
}
