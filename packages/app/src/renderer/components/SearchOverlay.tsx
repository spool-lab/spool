import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FragmentResult, Session } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import Hint from './Hint.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import SegmentedPill from './SegmentedPill.js'
import { bucketSessionsByDate } from './LibraryLanding.js'
import type { SearchMode } from './SearchBar.js'
import { snippetToStrongHtml } from '../lib/snippet.js'

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
  const { t } = useTranslation()
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<FragmentSearchResult[]>([])
  const [recents, setRecents] = useState<Session[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)

  const showRecents = !query.trim()
  const tLoose = t as unknown as (k: string) => string
  const buckets = useMemo(
    () => (showRecents ? bucketSessionsByDate(recents, tLoose) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showRecents, recents, t],
  )
  const flatRecents = useMemo(() => buckets.flatMap(b => b.sessions), [buckets])

  useEffect(() => { setActiveIndex(0) }, [showRecents, scope])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, showRecents, results.length, flatRecents.length])

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
      : window.spool.listSessions({ limit: 30 })
    /* recents and FTS both limit to 30 for consistent footer counts */
    fetchRecents
      .then(page => { if (!cancelled) setRecents(page.sessions) })
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
      aria-label={t('search.overlayAria')}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="w-full max-w-xl rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3">
          <SearchIcon />
          <input
            ref={inputRef}
            data-testid="search-overlay-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKey}
            placeholder={mode === 'ai' ? t('search.placeholder_ask') : t('search.placeholder_home')}
            className="flex-1 bg-transparent outline-none text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint"
          />
          {searching && <span className="text-[10px] text-warm-faint">{t('search.searchingShort')}</span>}
          {onModeChange && (
            <SegmentedPill
              value={mode}
              onChange={onModeChange}
              compact
              ariaLabel={t('search.mode_fast') + ' / ' + t('search.mode_ai')}
              options={[
                { value: 'fast', label: t('search.mode_fast'), icon: <ZapIcon />, hideLabel: true, title: t('search.mode_fast_title') },
                { value: 'ai', label: t('search.mode_ai'), icon: <SparklesIcon />, hideLabel: true, testId: 'mode-agent', title: t('search.mode_ai_title') },
              ]}
            />
          )}
        </div>

        <div className="px-4 py-2 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-warm-faint">{t('search.scope_searching')}</span>
          <ScopeChip
            label={scopeProjectName ? t('search.scope_inProject', { project: scopeProjectName }) : t('search.scope_inProjectGeneric')}
            active={scope === 'project'}
            disabled={!scopeProjectName}
            onClick={() => onScopeChange('project')}
            testId="scope-project"
          />
          <ScopeChip
            label={t('search.scope_all')}
            active={scope === 'all'}
            onClick={() => onScopeChange('all')}
            testId="scope-all"
          />
          {scopeProjectName && (
            <span className="flex items-center gap-1.5 text-[10px] text-warm-faint">
              <kbd className="font-mono text-[9.5px] px-1 py-px rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg">Tab</kbd>
              <span>{t('search.scope_switchHint')}</span>
            </span>
          )}
          {agentSelector && mode === 'ai' && (
            <div className="ml-auto flex items-center gap-1.5 text-[10px] text-warm-faint">
              <span className="uppercase tracking-wider">{t('search.scope_asking')}</span>
              {agentSelector}
            </div>
          )}
        </div>

        <div ref={listRef} className="min-h-[220px] max-h-[min(420px,55vh)] overflow-y-auto">
          {showRecents ? (
            flatRecents.length === 0 ? (
              <div className="min-h-[220px] flex items-center justify-center px-4 text-center text-sm text-warm-faint dark:text-dark-muted">
                {scope === 'project' ? t('search.noSessionsInProject') : t('search.noSessionsYet')}
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
                                className={`flex items-start gap-3 px-4 py-2 cursor-pointer transition-colors duration-75 ${
                                  active ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''
                                }`}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <SourceBadge source={session.source} />
                                    <span className="flex-1 min-w-0 text-sm text-warm-text dark:text-dark-text truncate">
                                      {session.title?.trim() || t('common.noTitle')}
                                    </span>
                                  </div>
                                </div>
                                <span className="flex-none font-mono text-[11px] leading-[20px] text-warm-faint dark:text-dark-muted tabular-nums">
                                  {formatRelativeDate(session.startedAt, { t: tLoose as unknown as (k: string, o?: Record<string, unknown>) => string })}
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
                  ? t('search.pressEnterToAsk_short', { key: '↵' }).split('↵').flatMap((part, i, arr) => i < arr.length - 1
                      ? [part, <kbd key={i} className="font-mono text-[10px] px-1 rounded border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface">↵</kbd>]
                      : [part])
                  : t('search.noMatches')}
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
                  className={`flex items-start gap-3 px-4 py-2 cursor-pointer transition-colors duration-75 ${
                    index === activeIndex ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <SourceBadge source={result.source} />
                      <span className="flex-1 min-w-0 text-sm text-warm-text dark:text-dark-text truncate">
                        {result.sessionTitle?.trim() || '(no title)'}
                      </span>
                    </div>
                    <div
                      className="mt-0.5 pl-1.5 text-[11px] text-warm-faint dark:text-dark-muted truncate [&_strong]:font-medium [&_strong]:text-accent dark:[&_strong]:text-accent-dark"
                      dangerouslySetInnerHTML={{ __html: snippetToStrongHtml(result.snippet) }}
                    />
                  </div>
                  <span className="flex-none font-mono text-[11px] leading-[20px] text-warm-faint dark:text-dark-muted tabular-nums">
                    {formatRelativeDate(result.startedAt, { t: tLoose as unknown as (k: string, o?: Record<string, unknown>) => string })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="w-full px-4 py-2 text-[11px] flex items-center justify-between text-warm-faint dark:text-dark-muted gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {(showRecents ? flatRecents.length > 0 : results.length > 0) && (
              <>
                <Hint keys={['↑', '↓']} label={t('search.hint_navigate')} />
                <Hint keys={['↵']} label={mode === 'ai' ? t('search.hint_ask') : t('search.hint_open')} />
              </>
            )}
            {!showRecents && results.length > 0 && mode !== 'ai' && (
              <Hint keys={['⇧', '↵']} label={t('search.hint_viewAll')} />
            )}
            <Hint keys={['esc']} label={t('search.hint_close')} />
          </div>
          <div className="flex-none">
            {showRecents && flatRecents.length > 0 ? (
              <span>{t('search.recentCount_other', { count: flatRecents.length })}</span>
            ) : results.length > 0 ? (
              <button
                type="button"
                data-testid="search-overlay-view-all"
                onClick={() => { if (query.trim()) onCommit(query) }}
                className="text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text transition-colors"
              >
                {t('search.resultsArrow_other', { count: results.length })}
              </button>
            ) : null}
          </div>
        </div>
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

