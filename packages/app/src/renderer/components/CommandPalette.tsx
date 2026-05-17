import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Search as SearchIcon, SlidersHorizontal } from 'lucide-react'
import type { Session, SearchResult, SessionSource } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import Hint from './Hint.js'
import ScopeSelector, { type ScopeValue } from './ScopeSelector.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { snippetToStrongHtml } from '../lib/snippet.js'
import { useHotkeys } from '../hooks/useHotkeys.js'
import { bucketSessionsByDate } from './LibraryLanding.js'

/**
 * Unified row shape. Recent mode populates everything except snippet;
 * search mode adds snippet (and messageId for cmdk navigation).
 */
export type PaletteRow = {
  sessionUuid: string
  title: string
  source: SessionSource
  projectLabel: string
  startedAt: string
  msgCount?: number
  /** HTML-with-<mark> from FTS; undefined in recent mode. */
  snippet?: string
  /** Fragment-level anchor for cmdk navigation. */
  messageId?: number
}

const RECENT_LIMIT = 30
const SEARCH_LIMIT = 30
const DEBOUNCE_MS = 150

export type CommandPaletteLabels = {
  /** Footer hint for ↵ — e.g. "open", "ask". */
  enterHint: string
  /** Footer hint for ⇧↵. Omit/empty disables the hint. */
  shiftEnterHint?: string
  /** Body when in search mode with zero matches. */
  noMatches: (query: string) => string
  /** Body when not in search mode and no sessions exist anywhere. */
  emptyNoSessions: string
  /** Body when scope is set and that scope has no sessions. */
  emptyInProject: (projectName: string) => string
  /** Footer total for search results. */
  resultsTotal: (count: number) => string
  /** Footer total for recents list. */
  recentTotal: (count: number) => string
}

type Props = {
  testId: string
  placeholder: string
  initialQuery?: string
  /** Controlled scope state (null = all projects). */
  scope: ScopeValue | null
  onScopeChange: (next: ScopeValue | null) => void
  /** When set, Tab toggles between this contextual scope and null. */
  contextualScope?: ScopeValue | null
  /** Slot above the search input on the right (e.g. Fast/AI pill). */
  headerExtras?: ReactNode
  /** Slot on the scope row, right side (e.g. AgentSelector when in AI mode). */
  scopeRowExtras?: ReactNode
  /** When true, recents are grouped under date bucket headers. */
  groupRecentsByDate?: boolean
  /** When true, query change does not trigger FTS — Enter commits instead. */
  searchDisabled?: boolean
  /** When provided, Tab is shown as an active hint in the scope row. */
  showTabScopeHint?: boolean
  /** When true, the options row is open on mount even if scope is null. */
  optionsDefaultOpen?: boolean
  /** Footer hint configuration — see CommandPaletteLabels. */
  labels: CommandPaletteLabels
  /** ↵ on a row. Also fires when searchDisabled is false. */
  onSubmit: (row: PaletteRow, query: string) => void
  /** ⇧↵ commit, or ↵ when searchDisabled is true. */
  onCommit?: (query: string) => void
  onClose: () => void
}

