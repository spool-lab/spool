import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FragmentResult, Session } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import SegmentedPill from './SegmentedPill.js'
import { bucketSessionsByDate } from './LibraryLanding.js'
import type { SearchMode } from './SearchBar.js'

type FragmentSearchResult = FragmentResult & { kind: 'fragment' }

type Scope = 'all' | 'project'

type Props = {
  open: boolean
  initialQuery: string
  scope: Scope
  scopeProjectName: string | null
  scopeProjectKey: string | null
  defaultScope: Scope
  mode: SearchMode
  onModeChange?: (mode: SearchMode) => void
  agentSelector?: ReactNode
  onClose: () => void
  onScopeChange: (scope: Scope) => void
  onCommit: (query: string) => void
  onOpenResult: (uuid: string, messageId: number | undefined, query: string) => void
}

export default function SearchOverlay({
  open,
  initialQuery,
  scope,
  scopeProjectName,
  scopeProjectKey,
  defaultScope,
  mode,
  onModeChange,
  agentSelector,
  onClose,
  onScopeChange,
  onCommit,
  onOpenResult,
}: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<FragmentSearchResult[]>([])
  const [recents, setRecents] = useState<Session[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  const showRecents = !query.trim()
  const buckets = useMemo(() => (showRecents ? bucketSessionsByDate(recents) : []), [showRecents, recents])
  const flatRecents = useMemo(() => buckets.flatMap(b => b.sessions), [buckets])

  useEffect(() => { setActiveIndex(0) }, [showRecents, scope])

  useEffect(() => {
    if (open) {
      setQuery(initialQuery)
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [open, initialQuery])

  useEffect(() => {
    if (!open || !showRecents) return
    let cancelled = false
    const fetchRecents = scope === 'project' && scopeProjectKey
      ? window.spool.listSessionsByIdentity(scopeProjectKey, { limit: 30 })
      : window.spool.listSessions(30)
    /* recents and FTS both limit to 30 for consistent footer counts */
    fetchRecents
      .then(sessions => { if (!cancelled) setRecents(sessions) })
      .catch(() => { if (!cancelled) setRecents([]) })
    return () => { cancelled = true }
  }, [open, showRecents, scope, scopeProjectKey])

  useEffect(() => {
    if (!open) return
    if (mode === 'ai') {
      setResults([])
      setSearching(false)
      return
    }
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setSearching(false)
      return
    }
    const seq = ++seqRef.current
    setSearching(true)
    const scopedKey = scope === 'project' && scopeProjectKey ? scopeProjectKey : undefined
    const timer = setTimeout(async () => {
      try {
        const raw = await window.spool.search(trimmed, 30, undefined, false, scopedKey)
        if (seq !== seqRef.current) return
        const fragments = raw.filter((r): r is FragmentSearchResult => r.kind === 'fragment')
        setResults(fragments)
        setActiveIndex(0)
      } finally {
        if (seq === seqRef.current) setSearching(false)
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [open, query, scope, scopeProjectKey, mode])

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (!scopeProjectName) return
      onScopeChange(scope === 'all' ? 'project' : 'all')
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const max = showRecents ? flatRecents.length - 1 : results.length - 1
      setActiveIndex(i => Math.min(max, i + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(i => Math.max(0, i - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey || mode === 'ai') {
        if (query.trim()) onCommit(query)
        return
      }
      if (showRecents) {
        const session = flatRecents[activeIndex]
        if (session) onOpenResult(session.sessionUuid, undefined, '')
        return
      }
      const target = results[activeIndex]
      if (target) onOpenResult(target.sessionUuid, target.messageId, query)
    }
  }

  if (!open) return null

  return (
    <div
      data-testid="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="w-full max-w-xl rounded-xl border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-warm-border dark:border-dark-border">
          <SearchIcon />
          <input
            ref={inputRef}
            data-testid="search-overlay-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKey}
            placeholder={mode === 'ai' ? 'Ask anything about your sessions…' : 'Search your sessions…'}
            className="flex-1 bg-transparent outline-none text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint"
          />
          {searching && <span className="text-[10px] text-warm-faint">searching…</span>}
          {onModeChange && (
            <SegmentedPill
              value={mode}
              onChange={onModeChange}
              compact
              ariaLabel="Search mode"
              options={[
                { value: 'fast', label: 'Fast', icon: <ZapIcon />, hideLabel: true, title: 'Fast search — find sessions by keyword' },
                { value: 'ai', label: 'Agent', icon: <SparklesIcon />, hideLabel: true, testId: 'mode-agent', title: 'Agent — ask in natural language; the agent searches and answers' },
              ]}
            />
          )}
        </div>

        <div className="px-4 py-2 flex items-center gap-2 border-b border-warm-border dark:border-dark-border">
          <span className="text-[10px] uppercase tracking-wider text-warm-faint">Searching:</span>
          <ScopeChip
            label={scopeProjectName ? `in: ${scopeProjectName}` : 'in: project'}
            active={scope === 'project'}
            disabled={!scopeProjectName}
            onClick={() => onScopeChange('project')}
            testId="scope-project"
          />
          <ScopeChip
            label="All projects"
            active={scope === 'all'}
            onClick={() => onScopeChange('all')}
            testId="scope-all"
          />
          {scopeProjectName && (
            <span className="flex items-center gap-1.5 text-[10px] text-warm-faint">
              <kbd className="font-mono text-[9.5px] px-1 py-px rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg">Tab</kbd>
              <span>to switch</span>
            </span>
          )}
          {agentSelector && mode === 'ai' && (
            <div className="ml-auto flex items-center gap-1.5 text-[10px] text-warm-faint">
              <span className="uppercase tracking-wider">Asking:</span>
              {agentSelector}
            </div>
          )}
        </div>

        <div className="min-h-[220px] max-h-[min(420px,55vh)] overflow-y-auto">
          {showRecents ? (
            flatRecents.length === 0 ? (
              <div className="min-h-[220px] flex items-center justify-center px-4 text-center text-sm text-warm-faint dark:text-dark-muted">
                {scope === 'project' ? 'No sessions in this project yet.' : 'No sessions yet.'}
              </div>
            ) : (
              (() => {
                let runningIdx = 0
                return (
                  <ul role="listbox">
                    {buckets.map(bucket => (
                      <li key={bucket.label}>
                        <div className="px-4 pt-3 pb-1 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted">
                          {bucket.label}
                        </div>
                        <ul>
                          {bucket.sessions.map(session => {
                            const idx = runningIdx++
                            const active = idx === activeIndex
                            return (
                              <li
                                key={session.sessionUuid}
                                role="option"
                                aria-selected={active}
                                onMouseEnter={() => setActiveIndex(idx)}
                                onClick={() => onOpenResult(session.sessionUuid, undefined, '')}
                                className={`px-4 py-2 cursor-pointer flex items-center gap-2 ${
                                  active ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''
                                }`}
                              >
                                <SourceBadge source={session.source} />
                                <span className="flex-1 truncate text-sm text-warm-text dark:text-dark-text">
                                  {session.title?.trim() || '(no title)'}
                                </span>
                                <span className="flex-none text-[11px] text-warm-faint dark:text-dark-muted">
                                  {formatRelativeDate(session.startedAt)}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )
              })()
            )
          ) : results.length === 0 ? (
            <div className="h-full flex items-center justify-center px-4 text-center text-sm text-warm-faint dark:text-dark-muted">
              <span>
                {mode === 'ai' && query.trim()
                  ? <>Press <kbd className="font-mono text-[10px] px-1 rounded border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface">↵</kbd> to ask the agent.</>
                  : 'No matches.'}
              </span>
            </div>
          ) : (
            <ul role="listbox">
              {results.map((result, index) => (
                <li
                  key={`${result.sessionUuid}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onOpenResult(result.sessionUuid, result.messageId, query)}
                  className={`px-4 py-2.5 cursor-pointer border-b border-warm-border/50 dark:border-dark-border/50 ${
                    index === activeIndex ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <SourceBadge source={result.source} />
                    <span className="text-xs text-warm-muted dark:text-dark-muted truncate flex-1">
                      {result.project.split('/').pop() ?? result.project}
                    </span>
                    <span className="text-[11px] text-warm-faint flex-none">{formatRelativeDate(result.startedAt)}</span>
                  </div>
                  <p
                    className="font-mono text-xs text-warm-text dark:text-dark-text leading-relaxed [&>strong]:font-semibold [&>strong]:text-accent dark:[&>strong]:text-accent-dark line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: snippetWithStrong(result.snippet) }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {showRecents && flatRecents.length > 0 ? (
          <div className="w-full px-4 py-2 text-[11px] border-t border-warm-border dark:border-dark-border flex items-center justify-end text-warm-faint dark:text-dark-muted">
            <span>{flatRecents.length} recent {flatRecents.length === 1 ? 'session' : 'sessions'}</span>
          </div>
        ) : results.length > 0 && (
          <button
            type="button"
            data-testid="search-overlay-view-all"
            onClick={() => { if (query.trim()) onCommit(query) }}
            className="w-full px-4 py-2 text-[11px] border-t border-warm-border dark:border-dark-border flex items-center justify-between text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <span>View all results</span>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M3 2.5L6 5L3 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="flex items-center gap-2">
              <kbd className="font-mono text-[9.5px] px-1 py-px rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg">⇧↵</kbd>
              <span className="text-warm-faint">{results.length} results</span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

function ScopeChip({
  label,
  active,
  disabled,
  onClick,
  testId,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-warm-text dark:text-dark-text'
          : disabled
            ? 'border-warm-border/50 dark:border-dark-border/50 text-warm-faint dark:text-dark-muted cursor-not-allowed'
            : 'border-warm-border dark:border-dark-border text-warm-muted dark:text-dark-muted hover:border-accent/50'
      }`}
    >
      {label}
    </button>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-warm-muted dark:text-dark-muted flex-none">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ZapIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  )
}

function SparklesIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
      <path d="M5 3v4M19 17v4M3 5h4M17 19h4"/>
    </svg>
  )
}

function snippetWithStrong(snippet: string): string {
  return snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
}
