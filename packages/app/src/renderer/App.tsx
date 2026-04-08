import { useEffect, useState, useCallback, useRef } from 'react'
import type { FragmentResult, SearchResult, StatusInfo } from '@spool/core'
import SearchBar, { type SearchMode } from './components/SearchBar.js'
import FragmentResults from './components/FragmentResults.js'
import HomeView from './components/HomeView.js'
import SessionDetail from './components/SessionDetail.js'
import StatusBar from './components/StatusBar.js'
import AiAnswerCard from './components/AiAnswerCard.js'
import SettingsPanel from './components/SettingsPanel.js'
import { getSessionResumeCommandPrefix } from '../shared/resumeCommand.js'
import { DEFAULT_SEARCH_SORT_ORDER, type SearchSortOrder } from '../shared/searchSort.js'

type View = 'search' | 'session'
type SettingsTab = 'general' | 'connectors' | 'agent'

interface AgentInfo {
  id: string
  name: string
  path: string
  status: 'ready' | 'not_found' | 'not_running'
  acpMode: 'extension' | 'native' | 'websocket'
}

export default function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const [view, setView] = useState<View>('search')
  const [homeMode, setHomeMode] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ phase: string; count: number; total: number } | null>(null)
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AI mode state
  const [searchMode, setSearchMode] = useState<SearchMode>('fast')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiAgent, setAiAgent] = useState('claude')
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([])
  const [aiToolCalls, setAiToolCalls] = useState<Map<string, { title: string; status: string; kind?: string }>>(new Map())
  const aiAnswerRef = useRef('')

  // Settings & modals
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [captureSources, setCaptureSources] = useState<Array<{ label: string; count: number }>>([])
  const [defaultSearchSort, setDefaultSearchSort] = useState<SearchSortOrder>(DEFAULT_SEARCH_SORT_ORDER)
  const [resumeToastCommand, setResumeToastCommand] = useState<string | null>(null)


  const isHomeMode = homeMode && view === 'search' && !selectedSession

  // Load agents + config, apply configured default
  const refreshAgents = useCallback(() => {
    if (!window.spool?.getAiAgents) return
    Promise.all([
      window.spool.getAiAgents(),
      window.spool.getAgentsConfig(),
    ]).then(([agents, config]) => {
      const ready = agents.filter(a => a.status === 'ready')
      setAvailableAgents(ready)
      setDefaultSearchSort(config.defaultSearchSort ?? DEFAULT_SEARCH_SORT_ORDER)
      const defaultId = config.defaultAgent && ready.find(a => a.id === config.defaultAgent)
        ? config.defaultAgent
        : ready[0]?.id
      if (defaultId) setAiAgent(defaultId)
    }).catch(console.error)
  }, [])

  // Detect available ACP agents on mount
  useEffect(() => { refreshAgents() }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  // Listen for AI streaming chunks and tool calls
  useEffect(() => {
    if (!window.spool?.onAiChunk) return () => {}
    const offChunk = window.spool.onAiChunk(({ text }) => {
      aiAnswerRef.current += text
      setAiAnswer(aiAnswerRef.current)
    })
    const offDone = window.spool.onAiDone(({ error }) => {
      setAiStreaming(false)
      if (error) setAiError(error)
    })
    const offToolCall = window.spool.onAiToolCall?.((tc) => {
      setAiToolCalls(prev => {
        const next = new Map(prev)
        next.set(tc.toolCallId, { title: tc.title || prev.get(tc.toolCallId)?.title || '', status: tc.status, kind: tc.kind })
        return next
      })
    })
    return () => { offChunk(); offDone(); offToolCall?.() }
  }, [])

  const refreshCaptureSources = useCallback(() => {
    if (!window.spool?.connectors) return
    window.spool.connectors.list().then(async connectors => {
      const results: Array<{ label: string; count: number }> = []
      for (const c of connectors) {
        const count = await window.spool.connectors.getCaptureCount(c.id)
        if (count > 0) results.push({ label: c.label, count })
      }
      setCaptureSources(results)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    if (!window.spool) return
    window.spool.getStatus().then(setStatus).catch(console.error)
    refreshCaptureSources()
  }, [syncStatus, refreshCaptureSources])

  useEffect(() => {
    if (!window.spool) return () => {}
    const offProgress = window.spool.onSyncProgress((e) => {
      setSyncStatus(e)
      if (e.phase === 'done') {
        setTimeout(() => setSyncStatus(null), 3000)
        window.spool.getStatus().then(setStatus).catch(console.error)
        if (query.trim() && searchMode === 'fast') doSearch(query)
      }
    })
    const offNew = window.spool.onNewSessions(() => {
      window.spool.getStatus().then(setStatus).catch(console.error)
      if (query.trim() && searchMode === 'fast') doSearch(query)
    })
    return () => { offProgress(); offNew() }
  }, [query, searchMode])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setIsSearching(false); return }
    setIsSearching(true)
    try {
      const res = window.spool ? await window.spool.search(q, 20) : []
      setResults(res)
    } finally {
      setIsSearching(false)
    }
  }, [])

  const doAiSearch = useCallback(async () => {
    if (!query.trim() || !window.spool?.aiSearch) return

    const ftsResults = results.length > 0 ? results : (window.spool ? await window.spool.search(query, 20) : [])
    if (ftsResults.length > 0 && results.length === 0) setResults(ftsResults)

    aiAnswerRef.current = ''
    setAiAnswer('')
    setAiError(null)
    setAiStreaming(true)
    setAiToolCalls(new Map())

    window.spool.aiSearch(query, aiAgent, ftsResults).catch((err) => {
      setAiError(String(err))
      setAiStreaming(false)
    })
  }, [query, aiAgent, results])

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q)
    if (!q.trim()) setHomeMode(true)
    if (searchMode === 'fast') {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => doSearch(q), 200)
    }
    if (aiAnswer || aiError) {
      setAiAnswer('')
      setAiError(null)
      aiAnswerRef.current = ''
    }
  }, [doSearch, searchMode, aiAnswer, aiError])

  const handleSubmit = useCallback(() => {
    if (!query.trim()) return
    setHomeMode(false)
    setSelectedSession(null)
    setTargetMessageId(null)
    setView('search')
    if (searchMode === 'ai') {
      doAiSearch()
    } else {
      doSearch(query)
    }
  }, [searchMode, doAiSearch, doSearch, query])

  const handleModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode)
    if (mode === 'fast') {
      setAiAnswer('')
      setAiError(null)
      setAiStreaming(false)
      setAiToolCalls(new Map())
      aiAnswerRef.current = ''
      if (query.trim()) {
        setHomeMode(false)
        setSelectedSession(null)
        setTargetMessageId(null)
        setView('search')
        doSearch(query)
      }
    } else {
      setResults([])
      setIsSearching(false)
    }
  }, [query, doSearch])

  const handleSelectSuggestion = useCallback((uuid: string) => {
    setHomeMode(false)
    setSelectedSession(uuid)
    setView('session')
  }, [])

  const handleOpenSession = useCallback((uuid: string, messageId?: number) => {
    setSelectedSession(uuid)
    setTargetMessageId(messageId ?? null)
    setView('session')
  }, [])

  const handleBack = useCallback(() => {
    setView('search'); setSelectedSession(null); setTargetMessageId(null)
  }, [])

  const handleConnectClick = useCallback(() => {
    setSettingsTab('connectors')
    setShowSettings(true)
  }, [])

  const handleCopySessionId = useCallback((source: FragmentResult['source']) => {
    const command = getSessionResumeCommandPrefix(source)
    if (!command) return
    setResumeToastCommand(command)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setResumeToastCommand(null), 3200)
  }, [])

  const activeAgentInfo = availableAgents.find(a => a.id === aiAgent) ?? availableAgents[0]
  const activeAgentName = activeAgentInfo?.name ?? aiAgent
  const activeAgentMode = activeAgentInfo?.acpMode
  const hasAgents = availableAgents.length > 0

  return (
    <div className="relative flex flex-col h-screen bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text">
      <div className="flex flex-col flex-1 min-h-0">
        {isHomeMode ? (
          <HomeView
            query={query}
            onChange={handleQueryChange}
            onSubmit={handleSubmit}
            onSelectSuggestion={handleSelectSuggestion}
            suggestions={results.filter((r: any) => r.kind !== 'capture')}
            isSearching={isSearching}
            claudeCount={status?.claudeSessions ?? null}
            codexCount={status?.codexSessions ?? null}
            captureSources={captureSources}
            mode={searchMode}
            onModeChange={hasAgents ? handleModeChange : undefined}
            onConnectClick={handleConnectClick}
          />
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 h-10 flex-none mt-2">
              <span className="text-base font-bold tracking-[-0.04em] flex-none select-none">
                S<span className="text-accent">.</span>
              </span>
              <SearchBar
                query={query}
                onChange={handleQueryChange}
                onSubmit={handleSubmit}
                {...(view === 'session' ? { onBack: handleBack } : {})}
                isSearching={isSearching}
                variant="compact"
                mode={searchMode}
                onModeChange={hasAgents ? handleModeChange : undefined}
              />
              {searchMode === 'ai' && availableAgents.length > 0 && (
                <AgentSelector
                  agents={availableAgents}
                  activeAgent={aiAgent}
                  onSelect={setAiAgent}
                />
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {view === 'session' && selectedSession ? (
                <SessionDetail sessionUuid={selectedSession} targetMessageId={targetMessageId} onCopySessionId={handleCopySessionId} />
              ) : (
                <div className="h-full flex flex-col overflow-hidden">
                  {searchMode === 'ai' && (aiAnswer || aiStreaming || aiError) && (
                    <AiAnswerCard
                      answer={aiAnswer}
                      streaming={aiStreaming}
                      agentName={activeAgentName}
                      agentMode={activeAgentMode}
                      sources={results}
                      error={aiError}
                      toolCalls={aiToolCalls}
                    />
                  )}
                  {searchMode === 'ai' && results.length > 0 && (aiAnswer || aiStreaming) && (
                    <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em]">
                      Sources used
                    </div>
                  )}
                  {searchMode === 'ai' && !aiAnswer && !aiStreaming && !aiError && results.length === 0 && query.trim() ? (
                    <div className="flex flex-col items-center justify-center h-full text-warm-faint dark:text-dark-muted gap-2 pb-12">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                        <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
                      </svg>
                      <p className="text-sm text-warm-muted dark:text-dark-muted">Press <kbd className="font-mono bg-warm-surface dark:bg-dark-surface px-1.5 py-0.5 rounded text-xs border border-warm-border dark:border-dark-border">Enter</kbd> to ask the agent</p>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <FragmentResults
                        results={results}
                        query={query}
                        onOpenSession={handleOpenSession}
                        defaultSortOrder={defaultSearchSort}
                        onCopySessionId={handleCopySessionId}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <StatusBar
        syncStatus={syncStatus}
        searchMode={searchMode}
        aiAgent={activeAgentName}
        aiAgentMode={activeAgentMode}
        onSettingsClick={() => { setSettingsTab('general'); setShowSettings(true) }}
      />

      {resumeToastCommand && (
        <ResumeToast command={resumeToastCommand} />
      )}

      {showSettings && (
        <SettingsPanel
          onClose={() => { setShowSettings(false); refreshAgents(); refreshCaptureSources() }}
          initialTab={settingsTab}
          claudeCount={status?.claudeSessions ?? null}
          codexCount={status?.codexSessions ?? null}
        />
      )}
    </div>
  )
}

function ResumeToast({ command }: { command: string }) {
  const suffix = 'then paste the id to resume this session'

  return (
    <div className="pointer-events-none absolute bottom-10 left-1/2 z-40 -translate-x-1/2 animate-in fade-in duration-150 px-4">
      <div className="rounded-full border border-warm-border dark:border-dark-border bg-warm-surface2/95 dark:bg-dark-surface2/95 px-4 py-2 shadow-lg backdrop-blur-sm">
        <p className="whitespace-nowrap text-xs text-warm-text dark:text-dark-text">
          Write <code className="rounded bg-warm-bg dark:bg-dark-bg px-1.5 py-0.5 font-mono text-[11px]">{command}</code> {suffix}
        </p>
      </div>
    </div>
  )
}

function AgentSelector({ agents, activeAgent, onSelect }: {
  agents: AgentInfo[]
  activeAgent: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const active = agents.find(a => a.id === activeAgent) ?? agents[0]

  if (agents.length <= 1) {
    return (
      <span className="text-[11px] text-warm-muted dark:text-dark-muted font-mono whitespace-nowrap flex-none">
        {active.name}
      </span>
    )
  }

  return (
    <div className="relative flex-none">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] text-warm-muted dark:text-dark-muted font-mono whitespace-nowrap hover:text-warm-text dark:hover:text-dark-text transition-colors"
      >
        {active.name} ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-warm-bg dark:bg-dark-surface border border-warm-border dark:border-dark-border rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
          {agents.map(a => (
            <button
              key={a.id}
              onClick={() => { onSelect(a.id); setOpen(false) }}
              className={`block w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors ${
                a.id === activeAgent
                  ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-[#2A1800]'
                  : 'text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface2'
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
