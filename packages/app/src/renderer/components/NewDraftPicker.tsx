import { useEffect, useRef, useState } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import type { Session, SearchResult, SessionSource } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import Hint from './Hint.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { snippetToStrongHtml } from '../lib/snippet.js'

type Props = {
  onSelect: (sessionUuid: string) => void
  onClose: () => void
}

// Match SearchOverlay's 30 for consistent footer counts across both
// command-palette surfaces.
const RECENT_LIMIT = 30
const SEARCH_LIMIT = 30
const DEBOUNCE_MS = 150

/**
 * Picker row shape — a thin union of the two backends. Recent mode
 * gives us Session objects (with messageCount + projectDisplayName);
 * search mode gives SearchResult (FragmentResult with a snippet but
 * a raw project path). We render the same row component for both.
 */
type Row = {
  sessionUuid: string
  title: string
  source: SessionSource
  projectLabel: string
  startedAt: string
  msgCount?: number | undefined
  /** HTML-with-<mark> from FTS; undefined in recent mode. */
  snippet?: string | undefined
}

function sessionToRow(s: Session): Row {
  return {
    sessionUuid: s.sessionUuid,
    title: s.title?.trim() || '(no title)',
    source: s.source,
    projectLabel: s.projectDisplayName ?? '',
    startedAt: s.startedAt,
    msgCount: s.messageCount,
  }
}

function searchResultToRow(r: SearchResult): Row {
  // FragmentResult.project is a raw path; show its basename for parity
  // with SessionRow's display style on this list.
  const basename = r.project.split('/').filter(Boolean).pop() ?? r.project
  return {
    sessionUuid: r.sessionUuid,
    title: r.sessionTitle?.trim() || '(no title)',
    source: r.source,
    projectLabel: basename,
    startedAt: r.startedAt,
    snippet: r.snippet,
  }
}

export default function NewDraftPicker({ onSelect, onClose }: Props) {
  const [recent, setRecent] = useState<Session[] | null>(null)
  const [results, setResults] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Fetch recent on mount.
  useEffect(() => {
    let cancelled = false
    window.spool.listSessions(RECENT_LIMIT)
      .then((rows) => { if (!cancelled) setRecent(rows) })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load sessions')
        setRecent([])
      })
    return () => { cancelled = true }
  }, [])

  // Debounced FTS search; falls back to "no results" until backend
  // responds. Empty query clears results and re-shows recent.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    let cancelled = false
    const handle = setTimeout(() => {
      window.spool.searchPreview(q, SEARCH_LIMIT)
        .then((rows) => {
          if (cancelled) return
          setResults(rows.map(searchResultToRow))
          setIsSearching(false)
        })
        .catch(() => {
          if (cancelled) return
          setResults([])
          setIsSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const inSearchMode = query.trim().length > 0
  const rows: Row[] | null = inSearchMode
    ? results
    : recent?.map(sessionToRow) ?? null

  const queryTokens = inSearchMode
    ? query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    : []

  // Reset active index whenever the result set changes shape.
  useEffect(() => { setActiveIndex(0) }, [rows?.length, inSearchMode])

  // Keep the active row visible as the user navigates.
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!rows || rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(rows.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(rows.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[activeIndex]
      if (row) onSelect(row.sessionUuid)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-draft-picker-title"
      data-testid="new-draft-picker"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-warm-bg/60 dark:bg-dark-bg/70 backdrop-blur-sm px-4 pt-[12vh] animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-[560px] max-h-[70vh] rounded-[10px] border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-xl flex flex-col overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="new-draft-picker-title" className="sr-only">
          Start a draft from a session
        </h2>

        <div className="flex-none flex items-center gap-2.5 px-5 py-3">
          <SearchIcon
            size={15}
            strokeWidth={1.6}
            aria-hidden
            className="flex-none text-warm-faint dark:text-dark-muted"
          />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Start a draft from a session"
            className="flex-1 bg-transparent outline-none text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted"
          />
          {isSearching && (
            <span className="flex-none text-[10px] text-warm-faint dark:text-dark-muted">searching…</span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows === null ? (
            <PickerSkeleton count={6} />
          ) : error && !inSearchMode ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              Couldn't load sessions: {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              {inSearchMode
                ? isSearching ? 'Searching…' : `No sessions match "${query.trim()}".`
                : 'No sessions yet — index some first and they\'ll show up here.'}
            </p>
          ) : (
            <ul ref={listRef} role="listbox">
              {rows.map((row, index) => (
                <li
                  key={row.sessionUuid}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-row-index={index}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <PickerRow
                    row={row}
                    queryTokens={queryTokens}
                    active={index === activeIndex}
                    onSelect={() => onSelect(row.sessionUuid)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-none w-full px-4 py-2 text-[11px] flex items-center justify-between text-warm-faint dark:text-dark-muted gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            {rows && rows.length > 0 && (
              <>
                <Hint keys={['↑', '↓']} label="navigate" />
                <Hint keys={['↵']} label="open" />
              </>
            )}
            <Hint keys={['esc']} label="close" />
          </div>
          <div className="flex-none">
            {rows && rows.length > 0 && (
              <span>
                {inSearchMode
                  ? `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`
                  : `${rows.length} recent ${rows.length === 1 ? 'session' : 'sessions'}`}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PickerRow({
  row,
  queryTokens,
  active,
  onSelect,
}: {
  row: Row
  queryTokens: string[]
  active: boolean
  onSelect: () => void
}) {
  const date = formatRelativeDate(row.startedAt)
  const inSearchMode = queryTokens.length > 0
  const snippetHtml = inSearchMode && row.snippet
    ? snippetToStrongHtml(row.snippet)
    : null
  const activeBg = active ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''

  return (
    <button
      type="button"
      data-testid="new-draft-picker-row"
      data-session-uuid={row.sessionUuid}
      onClick={onSelect}
      className={`w-full flex items-start gap-3 px-5 py-2 text-left transition-colors duration-75 ${activeBg}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <SourceBadge source={row.source} />
          <span className="flex-1 min-w-0 text-sm text-warm-text dark:text-dark-text truncate">
            {row.title}
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

function PickerSkeleton({ count }: { count: number }) {
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
