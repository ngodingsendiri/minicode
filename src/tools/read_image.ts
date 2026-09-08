import { isAbsolute, resolve } from "node:path"
import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
import { safeOpenRead } from "../lib/safe-open.ts"
import { estimateImageTokens } from "../policy/context.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"

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
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`)
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`)
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
    // TOCTOU-safe: safeOpenRead = realpath(abs)→cek di dalam root→open(preReal,O_NOFOLLOW)
    // bukan open(abs) yang bisa di-swap jadi symlink luar di antara cek dan open.
    let handle: Awaited<ReturnType<typeof safeOpenRead>>["handle"]
    try {
      ;({ handle } = await safeOpenRead(abs, root))
    } catch (e) {
      const msg = (e as Error).message ?? ""
      if ((e as NodeJS.ErrnoException).code === "ENOENT" || msg.includes("ENOENT"))
        throw new Error(`file not found: ${p}`)
      if (msg.includes("outside workspace") || msg.includes("symlink")) throw e
      throw new Error(`file not found: ${p}`)
    }
    let buf: Buffer
    let st: { size: number } | null = null
    try {
      st = await handle.stat().catch(() => null)
      if (!st) throw new Error(`file not found: ${p}`)
      if (st.size > LIMITS.BASH_OUTPUT_MAX_CHARS) throw new Error(`image too large: ${st.size}`)
      buf = await handle.readFile()
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
