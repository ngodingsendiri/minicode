import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import {
  getSessionTtlDays,
  listSessions,
  loadSession,
  purgeExpired,
} from "../../src/session/persistence.ts"
import { renderTable } from "../../src/tui/table.ts"
import { c } from "../../src/tui/theme.ts"

const SESSIONS_HELP = `minicode sessions — riwayat sesi

  minicode sessions list                 daftar sesi terbaru
  minicode sessions export <id> [--jsonl]  ekspor riwayat pesan
  minicode sessions purge                hapus sesi kedaluwarsa (TTL)`

export async function handleSessions(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  const sub = args[1]
  if (sub === "list" || !sub) {
    const cwdArg = getArg("--cwd")
    const rows = listSessions(cwdArg)
    if (rows.length === 0) console.log(c.dim("(belum ada sesi tercatat)"))
    else {
      const tableData = rows.map((r) => ({
        id: c.cyan(r.id),
        date: new Date(r.created_at).toLocaleString(),
        cwd: c.dim(r.cwd),
      }))
      console.log(
        `\n${c.bold("Sesi terbaru")}\n` +
          renderTable(
            [
              { header: "ID Sesi", key: "id", width: 14 },
              { header: "Dibuat", key: "date", width: 22 },
              { header: "Workspace", key: "cwd", width: 40 },
            ],
            tableData,
          ) +
          "\n",
      )
    }
    process.exit(0)
  } else if (sub === "export") {
    // args[2] bisa berupa flag bila user lupa id (`sessions export --cwd x`);
    // memperlakukannya sebagai id menghasilkan pesan "sesi --cwd tidak ditemukan".
    const id = args[2] && !args[2]!.startsWith("-") ? args[2] : undefined
    const asJsonl = args.includes("--jsonl")
    if (!id) {
      console.error("usage: minicode sessions export <id> [--jsonl]")
      process.exit(1)
    }
    const sess = loadSession(id, getArg("--cwd"))
    if (!sess) {
      console.error(`sesi "${id}" tidak ditemukan - lihat: minicode sessions list`)
      process.exit(1)
    }
    if (asJsonl) for (const m of sess.messages) console.log(JSON.stringify(m))
    else console.log(JSON.stringify(sess, null, 2))
    process.exit(0)
  } else if (sub === "purge") {
    const cwdArg = getArg("--cwd")
    const localPath = resolve(cwdArg ?? process.cwd(), ".minicode", "sessions.db")
    const dbPath = existsSync(localPath)
      ? localPath
      : (() => {
          const g = join(homedir(), ".minicode")
          mkdirSync(g, { recursive: true })
          return join(g, "sessions.db")
        })()
    const db = new Database(dbPath)
    try {
      const removed = purgeExpired(db)
      const ttl = getSessionTtlDays()
      console.log(`[purge] ${removed} sesi dihapus (lebih tua dari ${ttl} hari)`)
    } finally {
      db.close()
    }
    process.exit(0)
  } else {
    const asked = sub === "--help" || sub === "-h"
    if (!asked) console.error(`subcommand sessions tidak dikenal: ${sub}\n`)
    console.log(SESSIONS_HELP)
    process.exit(asked ? 0 : 1)
  }
}
