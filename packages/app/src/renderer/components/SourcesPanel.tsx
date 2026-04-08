import { useState, useEffect, useCallback } from 'react'
import type { OpenCLISource, PlatformInfo, ConnectorStatus } from '@spool/core'

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
  zhihu: '#0066FF',
  bilibili: '#FB7299',
  weibo: '#E6162D',
  xiaohongshu: '#FE2C55',
  douban: '#007722',
  substack: '#FF6719',
  medium: '#292929',
  linkedin: '#0A66C2',
  instagram: '#E4405F',
  facebook: '#1877F2',
  notion: '#000000',
  jike: '#FFE411',
  tiktok: '#010101',
  douyin: '#010101',
  v2ex: '#1A1A1A',
  devto: '#0A0A0A',
  lobsters: '#AC130D',
  stackoverflow: '#F48024',
  wikipedia: '#636466',
  steam: '#1B2838',
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
  const [sources, setSources] = useState<OpenCLISource[]>([])
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([])
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [connectorCounts, setConnectorCounts] = useState<Record<string, number>>({})
  const [showPicker, setShowPicker] = useState(false)
  const [syncing, setSyncing] = useState<number | null>(null)
  const [syncingConnector, setSyncingConnector] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<Record<string, { page: number; added: number; phase: string }>>({})
  const [syncError, setSyncError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const loadSources = useCallback(async () => {
    if (!window.spool?.opencli) return
    const list = await window.spool.opencli.listSources()
    setSources(list)
  }, [])

  const loadPlatforms = useCallback(async () => {
    if (!window.spool?.opencli) return
    const list = await window.spool.opencli.availablePlatforms()
    setPlatforms(list)
  }, [])

  const loadConnectors = useCallback(async () => {
    if (!window.spool?.connectors) return
    const list = await window.spool.connectors.list()
    setConnectors(list)
    // Load real capture counts from DB
    const counts: Record<string, number> = {}
    for (const c of list) {
      counts[c.id] = await window.spool.connectors.getCaptureCount(c.id)
    }
    setConnectorCounts(counts)
  }, [])

  useEffect(() => { loadSources(); loadPlatforms(); loadConnectors() }, [loadSources, loadPlatforms, loadConnectors])

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
      }
    })
    return off
  }, [loadConnectors])

  /** Resolve a friendly label for a connected source */
  const sourceLabel = useCallback((src: OpenCLISource) => {
    const match = platforms.find(p => p.platform === src.platform && p.command === src.command)
    return match?.label ?? `Your ${src.platform} ${src.command}`
  }, [platforms])

  const handleAddSource = async (platform: string, command: string) => {
    if (!window.spool?.opencli) return
    await window.spool.opencli.addSource(platform, command)
    setShowPicker(false)
    setFilter('')
    await loadSources()
  }

  const handleRemoveSource = async (id: number) => {
    if (!window.spool?.opencli) return
    await window.spool.opencli.removeSource(id)
    await loadSources()
  }

  const handleConnectorSync = async (connectorId: string) => {
    if (!window.spool?.connectors) return
    setSyncingConnector(connectorId)
    setSyncError(null)
    try {
      await window.spool.connectors.syncNow(connectorId)
      // Status updates come via events
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

  const handleSync = async (src: OpenCLISource) => {
    if (!window.spool?.opencli) return
    setSyncing(src.id)
    setSyncError(null)
    try {
      const result = await window.spool.opencli.syncSource(src.id, src.platform, src.command)
      if (!result.ok) {
        setSyncError(`${src.platform} ${src.command}: ${result.error ?? 'Sync failed'}`)
      }
      await loadSources()
    } catch (err) {
      setSyncError(`${src.platform} ${src.command}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSyncing(null)
    }
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

          {/* Connected Platforms */}
          {sources.length > 0 && (
            <div className="mb-5">
              <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-2">
                Connected via OpenCLI
              </h3>
              {sources.map(src => (
                <div key={src.id} className="flex items-center gap-3 py-2.5 group">
                  <span
                    className="w-2 h-2 rounded-full flex-none"
                    style={{ background: PLATFORM_COLORS[src.platform] ?? '#888' }}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-warm-text dark:text-dark-text">
                      {sourceLabel(src)}
                    </span>
                    <span className="text-xs text-warm-faint dark:text-dark-muted ml-2">
                      {src.syncCount} items · {formatSyncTime(src.lastSynced)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleSync(src)}
                    disabled={syncing === src.id}
                    className="text-[11px] text-accent dark:text-accent-dark hover:underline disabled:opacity-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {syncing === src.id ? 'Syncing...' : 'Sync'}
                  </button>
                  <button
                    onClick={() => handleRemoveSource(src.id)}
                    className="text-warm-faint dark:text-dark-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Source */}
          {!showPicker ? (
            <button
              onClick={() => setShowPicker(true)}
              className="w-full py-3 border border-dashed border-warm-border2 dark:border-dark-border rounded-[8px] text-sm text-warm-muted dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark hover:border-accent/40 dark:hover:border-accent-dark/40 transition-colors"
            >
              + Add a source
            </button>
          ) : (
            <div>
              <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-2">
                Available Platforms
              </h3>
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter platforms..."
                autoFocus
                className="w-full mb-2 px-3 py-1.5 text-sm text-warm-text dark:text-dark-text bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[6px] placeholder:text-warm-faint dark:placeholder:text-dark-muted focus:outline-none focus:border-accent/40 dark:focus:border-accent-dark/40"
              />
              <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                {platforms
                  .filter(p => !filter || p.label.toLowerCase().includes(filter.toLowerCase()) || p.platform.toLowerCase().includes(filter.toLowerCase()))
                  .map(p => (
                  <button
                    key={`${p.platform}-${p.command}`}
                    onClick={() => handleAddSource(p.platform, p.command)}
                    className="text-left px-3 py-2 text-sm text-warm-text dark:text-dark-text bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[6px] hover:border-accent/40 dark:hover:border-accent-dark/40 transition-colors"
                  >
                    <span className="block font-medium">{p.label}</span>
                    {p.description && (
                      <span className="block text-[11px] text-warm-faint dark:text-dark-muted truncate">{p.description}</span>
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setShowPicker(false); setFilter('') }}
                className="mt-2 text-xs text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text"
              >
                Cancel
              </button>
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
