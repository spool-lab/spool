import { useEffect, useState, useCallback, useRef, memo, startTransition, useDeferredValue } from 'react'
import type { FragmentResult, SearchResult, StatusInfo } from '@spool-lab/core'
import { type SearchMode } from './components/SearchBar.js'
import FragmentResults from './components/FragmentResults.js'
import SessionDetail from './components/SessionDetail.js'
import AiAnswerCard from './components/AiAnswerCard.js'
import SettingsPanel from './components/SettingsPanel.js'
import DaemonNoticeModal from './components/DaemonNoticeModal.js'
import Sidebar from './components/Sidebar.js'
import ProjectView from './components/ProjectView.js'
import LibraryLanding, { SearchTrigger } from './components/LibraryLanding.js'
import SearchOverlay from './components/SearchOverlay.js'
import { getSessionResumeCommandPrefix } from '../shared/resumeCommand.js'
import { DEFAULT_SEARCH_SORT_ORDER, type SearchSortOrder } from '../shared/searchSort.js'
import { DEFAULT_SIDEBAR_SORT_ORDER, type SidebarSortOrder } from '../shared/sidebarSort.js'
import { defaultThemeEditorState, type ThemeEditorStateV1 } from './theme/editorTypes.js'
import { applyEditorTheme } from './theme/applyEditorTheme.js'
import { loadThemeEditorState, saveThemeEditorState } from './theme/persist.js'

type View = 'search' | 'session'
type SettingsTab = 'general' | 'appearance' | 'sources' | 'agent'

type FragmentSearchResult = FragmentResult & { kind: 'fragment' }

interface AgentInfo {
  id: string
  name: string
  path: string
  status: 'ready' | 'not_found' | 'not_running'
  acpMode: 'extension' | 'native' | 'websocket'
}

interface RuntimeInfo {
  isDev: boolean
  appPath: string
  appName: string
}

