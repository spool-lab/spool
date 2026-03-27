import { useState } from 'react'
import type { FragmentResult } from '@spool/core'
import ContinueActions from './ContinueActions.js'

interface Props {
  results: FragmentResult[]
  query: string
  onOpenSession: (uuid: string) => void
}

export default function FragmentResults({ results, query, onOpenSession }: Props) {
  const [activeFilter, setActiveFilter] = useState('all')

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

  const sources = [...new Set(results.map(r => r.source))]
  const filtered = activeFilter === 'all' ? results : results.filter(r => r.source === activeFilter)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* AMD-8: filter tabs */}
      <div className="flex gap-0 border-b border-warm-border dark:border-dark-border px-4 flex-none">
        {(['all', ...sources] as string[]).map(src => (
          <button
            key={src}
            onClick={() => setActiveFilter(src)}
            className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              activeFilter === src
                ? 'border-accent text-warm-text dark:text-dark-text'
                : 'border-transparent text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
            }`}
          >
            {src === 'all' ? 'All' : src}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-warm-border dark:divide-dark-border">
          {filtered.map((result, i) => (
            <FragmentRow key={`${result.sessionUuid}-${i}`} result={result} onOpenSession={onOpenSession} />
          ))}
        </div>
      </div>
    </div>
  )
}

function FragmentRow({ result, onOpenSession }: { result: FragmentResult; onOpenSession: (uuid: string) => void }) {
  const snippet = result.snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
  const date = formatDate(result.startedAt)
  const project = result.project.split('/').pop() ?? result.project

  return (
    <div data-testid="fragment-row" className="px-4 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors">
      {/* Source + project + date */}
      <div className="flex items-center gap-2 mb-1.5">
        <SourceBadge source={result.source} />
        <span className="text-xs text-warm-muted dark:text-dark-muted truncate flex-1">You discussed this · {project}</span>
        <span className="text-xs text-warm-faint dark:text-dark-muted flex-none">{date}</span>
      </div>

      {/* Fragment snippet — monospace per DESIGN.md */}
      <p
        className="font-mono text-xs text-warm-text dark:text-dark-text leading-relaxed [&>strong]:font-semibold [&>strong]:text-accent dark:[&>strong]:text-accent-dark select-text cursor-text"
        dangerouslySetInnerHTML={{ __html: snippet }}
      />

      {/* Session title (subtle) */}
      <p className="text-xs text-warm-faint dark:text-dark-muted mt-1 truncate">
        {result.sessionTitle}
      </p>

      {/* Continue actions */}
      <ContinueActions result={result} onOpenSession={onOpenSession} />
    </div>
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
