import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Search as SearchIcon, X as XIcon, ChevronDown } from 'lucide-react'
import type { Session, SearchResult, SessionSource, ProjectGroup } from '@spool-lab/core'
import { SourceBadge } from './Badges.js'
import Hint from './Hint.js'
import { formatRelativeDate } from '../../shared/formatDate.js'
import { snippetToStrongHtml } from '../lib/snippet.js'
import { useHotkeys } from '../hooks/useHotkeys.js'

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

function sessionToRow(s: Session, noTitle: string): Row {
  return {
    sessionUuid: s.sessionUuid,
    title: s.title?.trim() || noTitle,
    source: s.source,
    projectLabel: s.projectDisplayName ?? '',
    startedAt: s.startedAt,
    msgCount: s.messageCount,
  }
}

function searchResultToRow(r: SearchResult, noTitle: string): Row {
  // FragmentResult.project is a raw path; show its basename for parity
  // with SessionRow's display style on this list.
  const basename = r.project.split('/').filter(Boolean).pop() ?? r.project
  return {
    sessionUuid: r.sessionUuid,
    title: r.sessionTitle?.trim() || noTitle,
    source: r.source,
    projectLabel: basename,
    startedAt: r.startedAt,
    snippet: r.snippet,
  }
}

export default function NewDraftPicker({ onSelect, onClose }: Props) {
  const { t } = useTranslation()
  const noTitle = t('common.noTitle')
  const [recent, setRecent] = useState<Session[] | null>(null)
  const [results, setResults] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [projects, setProjects] = useState<ProjectGroup[] | null>(null)
  const [scopeProject, setScopeProject] = useState<ProjectGroup | null>(null)
  const [scopeOpen, setScopeOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const scopeTriggerRef = useRef<HTMLButtonElement>(null)

  // Fetch project list once for the scope popover.
  useEffect(() => {
    let cancelled = false
    window.spool.listProjectGroups()
      .then((rows) => { if (!cancelled) setProjects(rows) })
      .catch(() => { if (!cancelled) setProjects([]) })
    return () => { cancelled = true }
  }, [])

  // Fetch recent on mount and whenever scope changes.
  useEffect(() => {
    let cancelled = false
    const req = scopeProject
      ? window.spool.listSessionsByIdentity(scopeProject.identityKey, { limit: RECENT_LIMIT })
      : window.spool.listSessions({ limit: RECENT_LIMIT })
    req
      .then((page) => { if (!cancelled) setRecent(page.sessions) })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('common.error'))
        setRecent([])
      })
    return () => { cancelled = true }
  }, [scopeProject?.identityKey])

  // Debounced FTS search; falls back to "no results" until backend
  // responds. Empty query clears results and re-shows recent. Project
  // scope uses the full `search` API (identityKey filter) and dedupes
  // fragments to one row per session.
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
      const req = scopeProject
        ? window.spool.search(q, SEARCH_LIMIT, undefined, false, scopeProject.identityKey)
        : window.spool.searchPreview(q, SEARCH_LIMIT)
      req
        .then((rows) => {
          if (cancelled) return
          const seen = new Set<string>()
          const unique: Row[] = []
          for (const r of rows) {
            if (seen.has(r.sessionUuid)) continue
            seen.add(r.sessionUuid)
            unique.push(searchResultToRow(r, noTitle))
          }
          setResults(unique)
          setIsSearching(false)
        })
        .catch(() => {
          if (cancelled) return
          setResults([])
          setIsSearching(false)
        })
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [query, scopeProject?.identityKey])

  // Modal layer. The scope popover stacks its own modal layer on top when
  // open, so Escape there closes the popover first (top-of-stack wins).
  useHotkeys({ Escape: onClose }, { modal: true })

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const inSearchMode = query.trim().length > 0
  const rows: Row[] | null = inSearchMode
    ? results
    : recent?.map(s => sessionToRow(s, noTitle)) ?? null

  const queryTokens = inSearchMode
    ? query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    : []

  // Reset active index whenever the result set changes shape.
  useEffect(() => { setActiveIndex(0) }, [rows?.length, inSearchMode, scopeProject?.identityKey])

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
          {t('newDraft.title')}
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
            placeholder={t('newDraft.searchPlaceholder')}
            className="flex-1 bg-transparent outline-none text-sm text-warm-text dark:text-dark-text placeholder:text-warm-faint dark:placeholder:text-dark-muted"
          />
          {isSearching && (
            <span className="flex-none text-[10px] text-warm-faint dark:text-dark-muted">{t('newDraft.searchingShort')}</span>
          )}
        </div>

        <div className="flex-none px-5 pb-2 flex items-center gap-0.5 relative">
          <button
            ref={scopeTriggerRef}
            type="button"
            data-testid="new-draft-picker-scope-trigger"
            aria-haspopup="listbox"
            aria-expanded={scopeOpen}
            onClick={() => setScopeOpen(v => !v)}
            className={`text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors ${
              scopeProject
                ? 'text-accent dark:text-accent-dark bg-accent/10 dark:bg-accent-dark/10 hover:bg-accent/15 dark:hover:bg-accent-dark/15'
                : 'text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
            }`}
          >
            <span className="max-w-[220px] truncate">
              {scopeProject ? scopeProject.displayName : t('newDraft.scopeAll')}
            </span>
            <ChevronDown size={10} strokeWidth={2} aria-hidden className="opacity-60" />
          </button>
          {scopeProject && (
            <button
              type="button"
              data-testid="new-draft-picker-scope-clear"
              onClick={() => setScopeProject(null)}
              aria-label={t('newDraft.scopeClear')}
              className="p-0.5 rounded text-warm-faint dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2"
            >
              <XIcon size={11} strokeWidth={2} aria-hidden />
            </button>
          )}
          {scopeOpen && (
            <ScopePopover
              anchorRef={scopeTriggerRef}
              projects={projects ?? []}
              selectedKey={scopeProject?.identityKey ?? null}
              onSelect={(p) => {
                setScopeProject(p)
                setScopeOpen(false)
              }}
              onClose={() => setScopeOpen(false)}
            />
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {rows === null ? (
            <PickerSkeleton count={6} />
          ) : error && !inSearchMode ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              {t('newDraft.loadError', { error })}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-warm-muted dark:text-dark-muted">
              {inSearchMode
                ? isSearching ? t('newDraft.searching') : t('newDraft.empty', { query: query.trim() })
                : scopeProject
                  ? t('newDraft.emptyInProject', { project: scopeProject.displayName })
                  : t('newDraft.emptyNoSessions')}
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
                    showProject={!scopeProject}
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
                <Hint keys={['↑', '↓']} label={t('newDraft.navigate')} />
                <Hint keys={['↵']} label={t('newDraft.open')} />
              </>
            )}
            <Hint keys={['esc']} label={t('newDraft.close')} />
          </div>
          <div className="flex-none">
            {rows && rows.length > 0 && (
              <span>
                {inSearchMode
                  ? t('newDraft.results_other', { count: rows.length })
                  : t('newDraft.recentSessions_other', { count: rows.length })}
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
  showProject,
  onSelect,
}: {
  row: Row
  queryTokens: string[]
  active: boolean
  showProject: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const date = formatRelativeDate(row.startedAt, { t: t as unknown as (k: string, o?: Record<string, unknown>) => string })
  const inSearchMode = queryTokens.length > 0
  const snippetHtml = inSearchMode && row.snippet
    ? snippetToStrongHtml(row.snippet)
    : null
  const activeBg = active ? 'bg-warm-surface2 dark:bg-dark-surface2' : ''
  const projectVisible = showProject && row.projectLabel

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

function ScopePopover({
  anchorRef,
  projects,
  selectedKey,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  projects: ProjectGroup[]
  selectedKey: string | null
  onSelect: (p: ProjectGroup | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const trig = anchorRef.current
    if (!trig) return
    const measure = () => {
      const r = trig.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorRef])

  useEffect(() => { inputRef.current?.focus() }, [])

  useHotkeys({ Escape: onClose }, { active: true, modal: true })

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    // Capture phase so we run before the modal's inner-card `stopPropagation`
    // on mousedown, which would otherwise hide outside clicks from window.
    window.addEventListener('mousedown', handleMouseDown, true)
    return () => window.removeEventListener('mousedown', handleMouseDown, true)
  }, [onClose, anchorRef])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? projects.filter(p => p.displayName.toLowerCase().includes(q))
      : projects
    return [...list].sort((a, b) => (b.lastSessionAt ?? '').localeCompare(a.lastSessionAt ?? ''))
  }, [projects, query])

  if (!pos) return null

  return createPortal(
    <div
      ref={rootRef}
      data-testid="new-draft-picker-scope-popover"
      role="dialog"
      onMouseDown={(e) => e.stopPropagation()}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[60] w-[280px] rounded-md border border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg shadow-lg overflow-hidden"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('newDraft.scopeSearchPlaceholder')}
        className="w-full px-3 py-2 text-[12px] bg-transparent outline-none text-warm-text dark:text-dark-text placeholder:text-warm-faint border-b border-warm-border/50 dark:border-dark-border/50"
      />
      <div className="max-h-[240px] overflow-y-auto py-1">
        <button
          type="button"
          data-testid="new-draft-picker-scope-option"
          data-identity-key=""
          onClick={() => onSelect(null)}
          className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-warm-surface2 dark:hover:bg-dark-surface2 ${
            selectedKey === null
              ? 'text-warm-text dark:text-dark-text font-medium'
              : 'text-warm-muted dark:text-dark-muted'
          }`}
        >
          {t('newDraft.scopeAll')}
        </button>
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-warm-faint dark:text-dark-muted">
            {query.trim() ? t('newDraft.scopeNoMatch') : t('newDraft.scopeNoProjects')}
          </p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.identityKey}
              type="button"
              data-testid="new-draft-picker-scope-option"
              data-identity-key={p.identityKey}
              onClick={() => onSelect(p)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[12px] hover:bg-warm-surface2 dark:hover:bg-dark-surface2 ${
                p.identityKey === selectedKey
                  ? 'text-warm-text dark:text-dark-text font-medium'
                  : 'text-warm-muted dark:text-dark-muted'
              }`}
            >
              <span className="truncate">{p.displayName}</span>
              <span className="flex-none font-mono text-[10px] text-warm-faint dark:text-dark-muted tabular-nums">
                {p.sessionCount}
              </span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
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
