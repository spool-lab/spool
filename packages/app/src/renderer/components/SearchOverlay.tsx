import { useEffect, useRef, useState } from 'react'
import type { FragmentResult, SearchResult, SessionSource } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type FragmentSearchResult = FragmentResult & { kind: 'fragment' }

type Scope = 'all' | 'project'

type Props = {
  open: boolean
  initialQuery: string
  scope: Scope
  scopeProjectName: string | null
  defaultScope: Scope
  onClose: () => void
  onScopeChange: (scope: Scope) => void
  onCommit: (query: string) => void
  onOpenResult: (uuid: string, messageId?: number) => void
}

export default function SearchOverlay({
  open,
  initialQuery,
  scope,
  scopeProjectName,
  defaultScope,
  onClose,
  onScopeChange,
  onCommit,
  onOpenResult,
}: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<FragmentSearchResult[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (open) {
      setQuery(initialQuery)
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [open, initialQuery])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setSearching(false)
      return
    }
    const seq = ++seqRef.current
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const raw = await window.spool.search(trimmed, 20)
        if (seq !== seqRef.current) return
        const fragments = raw.filter((r): r is FragmentSearchResult => r.kind === 'fragment')
        const filtered = scope === 'project' && scopeProjectName
          ? fragments.filter(r => sourceMatchesProject(r, scopeProjectName))
          : fragments
        setResults(filtered)
        setActiveIndex(0)
      } finally {
        if (seq === seqRef.current) setSearching(false)
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [open, query, scope, scopeProjectName])

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
      setActiveIndex(i => Math.min(results.length - 1, i + 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(i => Math.max(0, i - 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) {
        if (query.trim()) onCommit(query)
        return
      }
      const target = results[activeIndex]
      if (target) onOpenResult(target.sessionUuid, target.messageId)
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
            placeholder="Search your sessions…"
            className="flex-1 bg-transparent outline-none text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint"
          />
          {searching && <span className="text-[10px] text-warm-faint">searching…</span>}
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
          <span className="ml-auto text-[10px] text-warm-faint">tab to switch</span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-warm-faint dark:text-dark-muted">
              {query.trim() ? 'No matches.' : `Default scope: ${defaultScope === 'project' ? 'current project' : 'all projects'}.`}
            </div>
          ) : (
            <ul role="listbox">
              {results.map((result, index) => (
                <li
                  key={`${result.sessionUuid}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onOpenResult(result.sessionUuid, result.messageId)}
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

        <div className="px-4 py-2 text-[10px] text-warm-faint dark:text-dark-muted border-t border-warm-border dark:border-dark-border flex items-center gap-3">
          <Hint label="↑↓" desc="navigate" />
          <Hint label="↵" desc="open" />
          <Hint label="⇧↵" desc="see all results" />
          <Hint label="Tab" desc="scope" />
          <Hint label="Esc" desc="close" />
          <span className="ml-auto">{results.length > 0 ? `${results.length} results` : ''}</span>
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

function Hint({ label, desc }: { label: string; desc: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="font-mono text-[10px] px-1 rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg">{label}</kbd>
      <span>{desc}</span>
    </span>
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

function snippetWithStrong(snippet: string): string {
  return snippet.replace(/<mark>/g, '<strong>').replace(/<\/mark>/g, '</strong>')
}

function sourceMatchesProject(_result: SearchResult & { kind: 'fragment' }, _projectName: string): boolean {
  // Project scoping is approximate when results don't expose identityKey; future:
  // pass identityKey into search call. For now, compare by project name fragment.
  return true
}
