import { useEffect, useState } from 'react'
import type { ProjectGroup } from '@spool-lab/core'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type Props = {
  onSelectProject: (identityKey: string) => void
  onOpenSearch: () => void
}

export default function LibraryLanding({ onSelectProject, onOpenSearch }: Props) {
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(result => { if (!cancelled) setGroups(result) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [])

  const projectGroups = (groups ?? []).filter(g => g.identityKind !== 'loose')

  return (
    <div data-testid="library-landing" className="flex flex-col h-full">
      <div className="flex items-start justify-between gap-4 px-8 pt-10 pb-6 flex-none">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-warm-text dark:text-dark-text">
            AI Session Library
          </h1>
          <p className="mt-1 text-sm text-warm-muted dark:text-dark-muted">
            All your AI conversations, organized by your code projects.
          </p>
        </div>
        <SearchTrigger onClick={onOpenSearch} />
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-10">
        {groups === null ? (
          <p className="text-sm text-warm-faint dark:text-dark-muted">Loading…</p>
        ) : projectGroups.length === 0 ? (
          <p className="text-sm text-warm-faint dark:text-dark-muted">
            No sessions yet. Run <code className="font-mono bg-warm-surface dark:bg-dark-surface px-1 rounded">spool sync</code> to index your AI sessions.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projectGroups.map(group => (
              <button
                key={group.identityKey}
                type="button"
                data-testid="library-project-card"
                data-identity-key={group.identityKey}
                onClick={() => onSelectProject(group.identityKey)}
                className="text-left rounded-lg border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface p-4 hover:border-accent/50 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <h2 className="text-sm font-semibold tracking-tight text-warm-text dark:text-dark-text truncate flex-1">
                    {group.displayName}
                  </h2>
                  <span aria-hidden className="flex-none flex items-center gap-1">
                    {group.sources.map(src => (
                      <span
                        key={src}
                        title={getSessionSourceLabel(src)}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: getSessionSourceColor(src) }}
                      />
                    ))}
                  </span>
                </div>
                <p className="text-xs text-warm-muted dark:text-dark-muted">
                  {group.sessionCount} {group.sessionCount === 1 ? 'session' : 'sessions'}
                  {group.lastSessionAt && ` · ${formatRelativeDate(group.lastSessionAt)}`}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function SearchTrigger({ onClick, label = 'Search…' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      data-testid="search-trigger"
      onClick={onClick}
      className="flex items-center gap-2 h-9 rounded-full border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface px-3 text-xs text-warm-muted dark:text-dark-muted hover:border-accent/50 hover:text-warm-text dark:hover:text-dark-text transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-none">
        <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="flex-1 text-left">{label}</span>
      <kbd className="font-mono text-[10px] px-1 rounded border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg">⌘K</kbd>
    </button>
  )
}
