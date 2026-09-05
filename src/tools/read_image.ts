import { realpath, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { Tool } from "#minicore"
import { LIMITS } from "../constants.ts"
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
    const real = await realpath(abs).catch(() => abs)
    const realRoot = await realpath(root).catch(() => root)
    if (isPathOutsideRoot(real, realRoot)) throw new Error(`symlink points outside workspace: ${p}`)
    const st = await stat(real).catch(() => null)
    if (!st) throw new Error(`file not found: ${p}`)
    if (st.size > LIMITS.BASH_OUTPUT_MAX_CHARS) throw new Error(`image too large: ${st.size}`)
    // baca sebagai binary lalu base64 — reuse safe open
    const { open } = await import("node:fs/promises")
    const { constants } = await import("node:fs")
    const O_NOFOLLOW = (constants as unknown as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0x20000
    let handle: import("node:fs/promises").FileHandle
    try {
      handle = await open(abs, constants.O_RDONLY | O_NOFOLLOW)
    } catch {
      handle = await open(abs, constants.O_RDONLY)
    }
    let buf: Buffer
    try {
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
