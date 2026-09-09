import { isAbsolute, resolve } from "node:path"
import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
import { safeOpenRead } from "../lib/safe-open.ts"
import { estimateImageTokens } from "../policy/context.ts"

export const readImageTool: Tool = {
  name: "read_image",
  description:
    "Read an image file as base64 for vision review (PNG/JPG/WebP/GIF). Returns data URL + token estimate.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "path image relatif" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute({ path }, ctx) {
    ctx.signal.throwIfAborted()
    const p = path as string
    const root = (ctx as { cwd?: string }).cwd ?? process.cwd()
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
    // TOCTOU-safe: safeOpenRead = realpath(abs) → cek jail+sensitif di dalam
    // root → open(preReal, O_NOFOLLOW). Bukan open(abs) yang bisa di-swap jadi
    // symlink luar di antara cek dan open — semua verifikasi ada di titik ini.
    let handle: Awaited<ReturnType<typeof safeOpenRead>>["handle"]
    try {
      ;({ handle } = await safeOpenRead(abs, root))
    } catch (e) {
      // ENOENT → pesan seragam; sisanya (jail/sensitif/ELOOP/raw IO) apa adanya
      const msg = (e as Error).message ?? ""
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || msg.includes("ENOENT"))
        throw new Error(`file not found: ${p}`)
      throw e
    }
    let buf: Buffer
    let st: { size: number } | null = null
    try {
      st = await handle.stat().catch(() => null)
      if (!st) throw new Error(`file not found: ${p}`)
      if (st.size > LIMITS.READ_FILE_MAX_BYTES)
        throw new Error(`image too large: ${st.size} bytes (max 2M)`)
      buf = await handle.readFile()
      // Cek b64 agar tidak terpotong diam-diam oleh serializeContent (maxTokens*4)
      const estB64 = Math.ceil((buf.byteLength * 4) / 3) + 30
      if (estB64 > LIMITS.BASH_OUTPUT_MAX_CHARS * 5)
        throw new Error(
          `image too large: base64 ~${estB64} chars > cap — compress first (e.g. via code_run sharp)`,
        )
    } finally {
      await handle.close().catch(() => {})
    }
    const b64 = buf.toString("base64")
    const ext = p.split(".").pop()?.toLowerCase() ?? "png"
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/png"
    const tokens = estimateImageTokens(buf.byteLength)
    // S4 — kirim utuh + laporkan bytes (dulu slice 200k diam-diam → gambar korup).
    // File sudah di-cap BASH_OUTPUT_MAX_CHARS di atas, jadi b64 selalu muat konteks.
    return `data:${mime};base64,${b64}\n(${buf.byteLength} bytes ${mime}, tokens ~${tokens})`
  },
}
