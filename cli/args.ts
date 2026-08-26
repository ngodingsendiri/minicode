// Pure arg-parsing helpers — dipisah dari cli/index.ts agar mudah diuji.
const BOOLEAN_FLAGS = new Set([
  "--verbose",
  "--allow-all",
  "--ask",
  "--plan",
  "--interactive",
  "--tui",
  "--verify",
  "--allowlist",
])
const VALUE_FLAGS = new Set([
  "--cwd",
  "--resume",
  "--model",
  "--session",
  "--max-steps",
  "--context-window",
  "--timeout",
  "--sandbox",
  "--ratelimit",
  "--budget",
])
const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS, "-h", "--help"])

/** `--flag` atau `--flag=value` → normalisasi ke nama flag murni. */
function flagNameOf(token: string): string | null {
  if (!token.startsWith("-")) return null
  const eq = token.indexOf("=")
  const name = eq === -1 ? token : token.slice(0, eq)
  return KNOWN_FLAGS.has(name) ? name : null
}

export function getArg(argv: string[], name: string): string | undefined {
  // dukung bentuk --name value DAN --name=value; ambil kemunculan terakhir
  // (flag berulang → yang terakhir menang, konsisten dengan CLI umum)
  let found: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === name) {
      const v = argv[i + 1]
      if (v !== undefined && !v.startsWith("-")) found = v
    } else if (a.startsWith(`${name}=`)) {
      const v = a.slice(name.length + 1)
      if (v !== "") found = v
    }
  }
  return found
}

export function promptFromArgs(argv: string[]): string {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const fname = flagNameOf(a)
    if (fname === null) {
      out.push(a) // prompt word / unknown flag dibiarkan (perilaku lama utk kata)
      continue
    }
    if (BOOLEAN_FLAGS.has(fname)) continue
    // value flag: lewati flag-nya dan nilai terpisahnya (bila bukan bentuk =)
    if (!a.includes("=")) i++
  }
  return out.join(" ")
}

export function readPrompt(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("")
  return new Promise((resolve) => {
    let data = ""
    let done = false
    const t = setTimeout(() => {
      if (!done) {
        done = true
        resolve("")
      }
    }, 500)
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (c) => (data += c))
    process.stdin.on("end", () => {
      if (!done) {
        done = true
        clearTimeout(t)
        resolve(data.trim())
      }
    })
    // if stdin already ended
    if (process.stdin.readableEnded) {
      clearTimeout(t)
      resolve("")
    }
  })
}
