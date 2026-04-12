import { useState, useEffect, useCallback, type ReactNode } from 'react'
import type { ConnectorStatus } from '@spool/core'
import type { AgentInfo, AgentsConfig, SdkAgentConfig } from '../../preload/index.js'
import { DEFAULT_SEARCH_SORT_ORDER, SEARCH_SORT_OPTIONS, type SearchSortOrder } from '../../shared/searchSort.js'
import type { ThemeEditorStateV1 } from '../theme/editorTypes.js'
import ThemeEditorSection from './ThemeEditorSection.js'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'

// ── Types ──────────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'appearance' | 'connectors' | 'agent'

/** Must match SUPPORTED_TERMINALS in main/terminal.ts */
const TERMINAL_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'Terminal', label: 'Terminal' },
  { value: 'iTerm2', label: 'iTerm2' },
  { value: 'Warp', label: 'Warp' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'Alacritty', label: 'Alacritty' },
  { value: 'WezTerm', label: 'WezTerm' },
] as const

type SdkAgentPatch = Omit<Partial<SdkAgentConfig>, 'baseURL'> & {
  baseURL?: string | null
}

interface Props {
  onClose: () => void
  initialTab?: SettingsTab
  claudeCount: number | null
  codexCount: number | null
  geminiCount: number | null
  themeEditor: ThemeEditorStateV1
  onThemeEditorChange: (next: ThemeEditorStateV1) => void
}

type Theme = 'system' | 'light' | 'dark'

const MODE_LABELS: Record<string, string> = {
  extension: 'ACP Extension',
  native: 'ACP Native',
  websocket: 'WebSocket',
  sdk: 'Built-in SDK',
}

const SDK_MODEL_OPTIONS = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
] as const

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

// ── Sidebar tabs ───────────────────────────────────────────────────────────

const TABS: { id: SettingsTab; label: string; icon: ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    ),
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v2.5M12 18.5V21M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M3 12h2.5M18.5 12H21M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
        <circle cx="12" cy="12" r="4.25" />
      </svg>
    ),
  },
  {
    id: 'connectors',
    label: 'Connectors',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v6M12 18v4M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M18 12h4M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/>
      </svg>
    ),
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: (
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
      </svg>
    ),
  },
]

// ── Main component ─────────────────────────────────────────────────────────

