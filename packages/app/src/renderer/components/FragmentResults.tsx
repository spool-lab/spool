import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import type { FragmentResult, StarKind } from '@spool-lab/core'
import ContinueActions from './ContinueActions.js'
import StarButton from './StarButton.js'
import { SourceBadge } from './Badges.js'
import { SEARCH_SORT_OPTIONS, type SearchSortOrder } from '../../shared/searchSort.js'
import { getSessionSourceLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type FragmentRowResult = FragmentResult & { kind: 'fragment' }

type Props = {
  results: FragmentRowResult[]
  query: string
  onOpenSession: (uuid: string, messageId?: number) => void
  defaultSortOrder: SearchSortOrder
  onCopySessionId: (source: FragmentResult['source']) => void
  starredSessions: Set<string>
  onToggleStar: (kind: StarKind, uuid: string, next: boolean) => void
}

export default function FragmentResults({ results, query, onOpenSession, defaultSortOrder, onCopySessionId, starredSessions, onToggleStar }: Props) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<SearchSortOrder>(defaultSortOrder)

  const isResultStarred = (r: FragmentRowResult): boolean =>
    starredSessions.has(r.sessionUuid)

  useEffect(() => {
    setSortOrder(defaultSortOrder)
  }, [defaultSortOrder])

  useEffect(() => {
    if (activeFilter === 'starred' && !results.some(isResultStarred)) setActiveFilter('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, results, starredSessions])

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-warm-faint dark:text-dark-muted gap-2 pb-12">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="opacity-30">
          <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="2"/>
          <path d="M22 22L28 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <p className="text-sm text-warm-muted dark:text-dark-muted">No results for "{query}"</p>
        <p className="text-xs text-warm-faint dark:text-dark-muted opacity-80">
          Try different keywords, use spaces for multi-term search, or run{' '}
          <code className="font-mono bg-warm-surface dark:bg-dark-surface px-1 rounded">spool sync</code>
        </p>
      </div>
    )
  }

  const sourceKeys = [...new Set(results.map(r => r.source))]
  const starredInResults = results.some(isResultStarred)
  const filtered = activeFilter === 'all'
    ? results
    : activeFilter === 'starred'
      ? results.filter(isResultStarred)
      : results.filter(r => r.source === activeFilter)
  const sortedResults = sortResults(filtered, sortOrder)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-warm-border dark:border-dark-border px-4 min-h-11 flex-none">
        <div className="flex gap-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-none">
          {(['all', ...(starredInResults ? ['starred'] : []), ...sourceKeys] as string[]).map(src => (
            <button
              key={src}
              onClick={() => setActiveFilter(src)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1 ${
                activeFilter === src
                  ? 'border-accent text-warm-text dark:text-dark-text'
                  : 'border-transparent text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
              }`}
            >
              {src === 'starred' && (
                <Star size={11} strokeWidth={2} fill="currentColor" className="text-accent dark:text-accent-dark flex-none" />
              )}
              {src === 'all' ? 'All' : src === 'starred' ? 'Starred' : formatSourceFilterLabel(src)}
            </button>
          ))}
        </div>

        <div className="relative flex-none">
          <select
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as SearchSortOrder)}
            aria-label="Sort results"
            className="appearance-none h-8 rounded-full border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface pl-3 pr-9 text-xs font-medium text-warm-text dark:text-dark-text outline-none transition-colors hover:border-accent/50 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 focus:border-accent"
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

      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-warm-border dark:divide-dark-border">
          {sortedResults.map((result, i) => (
            <FragmentRow
              key={`frag-${result.sessionUuid}-${i}`}
              result={result}
              onOpenSession={onOpenSession}
              onCopySessionId={onCopySessionId}
              isStarred={starredSessions.has(result.sessionUuid)}
              onToggleStar={onToggleStar}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function formatSourceFilterLabel(source: string): string {
  if (source === 'claude' || source === 'codex' || source === 'gemini') {
    return getSessionSourceLabel(source)
  }
  return source
}

function FragmentRow({
  result,
  onOpenSession,
  onCopySessionId,
  isStarred,
  onToggleStar,
}: {
  result: FragmentRowResult
  onOpenSession: (uuid: string, messageId?: number) => void
  onCopySessionId: (source: FragmentResult['source']) => void
  isStarred: boolean
  onToggleStar: (kind: StarKind, uuid: string, next: boolean) => void
}) {
  const snippet = result.snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
  const date = formatRelativeDate(result.startedAt)
  const project = result.project.split('/').pop() ?? result.project

  return (
    <div
      data-testid="fragment-row"
      data-starred={isStarred ? '1' : '0'}
      className="px-4 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
    >
      <div
        className="cursor-pointer"
        onClick={() => onOpenSession(result.sessionUuid, result.messageId)}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <SourceBadge source={result.source} />
          <span className="text-xs text-warm-muted dark:text-dark-muted truncate flex-1">
            You discussed this · {project}
            {result.profileLabel && <span> · {result.profileLabel}</span>}
            {result.matchCount > 1 && <span data-testid="match-count"> · {result.matchCount} matches</span>}
          </span>
          <span className="text-xs text-warm-faint dark:text-dark-muted flex-none">{date}</span>
          <StarButton
            uuid={result.sessionUuid}
            isStarred={isStarred}
            onToggle={onToggleStar}
            testId="fragment-star"
          />
        </div>

        <p
          className="font-mono text-xs text-warm-text dark:text-dark-text leading-relaxed [&>strong]:font-semibold [&>strong]:text-accent dark:[&>strong]:text-accent-dark select-text cursor-text"
          onClick={(e) => e.stopPropagation()}
          dangerouslySetInnerHTML={{ __html: snippet }}
        />

        <p className="text-xs text-warm-faint dark:text-dark-muted mt-1 truncate">
          {result.sessionTitle}
        </p>
      </div>

      <ContinueActions result={result} onOpenSession={onOpenSession} onCopySessionId={onCopySessionId} />
    </div>
  )
}

function sortResults(results: FragmentRowResult[], sortOrder: SearchSortOrder): FragmentRowResult[] {
  if (sortOrder === 'relevance') return results

  const sorted = [...results]
  if (sortOrder === 'newest') {
    sorted.sort((a, b) => getResultTimestamp(b) - getResultTimestamp(a) || a.rank - b.rank)
    return sorted
  }

  sorted.sort((a, b) => getResultTimestamp(a) - getResultTimestamp(b) || a.rank - b.rank)
  return sorted
}

function getResultTimestamp(result: FragmentRowResult): number {
  const timestamp = Date.parse(result.startedAt)
  return Number.isNaN(timestamp) ? 0 : timestamp
}
