import chokidar, { type FSWatcher } from 'chokidar'
import type { Syncer } from './syncer.js'
import type { SessionSource } from '../types.js'
import { detectSessionSource, getSessionRoots } from './source-paths.js'
// No native module dependencies — uses node:sqlite via @spool/core

export type WatcherEvent = 'new-sessions'
export type WatcherEventCallback = (event: WatcherEvent, data: { count: number }) => void

/** Check if a file path is a session file we care about */
function isSessionFile(filePath: string): boolean {
  return filePath.endsWith('.jsonl')
    || (filePath.endsWith('.json') && /(?:^|[/\\])session-[^/\\]*\.json$/.test(filePath))
}

export class SpoolWatcher {
  private watcher: FSWatcher | null = null
  private listeners: WatcherEventCallback[] = []
  private pendingNew = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private sourceRoots: Record<SessionSource, string[]> = {
    claude: [],
    codex: [],
    gemini: [],
  }

  constructor(private syncer: Syncer) {}

  start(): void {
    this.sourceRoots = {
      claude: getSessionRoots('claude'),
      codex: getSessionRoots('codex'),
      gemini: getSessionRoots('gemini'),
    }
    // chokidar v4 removed glob support — watch directories directly
    // and use `ignored` to filter for session files only
    const dirs = [
      ...this.sourceRoots.claude,
      ...this.sourceRoots.codex,
      ...this.sourceRoots.gemini,
    ]

    this.watcher = chokidar.watch(dirs, {
      persistent: true,
      ignoreInitial: true, // initial sync is done by Syncer.syncAll()
      ignored: (path, stats) => stats?.isFile() === true && !isSessionFile(path),
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 200,
      },
    })

    this.watcher
      .on('add', (path) => this.handleFile(path))
      .on('change', (path) => this.handleFile(path))
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.flushTimer) clearTimeout(this.flushTimer)
  }

  on(event: WatcherEvent, cb: WatcherEventCallback): void {
    this.listeners.push(cb)
  }

  private handleFile(filePath: string): void {
    const source = detectSessionSource(filePath, this.sourceRoots)
    if (!source) return
    const result = this.syncer.syncFile(filePath, source)

    if (result === 'added' || result === 'updated') {
      this.pendingNew++
      // Debounce: flush all pending new-session events together
      if (this.flushTimer) clearTimeout(this.flushTimer)
      this.flushTimer = setTimeout(() => {
        const count = this.pendingNew
        this.pendingNew = 0
        this.listeners.forEach(cb => cb('new-sessions', { count }))
      }, 500)
    }
  }
}
