import { useState, useEffect, useCallback } from 'react'
import type { ConnectorStatus } from '@spool/core'

interface Props {
  onClose: () => void
  claudeCount: number | null
  codexCount: number | null
  geminiCount?: number | null
}

/** Source badge color by platform */
const PLATFORM_COLORS: Record<string, string> = {
  claude: '#6B5B8A',
  codex: '#1A6B3C',
  gemini: '#4285F4',
  twitter: '#3A3A3A',
  github: '#555555',
  youtube: '#B22222',
  reddit: '#FF4500',
  hackernews: '#FF6600',
  bilibili: '#FB7299',
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'never synced'
  const utcIso = iso.endsWith('Z') ? iso : iso + 'Z'
  const diff = Date.now() - new Date(utcIso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function SourcesPanel({ onClose, claudeCount, codexCount, geminiCount = null }: Props) {
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [connectorCounts, setConnectorCounts] = useState<Record<string, number>>({})
  const [syncingConnector, setSyncingConnector] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<Record<string, { page: number; added: number; phase: string }>>({})
  const [syncError, setSyncError] = useState<string | null>(null)

  const loadConnectors = useCallback(async () => {
    if (!window.spool?.connectors) return
    const list = await window.spool.connectors.list()
    setConnectors(list)
    const counts: Record<string, number> = {}
    for (const c of list) {
      counts[c.id] = await window.spool.connectors.getCaptureCount(c.id)
    }
    setConnectorCounts(counts)
  }, [])

  useEffect(() => { loadConnectors() }, [loadConnectors])

  // Listen for connector sync events to update status
  useEffect(() => {
    if (!window.spool?.connectors) return () => {}
    const off = window.spool.connectors.onEvent((event) => {
      if (event.type === 'sync-start') {
        setSyncingConnector(event.connectorId ?? null)
        setSyncProgress(prev => {
          const next = { ...prev }
          if (event.connectorId) next[event.connectorId] = { page: 0, added: 0, phase: 'starting' }
          return next
        })
      } else if (event.type === 'sync-progress') {
        const p = event.progress as { connectorId: string; phase: string; page: number; added: number } | undefined
        if (p) {
          setSyncProgress(prev => ({ ...prev, [p.connectorId]: { page: p.page, added: p.added, phase: p.phase } }))
        }
      } else if (event.type === 'sync-complete' || event.type === 'sync-error') {
        setSyncingConnector(null)
        setSyncProgress(prev => {
          const next = { ...prev }
          if (event.connectorId) delete next[event.connectorId]
          return next
        })
        loadConnectors()
      } else if (event.type === 'installed') {
        loadConnectors()
      }
    })
    return off
  }, [loadConnectors])

  const handleConnectorSync = async (connectorId: string) => {
    if (!window.spool?.connectors) return
    setSyncingConnector(connectorId)
    setSyncError(null)
    try {
      await window.spool.connectors.syncNow(connectorId)
    } catch (err) {
      setSyncError(`${connectorId}: ${err instanceof Error ? err.message : String(err)}`)
      setSyncingConnector(null)
    }
  }

  const handleEnableConnector = async (connectorId: string) => {
    if (!window.spool?.connectors) return
    await window.spool.connectors.setEnabled(connectorId, true)
    await loadConnectors()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[500px] max-h-[80vh] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border rounded-[10px] shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-border dark:border-dark-border">
          <h2 className="text-base font-semibold text-warm-text dark:text-dark-text">Your sources</h2>
          <button onClick={onClose} className="text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Agent Sessions (always on) */}
          <div className="mb-5">
            <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-2">
              Agent Sessions
            </h3>
            <BuiltInSource name="Claude Code" color={PLATFORM_COLORS['claude']!} count={claudeCount} />
            <BuiltInSource name="Codex CLI" color={PLATFORM_COLORS['codex']!} count={codexCount} />
            <BuiltInSource name="Gemini CLI" color={PLATFORM_COLORS['gemini']!} count={geminiCount} />
          </div>

          {/* Native Connectors */}
          {connectors.length > 0 && (
            <div className="mb-5">
              <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-2">
                Connectors
              </h3>
              {connectors.map(c => {
                const isSyncing = syncingConnector === c.id || c.syncing
                const progress = syncProgress[c.id]
                return (
                  <div key={c.id} className="py-2.5 group">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-2 h-2 rounded-full flex-none"
                        style={{ background: c.enabled ? c.color : '#888' }}
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm ${c.enabled ? 'text-warm-text dark:text-dark-text' : 'text-warm-muted dark:text-dark-muted'}`}>
                          {c.label}
                        </span>
                        <span className="text-xs text-warm-faint dark:text-dark-muted ml-2">
                          {!c.enabled
                            ? 'Not connected'
                            : isSyncing && progress
                              ? `page ${progress.page} · ${progress.added} new`
                              : (connectorCounts[c.id] ?? 0) > 0
                                ? `${connectorCounts[c.id]} items · ${formatSyncTime(c.state.lastForwardSyncAt)}${!c.state.tailComplete ? ' · syncing history' : ''}`
                                : c.state.lastErrorCode
                                  ? c.state.lastErrorMessage ?? 'Error'
                                  : 'Not synced yet'}
                        </span>
                      </div>
                      {!c.enabled ? (
                        <button
                          onClick={() => handleEnableConnector(c.id)}
                          className="text-[11px] text-accent dark:text-accent-dark hover:underline"
                        >
                          Connect
                        </button>
                      ) : (
                        <>
                          {!isSyncing && c.state.lastErrorCode?.startsWith('AUTH_') && (
                            <span className="text-[10px] text-amber-500 font-medium">needs login</span>
                          )}
                          <button
                            onClick={() => handleConnectorSync(c.id)}
                            disabled={isSyncing}
                            className="text-[11px] text-accent dark:text-accent-dark hover:underline disabled:opacity-50 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            {isSyncing ? 'Syncing...' : 'Sync'}
                          </button>
                        </>
                      )}
                    </div>
                    {isSyncing && progress && (
                      <div className="ml-5 mt-1 flex items-center gap-2">
                        <div className="h-1 w-3 rounded-full bg-accent dark:bg-accent-dark animate-pulse" />
                        <span className="text-[10px] text-warm-faint dark:text-dark-muted">
                          {progress.phase === 'forward' ? 'Fetching new items' : 'Backfilling history'}...
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
              {connectors.some(c => c.state.lastErrorCode) && (
                <div className="mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-[6px]">
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {connectors.find(c => c.state.lastErrorCode)?.state.lastErrorMessage}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Sync Error */}
          {syncError && (
            <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-[6px]">
              <p className="text-xs text-red-500">{syncError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-warm-border dark:border-dark-border text-[11px] text-warm-faint dark:text-dark-muted">
          All data stays local in ~/.spool/
        </div>
      </div>
    </div>
  )
}

function BuiltInSource({ name, color, count }: { name: string; color: string; count: number | null }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-2 h-2 rounded-full flex-none" style={{ background: color }} />
      <span className="flex-1 text-sm text-warm-text dark:text-dark-text">{name}</span>
      <span className="text-xs text-warm-faint dark:text-dark-muted tabular-nums font-mono">
        {count === null ? '...' : `${count} sessions`}
      </span>
      <span className="text-[10px] text-green-500 font-medium">auto</span>
    </div>
  )
}
