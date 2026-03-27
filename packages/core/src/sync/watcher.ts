import chokidar, { type FSWatcher } from 'chokidar'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Syncer } from './syncer.js'
// No native module dependencies — uses node:sqlite via @spool/core

export type WatcherEvent = 'new-sessions'
export type WatcherEventCallback = (event: WatcherEvent, data: { count: number }) => void

export class SpoolWatcher {
  private watcher: FSWatcher | null = null
  private listeners: WatcherEventCallback[] = []
  private pendingNew = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private syncer: Syncer) {}

  start(): void {
    const claudeBase = process.env['SPOOL_CLAUDE_DIR'] ?? join(homedir(), '.claude', 'projects')
    const codexBase = process.env['SPOOL_CODEX_DIR'] ?? join(homedir(), '.codex', 'sessions')
    const patterns = [
      join(claudeBase, '**', '*.jsonl'),
      join(codexBase, '**', '*.jsonl'),
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
    const source = filePath.includes('/.claude/') ? 'claude' : 'codex'
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
