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

export async function handleSessions(
  args: string[],
  getArg: (name: string) => string | undefined,
): Promise<never> {
  const sub = args[1]
  if (sub === "list" || !sub) {
    const cwdArg = getArg("--cwd")
    const rows = listSessions(cwdArg)
    if (rows.length === 0) console.log(c.dim("(no sessions recorded)"))
    else {
      const tableData = rows.map((r) => ({
        id: c.cyan(r.id),
        date: new Date(r.created_at).toLocaleString(),
        cwd: c.dim(r.cwd),
      }))
      console.log(
        `\n${c.bold("Recent Sessions")}\n` +
          renderTable(
            [
              { header: "Session ID", key: "id", width: 14 },
              { header: "Created At", key: "date", width: 22 },
              { header: "Workspace Directory", key: "cwd", width: 36 },
            ],
            tableData,
          ) +
          "\n",
      )
    }
    process.exit(0)
  } else if (sub === "export") {
    const id = args[2]
    const asJsonl = args.includes("--jsonl")
    if (!id) {
      console.error("usage: minicode sessions export <id> [--jsonl]")
      process.exit(1)
    }
    const sess = loadSession(id, getArg("--cwd"))
    if (!sess) {
      console.error(`session ${id} not found`)
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
      console.log(`[purge] removed ${removed} session(s) older than ${ttl} day(s)`)
    } finally {
      db.close()
    }
    process.exit(0)
  } else {
    console.log("unknown sessions subcommand")
    process.exit(0)
  }
}
