import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

function dbPath(cwd?: string): string {
  const local = resolve(cwd ?? process.cwd(), ".minicode", "sessions.db");
  if (existsSync(local)) return local;
  const global = join(homedir(), ".minicode", "sessions.db");
  mkdirSync(join(global, ".."), { recursive: true });
  return global;
}

function open(cwd?: string): Database {
  const p = dbPath(cwd);
  const db = new Database(p);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created_at INTEGER, cwd TEXT, system TEXT);
    CREATE TABLE IF NOT EXISTS messages (session_id TEXT, seq INTEGER, role TEXT, content TEXT, toolCalls TEXT, ts INTEGER, PRIMARY KEY(session_id, seq));
    CREATE TABLE IF NOT EXISTS turns (session_id TEXT, turn_idx INTEGER, usage TEXT, ts INTEGER, PRIMARY KEY(session_id, turn_idx));
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
  `);
  return db;
}

export function saveSession(id: string, cwd: string | undefined, system: string | undefined, messages: readonly unknown[], usage: unknown) {
  const db = open(cwd);
  const now = Date.now();
  db.prepare("INSERT OR REPLACE INTO sessions (id, created_at, cwd, system) VALUES (?, ?, ?, ?)").run(id, now, cwd ?? "", system ?? "");
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
  const ins = db.prepare("INSERT INTO messages (session_id, seq, role, content, toolCalls, ts) VALUES (?, ?, ?, ?, ?, ?)");
  const txn = db.transaction((msgs: readonly unknown[]) => {
    msgs.forEach((m: unknown, i: number) => {
      const msg = m as { role: string; content: unknown; toolCalls?: unknown };
      ins.run(id, i, msg.role, JSON.stringify(msg.content), JSON.stringify(msg.toolCalls ?? null), now);
    });
  });
  txn(messages);
  if (usage) {
    db.prepare("INSERT OR REPLACE INTO turns (session_id, turn_idx, usage, ts) VALUES (?, ?, ?, ?)").run(id, 0, JSON.stringify(usage), now);
  }
  db.close();
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

export function listSessions(cwd?: string): { id: string; created_at: number; cwd: string }[] {
  const db = open(cwd);
  const rows = db.prepare("SELECT id, created_at, cwd FROM sessions ORDER BY created_at DESC LIMIT 50").all() as { id: string; created_at: number; cwd: string }[];
  db.close();
  return rows;
}

export function deleteSession(id: string, cwd?: string) {
  const db = open(cwd);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  db.close();
}
