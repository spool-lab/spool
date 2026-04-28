import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, statSync } from 'node:fs'

export const SPOOL_DIR = process.env['SPOOL_DATA_DIR'] ?? join(homedir(), '.spool')
export const DB_PATH = join(SPOOL_DIR, 'spool.db')

let _db: Database.Database | null = null
let _wasNewDb = false
let _initialUserVersion: number | null = null

export function getDB(_readonly = false): Database.Database {
  if (_db) return _db
  mkdirSync(SPOOL_DIR, { recursive: true })
  // Capture pre-open state before better-sqlite3 creates the file. These two
  // signals together let callers tell apart "fresh install" from "upgrade":
  //   - wasNewDb=true  → DB file did not exist; this is a first-time install
  //   - wasNewDb=false → upgrade path, and initialUserVersion tells you from where
  _wasNewDb = !existsSync(DB_PATH)
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  _initialUserVersion = (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version ?? 0
  runMigrations(db)
  _db = db
  return db
}

/** True if the DB file did not exist before this process opened it. */
export function wasNewDb(): boolean { return _wasNewDb }

/** user_version of the DB before any migrations ran this process. Null if getDB() hasn't been called. */
export function getInitialUserVersion(): number | null { return _initialUserVersion }

export function getDBSize(): number {
  try {
    return statSync(DB_PATH).size
  } catch {
    return 0
  }
}

export function runMigrations(db: Database.Database): void {
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

    -- ── Stars ─────────────────────────────────────────────────────────────
    -- Star table keyed by session_uuid (natural id, stable across re-index).
    -- No FK — queries filter orphans at read time via JOIN, so transient
    -- referent absence (e.g. transcript file removed then restored) doesn't
    -- destroy the star. CHECK constraint guards against typos in item_type.
    CREATE TABLE IF NOT EXISTS stars (
      item_type  TEXT NOT NULL CHECK (item_type = 'session'),
      item_uuid  TEXT NOT NULL,
      starred_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (item_type, item_uuid)
    );

    CREATE INDEX IF NOT EXISTS idx_stars_starred_at ON stars(starred_at DESC);
  `)

  db.exec(`
    DROP TRIGGER IF EXISTS messages_fts_insert;
    DROP TRIGGER IF EXISTS messages_fts_delete;
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

  // ── Incremental migrations ──────────────────────────────────────────────
  // Use SQLite's built-in user_version pragma to track schema version.
  // Each migration runs exactly once. Add new migrations at the end with
  // the next sequential version number.
  const version = (db.pragma('user_version') as [{ user_version: number }])[0].user_version

  // Historical connector migrations (v1-v3): all operate on the captures /
  // connector_sync_state tables that were dropped in v5. Wrapped to no-op
  // when those tables aren't present (fresh install on the post-v5 schema).
  if (version < 1) {
    try { db.exec('ALTER TABLE connector_sync_state ADD COLUMN last_error_at TEXT') } catch {}
    db.pragma('user_version = 1')
  }

  if (version < 2) {
    try { db.exec("INSERT INTO captures_fts(captures_fts) VALUES('rebuild')") } catch {}
    try { db.exec("INSERT INTO captures_fts_trigram(captures_fts_trigram) VALUES('rebuild')") } catch {}
    db.pragma('user_version = 2')
  }

  if (version < 3) {
    try {
      db.transaction(() => {
        db.exec(`
          INSERT OR IGNORE INTO capture_connectors (capture_id, connector_id)
          SELECT id, json_extract(metadata, '$.connectorId')
          FROM captures
          WHERE json_extract(metadata, '$.connectorId') IS NOT NULL
        `)
        db.exec(`
          UPDATE captures
          SET metadata = json_remove(metadata, '$.connectorId')
          WHERE json_extract(metadata, '$.connectorId') IS NOT NULL
        `)
        db.exec(`
          UPDATE captures
          SET source_id = (SELECT id FROM sources WHERE name = 'connector')
          WHERE id IN (SELECT capture_id FROM capture_connectors)
        `)
        db.exec(`DROP INDEX IF EXISTS idx_captures_source`)
      })()
    } catch {}
    db.pragma('user_version = 3')
  }

  if (version < 4) {
    // v4: stars table. Created with the historical wide CHECK; v5 narrows it.
    db.exec(`
      DROP TABLE IF EXISTS session_stars;
      CREATE TABLE IF NOT EXISTS stars (
        item_type  TEXT NOT NULL CHECK (item_type IN ('session', 'capture')),
        item_uuid  TEXT NOT NULL,
        starred_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_type, item_uuid)
      );
      CREATE INDEX IF NOT EXISTS idx_stars_starred_at ON stars(starred_at DESC);
    `)
    db.pragma('user_version = 4')
  }

  if (version < 5) {
    // v5: connector subsystem removed. Drop captures + connector_sync_state
    // tables, narrow stars CHECK to session-only.
    //
    // SQLite can't ALTER a CHECK constraint, so we rebuild the stars table.
    // For users who never had the wide CHECK (fresh install on post-v5
    // schema), the rebuild is a no-op rename round-trip — safe and cheap.
    // Captures data is dropped without backup; users were directed to Spool
    // Daemon for connector functionality.
    db.transaction(() => {
      db.exec(`DROP TRIGGER IF EXISTS captures_fts_insert`)
      db.exec(`DROP TRIGGER IF EXISTS captures_fts_delete`)
      db.exec(`DROP TABLE IF EXISTS captures_fts_trigram`)
      db.exec(`DROP TABLE IF EXISTS captures_fts`)
      db.exec(`DROP TABLE IF EXISTS capture_connectors`)
      db.exec(`DROP TABLE IF EXISTS captures`)
      db.exec(`DROP TABLE IF EXISTS connector_sync_state`)

      db.exec(`DELETE FROM stars WHERE item_type = 'capture'`)
      db.exec(`
        CREATE TABLE stars_new (
          item_type  TEXT NOT NULL CHECK (item_type = 'session'),
          item_uuid  TEXT NOT NULL,
          starred_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (item_type, item_uuid)
        );
        INSERT INTO stars_new (item_type, item_uuid, starred_at)
          SELECT item_type, item_uuid, starred_at FROM stars;
        DROP TABLE stars;
        ALTER TABLE stars_new RENAME TO stars;
        CREATE INDEX IF NOT EXISTS idx_stars_starred_at ON stars(starred_at DESC);
      `)

      db.exec(`DELETE FROM sources WHERE name = 'connector'`)
    })()
    db.pragma('user_version = 5')
  }

  if (version < 6) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE projects ADD COLUMN identity_kind TEXT;
        ALTER TABLE projects ADD COLUMN identity_key  TEXT;
        CREATE INDEX IF NOT EXISTS idx_projects_identity
          ON projects (identity_kind, identity_key);

        CREATE VIEW IF NOT EXISTS project_groups_v AS
        SELECT
          p.identity_kind,
          p.identity_key,
          MIN(p.display_name)              AS display_name,
          GROUP_CONCAT(DISTINCT s.name)    AS sources_csv,
          COALESCE(SUM(c.session_count),0) AS session_count,
          MAX(c.last_session_at)           AS last_session_at
        FROM projects p
        JOIN sources s ON s.id = p.source_id
        LEFT JOIN (
          SELECT project_id,
                 COUNT(*)         AS session_count,
                 MAX(started_at)  AS last_session_at
          FROM sessions
          GROUP BY project_id
        ) c ON c.project_id = p.id
        WHERE p.identity_kind IS NOT NULL
        GROUP BY p.identity_kind, p.identity_key;
      `)
    })()
    db.pragma('user_version = 6')
  }

  rebuildFtsTableIfEmpty(db, 'messages', 'messages_fts_trigram')
  rebuildFtsTableIfEmpty(db, 'session_search', 'session_search_fts')
  rebuildFtsTableIfEmpty(db, 'session_search', 'session_search_fts_trigram')
}

function rebuildFtsTableIfEmpty(
  db: Database.Database,
  contentTable: 'messages' | 'session_search',
  ftsTable:
    | 'messages_fts_trigram'
    | 'session_search_fts'
    | 'session_search_fts_trigram',
): void {
  const sourceCount = (db.prepare(`SELECT COUNT(*) AS count FROM ${contentTable}`).get() as { count: number }).count
  if (sourceCount === 0) return

  const indexCount = (db.prepare(`SELECT COUNT(*) AS count FROM ${ftsTable}`).get() as { count: number }).count
  if (indexCount > 0) return

  db.exec(`INSERT INTO ${ftsTable}(${ftsTable}) VALUES('rebuild')`)
}
