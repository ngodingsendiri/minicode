import { readFile, realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, resolve } from "node:path"
import type { Tool } from "minicore"
import { atomicWriteText } from "../lib/atomic-write.ts"
import { isPathOutsideRoot, isSensitive } from "../policy/jail.ts"
import { appendLspDiagnostics } from "../policy/verifier.ts"

function normalizeLf(s: string): string {
  return s.replace(/\r\n/g, "\n")
}

function stripTrailingWhitespace(s: string): string {
  return s
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
}

// Petakan index di string ternormalisasi (LF) kembali ke index string asli.
function mapOriginalIndex(original: string, nIdx: number): number {
  let oi = 0,
    ni = 0
  while (ni < nIdx && oi < original.length) {
    if (original[oi] === "\r" && original[oi + 1] === "\n")
      oi += 2 // \r\n = 1 unit LF
    else oi += 1
    ni += 1
  }
  return oi
}

export interface MatchResult {
  start: number
  end: number
  mode: "exact" | "crlf" | "trimmed" | "fuzzy"
}

// Search needle dengan toleransi bertingkat:
// 1. Exact match
// 2. CRLF vs LF match
// 3. Trimmed trailing whitespace line match
// 4. Line-by-line normalized whitespace match
export function flexibleMatch(content: string, needle: string): MatchResult | null {
  // 1. Exact match
  const direct = content.indexOf(needle)
  if (direct !== -1) {
    return { start: direct, end: direct + needle.length, mode: "exact" }
  }

  const cLf = normalizeLf(content)
  const nLf = normalizeLf(needle)

  // 2. CRLF vs LF match
  const nStart = cLf.indexOf(nLf)
  if (nStart !== -1) {
    return {
      start: mapOriginalIndex(content, nStart),
      end: mapOriginalIndex(content, nStart + nLf.length),
      mode: "crlf",
    }
  }

  // 3. Trailing whitespace tolerance
  const cTrimmed = stripTrailingWhitespace(cLf)
  const nTrimmed = stripTrailingWhitespace(nLf)
  const trimStart = cTrimmed.indexOf(nTrimmed)
  if (trimStart !== -1) {
    // Map back to cLf line positions
    const beforeTrim = cTrimmed.slice(0, trimStart)
    const lineCountBefore = beforeTrim.split("\n").length - 1
    const needleLineCount = nTrimmed.split("\n").length

    const cLfLines = cLf.split("\n")
    if (lineCountBefore + needleLineCount <= cLfLines.length) {
      const matchedLines = cLfLines.slice(lineCountBefore, lineCountBefore + needleLineCount)
      const startInLf =
        cLfLines.slice(0, lineCountBefore).join("\n").length + (lineCountBefore > 0 ? 1 : 0)
      const endInLf = startInLf + matchedLines.join("\n").length

      return {
        start: mapOriginalIndex(content, startInLf),
        end: mapOriginalIndex(content, endInLf),
        mode: "trimmed",
      }
    }
  }

  // 4. Fuzzy line-by-line match (ignoring leading/trailing whitespace difference per line)
  const cLines = cLf.split("\n")
  const nLines = nLf.split("\n")

  if (nLines.length > 0 && nLines.length <= cLines.length) {
    const nStripped = nLines.map((l) => l.trim())
    let matchLineIdx = -1

    for (let i = 0; i <= cLines.length - nLines.length; i++) {
      let isMatch = true
      for (let j = 0; j < nLines.length; j++) {
        if (cLines[i + j]!.trim() !== nStripped[j]) {
          isMatch = false
          break
        }
      }
      if (isMatch) {
        if (matchLineIdx !== -1) {
          // Ambiguous multiple fuzzy matches
          return null
        }
        matchLineIdx = i
      }
    }

    if (matchLineIdx !== -1) {
      const matchedLines = cLines.slice(matchLineIdx, matchLineIdx + nLines.length)
      const startInLf = cLines.slice(0, matchLineIdx).join("\n").length + (matchLineIdx > 0 ? 1 : 0)
      const endInLf = startInLf + matchedLines.join("\n").length

      return {
        start: mapOriginalIndex(content, startInLf),
        end: mapOriginalIndex(content, endInLf),
        mode: "fuzzy",
      }
    }
  }

  return null
}

export const editTool: Tool = {
  name: "edit",
  description:
    "Edit file dengan replacement string. oldString harus ada tepat sekali (didukung fuzzy tolerance untuk spasi/indentasi). newString menggantikannya.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string", description: "teks lama yang akan diganti" },
      newString: { type: "string", description: "teks baru" },
    },
    required: ["path", "oldString", "newString"],
    additionalProperties: false,
  },
  async execute({ path, oldString, newString }, ctx) {
    ctx.signal.throwIfAborted()
    const p = path as string
    const root = process.cwd()
    if (isPathOutsideRoot(p, root)) throw new Error(`path outside workspace: ${p}`)
    if (isSensitive(p)) throw new Error(`blocked sensitive file: ${p}`)
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p)
    // resolve symlink to prevent symlink escape (parent dir + file itself)
    const realDir = await realpath(dirname(abs)).catch(() => dirname(abs))
    const fileReal = await realpath(abs).catch(() => null)
    const realAbs = fileReal ?? resolve(realDir, basename(abs))
    if (isPathOutsideRoot(realAbs, root)) throw new Error(`symlink points outside workspace: ${p}`)
    const st = await stat(realAbs).catch(() => null)
    if (!st) throw new Error(`file not found: ${p}`)
    if (st.size > 2_000_000) throw new Error(`file too large: ${p} (${st.size})`)
    const content = await readFile(realAbs, "utf8").catch(() => {
      throw new Error(`file not found: ${p}`)
    })
    const oldS = oldString as string
    const newS = newString as string
    if (oldS === newS) throw new Error("oldString == newString (no change)")
    const match = flexibleMatch(content, oldS)
    if (!match) throw new Error(`oldString not found in ${p}`)

    // ensure uniqueness pada exact/crlf mode
    if (match.mode === "exact" || match.mode === "crlf") {
      const second = flexibleMatch(content.slice(match.end), oldS)
      if (second && (second.mode === "exact" || second.mode === "crlf")) {
        throw new Error(
          `oldString found multiple times in ${p} — provide more surrounding lines to make it unique`,
        )
      }
    }

    const next = content.slice(0, match.start) + newS + content.slice(match.end)
    if (next.length > 5_000_000) throw new Error(`result too large: ${next.length} chars (max 5M)`)
    // atomic (O_EXCL + randomUUID tmp)
    await atomicWriteText(realAbs, next)
    const note = match.mode !== "exact" ? ` (${match.mode} match)` : ""
    const base = `edited ${realAbs}${note} (${oldS.length} → ${newS.length} chars)`
    return await appendLspDiagnostics(realAbs, next, base)
  },
}
