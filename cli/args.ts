// Pure arg-parsing helpers - dipisah dari cli/index.ts agar mudah diuji.
const BOOLEAN_FLAGS = new Set([
  "--verbose",
  "--allow-all",
  "--ask",
  "--plan",
  "--interactive",
  "--verify",
  "--allowlist",
  "--json", // dipakai `exec --json` dan `--help --json`
])
const VALUE_FLAGS = new Set([
  "--cwd",
  "--resume",
  "--model",
  "--provider",
  "--session",
  "--max-steps",
  "--context-window",
  "--timeout",
  "--sandbox",
  "--ratelimit",
  "--budget",
  "--output-format", // `exec --output-format=json`
  "--prompt",
  // subcommand flags — harus dikenal agar tidak bocor ke prompt one-shot
  "--baseUrl",
  "--apiKey",
  "--id",
  "--command",
  "--args",
  "--env",
  "--header",
  "--allow-private",
  "--url",
  "--match",
  "--jsonl",
  "--all-tools",
  "--global",
  "--local",
])
export const valueFlags = VALUE_FLAGS
export { flagNameOf }

export function hasFlag(argv: string[], name: string): boolean {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--") return false
    if (token === name || token?.startsWith(`${name}=`)) return true
    if (token && valueFlags.has(token) && !token.includes("=")) i++
  }
  return false
}
const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS, "-h", "--help", "-v", "--version"])

/** `--flag` atau `--flag=value` -> normalisasi ke nama flag murni. */
export function flagNameOf(token: string): string | null {
  if (!token.startsWith("-")) return null
  const eq = token.indexOf("=")
  const name = eq === -1 ? token : token.slice(0, eq)
  return KNOWN_FLAGS.has(name) ? name : null
}

export function getArg(argv: string[], name: string): string | undefined {
  // dukung bentuk --name value DAN --name=value; ambil kemunculan terakhir
  // (flag berulang -> yang terakhir menang, konsisten dengan CLI umum)
  let found: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) break
    if (a === "--") break
    if (a === name) {
      const v = argv[i + 1]
      if (v !== undefined && (v === "-" || !v.startsWith("-"))) found = v
    } else if (a.startsWith(`${name}=`)) {
      const v = a.slice(name.length + 1)
      if (v !== "") found = v
    }
  }
  return found
}

export function promptFromArgs(argv: string[]): string {
  const out: string[] = []
  let afterSeparator = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) break
    if (a === "--") {
      afterSeparator = true
      continue
    }
    if (afterSeparator) {
      out.push(a)
      continue
    }
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
