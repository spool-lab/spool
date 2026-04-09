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
      ('codex',  '~/.codex/sessions'),
      ('gemini', '~/.gemini/tmp');

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

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(
      content_text,
      content='messages',
      content_rowid='id',
      tokenize='trigram'
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id        INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES sources(id),
      file_path TEXT NOT NULL,
      status    TEXT NOT NULL,
      message   TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_search (
      session_id      INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      title           TEXT NOT NULL DEFAULT '',
      user_text       TEXT NOT NULL DEFAULT '',
      assistant_text  TEXT NOT NULL DEFAULT '',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts USING fts5(
      title,
      user_text,
      assistant_text,
      content='session_search',
      content_rowid='session_id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts_trigram USING fts5(
      title,
      user_text,
      assistant_text,
      content='session_search',
      content_rowid='session_id',
      tokenize='trigram'
    );

    -- ── Captures (connector items) ─────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS captures (
      id              INTEGER PRIMARY KEY,
      source_id       INTEGER NOT NULL REFERENCES sources(id),
      capture_uuid    TEXT NOT NULL UNIQUE,
      url             TEXT NOT NULL,
      title           TEXT NOT NULL DEFAULT '',
      content_text    TEXT NOT NULL DEFAULT '',
      author          TEXT,
      platform        TEXT NOT NULL,
      platform_id     TEXT,
      content_type    TEXT NOT NULL DEFAULT 'page',
      thumbnail_url   TEXT,
      metadata        TEXT NOT NULL DEFAULT '{}',
      captured_at     TEXT NOT NULL,
      indexed_at      TEXT NOT NULL DEFAULT (datetime('now')),
      raw_json        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_captures_source   ON captures(source_id);
    CREATE INDEX IF NOT EXISTS idx_captures_platform ON captures(platform);
    CREATE INDEX IF NOT EXISTS idx_captures_url      ON captures(url);
    CREATE INDEX IF NOT EXISTS idx_captures_captured ON captures(captured_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
      title,
      content_text,
      content='captures',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 1'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts_trigram USING fts5(
      title,
      content_text,
      content='captures',
      content_rowid='id',
      tokenize='trigram'
    );

    -- ── Connector sync state ────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS connector_sync_state (
      connector_id        TEXT PRIMARY KEY,
      head_cursor         TEXT,
      head_item_id        TEXT,
      tail_cursor         TEXT,
      tail_complete       INTEGER NOT NULL DEFAULT 0,
      last_forward_sync_at  TEXT,
      last_backfill_sync_at TEXT,
      total_synced        INTEGER NOT NULL DEFAULT 0,
      consecutive_errors  INTEGER NOT NULL DEFAULT 0,
      enabled             INTEGER NOT NULL DEFAULT 1,
      config_json         TEXT NOT NULL DEFAULT '{}',
      last_error_code     TEXT,
      last_error_message  TEXT
    );
  `)

  db.exec(`
    DROP TRIGGER IF EXISTS messages_fts_insert;
    DROP TRIGGER IF EXISTS messages_fts_delete;
    DROP TRIGGER IF EXISTS captures_fts_insert;
    DROP TRIGGER IF EXISTS captures_fts_delete;
    DROP TRIGGER IF EXISTS session_search_fts_insert;
    DROP TRIGGER IF EXISTS session_search_fts_update;
    DROP TRIGGER IF EXISTS session_search_fts_delete;

    CREATE TRIGGER messages_fts_insert
    AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
      INSERT INTO messages_fts_trigram(rowid, content_text)
        VALUES(NEW.id, NEW.content_text);
    END;

    CREATE TRIGGER messages_fts_delete
    AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_text)
        VALUES('delete', OLD.id, OLD.content_text);
      INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content_text)
        VALUES('delete', OLD.id, OLD.content_text);
    END;

    CREATE TRIGGER captures_fts_insert
    AFTER INSERT ON captures BEGIN
      INSERT INTO captures_fts(rowid, title, content_text)
        VALUES(NEW.id, NEW.title, NEW.content_text);
      INSERT INTO captures_fts_trigram(rowid, title, content_text)
        VALUES(NEW.id, NEW.title, NEW.content_text);
    END;

    CREATE TRIGGER captures_fts_delete
    AFTER DELETE ON captures BEGIN
      INSERT INTO captures_fts(captures_fts, rowid, title, content_text)
        VALUES('delete', OLD.id, OLD.title, OLD.content_text);
      INSERT INTO captures_fts_trigram(captures_fts_trigram, rowid, title, content_text)
        VALUES('delete', OLD.id, OLD.title, OLD.content_text);
    END;

    CREATE TRIGGER session_search_fts_insert
    AFTER INSERT ON session_search BEGIN
      INSERT INTO session_search_fts(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
      INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    END;

    CREATE TRIGGER session_search_fts_update
    AFTER UPDATE ON session_search BEGIN
      INSERT INTO session_search_fts(session_search_fts, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
      INSERT INTO session_search_fts_trigram(session_search_fts_trigram, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts_trigram(rowid, title, user_text, assistant_text)
        VALUES(NEW.session_id, NEW.title, NEW.user_text, NEW.assistant_text);
    END;

    CREATE TRIGGER session_search_fts_delete
    AFTER DELETE ON session_search BEGIN
      INSERT INTO session_search_fts(session_search_fts, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
      INSERT INTO session_search_fts_trigram(session_search_fts_trigram, rowid, title, user_text, assistant_text)
        VALUES('delete', OLD.session_id, OLD.title, OLD.user_text, OLD.assistant_text);
    END;
  `)

  rebuildFtsTableIfEmpty(db, 'messages', 'messages_fts_trigram')
  rebuildFtsTableIfEmpty(db, 'captures', 'captures_fts_trigram')
  rebuildFtsTableIfEmpty(db, 'session_search', 'session_search_fts')
  rebuildFtsTableIfEmpty(db, 'session_search', 'session_search_fts_trigram')
}

function rebuildFtsTableIfEmpty(
  db: Database.Database,
  contentTable: 'messages' | 'captures' | 'session_search',
  ftsTable:
    | 'messages_fts_trigram'
    | 'captures_fts_trigram'
    | 'session_search_fts'
    | 'session_search_fts_trigram',
): void {
  const sourceCount = (db.prepare(`SELECT COUNT(*) AS count FROM ${contentTable}`).get() as { count: number }).count
  if (sourceCount === 0) return

  const indexCount = (db.prepare(`SELECT COUNT(*) AS count FROM ${ftsTable}`).get() as { count: number }).count
  if (indexCount > 0) return

  db.exec(`INSERT INTO ${ftsTable}(${ftsTable}) VALUES('rebuild')`)
}
