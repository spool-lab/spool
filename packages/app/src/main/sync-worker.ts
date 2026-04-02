import { parentPort } from 'node:worker_threads'
import { getDB, Syncer } from '@spool/core'
import type { SyncProgressEvent } from '@spool/core'
import type { SyncResult } from '@spool/core'

export type SyncWorkerMessage =
  | { type: 'progress'; data: SyncProgressEvent }
  | { type: 'done'; result: SyncResult }
  | { type: 'error'; error: string }

const db = getDB()
const syncer = new Syncer(db, (event) => {
  parentPort?.postMessage({ type: 'progress', data: event } satisfies SyncWorkerMessage)
})

try {
  const result = syncer.syncAll()
  parentPort?.postMessage({ type: 'done', result } satisfies SyncWorkerMessage)
} catch (err) {
  parentPort?.postMessage({ type: 'error', error: String(err) } satisfies SyncWorkerMessage)
}
