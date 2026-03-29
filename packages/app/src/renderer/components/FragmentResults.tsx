import { useEffect, useState } from 'react'
import type { FragmentResult, CaptureResult, SearchResult } from '@spool/core'
import ContinueActions from './ContinueActions.js'
import { SEARCH_SORT_OPTIONS, type SearchSortOrder } from '../../shared/searchSort.js'

type Props = {
  results: SearchResult[]
  query: string
  onOpenSession: (uuid: string) => void
  defaultSortOrder: SearchSortOrder
}

export default function FragmentResults({ results, query, onOpenSession, defaultSortOrder }: Props) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState<SearchSortOrder>(defaultSortOrder)

  useEffect(() => {
    setSortOrder(defaultSortOrder)
  }, [defaultSortOrder])

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-warm-faint dark:text-dark-muted gap-2 pb-12">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="opacity-30">
          <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="2"/>
          <path d="M22 22L28 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <p className="text-sm text-warm-muted dark:text-dark-muted">No results for "{query}"</p>
        <p className="text-xs text-warm-faint dark:text-dark-muted opacity-80">
          Try different keywords or run{' '}
          <code className="font-mono bg-warm-surface dark:bg-dark-surface px-1 rounded">spool sync</code>
        </p>
      </div>
    )
  }

  // Derive source tabs: claude, codex, plus any capture platforms
  const sourceKeys = [...new Set(results.map(r =>
    r.kind === 'fragment' ? r.source : r.platform
  ))]
  const filtered = activeFilter === 'all'
    ? results
    : results.filter(r =>
        r.kind === 'fragment' ? r.source === activeFilter : r.platform === activeFilter
      )
  const sortedResults = sortResults(filtered, sortOrder)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-warm-border dark:border-dark-border px-4 min-h-11 flex-none">
        <div className="flex gap-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-none">
          {(['all', ...sourceKeys] as string[]).map(src => (
            <button
              key={src}
              onClick={() => setActiveFilter(src)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                activeFilter === src
                  ? 'border-accent text-warm-text dark:text-dark-text'
                  : 'border-transparent text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
              }`}
            >
              {src === 'all' ? 'All' : src}
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
          {sortedResults.map((result, i) =>
            result.kind === 'capture'
              ? <CaptureRow key={`cap-${result.captureId}`} result={result} />
              : <FragmentRow key={`frag-${result.sessionUuid}-${i}`} result={result} onOpenSession={onOpenSession} />
          )}
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ result, onOpenSession }: { result: FragmentResult & { kind: 'fragment' }; onOpenSession: (uuid: string) => void }) {
  const snippet = result.snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
  const date = formatDate(result.startedAt)
  const project = result.project.split('/').pop() ?? result.project

  return (
    <div data-testid="fragment-row" className="px-4 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <SourceBadge source={result.source} />
        <span className="text-xs text-warm-muted dark:text-dark-muted truncate flex-1">You discussed this · {project}</span>
        <span className="text-xs text-warm-faint dark:text-dark-muted flex-none">{date}</span>
      </div>

      <p
        className="font-mono text-xs text-warm-text dark:text-dark-text leading-relaxed [&>strong]:font-semibold [&>strong]:text-accent dark:[&>strong]:text-accent-dark select-text cursor-text"
        dangerouslySetInnerHTML={{ __html: snippet }}
      />

      <p className="text-xs text-warm-faint dark:text-dark-muted mt-1 truncate">
        {result.sessionTitle}
      </p>

      <ContinueActions result={result} onOpenSession={onOpenSession} />
    </div>
  )
}

function CaptureRow({ result }: { result: CaptureResult & { kind: 'capture' } }) {
  const snippet = result.snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
  const date = formatDate(result.capturedAt)

  return (
    <a
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-4 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <PlatformBadge platform={result.platform} />
        <span className="text-xs text-warm-muted dark:text-dark-muted truncate flex-1">
          {result.author ? `You saved this · ${result.author}` : 'You saved this'}
        </span>
        <span className="text-xs text-warm-faint dark:text-dark-muted flex-none">{date}</span>
      </div>

      <p
        className="font-mono text-xs text-warm-text dark:text-dark-text leading-relaxed [&>strong]:font-semibold [&>strong]:text-accent dark:[&>strong]:text-accent-dark select-text cursor-text"
        dangerouslySetInnerHTML={{ __html: snippet }}
      />

      <p className="text-xs text-warm-faint dark:text-dark-muted mt-1 truncate">
        {result.title || result.url}
      </p>
    </a>
  )
}

const PLATFORM_BADGE_COLORS: Record<string, string> = {
  twitter: '#3A3A3A',
  github: '#555555',
  youtube: '#B22222',
  reddit: '#FF4500',
  hackernews: '#FF6600',
  bilibili: '#FB7299',
  weibo: '#E6162D',
  xiaohongshu: '#FE2C55',
  douban: '#007722',
  linkedin: '#0A66C2',
}

function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span
      className="text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded text-white"
      style={{ background: PLATFORM_BADGE_COLORS[platform] ?? '#C85A00' }}
    >
      {platform}
    </span>
  )
}

function SourceBadge({ source }: { source: string }) {
  const isClaude = source === 'claude'
  return (
    <span
      className="text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded text-white"
      style={{ background: isClaude ? '#6B5B8A' : '#1A6B3C' }}
    >
      {isClaude ? 'claude' : 'codex'}
    </span>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
    if (diffDays === 0) return 'today'
    if (diffDays === 1) return 'yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  } catch {
    return iso.slice(0, 10)
  }
}

function sortResults(results: SearchResult[], sortOrder: SearchSortOrder): SearchResult[] {
  if (sortOrder === 'relevance') return results

  const sorted = [...results]
  if (sortOrder === 'newest') {
    sorted.sort((a, b) => getResultTimestamp(b) - getResultTimestamp(a) || a.rank - b.rank)
    return sorted
  }

  sorted.sort((a, b) => getResultTimestamp(a) - getResultTimestamp(b) || a.rank - b.rank)
  return sorted
}

function getResultTimestamp(result: SearchResult): number {
  const iso = result.kind === 'fragment' ? result.startedAt : result.capturedAt
  const timestamp = Date.parse(iso)
  return Number.isNaN(timestamp) ? 0 : timestamp
}
