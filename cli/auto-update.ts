// Orkestrasi auto-update interaktif: cek → install → restart.
// Dipanggil dari cli/index.ts HANYA saat masuk REPL (enterRepl). One-shot,
// exec, pipe, dan CI tidak tersentuh (notifikasi async biasa) — restart di
// tengah pipeline akan merusak output machine dan perilaku skrip.

import { spawn } from "node:child_process"
import {
  checkForUpdateFresh,
  formatUpdateMessage,
  installUpdate,
  isInstalledCopy,
  shouldAutoUpdate,
  UPDATE_GUARD_ENV,
} from "../src/policy/update-check.ts"
import { c } from "../src/ui/render/theme.ts"

/**
 * Bila layak: cek registry (fresh), install bila ada versi baru, lalu
 * respawn argv yang sama dan JANGAN kembali (process.exit di dalam).
 * Return bila tidak ada update / tak layak / install gagal — REPL lanjut
 * dengan versi lama. Tak pernah melempar.
 */
export async function maybeAutoUpdate(version: string): Promise<void> {
  let decision: ReturnType<typeof shouldAutoUpdate>
  try {
    decision = shouldAutoUpdate(process.argv.slice(2), {
      stdinTTY: process.stdin.isTTY,
      installed: isInstalledCopy(),
    })
  } catch {
    return
  }
  if (!decision.run) return
  let latest: string | null
  try {
    latest = await checkForUpdateFresh(version)
  } catch {
    return
  }
  if (!latest) return
  process.stderr.write(`\n${c.yellow(formatUpdateMessage(version, latest))}\n`)
  process.stderr.write(c.dim("Menginstall pembaruan otomatis…\n"))
  let ok = false
  try {
    ok = installUpdate()
  } catch {
    ok = false
  }
  if (!ok) {
    process.stderr.write(
      c.yellow(
        `Auto-update gagal — lanjut versi ${version}. Update manual: npm update -g @miniroom/minicode\n`,
      ),
    )
    return
  }
  // Restart ke kode baru dengan argv identik; guard env cegah loop bila
  // versi ter-install ternyata masih dilaporkan lebih tua.
  process.stderr.write(c.dim(`Restart ke versi ${latest}…\n`))
  const entry = process.argv[1] ?? ""
  const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, [UPDATE_GUARD_ENV]: "1" },
  })
  const code = await new Promise<number | null>((res) => {
    child.on("exit", (c2) => res(c2))
    child.on("error", () => res(1))
  })
  process.exit(code ?? 0)
}
