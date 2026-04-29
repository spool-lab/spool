import { useEffect, useState } from 'react'
import type { ProjectGroup, SessionSource } from '@spool-lab/core'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'

type Props = {
  activeIdentityKey: string | null
  onSelectProject: (identityKey: string) => void
  onSelectHome?: () => void
}

export default function Sidebar({ activeIdentityKey, onSelectProject, onSelectHome }: Props) {
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null)

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(result => { if (!cancelled) setGroups(result) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [])

  const projectGroups = (groups ?? []).filter(g => g.identityKind !== 'loose')
  const looseGroup = (groups ?? []).find(g => g.identityKind === 'loose')

  return (
    <aside
      data-testid="sidebar"
      className="w-60 flex-none border-r border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface flex flex-col h-full overflow-hidden"
    >
      <div className="px-4 pt-5 pb-4 flex-none">
        <button
          type="button"
          data-testid="sidebar-home"
          onClick={() => onSelectHome?.()}
          className="text-xl font-bold tracking-[-0.04em] select-none cursor-pointer hover:opacity-80 transition-opacity"
          aria-label="Spool home"
        >
          Spool<span className="text-accent">.</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 mt-1 mb-1.5 text-[10px] font-semibold tracking-[0.08em] text-warm-faint dark:text-dark-muted select-none">
          PROJECTS
        </div>

        {groups === null ? (
          <SidebarSkeleton />
        ) : projectGroups.length === 0 && !looseGroup ? (
          <p className="px-2 py-3 text-xs text-warm-faint dark:text-dark-muted">
            No sessions yet
          </p>
        ) : (
          <>
            {projectGroups.map(group => (
              <ProjectRow
                key={group.identityKey}
                group={group}
                active={group.identityKey === activeIdentityKey}
                onClick={() => onSelectProject(group.identityKey)}
              />
            ))}

            {looseGroup && (
              <>
                <div className="my-2 mx-2 border-t border-warm-border dark:border-dark-border" />
                <ProjectRow
                  group={looseGroup}
                  active={looseGroup.identityKey === activeIdentityKey}
                  onClick={() => onSelectProject(looseGroup.identityKey)}
                />
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function ProjectRow({
  group,
  active,
  onClick,
}: {
  group: ProjectGroup
  active: boolean
  onClick: () => void
}) {
  const sourceList = group.sources.map(getSessionSourceLabel).join(', ')
  const ariaLabel = sourceList
    ? `${group.displayName}, ${sourceList}, ${group.sessionCount} sessions`
    : `${group.displayName}, ${group.sessionCount} sessions`
  return (
    <button
      data-testid="sidebar-project-row"
      data-identity-key={group.identityKey}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <span className="flex-1 truncate text-[13px] font-medium">
        {group.displayName}
      </span>
      <SourceDots sources={group.sources} />
      <span className="flex-none font-mono text-[11px] tabular-nums text-warm-faint dark:text-dark-muted">
        {group.sessionCount}
      </span>
    </button>
  )
}

function SourceDots({ sources }: { sources: SessionSource[] }) {
  if (sources.length === 0) return null
  const tooltip = sources.map(getSessionSourceLabel).join(' · ')
  return (
    <span aria-hidden="true" title={tooltip} className="flex-none flex items-center gap-1">
      {sources.map(source => (
        <span
          key={source}
          className="block w-1.5 h-1.5 rounded-full"
          style={{ background: getSessionSourceColor(source) }}
        />
      ))}
    </span>
  )
}

function SidebarSkeleton() {
  return (
    <div className="px-2 py-1 space-y-1.5" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="h-6 rounded-md bg-warm-surface2 dark:bg-dark-surface2 opacity-60 animate-pulse"
        />
      ))}
    </div>
  )
}