export default function CommandPalette({
  testId,
  placeholder,
  initialQuery = '',
  scope,
  onScopeChange,
  contextualScope,
  headerExtras,
  scopeRowExtras,
  groupRecentsByDate = false,
  searchDisabled = false,
  showTabScopeHint = false,
  optionsDefaultOpen = false,
  labels,
  onSubmit,
  onCommit,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const noTitle = t('common.noTitle')
  const [query, setQuery] = useState(initialQuery)
  const [recent, setRecent] = useState<Session[] | null>(null)
  const [results, setResults] = useState<PaletteRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(scope !== null || optionsDefaultOpen)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const requestSeqRef = useRef(0)

  // Auto-expand whenever scope flips to non-null so the user can see the
  // active filter; collapsing is left to the user via the toggle.
  useEffect(() => {
    if (scope) setFiltersOpen(true)
  }, [scope?.identityKey])

  // Re-seed query whenever the caller pushes a new initialQuery (e.g. cmdk
  // re-opening with a different starting term).
  useEffect(() => { setQuery(initialQuery) }, [initialQuery])

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  // Modal layer — stacks below any popover (e.g. ScopeSelector popover)
  // and routes Escape to onClose.
  useHotkeys({ Escape: onClose }, { modal: true })

  // Recents fetch (scoped if a project is selected).
  useEffect(() => {
    let cancelled = false
    const req = scope
      ? window.spool.listSessionsByIdentity(scope.identityKey, { limit: RECENT_LIMIT })
      : window.spool.listSessions({ limit: RECENT_LIMIT })
    req
      .then((page) => { if (!cancelled) setRecent(page.sessions) })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('common.error'))
        setRecent([])
      })
    return () => { cancelled = true }
  }, [scope?.identityKey])

  // FTS search with optional project scope. Skipped when `searchDisabled`
  // (AI mode etc.); empty query clears results and re-shows recents.
  useEffect(() => {
    if (searchDisabled) {
      setResults(null)
      setIsSearching(false)
      return
    }
    const q = query.trim()
    if (!q) {
      setResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const seq = ++requestSeqRef.current
    const handle = setTimeout(() => {
      const req = scope
        ? window.spool.search(q, SEARCH_LIMIT, undefined, false, scope.identityKey)
        : window.spool.searchPreview(q, SEARCH_LIMIT)
      req
        .then((rows) => {
          if (seq !== requestSeqRef.current) return
          const seen = new Set<string>()
          const unique: PaletteRow[] = []
          for (const r of rows) {
            if (seen.has(r.sessionUuid)) continue
            seen.add(r.sessionUuid)
            unique.push(searchResultToRow(r, noTitle))
          }
          setResults(unique)
          setIsSearching(false)
        })
        .catch(() => {
          if (seq !== requestSeqRef.current) return
          setResults([])
          setIsSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(handle) }
  }, [query, scope?.identityKey, searchDisabled])

  const inSearchMode = !searchDisabled && query.trim().length > 0
  const recentRows = useMemo(
    () => recent?.map(s => sessionToRow(s, noTitle)) ?? null,
    [recent, noTitle],
  )
  const rows: PaletteRow[] | null = inSearchMode ? results : recentRows

  const queryTokens = inSearchMode
    ? query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    : []

  const showProjectOnRow = !scope

  // Recents bucketing (cmdk style).
  const tLoose = t as unknown as (k: string) => string
  const recentBuckets = useMemo(() => {
    if (!groupRecentsByDate || !recent) return null
    return bucketSessionsByDate(recent, tLoose)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupRecentsByDate, recent, t])

  // Reset active row whenever the visible list changes shape.
  useEffect(() => { setActiveIndex(0) }, [rows?.length, inSearchMode, scope?.identityKey])

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function handleInputKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Tab' && contextualScope) {
      e.preventDefault()
      onScopeChange(scope?.identityKey === contextualScope.identityKey ? null : contextualScope)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey || searchDisabled) {
        if (query.trim()) onCommit?.(query)
        return
      }
      const row = rows?.[activeIndex]
      if (row) onSubmit(row, query)
      return
    }
    if (!rows || rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(rows.length - 1)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={testId}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[12vh] animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-[560px] max-h-[70vh] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Search row */}
        <div className="flex-none flex items-center gap-2.5 px-5 py-3">
          <SearchIcon
            size={15}
            strokeWidth={1.6}
            aria-hidden
            className="flex-none text-warm-faint dark:text-dark-muted"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKey}
            placeholder={placeholder}
            data-testid={`${testId}-input`}
            className="flex-1 bg-transparent outline-none text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted"
          />
          {isSearching && (
            <span className="flex-none text-[10px] text-warm-faint dark:text-dark-muted">{t('search.searchingShort')}</span>
          )}
          {headerExtras && <div className="flex-none">{headerExtras}</div>}
          <button
            type="button"
            data-testid={`${testId}-options-toggle`}
            aria-pressed={filtersOpen}
            aria-label={t('palette.toggleOptions')}
            onClick={() => {
              setFiltersOpen(v => !v)
              inputRef.current?.focus()
            }}
            className={`flex-none rounded-md p-1 -ml-1 transition-colors ${
              scope
                ? 'text-accent hover:bg-accent/10 dark:text-accent-dark dark:hover:bg-accent-dark/10'
                : filtersOpen
                  ? 'bg-warm-surface2 text-warm-text dark:bg-dark-surface2 dark:text-dark-text'
                  : 'text-warm-faint hover:bg-warm-surface2 hover:text-warm-text dark:text-dark-muted dark:hover:bg-dark-surface2 dark:hover:text-dark-text'
            }`}
          >
            <SlidersHorizontal size={13} strokeWidth={1.6} aria-hidden />
          </button>
        </div>

        {/* Options row — scope + caller-provided extras (agent selector, etc). */}
        {filtersOpen && (
          <div
            data-testid={`${testId}-options-row`}
            className="flex-none px-5 pb-2 flex items-center gap-1.5"
          >
            <ScopeSelector
              value={scope}
              onChange={(next) => {
                onScopeChange(next)
                // Return focus to the search input so the Tab shortcut and
                // arrow-nav remain live after the popover closes.
                inputRef.current?.focus()
              }}
              onPopoverClose={() => inputRef.current?.focus()}
              testIdPrefix={`${testId}-scope`}
            />
            {showTabScopeHint && contextualScope && (
              <span
                data-testid={`${testId}-scope-tabhint`}
                className="flex items-center gap-1.5 text-[10px] text-warm-faint dark:text-dark-muted ml-1"
              >
                <kbd className="font-mono text-[9.5px] px-1 py-px rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg">Tab</kbd>
                <span>{t('search.scope_switchHint')}</span>
              </span>
            )}
            {scopeRowExtras && <div className="ml-auto">{scopeRowExtras}</div>}
          </div>
        )}

        {/* Results / recents */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
          {rows === null ? (
            <PaletteSkeleton count={6} />
          ) : error && !inSearchMode ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              {t('newDraft.loadError', { error })}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              {inSearchMode
                ? labels.noMatches(query.trim())
                : scope
                  ? labels.emptyInProject(scope.displayName)
                  : labels.emptyNoSessions}
            </p>
          ) : recentBuckets && !inSearchMode ? (
            <BucketedList
              testId={testId}
              buckets={recentBuckets}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              onSelect={(row) => onSubmit(row, query)}
              noTitle={noTitle}
              showProject={showProjectOnRow}
            />
          ) : (
            <FlatList
              testId={testId}
              rows={rows}
              queryTokens={queryTokens}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              onSelect={(row) => onSubmit(row, query)}
              showProject={showProjectOnRow}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex-none w-full px-4 py-2 text-[11px] flex items-center justify-between text-warm-faint dark:text-dark-muted gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {rows && rows.length > 0 && (
              <>
                <Hint keys={['↑', '↓']} label={t('newDraft.navigate')} />
                <Hint keys={['↵']} label={labels.enterHint} />
              </>
            )}
            {labels.shiftEnterHint && rows && rows.length > 0 && (
              <Hint keys={['⇧', '↵']} label={labels.shiftEnterHint} />
            )}
            <Hint keys={['esc']} label={t('newDraft.close')} />
          </div>
          <div className="flex-none">
            {rows && rows.length > 0 && (
              <span>
                {inSearchMode
                  ? labels.resultsTotal(rows.length)
                  : labels.recentTotal(rows.length)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FlatList({
  testId,
  rows,
  queryTokens,
  activeIndex,
  setActiveIndex,
  onSelect,
  showProject,
}: {
  testId: string
  rows: PaletteRow[]
  queryTokens: string[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  onSelect: (row: PaletteRow) => void
  showProject: boolean
}) {
  return (
    <ul role="listbox">
      {rows.map((row, index) => (
        <li
          key={`${row.sessionUuid}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          data-row-index={index}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <PaletteRowButton
            testId={testId}
            row={row}
            queryTokens={queryTokens}
            active={index === activeIndex}
            showProject={showProject}
            onSelect={() => onSelect(row)}
          />
        </li>
      ))}
    </ul>
  )
}

function BucketedList({
  testId,
  buckets,
  activeIndex,
  setActiveIndex,
  onSelect,
  noTitle,
  showProject,
}: {
  testId: string
  buckets: { label: string; sessions: Session[] }[]
  activeIndex: number
  setActiveIndex: (i: number) => void
  onSelect: (row: PaletteRow) => void
  noTitle: string
  showProject: boolean
}) {
  let running = 0
  return (
    <ul role="listbox">
      {buckets.map(bucket => (
        <li key={bucket.label}>
          <div className="px-5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.04em] text-warm-faint dark:text-dark-muted">
            {bucket.label}
          </div>
          <ul>
            {bucket.sessions.map(session => {
              const index = running++
              const row = sessionToRow(session, noTitle)
              const active = index === activeIndex
              return (
                <li
                  key={session.sessionUuid}
                  role="option"
                  aria-selected={active}
                  data-row-index={index}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <PaletteRowButton
                    testId={testId}
                    row={row}
                    queryTokens={[]}
                    active={active}
                    showProject={showProject}
                    onSelect={() => onSelect(row)}
                  />
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function PaletteRowButton({
  testId,
  row,
  queryTokens,
  active,
  showProject,
  onSelect,
}: {
  testId: string
  row: PaletteRow
  queryTokens: string[]
  active: boolean
  showProject: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const date = formatRelativeDate(row.startedAt, { t: t as unknown as (k: string, o?: Record<string, unknown>) => string })
  const inSearchMode = queryTokens.length > 0
  const snippetHtml = inSearchMode && row.snippet ? snippetToStrongHtml(row.snippet) : null
  const activeBg = active ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''
  const projectVisible = showProject && row.projectLabel

  return (
    <button
      type="button"
      data-testid={`${testId}-row`}
      data-session-uuid={row.sessionUuid}
      onClick={onSelect}
      className={`w-full flex items-start gap-3 px-5 py-2 text-left transition-colors duration-75 ${activeBg}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <SourceBadge source={row.source} />
          <span className="flex-1 min-w-0 text-sm truncate">
            <span className="text-warm-text dark:text-dark-text">{row.title}</span>
            {projectVisible && (
              <span className="text-warm-faint dark:text-dark-muted"> · {row.projectLabel}</span>
            )}
          </span>
        </div>
        {snippetHtml && (
          <div
            className="mt-0.5 pl-1.5 text-[11px] text-warm-faint dark:text-dark-muted truncate [&_strong]:font-medium [&_strong]:text-accent dark:[&_strong]:text-accent-dark"
            dangerouslySetInnerHTML={{ __html: snippetHtml }}
          />
        )}
      </div>
      <span className="flex-none font-mono text-[11px] leading-[20px] text-warm-faint dark:text-dark-muted tabular-nums">
        {date}
      </span>
    </button>
  )
}

function PaletteSkeleton({ count }: { count: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-2">
          <div className="h-4 w-12 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
          <div className="flex-1 h-4 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse" />
          <div className="h-3 w-16 rounded bg-warm-surface2 dark:bg-dark-surface2 opacity-40 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

function sessionToRow(s: Session, noTitle: string): PaletteRow {
  return {
    sessionUuid: s.sessionUuid,
    title: s.title?.trim() || noTitle,
    source: s.source,
    projectLabel: s.projectDisplayName ?? '',
    startedAt: s.startedAt,
    ...(typeof s.messageCount === 'number' ? { msgCount: s.messageCount } : {}),
  }
}

function searchResultToRow(r: SearchResult, noTitle: string): PaletteRow {
  const basename = r.project.split('/').filter(Boolean).pop() ?? r.project
  return {
    sessionUuid: r.sessionUuid,
    title: r.sessionTitle?.trim() || noTitle,
    source: r.source,
    projectLabel: basename,
    startedAt: r.startedAt,
    snippet: r.snippet,
    messageId: r.messageId,
  }
}
