import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, statSync } from 'node:fs'

export const SPOOL_DIR = process.env['SPOOL_DATA_DIR'] ?? join(homedir(), '.spool')
export const DB_PATH = join(SPOOL_DIR, 'spool.db')

let _db: Database.Database | null = null

export function getDB(_readonly = false): Database.Database {
  if (_db) return _db
  mkdirSync(SPOOL_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  runMigrations(db)
  _db = db
  return db
}

export function getDBSize(): number {
  try {
    return statSync(DB_PATH).size
  } catch {
    return 0
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      base_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO sources (name, base_path) VALUES
      ('claude', '~/.claude/projects'),
      ('codex',  '~/.codex/sessions');

    CREATE TABLE IF NOT EXISTS projects (
      id           INTEGER PRIMARY KEY,
      source_id    INTEGER NOT NULL REFERENCES sources(id),
      slug         TEXT NOT NULL,
      display_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      last_synced  TEXT,
      UNIQUE (source_id, slug)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id             INTEGER PRIMARY KEY,
      project_id     INTEGER NOT NULL REFERENCES projects(id),
      source_id      INTEGER NOT NULL REFERENCES sources(id),
      session_uuid   TEXT NOT NULL UNIQUE,
      file_path      TEXT NOT NULL UNIQUE,
      title          TEXT,
      started_at     TEXT NOT NULL,
      ended_at       TEXT NOT NULL,
      message_count  INTEGER NOT NULL DEFAULT 0,
      has_tool_use   INTEGER NOT NULL DEFAULT 0,
      cwd            TEXT,
      model          TEXT,
      raw_file_mtime TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started  ON sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_source   ON sessions(source_id);

    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY,
      session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      source_id    INTEGER NOT NULL REFERENCES sources(id),
      msg_uuid     TEXT,
      parent_uuid  TEXT,
      role         TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '',
      timestamp    TEXT NOT NULL,
      is_sidechain INTEGER NOT NULL DEFAULT 0,
      tool_names   TEXT NOT NULL DEFAULT '[]',
      seq          INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content_text,
      content='messages',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE TRIGGER IF NOT EXISTS messages_fts_insert
    AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_delete
    AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_text)
        VALUES('delete', OLD.id, OLD.content_text);
    END;

    CREATE TABLE IF NOT EXISTS sync_log (
      id        INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES sources(id),
      file_path TEXT NOT NULL,
      status    TEXT NOT NULL,
      message   TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}