export default function SettingsPanel({
  onClose,
  initialTab = 'general',
  claudeCount,
  codexCount,
  geminiCount,
  themeEditor,
  onThemeEditorChange,
}: Props) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[720px] h-[560px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border rounded-[10px] shadow-xl overflow-hidden flex">
        {/* Sidebar */}
        <div className="w-[176px] flex-none bg-warm-surface dark:bg-dark-surface border-r border-warm-border dark:border-dark-border flex flex-col py-3">
          <div className="px-4 mb-3">
            <h2 className="text-sm font-semibold text-warm-text dark:text-dark-text">Settings</h2>
          </div>
          <div className="px-2 space-y-0.5">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0 ${
                  tab === t.id
                    ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-[#2A1800] font-medium'
                    : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-bg/70 dark:hover:bg-dark-bg/60'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="px-4 py-2 text-[10px] text-warm-faint dark:text-dark-muted">
            All data stays local in ~/.spool/
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-5 py-3 border-b border-warm-border dark:border-dark-border">
            <h3 className="text-sm font-medium text-warm-text dark:text-dark-text">
              {TABS.find(t => t.id === tab)?.label}
            </h3>
            <button
              type="button"
              aria-label="Close settings"
              onClick={onClose}
              className="rounded-[6px] text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-0"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === 'general' && <GeneralTab />}
            {tab === 'appearance' && (
              <AppearanceTab themeEditor={themeEditor} onThemeEditorChange={onThemeEditorChange} />
            )}
            {tab === 'connectors' && <ConnectorsTab claudeCount={claudeCount} codexCount={codexCount} geminiCount={geminiCount} />}
            {tab === 'agent' && <AgentTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── General Tab ────────────────────────────────────────────────────────────

function GeneralTab() {
  const [config, setConfig] = useState<AgentsConfig>({})

  useEffect(() => {
    if (!window.spool) return
    window.spool.getAgentsConfig().then(setConfig).catch(console.error)
  }, [])

  const updateConfig = async (patch: Partial<AgentsConfig>) => {
    const next: AgentsConfig = { ...config, ...patch }
    setConfig(next)
    try { await window.spool.setAgentsConfig(next) } catch {}
  }

  const handleTerminalChange = (value: string) => {
    const next: AgentsConfig = { ...config }
    if (value) next.terminal = value
    else delete next.terminal
    setConfig(next)
    void window.spool?.setAgentsConfig(next)
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <Section title="Search">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-warm-muted dark:text-dark-muted">Default sort</span>
          <SmallSelect
            value={config.defaultSearchSort ?? DEFAULT_SEARCH_SORT_ORDER}
            onChange={(v) => updateConfig({ defaultSearchSort: v as SearchSortOrder })}
            options={SEARCH_SORT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          />
        </div>
      </Section>

      {/* Terminal */}
      <Section title="Terminal">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-warm-muted dark:text-dark-muted">Session resume</span>
          <SmallSelect
            value={config.terminal ?? ''}
            onChange={handleTerminalChange}
            options={TERMINAL_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
          />
        </div>
        <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
          Which terminal to open when resuming a session.
        </p>
      </Section>

      {/* Data */}
      <Section title="Data">
        <div className="flex items-center justify-between">
          <span className="text-xs text-warm-muted dark:text-dark-muted">Database</span>
          <span className="text-[11px] font-mono text-warm-faint dark:text-dark-muted">~/.spool/spool.db</span>
        </div>
      </Section>

      {/* About */}
      <Section title="About">
        <p className="text-xs text-warm-muted dark:text-dark-muted">
          Spool — a local search engine for your thinking.
        </p>
      </Section>
    </div>
  )
}

function AppearanceTab({
  themeEditor,
  onThemeEditorChange,
}: {
  themeEditor: ThemeEditorStateV1
  onThemeEditorChange: (next: ThemeEditorStateV1) => void
}) {
  const [themeSource, setThemeSource] = useState<Theme>('system')

  useEffect(() => {
    if (!window.spool) return
    window.spool.getTheme().then(t => { if (t) setThemeSource(t) }).catch(console.error)
  }, [])

  const setThemeMode = async (t: Theme) => {
    setThemeSource(t)
    try {
      await window.spool?.setTheme(t)
    } catch (err) {
      console.error('Failed to set theme:', err)
    }
  }

  return (
    <div>
      <ThemeEditorSection
        state={themeEditor}
        onChange={onThemeEditorChange}
        themeSource={themeSource}
        onThemeMode={setThemeMode}
      />
    </div>
  )
}

// ── Connectors Tab ─────────────────────────────────────────────────────────

function ConnectorsTab({ claudeCount, codexCount, geminiCount }: { claudeCount: number | null; codexCount: number | null; geminiCount: number | null }) {
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [connectorCounts, setConnectorCounts] = useState<Record<string, number>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [syncingConnector, setSyncingConnector] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<Record<string, { added: number; phase: string }>>({})
  const [syncError, setSyncError] = useState<string | null>(null)
  const [availableUpdates, setAvailableUpdates] = useState<Record<string, { current: string; latest: string }>>({})
  const [updatingConnector, setUpdatingConnector] = useState<string | null>(null)
  const [updateErrors, setUpdateErrors] = useState<Record<string, string>>({})

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

  useEffect(() => {
    window.spool?.connectors.checkUpdates().then(setAvailableUpdates).catch(() => {})
  }, [])

  // Listen for connector sync events
  useEffect(() => {
    if (!window.spool?.connectors) return () => {}
    const off = window.spool.connectors.onEvent((event) => {
      if (event.type === 'sync-start') {
        setSyncingConnector(event.connectorId ?? null)
        if (event.connectorId) setSyncProgress(prev => ({ ...prev, [event.connectorId!]: { added: 0, phase: 'starting' } }))
      } else if (event.type === 'sync-progress') {
        const p = event.progress as { connectorId: string; phase: string; added: number } | undefined
        if (p) setSyncProgress(prev => ({ ...prev, [p.connectorId]: { added: p.added, phase: p.phase } }))
      } else if (event.type === 'sync-complete' || event.type === 'sync-error') {
        setSyncingConnector(null)
        if (event.connectorId) setSyncProgress(prev => { const next = { ...prev }; delete next[event.connectorId!]; return next })
        loadConnectors()
      } else if (event.type === 'updated') {
        loadConnectors()
        window.spool?.connectors.checkUpdates().then(setAvailableUpdates).catch(() => {})
      }
    })
    return off
  }, [loadConnectors])

  const handleSync = async (connectorId: string) => {
    if (!window.spool?.connectors) return
    setSyncingConnector(connectorId)
    setSyncError(null)
    try { await window.spool.connectors.syncNow(connectorId) } catch (err) {
      setSyncError(`${connectorId}: ${err instanceof Error ? err.message : String(err)}`)
      setSyncingConnector(null)
    }
  }

  const handleToggleEnabled = async (connectorId: string, enabled: boolean) => {
    if (!window.spool?.connectors) return
    await window.spool.connectors.setEnabled(connectorId, enabled)
    await loadConnectors()
  }

  const handleUpdate = async (connectorId: string) => {
    if (!window.spool?.connectors) return
    setUpdatingConnector(connectorId)
    setUpdateErrors(prev => { const next = { ...prev }; delete next[connectorId]; return next })
    try {
      const result = await window.spool.connectors.update(connectorId)
      if (!result.ok) setUpdateErrors(prev => ({ ...prev, [connectorId]: result.error ?? 'Update failed' }))
    } catch (err) {
      setUpdateErrors(prev => ({ ...prev, [connectorId]: err instanceof Error ? err.message : String(err) }))
    } finally {
      setUpdatingConnector(null)
    }
  }

  const selected = connectors.find(c => c.id === selectedId)

  // ── Detail view (drill-down) ──
  if (selected) {
    const isSyncing = syncingConnector === selected.id || selected.syncing
    const progress = syncProgress[selected.id]
    return (
      <div className="space-y-5">
        {/* Back button */}
        <button
          onClick={() => setSelectedId(null)}
          className="flex items-center gap-1.5 text-xs text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>

        {/* Connector header */}
        <div className="flex items-center gap-3">
          <span
            className={`w-3 h-3 rounded-full flex-none ${isSyncing ? 'animate-pulse' : ''}`}
            style={{ background: selected.enabled ? selected.color : '#888' }}
          />
          <div>
            <h4 className="text-xs font-medium text-warm-text dark:text-dark-text">{selected.label}</h4>
            <p className="text-[11px] text-warm-faint dark:text-dark-muted">{selected.description}</p>
          </div>
        </div>

        {/* Status */}
        <div className="px-3 py-2.5 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-warm-muted dark:text-dark-muted">Status</span>
            <span className={`text-[11px] font-medium ${selected.enabled ? 'text-green-500' : 'text-warm-faint dark:text-dark-muted'}`}>
              {!selected.enabled
                ? 'Disabled'
                : isSyncing
                  ? 'Syncing…'
                  : selected.state.lastErrorCode?.startsWith('AUTH_')
                    ? 'Needs login'
                    : 'Connected'}
            </span>
          </div>
          {selected.enabled && (connectorCounts[selected.id] ?? 0) > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-warm-muted dark:text-dark-muted">Items</span>
              <span className="text-[11px] font-mono text-warm-faint dark:text-dark-muted">
                {connectorCounts[selected.id]} · {formatSyncTime(selected.state.lastForwardSyncAt)}
              </span>
            </div>
          )}
          {isSyncing && progress && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-warm-muted dark:text-dark-muted">Progress</span>
              <span className="text-[11px] text-warm-faint dark:text-dark-muted">
                {progress.added} new · {progress.phase === 'forward' ? 'fetching' : 'backfilling'}…
              </span>
            </div>
          )}
          {selected.enabled && !isSyncing && selected.state.lastErrorCode && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-warm-muted dark:text-dark-muted">Error</span>
              <span className="text-[11px] text-red-400 dark:text-red-400 max-w-[60%] truncate text-right" title={selected.state.lastErrorMessage ?? undefined}>
                {selected.state.lastErrorMessage ?? selected.state.lastErrorCode}
              </span>
            </div>
          )}
          {selected.enabled && !selected.state.tailComplete && !isSyncing && !selected.state.lastErrorCode && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-warm-muted dark:text-dark-muted">History</span>
              <span className="text-[11px] text-warm-faint dark:text-dark-muted">syncing in background</span>
            </div>
          )}
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px]">
          <span className="text-xs text-warm-muted dark:text-dark-muted">Enabled</span>
          <button
            onClick={() => handleToggleEnabled(selected.id, !selected.enabled)}
            className={`relative w-8 h-[18px] rounded-full transition-colors ${
              selected.enabled ? 'bg-accent dark:bg-accent-dark' : 'bg-warm-border2 dark:bg-dark-border'
            }`}
          >
            <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
              selected.enabled ? 'left-[16px]' : 'left-[2px]'
            }`} />
          </button>
        </div>

        {/* Sync button */}
        {selected.enabled && (
          <button
            onClick={() => handleSync(selected.id)}
            disabled={isSyncing}
            className="w-full py-2 text-xs font-medium text-accent dark:text-accent-dark border border-accent/30 dark:border-accent-dark/30 rounded-[8px] hover:bg-accent-bg dark:hover:bg-[#2A1800] disabled:opacity-50 transition-colors"
          >
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}

        {syncError && (
          <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-[6px]">
            <p className="text-xs text-red-500">{syncError}</p>
          </div>
        )}

        {/* Update available */}
        {availableUpdates[selected.id] && (
          <div className="px-3 py-2.5 bg-warm-surface dark:bg-dark-surface border border-accent/30 dark:border-accent-dark/30 rounded-[8px] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-warm-muted dark:text-dark-muted">Update available</span>
              <span className="text-[11px] font-mono text-warm-text dark:text-dark-text">
                {availableUpdates[selected.id]!.current} → {availableUpdates[selected.id]!.latest}
              </span>
            </div>
            <button
              onClick={() => handleUpdate(selected.id)}
              disabled={updatingConnector === selected.id}
              className="w-full py-1.5 text-xs font-medium text-accent dark:text-accent-dark border border-accent/30 dark:border-accent-dark/30 rounded-[6px] hover:bg-accent-bg dark:hover:bg-[#2A1800] disabled:opacity-50 transition-colors"
            >
              {updatingConnector === selected.id ? 'Updating…' : 'Update'}
            </button>
            {updateErrors[selected.id] && updatingConnector !== selected.id && (
              <p className="text-[11px] text-red-400">{updateErrors[selected.id]}</p>
            )}
          </div>
        )}

        {/* Uninstall (hidden for bundled connectors) */}
        {!selected.bundled && (
          <button
            onClick={async () => {
              const count = connectorCounts[selected.id] ?? 0
              const msg = count > 0
                ? `Uninstall "${selected.label}"?\n\nThis will permanently delete ${count} synced item${count === 1 ? '' : 's'} and remove the connector. You can reinstall it later from spool.pro/connectors.`
                : `Uninstall "${selected.label}"?\n\nThis will remove the connector. You can reinstall it later from spool.pro/connectors.`
              if (!confirm(msg)) return
              await window.spool?.connectors.uninstall(selected.id)
              setSelectedId(null)
              await loadConnectors()
            }}
            className="w-full py-2 text-xs font-medium text-red-500 border border-red-500/20 rounded-[8px] hover:bg-red-500/10 transition-colors"
          >
            Uninstall
          </button>
        )}
      </div>
    )
  }

  // ── List view ──
  return (
    <div className="space-y-5">
      <Section title="Agent Sessions">
        <BuiltInSource name={getSessionSourceLabel('claude')} color={getSessionSourceColor('claude')} count={claudeCount} />
        <BuiltInSource name={getSessionSourceLabel('codex')} color={getSessionSourceColor('codex')} count={codexCount} />
        <BuiltInSource name={getSessionSourceLabel('gemini')} color={getSessionSourceColor('gemini')} count={geminiCount} />
      </Section>

      <Section title="Data Sources">
        {connectors.length === 0 && (
          <p className="text-xs text-warm-faint dark:text-dark-muted">No connectors available.</p>
        )}
        {connectors.map(c => {
          const isSyncing = syncingConnector === c.id || c.syncing
          const progress = syncProgress[c.id]
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="w-full flex items-center gap-3 py-2.5 px-2 rounded-[6px] text-left hover:bg-warm-surface/50 dark:hover:bg-dark-surface/50 transition-colors"
            >
              <span
                className={`w-2 h-2 rounded-full flex-none ${isSyncing ? 'animate-pulse' : ''}`}
                style={{ background: c.enabled ? c.color : '#888' }}
              />
              <div className="flex-1 min-w-0">
                <span className={`text-xs ${c.enabled ? 'text-warm-text dark:text-dark-text' : 'text-warm-muted dark:text-dark-muted'}`}>
                  {c.label}
                </span>
                <span className="text-[11px] text-warm-faint dark:text-dark-muted ml-2">
                  {!c.enabled
                    ? 'Not connected'
                    : isSyncing && progress
                      ? `${progress.added} new · ${progress.phase === 'forward' ? 'fetching' : 'backfilling'}…`
                      : (connectorCounts[c.id] ?? 0) > 0
                        ? `${connectorCounts[c.id]} items · ${formatSyncTime(c.state.lastForwardSyncAt)}`
                        : c.state.lastErrorCode
                          ? c.state.lastErrorMessage ?? 'Error'
                          : 'Not synced yet'}
                </span>
              </div>
              {c.enabled && !isSyncing && c.state.lastErrorCode?.startsWith('AUTH_') && (
                <span className="text-[10px] text-amber-500 font-medium">needs login</span>
              )}
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-warm-faint dark:text-dark-muted">
                <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )
        })}
      </Section>

      {syncError && (
        <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-[6px]">
          <p className="text-xs text-red-500">{syncError}</p>
        </div>
      )}
    </div>
  )
}

// ── Agent Tab ──────────────────────────────────────────────────────────────

function AgentTab() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [config, setConfig] = useState<AgentsConfig>({})

  useEffect(() => {
    if (!window.spool) return
    Promise.all([
      window.spool.getAiAgents(),
      window.spool.getAgentsConfig(),
    ]).then(([a, c]) => { setAgents(a); setConfig(c) }).catch(console.error)
  }, [])

  const sdkAgent = agents.find(a => a.acpMode === 'sdk')
  const cliAgents = agents.filter(a => a.acpMode !== 'sdk')
  const sdkConfigured = !!config.sdkAgent?.apiKey

  const selectableIds = new Set([
    ...(sdkAgent ? [sdkAgent.id] : []),
    ...cliAgents.filter(a => a.status === 'ready').map(a => a.id),
  ])
  const selectedId = config.defaultAgent && selectableIds.has(config.defaultAgent)
    ? config.defaultAgent
    : (sdkConfigured && sdkAgent ? sdkAgent.id : cliAgents.find(a => a.status === 'ready')?.id ?? '')

  const updateConfig = async (patch: Partial<AgentsConfig>) => {
    const next: AgentsConfig = { ...config, ...patch }
    setConfig(next)
    try { await window.spool.setAgentsConfig(next) } catch {}
  }

  const updateSdkAgent = (patch: SdkAgentPatch) => {
    const current = config.sdkAgent ?? {}
    const { baseURL, ...restPatch } = patch
    const nextSdkAgent: SdkAgentConfig = { ...current, ...restPatch }
    if (baseURL) nextSdkAgent.baseURL = baseURL
    else delete nextSdkAgent.baseURL
    void updateConfig({ sdkAgent: nextSdkAgent })
  }

  return (
    <div className="space-y-6">
      {/* Built-in Agent */}
      {sdkAgent && (
        <Section title="Built-in Agent">
          <button
            onClick={() => updateConfig({ defaultAgent: sdkAgent.id })}
            className={`w-full flex items-center gap-3 px-3 py-2.5 border text-left transition-colors ${
              selectedId === sdkAgent.id ? 'rounded-t-[8px] border-b-0 bg-accent-bg dark:bg-[#2A1800] border-accent/30 dark:border-accent-dark/30' : 'rounded-[8px] bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
            }`}
          >
            <RadioDot selected={selectedId === sdkAgent.id} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-warm-text dark:text-dark-text">Built-in</span>
                <span className="text-[9px] font-mono text-warm-faint dark:text-dark-muted px-1.5 py-0.5 bg-warm-surface2 dark:bg-dark-surface2 rounded">
                  Requires API Key
                </span>
              </div>
              <span className="block text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate">
                {sdkConfigured ? `${config.sdkAgent?.model || 'claude-sonnet-4-6'} via API` : 'No CLI needed — just add your API key'}
              </span>
            </div>
            <span className={`text-[10px] font-medium flex-none ${sdkConfigured ? 'text-green-500' : 'text-amber-500 dark:text-amber-400'}`}>
              {sdkConfigured ? 'ready' : 'needs key'}
            </span>
          </button>

          {selectedId === sdkAgent.id && (
            <div className="px-3 py-3 bg-accent-bg dark:bg-[#2A1800] border border-t-0 border-accent/30 dark:border-accent-dark/30 rounded-b-[8px] space-y-2.5">
              <ConfigRow label="API Key">
                <input
                  type="password"
                  value={config.sdkAgent?.apiKey ?? ''}
                  onChange={(e) => updateSdkAgent({ apiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="flex-1 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg px-2.5 text-[11px] font-mono text-warm-text dark:text-dark-text outline-none transition-colors focus:border-accent placeholder:text-warm-faint/50 dark:placeholder:text-dark-muted/50"
                />
              </ConfigRow>
              <ConfigRow label="Model">
                <div className="relative flex-1">
                  <select
                    value={config.sdkAgent?.model ?? 'claude-sonnet-4-6'}
                    onChange={(e) => updateSdkAgent({ model: e.target.value })}
                    className="appearance-none w-full h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg pl-2.5 pr-7 text-[11px] font-mono text-warm-text dark:text-dark-text outline-none transition-colors focus:border-accent"
                  >
                    {SDK_MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <ChevronDown />
                </div>
              </ConfigRow>
              <ConfigRow label="Base URL">
                <input
                  type="text"
                  value={config.sdkAgent?.baseURL ?? ''}
                  onChange={(e) => updateSdkAgent({ baseURL: e.target.value || null })}
                  placeholder="Default (Anthropic API)"
                  className="flex-1 h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg px-2.5 text-[11px] font-mono text-warm-text dark:text-dark-text outline-none transition-colors focus:border-accent placeholder:text-warm-faint/50 dark:placeholder:text-dark-muted/50"
                />
              </ConfigRow>
              <p className="text-[10px] text-warm-faint dark:text-dark-muted leading-relaxed">
                Runs directly via API — no CLI install needed. Override Base URL for OpenRouter or other providers.
              </p>
            </div>
          )}
        </Section>
      )}

      {/* Installed Agents */}
      <Section title="Installed Agents">
        <div className="space-y-1.5">
          {cliAgents.map(agent => {
            const isReady = agent.status === 'ready'
            const isSelected = agent.id === selectedId
            return (
              <button
                key={agent.id}
                onClick={() => isReady && updateConfig({ defaultAgent: agent.id })}
                disabled={!isReady}
                className={`w-full flex items-center gap-3 px-3 py-2.5 border rounded-[8px] text-left transition-colors ${
                  isSelected
                    ? 'bg-accent-bg dark:bg-[#2A1800] border-accent/30 dark:border-accent-dark/30'
                    : isReady
                      ? 'bg-warm-surface dark:bg-dark-surface border-warm-border dark:border-dark-border hover:border-warm-border2 dark:hover:border-dark-border2'
                      : 'bg-warm-bg dark:bg-dark-bg border-warm-border/50 dark:border-dark-border/50 opacity-50 cursor-not-allowed'
                }`}
              >
                <RadioDot selected={isSelected} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${isReady ? 'text-warm-text dark:text-dark-text' : 'text-warm-faint dark:text-dark-muted'}`}>
                      {agent.name}
                    </span>
                    <span className="text-[9px] font-mono text-warm-faint dark:text-dark-muted px-1.5 py-0.5 bg-warm-surface2 dark:bg-dark-surface2 rounded">
                      {MODE_LABELS[agent.acpMode] ?? agent.acpMode}
                    </span>
                  </div>
                  <span className="block text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate">
                    {isReady ? agent.path : `${agent.id} — not found in PATH`}
                  </span>
                </div>
                <span className={`text-[10px] font-medium flex-none ${isReady ? 'text-green-500' : 'text-warm-faint dark:text-dark-muted'}`}>
                  {isReady ? 'ready' : 'not found'}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
          Agents detected on your system.
          Add custom agents in <span className="font-mono">~/.spool/agents.json</span>.
        </p>
      </Section>
    </div>
  )
}

