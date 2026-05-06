import { useEffect, useMemo, useState } from 'react'
import type { ProjectGroup, DirectoryGroup, SessionSource, StatusInfo } from '@spool-lab/core'
import { getSessionSourceColor, getSessionSourceLabel } from '../../shared/sessionSources.js'
import {
  DEFAULT_SIDEBAR_SORT_ORDER,
  SIDEBAR_SORT_OPTIONS,
  type SidebarSortOrder,
} from '../../shared/sidebarSort.js'
import { SearchTrigger } from './LibraryLanding.js'
import Menu from './Menu.js'
import { buildDirTree, type DirNode } from '../dirTree.js'

type Props = {
  activeIdentityKey: string | null
  activeDirectorySlug: string | null
  onSelectProject: (identityKey: string) => void
  onSelectDirectory: (slug: string, displayPath: string) => void
  onSelectHome?: () => void
  onOpenSearch?: () => void
  syncStatus?: { phase: string; count: number; total: number } | null
  status?: StatusInfo | null
  onSettingsClick?: () => void
  showSourceDots?: boolean
  showSessionCount?: boolean
  sortOrder?: SidebarSortOrder
  onSortOrderChange?: (next: SidebarSortOrder) => void
}

export default function Sidebar({ activeIdentityKey, activeDirectorySlug, onSelectProject, onSelectDirectory, onSelectHome, onOpenSearch, syncStatus, status, onSettingsClick, showSourceDots = true, showSessionCount = true, sortOrder = DEFAULT_SIDEBAR_SORT_ORDER, onSortOrderChange }: Props) {
  const [groups, setGroups] = useState<ProjectGroup[] | null>(null)
  const [dirGroups, setDirGroups] = useState<DirectoryGroup[] | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [sidebarTab, setSidebarTab] = useState<'projects' | 'directories'>('projects')

  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then(result => { if (!cancelled) setGroups(result) })
      .catch(() => { if (!cancelled) setGroups([]) })
    return () => { cancelled = true }
  }, [status?.totalSessions])

  useEffect(() => {
    if (sidebarTab !== 'directories') return
    let cancelled = false
    window.spool.listDirectoryGroups()
      .then(result => { if (!cancelled) setDirGroups(result) })
      .catch(() => { if (!cancelled) setDirGroups([]) })
    return () => { cancelled = true }
  }, [sidebarTab, status?.totalSessions])

  const visibleGroups = (groups ?? []).filter(g => g.sessionCount > 0)
  const projectGroups = useMemo(
    () => sortProjectGroups(visibleGroups.filter(g => g.identityKind !== 'loose'), sortOrder),
    [visibleGroups, sortOrder],
  )
  const looseGroup = visibleGroups.find(g => g.identityKind === 'loose')

  return (
    <aside
      data-testid="sidebar"
      className="w-60 flex-none border-r border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface flex flex-col h-full overflow-hidden"
    >
      <div className="px-4 pt-3 pb-3 flex-none">
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

      {onOpenSearch && (
        <div className="px-3 pb-3 flex-none">
          <SearchTrigger onClick={onOpenSearch} fullWidth />
        </div>
      )}

      <div className="mx-2 px-2 py-1 flex-none flex items-center gap-1">
        <div className="flex-1 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setSidebarTab('projects')}
            className={`text-[10px] font-semibold tracking-[0.08em] px-1.5 py-0.5 rounded transition-colors select-none ${
              sidebarTab === 'projects'
                ? 'text-warm-text dark:text-dark-text'
                : 'text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
            }`}
          >
            PROJECTS
          </button>
          <button
            type="button"
            onClick={() => setSidebarTab('directories')}
            className={`text-[10px] font-semibold tracking-[0.08em] px-1.5 py-0.5 rounded transition-colors select-none ${
              sidebarTab === 'directories'
                ? 'text-warm-text dark:text-dark-text'
                : 'text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text'
            }`}
          >
            DIRS
          </button>
        </div>
        {sidebarTab === 'projects' && onSortOrderChange && (
          <Menu
            align="right"
            testId="sidebar-sort-menu"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                data-testid="sidebar-sort-trigger"
                onClick={toggle}
                title="Sort projects"
                aria-label="Sort projects"
                aria-haspopup="menu"
                aria-expanded={open}
                className={`flex-none inline-flex items-center justify-end h-4 transition-opacity text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text ${
                  open ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M0.75 2.5h9.5M2 5.5h7M4 8.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            )}
            items={SIDEBAR_SORT_OPTIONS.map(option => ({
              label: option.label,
              active: sortOrder === option.value,
              onSelect: () => onSortOrderChange(option.value),
            }))}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 scrollbar-none [mask-image:linear-gradient(to_bottom,black_calc(100%_-_20px),transparent)]">
        {sidebarTab === 'projects' ? (
          groups === null ? (
            <SidebarSkeleton />
          ) : projectGroups.length === 0 && !looseGroup ? (
            <p className="px-2 py-3 text-xs text-warm-faint dark:text-dark-muted">No sessions yet</p>
          ) : (
            <>
              {projectGroups.map(group => (
                <ProjectRow
                  key={group.identityKey}
                  group={group}
                  active={group.identityKey === activeIdentityKey}
                  showSourceDots={showSourceDots}
                  showSessionCount={showSessionCount}
                  onClick={() => onSelectProject(group.identityKey)}
                />
              ))}
              {looseGroup && (
                <>
                  <div className="my-2 mx-2 border-t border-warm-border dark:border-dark-border" />
                  <ProjectRow
                    group={looseGroup}
                    active={looseGroup.identityKey === activeIdentityKey}
                    showSourceDots={showSourceDots}
                    showSessionCount={showSessionCount}
                    onClick={() => onSelectProject(looseGroup.identityKey)}
                  />
                </>
              )}
            </>
          )
        ) : (
          dirGroups === null ? (
            <SidebarSkeleton />
          ) : dirGroups.length === 0 ? (
            <p className="px-2 py-3 text-xs text-warm-faint dark:text-dark-muted">No directories</p>
          ) : (
            <DirTree
              nodes={buildDirTree(dirGroups)}
              activeSlug={activeDirectorySlug}
              showSessionCount={showSessionCount}
              onSelect={onSelectDirectory}
            />
          )
        )}
      </div>

      <SidebarStatus
        syncStatus={syncStatus ?? null}
        status={status ?? null}
        {...(onSettingsClick ? { onSettingsClick } : {})}
      />
    </aside>
  )
}

function SidebarStatus({
  syncStatus,
  status,
  onSettingsClick,
}: {
  syncStatus: { phase: string; count: number; total: number } | null
  status: StatusInfo | null
  onSettingsClick?: () => void
}) {
  const text = getSyncStatusText(syncStatus, status)
  const isOk = !syncStatus || syncStatus.phase === 'done'

  return (
    <div className="flex-none pl-2 pr-1.5 pt-1 pb-2 flex items-center gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${isOk ? 'bg-green-500' : 'bg-amber-400 animate-pulse'}`} />
        <span data-testid="status-text" className="text-[11px] font-mono text-warm-faint dark:text-dark-muted truncate" title={text}>
          {text}
        </span>
      </div>
      {onSettingsClick && (
        <button
          type="button"
          onClick={onSettingsClick}
          title="Settings"
          aria-label="Settings"
          className="flex-none inline-flex items-center justify-center w-6 h-6 rounded text-warm-faint dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </button>
      )}
    </div>
  )
}

function getSyncStatusText(
  syncStatus: { phase: string; count: number; total: number } | null,
  status: StatusInfo | null,
): string {
  if (syncStatus) {
    if (syncStatus.phase === 'scanning') return 'Scanning…'
    if (syncStatus.phase === 'syncing') return `Indexing ${syncStatus.count}/${syncStatus.total} files`
    if (syncStatus.phase === 'indexing') return 'Building index…'
    if (syncStatus.phase === 'done' && status) {
      return `${status.totalSessions} sessions · now`
    }
  }
  if (!status) return 'Loading…'
  const lastSync = status.lastSyncedAt ? formatShortTimeAgo(status.lastSyncedAt) : 'never'
  return `${status.totalSessions} sessions · ${lastSync}`
}

function formatShortTimeAgo(iso: string): string {
  try {
    const utcIso = iso.endsWith('Z') ? iso : iso + 'Z'
    const diff = Date.now() - new Date(utcIso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
  } catch {
    return iso
  }
}

function ProjectRow({
  group,
  active,
  showSourceDots,
  showSessionCount,
  onClick,
}: {
  group: ProjectGroup
  active: boolean
  showSourceDots: boolean
  showSessionCount: boolean
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
      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-md transition-colors ${
        active
          ? 'bg-warm-surface2 dark:bg-dark-surface2 text-warm-text dark:text-dark-text'
          : 'text-warm-text/85 dark:text-dark-text/85 hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      <FolderIcon active={active} />
      <span className="flex-1 truncate text-[12.5px]">
        {group.displayName}
      </span>
      {showSourceDots && <SourceDots sources={group.sources} />}
      {showSessionCount && (
        <span className="flex-none font-mono text-[10.5px] tabular-nums text-warm-faint/70 dark:text-dark-muted/70">
          {group.sessionCount}
        </span>
      )}
    </button>
  )
}

function DirTree({ nodes, activeSlug, showSessionCount, onSelect, depth = 0 }: {
  nodes: DirNode[]
  activeSlug: string | null
  showSessionCount: boolean
  onSelect: (slug: string, displayPath: string) => void
  depth?: number
}) {
  return (
    <>
      {nodes.map(node => (
        <DirTreeNode
          key={node.fullPath}
          node={node}
          activeSlug={activeSlug}
          showSessionCount={showSessionCount}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </>
  )
}

function DirTreeNode({ node, activeSlug, showSessionCount, onSelect, depth }: {
  node: DirNode
  activeSlug: string | null
  showSessionCount: boolean
  onSelect: (slug: string, displayPath: string) => void
  depth: number
}) {
  const hasChildren = node.children.length > 0
  const hasSelf = node.dir !== null
  const isActive = hasSelf && node.dir!.slug === activeSlug
  const [open, setOpen] = useState(true)
  const indent = depth * 10

  return (
    <>
      <div
        className={`flex items-center rounded-md transition-colors ${
          isActive ? 'bg-warm-surface2 dark:bg-dark-surface2' : 'hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
        }`}
        style={{ paddingLeft: `${8 + indent}px` }}
      >
        {/* 展开/折叠箭头，无子节点时占位保持对齐 */}
        <button
          type="button"
          onClick={() => hasChildren && setOpen(o => !o)}
          className="flex-none w-4 h-full flex items-center justify-center"
          tabIndex={hasChildren ? 0 : -1}
          aria-hidden={!hasChildren}
        >
          {hasChildren && (
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden className={`transition-transform text-warm-faint/70 dark:text-dark-muted/70 ${open ? 'rotate-90' : ''}`}>
              <path d="M3 1.5L6 4.5L3 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* 节点名称，有自身会话时可点击 */}
        <button
          type="button"
          onClick={hasSelf ? () => onSelect(node.dir!.slug, node.dir!.displayPath) : undefined}
          disabled={!hasSelf}
          title={node.dir?.displayPath ?? node.fullPath}
          className={`flex-1 min-w-0 flex items-center gap-1.5 py-1 pr-2 text-left ${
            hasSelf
              ? isActive
                ? 'text-warm-text dark:text-dark-text cursor-pointer'
                : 'text-warm-text/85 dark:text-dark-text/85 cursor-pointer'
              : 'text-warm-text/60 dark:text-dark-text/60 cursor-default'
          }`}
        >
          <FolderIcon active={isActive} />
          <span className="flex-1 truncate text-[12.5px] font-mono">{node.name}</span>
          <SourceDots sources={node.sources} />
          {showSessionCount && (
            <span className="flex-none flex items-center gap-1">
              {/* 自身会话数（正常颜色），仅当自身有会话时显示 */}
              {hasSelf && (
                <span className="font-mono text-[10.5px] tabular-nums text-warm-faint/70 dark:text-dark-muted/70">
                  {node.dir!.sessionCount}
                </span>
              )}
              {/* 子树总数（低透明度），仅当有子目录时显示 */}
              {hasChildren && (
                <span className="font-mono text-[10.5px] tabular-nums text-warm-faint/40 dark:text-dark-muted/40">
                  {node.totalSessions}
                </span>
              )}
            </span>
          )}
        </button>
      </div>

      {open && hasChildren && (
        <DirTree
          nodes={node.children}
          activeSlug={activeSlug}
          showSessionCount={showSessionCount}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </>
  )
}

function FolderIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={`flex-none ${active ? 'text-warm-faint dark:text-dark-muted' : 'text-warm-faint/70 dark:text-dark-muted/70'}`}
    >
      <path
        d="M1.5 4.2c0-.55.45-1 1-1h3l1.2 1.3h4.8c.55 0 1 .45 1 1v5.3c0 .55-.45 1-1 1H2.5c-.55 0-1-.45-1-1V4.2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
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

function sortProjectGroups(groups: ProjectGroup[], order: SidebarSortOrder): ProjectGroup[] {
  const sorted = [...groups]
  switch (order) {
    case 'name':
      sorted.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
      return sorted
    case 'most_sessions':
      sorted.sort((a, b) => {
        if (b.sessionCount !== a.sessionCount) return b.sessionCount - a.sessionCount
        return compareLastSessionAtDesc(a, b)
      })
      return sorted
    case 'recent':
    default:
      sorted.sort(compareLastSessionAtDesc)
      return sorted
  }
}

function compareLastSessionAtDesc(a: ProjectGroup, b: ProjectGroup): number {
  if (!a.lastSessionAt && !b.lastSessionAt) return 0
  if (!a.lastSessionAt) return 1
  if (!b.lastSessionAt) return -1
  return b.lastSessionAt.localeCompare(a.lastSessionAt)
}
