import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

function dbPath(cwd?: string): string {
  const local = resolve(cwd ?? process.cwd(), ".minicode", "sessions.db");
  const localDir = resolve(cwd ?? process.cwd(), ".minicode");
  if (existsSync(local)) return local;
  if (existsSync(localDir)) {
    mkdirSync(localDir, { recursive: true });
    return local;
  }
  const global = join(homedir(), ".minicode", "sessions.db");
  mkdirSync(join(global, ".."), { recursive: true });
  return global;
}

function open(cwd?: string): Database {
  const p = dbPath(cwd);
  const db = new Database(p);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA synchronous=NORMAL;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at INTEGER, cwd TEXT, system TEXT);
    CREATE TABLE IF NOT EXISTS messages (session_id TEXT, seq INTEGER, role TEXT, content TEXT, toolCalls TEXT, ts INTEGER, PRIMARY KEY(session_id, seq));
    CREATE TABLE IF NOT EXISTS turns (session_id TEXT, turn_idx INTEGER, usage TEXT, ts INTEGER, PRIMARY KEY(session_id, turn_idx));
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
  `);
  // migration: add updated_at column if missing (for old DBs)
  try {
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "updated_at")) {
      db.exec("ALTER TABLE sessions ADD COLUMN updated_at INTEGER");
      db.exec("UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL");
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC)`);
  } catch {}
  return db;
}

export function saveSession(id: string, cwd: string | undefined, system: string | undefined, messages: readonly unknown[], usage: unknown) {
  const db = open(cwd);
  const now = Date.now();
  const txn = db.transaction(() => {
    const existing = db.prepare("SELECT created_at, updated_at FROM sessions WHERE id = ?").get(id) as { created_at: number; updated_at: number | null } | null;
    const createdAt = existing?.created_at ?? now;
    db.prepare("INSERT OR REPLACE INTO sessions (id, created_at, updated_at, cwd, system) VALUES (?, ?, ?, ?, ?)").run(id, createdAt, now, cwd ?? "", system ?? "");
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    const ins = db.prepare("INSERT INTO messages (session_id, seq, role, content, toolCalls, ts) VALUES (?, ?, ?, ?, ?, ?)");
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as { role: string; content: unknown; toolCalls?: unknown };
      ins.run(id, i, m.role, JSON.stringify(m.content), JSON.stringify(m.toolCalls ?? null), now);
    }
    if (usage) {
      const maxRow = db.prepare("SELECT MAX(turn_idx) as m FROM turns WHERE session_id = ?").get(id) as { m: number | null } | null;
      const nextIdx = (maxRow?.m ?? -1) + 1;
      db.prepare("INSERT INTO turns (session_id, turn_idx, usage, ts) VALUES (?, ?, ?, ?)").run(id, nextIdx, JSON.stringify(usage), now);
    }
  });
  try {
    txn();
  } finally {
    db.close();
  }
}

export function loadSession(id: string, cwd?: string): { messages: unknown[]; system?: string; cwd?: string } | null {
  const db = open(cwd);
  const sess = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as { system: string; cwd: string } | null;
  if (!sess) {
    db.close();
    return null;
  }
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq").all(id) as { role: string; content: string; toolCalls: string }[];
  const messages = rows.map((r) => ({
    role: r.role,
    content: JSON.parse(r.content),
    ...(r.toolCalls && r.toolCalls !== "null" ? { toolCalls: JSON.parse(r.toolCalls) } : {}),
  }));
  db.close();
  return { messages, system: sess.system, cwd: sess.cwd };
}

export function listSessions(cwd?: string): { id: string; created_at: number; updated_at?: number; cwd: string }[] {
  const db = open(cwd);
  const rows = db
    .prepare("SELECT id, created_at, updated_at, cwd FROM sessions ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 50")
    .all() as { id: string; created_at: number; updated_at: number | null; cwd: string }[];
  db.close();
  return rows.map((r) => ({ ...r, updated_at: r.updated_at ?? r.created_at }));
}

export function deleteSession(id: string, cwd?: string) {
  const db = open(cwd);
  const txn = db.transaction(() => {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  });
  try {
    txn();
  } finally {
    db.close();
  }
}

export function vacuumSessions(cwd?: string) {
  const db = open(cwd);
  try {
    // keep only 100 most recent sessions
    db.exec(`DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 100)`);
    db.exec(`DELETE FROM messages WHERE session_id NOT IN (SELECT id FROM sessions)`);
    db.exec(`DELETE FROM turns WHERE session_id NOT IN (SELECT id FROM sessions)`);
    db.exec("VACUUM");
  } finally {
    db.close();
  }
}
