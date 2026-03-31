import { useState, useEffect } from 'react'
import { DEFAULT_SEARCH_SORT_ORDER, SEARCH_SORT_OPTIONS, type SearchSortOrder } from '../../shared/searchSort.js'

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

interface AgentInfo {
  id: string
  name: string
  path: string
  status: 'ready' | 'not_found' | 'not_running'
  acpMode: 'extension' | 'native' | 'websocket'
}

interface AgentsConfig {
  defaultAgent?: string
  defaultSearchSort?: SearchSortOrder
}

interface Props {
  onClose: () => void
}

const MODE_LABELS: Record<string, string> = {
  extension: 'ACP Extension',
  native: 'ACP Native',
  websocket: 'WebSocket',
}

export default function SettingsPanel({ onClose }: Props) {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [config, setConfig] = useState<AgentsConfig>({})
  const [dbPath] = useState('~/.spool/spool.db')

  useEffect(() => {
    if (!window.spool) return
    Promise.all([
      window.spool.getAiAgents(),
      window.spool.getAgentsConfig(),
    ]).then(([a, c]) => {
      setAgents(a)
      setConfig(c)
    }).catch(console.error)
  }, [])

  // The selected default: explicit config > first ready agent
  const readyAgents = agents.filter(a => a.status === 'ready')
  const selectedId = config.defaultAgent && readyAgents.find(a => a.id === config.defaultAgent)
    ? config.defaultAgent
    : readyAgents[0]?.id ?? ''

  const updateConfig = async (patch: Partial<AgentsConfig>) => {
    const next: AgentsConfig = { ...config, ...patch }
    setConfig(next)
    try {
      await window.spool.setAgentsConfig(next)
    } catch (err) {
      console.error('Failed to save config:', err)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[500px] max-h-[80vh] bg-warm-bg dark:bg-dark-bg border border-warm-border dark:border-dark-border rounded-[10px] shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-warm-border dark:border-dark-border">
          <h2 className="text-base font-semibold text-warm-text dark:text-dark-text">Settings</h2>
          <button onClick={onClose} className="text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Default Coding Agent */}
          <div className="mb-6">
            <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-3">
              Default Coding Agent
            </h3>
            <div className="space-y-1.5">
              {agents.map(agent => {
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
                    {/* Radio dot */}
                    <span className={`w-4 h-4 rounded-full border-2 flex-none flex items-center justify-center ${
                      isSelected
                        ? 'border-accent dark:border-accent-dark'
                        : 'border-warm-border2 dark:border-dark-border2'
                    }`}>
                      {isSelected && (
                        <span className="w-2 h-2 rounded-full bg-accent dark:bg-accent-dark" />
                      )}
                    </span>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${
                          isReady ? 'text-warm-text dark:text-dark-text' : 'text-warm-faint dark:text-dark-muted'
                        }`}>{agent.name}</span>
                        <span className="text-[9px] font-mono text-warm-faint dark:text-dark-muted px-1.5 py-0.5 bg-warm-surface2 dark:bg-dark-surface2 rounded">
                          {MODE_LABELS[agent.acpMode] ?? agent.acpMode}
                        </span>
                      </div>
                      <span className="block text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate">
                        {isReady ? agent.path : `${agent.id} — not found in PATH`}
                      </span>
                    </div>

                    {/* Status */}
                    <span className={`text-[10px] font-medium flex-none ${
                      isReady ? 'text-green-500' : 'text-warm-faint dark:text-dark-muted'
                    }`}>
                      {isReady ? 'ready' : 'not found'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
              Select which agent to use in AI mode. Only installed agents can be selected.
              Add custom agents in <span className="font-mono">~/.spool/agents.json</span>.
            </p>
          </div>

          {/* Data */}
          <div className="mb-6">
            <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-3">
              Data
            </h3>
            <div className="px-3 py-2.5 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-warm-muted dark:text-dark-muted">Database</span>
                <span className="text-[11px] font-mono text-warm-faint dark:text-dark-muted">{dbPath}</span>
              </div>
            </div>
            <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
              All data stays local. Sessions are indexed from agent history directories.
            </p>
          </div>

          {/* Search */}
          <div className="mb-6">
            <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-3">
              Search
            </h3>
            <div className="px-3 py-2.5 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-warm-muted dark:text-dark-muted">Default sort</span>
                <div className="relative flex-none">
                  <select
                    value={config.defaultSearchSort ?? DEFAULT_SEARCH_SORT_ORDER}
                    onChange={(e) => updateConfig({ defaultSearchSort: e.target.value as SearchSortOrder })}
                    aria-label="Default search sort"
                    className="appearance-none h-8 rounded-full border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg pl-3 pr-9 text-xs font-medium text-warm-text dark:text-dark-text outline-none transition-colors hover:border-accent/50 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 focus:border-accent"
                  >
                    {SEARCH_SORT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-warm-muted dark:text-dark-muted"
                    fill="none"
                  >
                    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
              Choose which sort order new search results should use by default.
            </p>
          </div>

          {/* Terminal */}
          <div className="mb-6">
            <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-3">
              Terminal
            </h3>
            <div className="px-3 py-2.5 bg-warm-surface dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-[8px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-warm-muted dark:text-dark-muted">Session resume</span>
                <div className="relative flex-none">
                  <select
                    value={config.terminal ?? ''}
                    onChange={(e) => updateConfig({ terminal: e.target.value || undefined })}
                    aria-label="Terminal for session resume"
                    className="appearance-none h-8 rounded-full border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg pl-3 pr-9 text-xs font-medium text-warm-text dark:text-dark-text outline-none transition-colors hover:border-accent/50 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 focus:border-accent"
                  >
                    {TERMINAL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-warm-muted dark:text-dark-muted"
                    fill="none"
                  >
                    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-warm-faint dark:text-dark-muted mt-2">
              Which terminal to open when resuming a session. Auto-detect checks for running third-party terminals.
            </p>
          </div>

          {/* About */}
          <div>
            <h3 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase mb-3">
              About
            </h3>
            <p className="text-xs text-warm-muted dark:text-dark-muted">
              Spool — a local search engine for your thinking.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
