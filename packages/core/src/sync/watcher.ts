import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'
import type { Syncer } from './syncer.js'
import { detectSessionSource, getSessionRoots } from './source-paths.js'
// No native module dependencies — uses node:sqlite via @spool/core

export type WatcherEvent = 'new-sessions'
export type WatcherEventCallback = (event: WatcherEvent, data: { count: number }) => void

export class SpoolWatcher {
  private watcher: FSWatcher | null = null
  private listeners: WatcherEventCallback[] = []
  private pendingNew = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private sourceRoots: Record<'claude' | 'codex', string[]> = {
    claude: [],
    codex: [],
  }

  constructor(private syncer: Syncer) {}

  start(): void {
    this.sourceRoots = {
      claude: getSessionRoots('claude'),
      codex: getSessionRoots('codex'),
    }
    const patterns = [...this.sourceRoots.claude, ...this.sourceRoots.codex].map(root => join(root, '**', '*.jsonl'))

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