export default function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [previewSuggestions, setPreviewSuggestions] = useState<SearchResult[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null)
  const [view, setView] = useState<View>('search')
  const [homeMode, setHomeMode] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ phase: string; count: number; total: number } | null>(null)
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestSeq = useRef(0)
  const previewRequestSeq = useRef(0)

  // AI mode state
  const [searchMode, setSearchMode] = useState<SearchMode>('fast')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiAgent, setAiAgent] = useState('claude')
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([])
  const [aiToolCalls, setAiToolCalls] = useState<Map<string, { title: string; status: string; kind?: string | undefined }>>(new Map())
  const aiAnswerRef = useRef('')

  // Settings & modals
  const [showSettings, setShowSettings] = useState(false)
  const [showDaemonNotice, setShowDaemonNotice] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [defaultSearchSort, setDefaultSearchSort] = useState<SearchSortOrder>(DEFAULT_SEARCH_SORT_ORDER)
  const [sidebarShowSourceDots, setSidebarShowSourceDots] = useState(true)
  const [sidebarShowSessionCount, setSidebarShowSessionCount] = useState(true)
  const [sidebarSortOrder, setSidebarSortOrder] = useState<SidebarSortOrder>(DEFAULT_SIDEBAR_SORT_ORDER)
  const [resumeToastCommand, setResumeToastCommand] = useState<string | null>(null)
  const [themeEditor, setThemeEditor] = useState<ThemeEditorStateV1>(() => defaultThemeEditorState())
  const themeHydrated = useRef(false)
  const deferredResults = useDeferredValue(results)
  const [lastCompletedPreviewQuery, setLastCompletedPreviewQuery] = useState('')
  const [activeProjectKey, setActiveProjectKey] = useState<string | null>(null)
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null)
  const [searchOverlayOpen, setSearchOverlayOpen] = useState(false)
  const [searchScope, setSearchScope] = useState<'all' | 'project'>('all')

  const showProjectView = activeProjectKey !== null && view === 'search' && !selectedSession && !query.trim()
  const showSearchResults = view === 'search' && !selectedSession && !!query.trim()
  const isHomeMode = homeMode && view === 'search' && !selectedSession && !showProjectView && !showSearchResults

  useEffect(() => {
    loadThemeEditorState()
      .then(setThemeEditor)
      .catch(console.error)
      .finally(() => {
        themeHydrated.current = true
      })
  }, [])

  useEffect(() => {
    if (!window.spool?.getDaemonNoticePending) return
    window.spool.getDaemonNoticePending()
      .then(pending => { if (pending) setShowDaemonNotice(true) })
      .catch(console.error)
  }, [])

  useEffect(() => {
    applyEditorTheme(themeEditor)
  }, [themeEditor])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      applyEditorTheme(themeEditor)
    }
    mq.addEventListener('change', onScheme)
    return () => mq.removeEventListener('change', onScheme)
  }, [themeEditor])

  useEffect(() => {
    if (!themeHydrated.current) return
    const t = window.setTimeout(() => {
      saveThemeEditorState(themeEditor).catch(console.error)
    }, 400)
    return () => window.clearTimeout(t)
  }, [themeEditor])

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
      setSidebarShowSourceDots(config.sidebarShowSourceDots ?? true)
      setSidebarShowSessionCount(config.sidebarShowSessionCount ?? true)
      setSidebarSortOrder(config.sidebarSortOrder ?? DEFAULT_SIDEBAR_SORT_ORDER)
      const defaultId = config.defaultAgent && ready.find(a => a.id === config.defaultAgent)
        ? config.defaultAgent
        : ready[0]?.id
      if (defaultId) setAiAgent(defaultId)
    }).catch(console.error)
  }, [])

  // Detect available ACP agents on mount
  useEffect(() => { refreshAgents() }, [])

  const handleSidebarSortChange = useCallback(async (next: SidebarSortOrder) => {
    setSidebarSortOrder(next)
    if (!window.spool?.setAgentsConfig) return
    try {
      const config = await window.spool.getAgentsConfig()
      await window.spool.setAgentsConfig({ ...config, sidebarSortOrder: next })
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      if (syncRefreshTimer.current) clearTimeout(syncRefreshTimer.current)
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
        const previous = prev.get(tc.toolCallId)
        next.set(tc.toolCallId, {
          title: tc.title || previous?.title || '',
          status: tc.status,
          ...(tc.kind ? { kind: tc.kind } : previous?.kind ? { kind: previous.kind } : {}),
        })
        return next
      })
    })
    return () => { offChunk(); offDone(); offToolCall?.() }
  }, [])

  useEffect(() => {
    if (!window.spool) return
    window.spool.getRuntimeInfo?.().then(setRuntimeInfo).catch(console.error)
  }, [])

  useEffect(() => {
    if (!window.spool) return
    if (syncStatus && syncStatus.phase !== 'done') return
    window.spool.getStatus().then(setStatus).catch(console.error)
  }, [syncStatus?.phase])

  useEffect(() => {
    if (!window.spool) return () => {}
    const scheduleSearchRefresh = () => {
      if (!query.trim() || searchMode !== 'fast') return
      if (syncRefreshTimer.current) clearTimeout(syncRefreshTimer.current)
      syncRefreshTimer.current = setTimeout(() => {
        syncRefreshTimer.current = null
        doSearch(query)
      }, 250)
    }
    const offProgress = window.spool.onSyncProgress((e) => {
      setSyncStatus(e)
      if (e.phase === 'syncing' || e.phase === 'indexing') {
        scheduleSearchRefresh()
      }
      if (e.phase === 'done') {
        if (syncRefreshTimer.current) {
          clearTimeout(syncRefreshTimer.current)
          syncRefreshTimer.current = null
        }
        setTimeout(() => setSyncStatus(null), 3000)
        if (query.trim() && searchMode === 'fast') doSearch(query)
      }
    })
    const offNew = window.spool.onNewSessions(() => {
      window.spool.getStatus().then(setStatus).catch(console.error)
      scheduleSearchRefresh()
    })
    return () => { offProgress(); offNew() }
  }, [query, searchMode])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setIsSearching(false); return }
    const requestId = ++searchRequestSeq.current
    setIsSearching(true)
    const scopedKey = searchScope === 'project' && activeProjectKey ? activeProjectKey : undefined
    try {
      const res = window.spool ? await window.spool.search(q, 20, undefined, false, scopedKey) : []
      if (requestId !== searchRequestSeq.current) return
      startTransition(() => {
        setResults(res)
      })
    } finally {
      if (requestId === searchRequestSeq.current) {
        setIsSearching(false)
      }
    }
  }, [searchScope, activeProjectKey])

  const doPreviewSearch = useCallback(async (q: string) => {
    if (!q.trim() || !window.spool?.searchPreview) {
      setPreviewSuggestions([])
      setLastCompletedPreviewQuery(q)
      return
    }

    const requestId = ++previewRequestSeq.current
    const suggestions = await window.spool.searchPreview(q, 5)
    if (requestId !== previewRequestSeq.current) return
    startTransition(() => {
      setPreviewSuggestions(suggestions)
    })
    setLastCompletedPreviewQuery(q)
  }, [])

  const doAiSearch = useCallback(async (overrideQuery?: string) => {
    const q = (overrideQuery ?? query).trim()
    if (!q || !window.spool?.aiSearch) return

    const scopedKey = searchScope === 'project' && activeProjectKey ? activeProjectKey : undefined
    const ftsResults = results.length > 0 ? results : (window.spool ? await window.spool.search(q, 20, undefined, false, scopedKey) : [])
    if (ftsResults.length > 0 && results.length === 0) setResults(ftsResults)
    const fragmentContext = ftsResults.filter((result): result is FragmentResult & { kind: 'fragment' } => result.kind === 'fragment')

    aiAnswerRef.current = ''
    setAiAnswer('')
    setAiError(null)
    setAiStreaming(true)
    setAiToolCalls(new Map())

    window.spool.aiSearch(q, aiAgent, fragmentContext).catch((err) => {
      setAiError(String(err))
      setAiStreaming(false)
    })
  }, [query, aiAgent, results, searchScope, activeProjectKey])

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q)
    if (!q.trim()) setHomeMode(true)
    if (searchMode === 'fast') {
      if (searchTimer.current) clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => doSearch(q), 120)
      void doPreviewSearch(q)
    }
    if (aiAnswer || aiError) {
      setAiAnswer('')
      setAiError(null)
      aiAnswerRef.current = ''
    }
  }, [doPreviewSearch, doSearch, searchMode, aiAnswer, aiError])

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

  const handleSelectSuggestion = useCallback((uuid: string, messageId?: number) => {
    setHomeMode(false)
    setSelectedSession(uuid)
    setTargetMessageId(messageId ?? null)
    setView('session')
  }, [])

  const handleOpenSession = useCallback((uuid: string, messageId?: number) => {
    setSelectedSession(uuid)
    setTargetMessageId(messageId ?? null)
    setView('session')
  }, [])

  const handleBack = useCallback(() => {
    setView('search')
    setSelectedSession(null)
    setTargetMessageId(null)
  }, [])

  const handleClearResults = useCallback(() => {
    setQuery('')
    setResults([])
    setAiAnswer('')
    setAiError(null)
    setAiStreaming(false)
    aiAnswerRef.current = ''
    setSelectedSession(null)
    setTargetMessageId(null)
    setHomeMode(activeProjectKey === null)
    setView('search')
  }, [activeProjectKey])

  // ⌘K opens overlay
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMacLike = /mac/i.test(navigator.platform)
      const modifier = isMacLike ? event.metaKey : event.ctrlKey
      if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOverlayOpen(open => !open)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Default scope follows active project
  useEffect(() => {
    if (activeProjectKey) {
      setSearchScope('project')
    } else {
      setSearchScope('all')
    }
  }, [activeProjectKey])

  // Resolve active project name for scope chip label
  useEffect(() => {
    if (!activeProjectKey) {
      setActiveProjectName(null)
      return
    }
    let cancelled = false
    window.spool.listProjectGroups()
      .then(groups => {
        if (cancelled) return
        const match = groups.find(g => g.identityKey === activeProjectKey)
        setActiveProjectName(match?.displayName ?? null)
      })
      .catch(() => { if (!cancelled) setActiveProjectName(null) })
    return () => { cancelled = true }
  }, [activeProjectKey])

  const handleSearchOpen = useCallback(() => setSearchOverlayOpen(true), [])
  const handleSearchClose = useCallback(() => setSearchOverlayOpen(false), [])
  const handleSearchCommit = useCallback((q: string) => {
    setSearchOverlayOpen(false)
    setQuery(q)
    setHomeMode(false)
    setSelectedSession(null)
    setTargetMessageId(null)
    setView('search')
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (searchMode === 'ai') {
      void doAiSearch(q)
    } else {
      void doSearch(q)
    }
  }, [doSearch, doAiSearch, searchMode])

  const handleOpenResultFromOverlay = useCallback((uuid: string, messageId: number | undefined, q: string) => {
    setSearchOverlayOpen(false)
    setSelectedSession(uuid)
    setTargetMessageId(messageId ?? null)
    setView('session')
    if (q.trim() && q !== query) {
      setQuery(q)
      setHomeMode(false)
      void doSearch(q)
    }
  }, [query, doSearch])

  const handleCopySessionId = useCallback((source: FragmentResult['source']) => {
    const command = getSessionResumeCommandPrefix(source)
    if (!command) return
    setResumeToastCommand(command)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setResumeToastCommand(null), 3200)
  }, [])

  const activeAgentInfo = availableAgents.find(a => a.id === aiAgent) ?? availableAgents[0]
  const activeAgentName = activeAgentInfo?.name ?? aiAgent
  const hasAgents = availableAgents.length > 0
  const fragmentSources = deferredResults.filter((result): result is FragmentSearchResult => result.kind === 'fragment')
  const fragmentPreview = previewSuggestions.filter((result): result is FragmentSearchResult => result.kind === 'fragment')

  return (
    <div className="relative flex h-screen bg-warm-bg dark:bg-dark-bg text-warm-text dark:text-dark-text">
      <Sidebar
        activeIdentityKey={activeProjectKey}
        onSelectProject={(key) => {
          setActiveProjectKey(key)
          setHomeMode(false)
          setSelectedSession(null)
          setTargetMessageId(null)
          setView('search')
          setQuery('')
        }}
        onSelectHome={() => {
          setActiveProjectKey(null)
          setHomeMode(true)
          setSelectedSession(null)
          setTargetMessageId(null)
          setView('search')
          setQuery('')
        }}
        onOpenSearch={handleSearchOpen}
        syncStatus={syncStatus}
        status={status}
        showSourceDots={sidebarShowSourceDots}
        showSessionCount={sidebarShowSessionCount}
        sortOrder={sidebarSortOrder}
        onSortOrderChange={handleSidebarSortChange}
        onSettingsClick={() => { setSettingsTab('general'); setShowSettings(true) }}
      />
      <div className="relative flex flex-col flex-1 min-w-0">
      <div className="flex flex-col flex-1 min-h-0 relative">
        {isHomeMode ? (
          <LibraryLanding
            onSelectProject={(key) => {
              setActiveProjectKey(key)
              setHomeMode(false)
              setSelectedSession(null)
              setTargetMessageId(null)
              setView('search')
              setQuery('')
            }}
            onOpenSession={handleOpenSession}
            onCopySessionId={handleCopySessionId}
          />
        ) : (
          <>
            {!showProjectView && view !== 'session' && !!query.trim() && (
              <div className="flex items-center gap-3 px-6 pt-6 pb-3 flex-none">
                <button
                  type="button"
                  onClick={handleClearResults}
                  aria-label="Back"
                  title="Back"
                  className="flex-none flex items-center justify-center w-6 h-6 rounded-md text-warm-muted dark:text-dark-muted hover:bg-warm-surface dark:hover:bg-dark-surface hover:text-warm-text dark:hover:text-dark-text transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M8 3L4 6.5L8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <p className="text-xs text-warm-muted dark:text-dark-muted">
                  Results for <span className="font-mono text-warm-text dark:text-dark-text">"{query}"</span>
                  <span aria-hidden className="mx-1.5 text-warm-faint">·</span>
                  <span data-testid="results-scope-chip" className="text-warm-faint dark:text-dark-muted">
                    {searchScope === 'project' && activeProjectName
                      ? <>in <span className="font-mono">{activeProjectName}</span></>
                      : 'all projects'}
                  </span>
                </p>
                {searchMode === 'ai' && availableAgents.length > 0 && (
                  <AgentSelector
                    agents={availableAgents}
                    activeAgent={aiAgent}
                    onSelect={setAiAgent}
                  />
                )}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-hidden">
              {view === 'session' && selectedSession ? (
                <SessionDetail
                  sessionUuid={selectedSession}
                  targetMessageId={targetMessageId}
                  onCopySessionId={handleCopySessionId}
                  onBack={handleBack}
                />
              ) : showProjectView && activeProjectKey ? (
                <ProjectView
                  identityKey={activeProjectKey}
                  onOpenSession={handleOpenSession}
                  onCopySessionId={handleCopySessionId}
                />
              ) : (
                <div className="h-full flex flex-col overflow-hidden">
                  {searchMode === 'ai' && (aiAnswer || aiStreaming || aiError) && (
                    <AiAnswerCard
                      answer={aiAnswer}
                      streaming={aiStreaming}
                      agentName={activeAgentName}
                      sources={fragmentSources}
                      error={aiError}
                      toolCalls={aiToolCalls}
                    />
                  )}
                  {searchMode === 'ai' && fragmentSources.length > 0 && (aiAnswer || aiStreaming) && (
                    <div className="px-4 pt-2 pb-1 text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em]">
                      Sources used
                    </div>
                  )}
                  {searchMode === 'ai' && !aiAnswer && !aiStreaming && !aiError && fragmentSources.length === 0 && query.trim() ? (
                    <div className="flex flex-col items-center justify-center h-full text-warm-faint dark:text-dark-muted gap-2 pb-12">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                        <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
                      </svg>
                      <p className="text-sm text-warm-muted dark:text-dark-muted">Press <kbd className="font-mono bg-warm-surface dark:bg-dark-surface px-1.5 py-0.5 rounded text-xs border border-warm-border dark:border-dark-border">Enter</kbd> to ask the agent</p>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0">
                      <FragmentResults
                        results={fragmentSources}
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

      </div>

      {resumeToastCommand && (
        <ResumeToast command={resumeToastCommand} />
      )}

      {showSettings && (
        <SettingsPanel
          onClose={() => { setShowSettings(false); refreshAgents() }}
          initialTab={settingsTab}
          claudeCount={status?.claudeSessions ?? null}
          codexCount={status?.codexSessions ?? null}
          geminiCount={status?.geminiSessions ?? null}
          themeEditor={themeEditor}
          onThemeEditorChange={setThemeEditor}
        />
      )}

      {showDaemonNotice && (
        <DaemonNoticeModal onClose={() => setShowDaemonNotice(false)} />
      )}

      <SearchOverlay
        open={searchOverlayOpen}
        initialQuery={query}
        scope={searchScope}
        scopeProjectName={activeProjectName}
        scopeProjectKey={activeProjectKey}
        defaultScope={activeProjectKey ? 'project' : 'all'}
        mode={searchMode}
        {...(hasAgents ? { onModeChange: setSearchMode } : {})}
        {...(hasAgents ? {
          agentSelector: (
            <AgentSelector
              agents={availableAgents}
              activeAgent={aiAgent}
              onSelect={setAiAgent}
            />
          )
        } : {})}
        onClose={handleSearchClose}
        onScopeChange={(next) => setSearchScope(activeProjectName ? next : 'all')}
        onCommit={handleSearchCommit}
        onOpenResult={handleOpenResultFromOverlay}
      />
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

const AgentSelector = memo(function AgentSelector({ agents, activeAgent, onSelect }: {
  agents: AgentInfo[]
  activeAgent: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (agents.length === 0) return null
  const active = agents.find(a => a.id === activeAgent) ?? agents[0]!

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
        onMouseDown={(e) => e.preventDefault()}
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(a.id); setOpen(false) }}
              className={`block w-full text-left px-3 py-1.5 text-[11px] font-mono transition-colors ${
                a.id === activeAgent
                  ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
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
})

