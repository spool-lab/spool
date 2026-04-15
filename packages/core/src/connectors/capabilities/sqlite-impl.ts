import Database from 'better-sqlite3'
import type { SqliteCapability, SqliteDatabase, SqliteStatement } from '@spool-lab/connector-sdk'

export function makeSqliteCapability(): SqliteCapability {
  return {
    openReadonly(path: string): SqliteDatabase {
      const db = new Database(path, { readonly: true, fileMustExist: true })
      return {
        prepare<T = unknown>(sql: string): SqliteStatement<T> {
          const stmt = db.prepare(sql)
          return {
            all: (...params) => stmt.all(...params) as T[],
            get: (...params) => stmt.get(...params) as T | undefined,
          }
        },
        close: () => { db.close() },
      }
    },
  }
}
