import chokidar, { type FSWatcher } from 'chokidar'
import type { Syncer } from './syncer.js'
import type { SessionSource } from '../types.js'
import { detectSessionSource, getSessionRoots, getSessionWatchPatterns } from './source-paths.js'
// No native module dependencies — uses node:sqlite via @spool/core

export type WatcherEvent = 'new-sessions'
export type WatcherEventCallback = (event: WatcherEvent, data: { count: number }) => void

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
    const patterns = [
      ...getSessionWatchPatterns('claude', this.sourceRoots.claude),
      ...getSessionWatchPatterns('codex', this.sourceRoots.codex),
      ...getSessionWatchPatterns('gemini', this.sourceRoots.gemini),
    ]

    this.watcher = chokidar.watch(patterns, {
      persistent: true,
      ignoreInitial: true, // initial sync is done by Syncer.syncAll()
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
