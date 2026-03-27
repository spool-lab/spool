import { useState, useEffect, useCallback } from 'react'
import type { OpenCLISource, PlatformInfo } from '@spool/core'

interface Props {
  onClose: () => void
  claudeCount: number | null
  codexCount: number | null
}

/** Source badge color by platform */
const PLATFORM_COLORS: Record<string, string> = {
  claude: '#6B5B8A',
  codex: '#1A6B3C',
  twitter: '#3A3A3A',
  github: '#555555',
  youtube: '#B22222',
  reddit: '#FF4500',
  hackernews: '#FF6600',
  zhihu: '#0066FF',
  bilibili: '#FB7299',
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'never synced'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function SourcesPanel({ onClose, claudeCount, codexCount }: Props) {
  const [sources, setSources] = useState<OpenCLISource[]>([])
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [syncing, setSyncing] = useState<number | null>(null)

  const loadSources = useCallback(async () => {
    if (!window.spool?.opencli) return
    const list = await window.spool.opencli.listSources()
    setSources(list)
  }, [])

  useEffect(() => { loadSources() }, [loadSources])

  const loadPlatforms = async () => {
    if (!window.spool?.opencli) return
    const list = await window.spool.opencli.availablePlatforms()
    setPlatforms(list)
    setShowPicker(true)
  }

  const handleAddSource = async (platform: string, command: string) => {
    if (!window.spool?.opencli) return
    await window.spool.opencli.addSource(platform, command)
    setShowPicker(false)
    await loadSources()
  }

  const handleRemoveSource = async (id: number) => {
    if (!window.spool?.opencli) return
    await window.spool.opencli.removeSource(id)
    await loadSources()
  }

  const handleSync = async (src: OpenCLISource) => {
    if (!window.spool?.opencli) return
    setSyncing(src.id)
    try {
      await window.spool.opencli.syncSource(src.id, src.platform, src.command)
      await loadSources()
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
          </div>

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
                      Your {src.platform} {src.command}
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
              onClick={loadPlatforms}
              className="w-full py-3 border border-dashed border-warm-border2 dark:border-dark-border rounded-[8px] text-sm text-warm-muted dark:text-dark-muted hover:text-accent dark:hover:text-accent-dark hover:border-accent/40 dark:hover:border-accent-dark/40 transition-colors"
            >
              + Add a source
            </button>
          ) : (
            <div>
              <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-2">
                Available Platforms
              </h3>
              <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                {platforms.map(p => (
                  <button
                    key={p.platform}
                    onClick={() => handleAddSource(p.platform, p.commands[0] ?? 'default')}
                    className="text-left px-3 py-2 text-sm text-warm-text dark:text-dark-text bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[6px] hover:border-accent/40 dark:hover:border-accent-dark/40 transition-colors"
                  >
                    <span className="block font-medium">{p.platform}</span>
                    {p.description && (
                      <span className="block text-[11px] text-warm-faint dark:text-dark-muted truncate">{p.description}</span>
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowPicker(false)}
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
