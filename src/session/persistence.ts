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
    CREATE TABLE IF NOT EXISTS messages (session_id TEXT, seq INTEGER, role TEXT, content TEXT, toolCalls TEXT, toolCallId TEXT, name TEXT, ts INTEGER, PRIMARY KEY(session_id, seq));
    CREATE TABLE IF NOT EXISTS turns (session_id TEXT, turn_idx INTEGER, usage TEXT, ts INTEGER, PRIMARY KEY(session_id, turn_idx));
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
  `);
  // migration: add updated_at, toolCallId, name jika kolom lama (backward-compat)
  try {
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "updated_at")) {
      db.exec("ALTER TABLE sessions ADD COLUMN updated_at INTEGER");
      db.exec("UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL");
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC)`);
  } catch {}
  try {
    const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (!msgCols.some((c) => c.name === "toolCallId")) {
      db.exec("ALTER TABLE messages ADD COLUMN toolCallId TEXT");
      db.exec("ALTER TABLE messages ADD COLUMN name TEXT");
    }
  } catch {}
  return db;
}

// JSON-safe serialization: konten binary (Uint8Array) jangan di-stringify jadi
// array ribuan angka — cukup placeholder agar DB tidak menggembung.
function safeContent(value: unknown): string {
  if (value instanceof Uint8Array) return `[binary: ${value.length} bytes]`;
  if (Array.isArray(value)) {
    for (const p of value) {
      if (p instanceof Uint8Array) return `[binary: ${value.length} parts]`;
      if (p && typeof p === "object" && (p as { data?: unknown }).data instanceof Uint8Array) {
        return `[binary: ${value.length} parts (image)]`;
      }
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function saveSession(id: string, cwd: string | undefined, system: string | undefined, messages: readonly unknown[], usage: unknown) {
  const db = open(cwd);
  const now = Date.now();
  const txn = db.transaction(() => {
    const existing = db.prepare("SELECT created_at, updated_at FROM sessions WHERE id = ?").get(id) as { created_at: number; updated_at: number | null } | null;
    const createdAt = existing?.created_at ?? now;
    db.prepare("INSERT OR REPLACE INTO sessions (id, created_at, updated_at, cwd, system) VALUES (?, ?, ?, ?, ?)").run(id, createdAt, now, cwd ?? "", system ?? "");
    const ins = db.prepare("INSERT INTO messages (session_id, seq, role, content, toolCalls, toolCallId, name, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const known = (db.prepare("SELECT COUNT(*) as c FROM messages WHERE session_id = ?").get(id) as { c: number } | null)?.c ?? 0;
    if (messages.length >= known) {
      // incremental append-only: cukup insert pesan baru (umumnya 1 turn)
      for (let i = known; i < messages.length; i++) {
        const m = messages[i] as { role: string; content: unknown; toolCalls?: unknown; toolCallId?: string; name?: string };
        ins.run(id, i, m.role, safeContent(m.content), safeContent(m.toolCalls ?? null), m.toolCallId ?? null, m.name ?? null, now);
      }
    } else {
      // history menyusut (compaction/reset) → tulis ulang penuh agar tidak ada
      // pesan basi yang tertinggal untuk resume
      db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i] as { role: string; content: unknown; toolCalls?: unknown; toolCallId?: string; name?: string };
        ins.run(id, i, m.role, safeContent(m.content), safeContent(m.toolCalls ?? null), m.toolCallId ?? null, m.name ?? null, now);
      }
    }
    if (usage) {
      const maxRow = db.prepare("SELECT MAX(turn_idx) as m FROM turns WHERE session_id = ?").get(id) as { m: number | null } | null;
      const nextIdx = (maxRow?.m ?? -1) + 1;
      db.prepare("INSERT INTO turns (session_id, turn_idx, usage, ts) VALUES (?, ?, ?, ?)").run(id, nextIdx, JSON.stringify(usage), now);
    }
    // TTL: hapus sesi basi + orphan rows (best-effort; 0 = forever)
    try {
      purgeExpired(db, now);
    } catch {}
  });
  try {
    txn();
  } finally {
    db.close();
  }
}

// TTL default 30 hari; MINICODE_SESSION_TTL_DAYS=0 = simpan selamanya.
export function getSessionTtlDays(): number {
  const raw = process.env.MINICODE_SESSION_TTL_DAYS;
  if (raw == null || raw === "") return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

export function purgeExpired(db: Database, now = Date.now()): number {
  const days = getSessionTtlDays();
  if (days <= 0) return 0;
  const ttlMs = days * 24 * 60 * 60 * 1000;
  const cutoff = now - ttlMs;
  const gone = db.prepare("DELETE FROM sessions WHERE COALESCE(updated_at, created_at) < ?").run(cutoff);
  db.prepare("DELETE FROM messages WHERE session_id NOT IN (SELECT id FROM sessions)").run();
  db.prepare("DELETE FROM turns WHERE session_id NOT IN (SELECT id FROM sessions)").run();
  return gone.changes;
}

function parseContent(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s; // placeholder "[binary: N bytes]" atau data yang bukan JSON
  }
}

export function loadSession(id: string, cwd?: string): { messages: unknown[]; system?: string; cwd?: string } | null {
  const db = open(cwd);
  const sess = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as { system: string; cwd: string } | null;
  if (!sess) {
    db.close();
    return null;
  }
  const rows = db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq").all(id) as { role: string; content: string; toolCalls: string; toolCallId: string | null; name: string | null }[];
  const messages = rows.map((r) => ({
    role: r.role,
    content: parseContent(r.content),
    ...(r.toolCalls && r.toolCalls !== "null" ? { toolCalls: parseContent(r.toolCalls) } : {}),
    ...(r.toolCallId ? { toolCallId: r.toolCallId } : {}),
    ...(r.name ? { name: r.name } : {}),
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