// ── Shared components ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-2">
        {title}
      </h4>
      {children}
    </div>
  )
}

function BuiltInSource({ name, color, count }: { name: string; color: string; count: number | null }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-2 h-2 rounded-full flex-none" style={{ background: color }} />
      <span className="flex-1 text-xs text-warm-text dark:text-dark-text">{name}</span>
      <span className="text-[11px] text-warm-faint dark:text-dark-muted tabular-nums font-mono">
        {count === null ? '…' : `${count} sessions`}
      </span>
      <span className="text-[10px] text-green-500 font-medium">auto</span>
    </div>
  )
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <span className={`w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center ${
      selected ? 'border-accent dark:border-accent-dark' : 'border-warm-border2 dark:border-dark-border2'
    }`}>
      {selected && <span className="w-2 h-2 rounded-full bg-accent dark:bg-accent-dark" />}
    </span>
  )
}

function ConfigRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-warm-muted dark:text-dark-muted w-16 flex-none">{label}</span>
      {children}
    </div>
  )
}

function SmallSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="relative flex-none">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none h-7 rounded-[6px] border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface pl-2.5 pr-7 text-xs text-warm-text dark:text-dark-text outline-none transition-colors hover:border-warm-border2 dark:hover:border-dark-border2 focus:border-accent"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown />
    </div>
  )
}

function ChevronDown() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-warm-muted dark:text-dark-muted" fill="none">
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
