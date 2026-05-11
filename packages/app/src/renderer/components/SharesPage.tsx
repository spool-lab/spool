import { type ReactNode } from 'react'
import { Newspaper } from 'lucide-react'
import { useShareDrafts } from '../hooks/useShareDrafts'
import type { ShareDraftRow } from '@spool-lab/core'

/**
 * The Drafts / Published tab strip is intentionally not rendered yet:
 * Phase 0 only has Drafts, and showing a Published tab that maps to a
 * "Coming in a future update" placeholder reads as a broken promise.
 * The tab strip lands in Phase 2 alongside the actual publish flow.
 */
export default function SharesPage() {
  const { drafts, loading, error } = useShareDrafts()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <DraftsList drafts={drafts} loading={loading} error={error} />
      </div>
    </div>
  )
}

function DraftsList({
  drafts,
  loading,
  error,
}: {
  drafts: ShareDraftRow[]
  loading: boolean
  error: string | null
}) {
  if (loading && drafts.length === 0) {
    return <SmallEmptyState>Loading drafts…</SmallEmptyState>
  }
  if (error) {
    return <SmallEmptyState>Couldn't load drafts: {error}</SmallEmptyState>
  }
  if (drafts.length === 0) {
    return (
      <FeaturedEmptyState
        icon={<Newspaper size={22} strokeWidth={1.5} />}
        title="No shares yet"
        hint="Start a share from a session, a search result, or an AI answer — drafts you create land here, ready to keep editing."
      />
    )
  }
  return (
    <ul className="px-6 py-4 flex flex-col gap-2">
      {drafts.map((draft) => (
        <li
          key={draft.draft_id}
          className="px-3 py-2 rounded-md border border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface"
        >
          <div className="text-sm text-warm-text dark:text-dark-text">
            {draft.title || 'untitled'}
          </div>
          <div className="text-xs text-warm-muted dark:text-dark-muted">
            edited {formatRelative(draft.updated_at)}
            {draft.source_origin ? ` · from ${describeSource(draft)}` : ''}
          </div>
        </li>
      ))}
    </ul>
  )
}

function FeaturedEmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mb-5 bg-warm-surface dark:bg-dark-surface text-warm-muted dark:text-dark-muted"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="text-xl font-semibold tracking-[-0.01em] text-warm-text dark:text-dark-text mb-2">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-warm-muted dark:text-dark-muted max-w-[360px]">
        {hint}
      </p>
    </div>
  )
}

function SmallEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center px-6 py-16 text-sm text-warm-muted dark:text-dark-muted text-center">
      {children}
    </div>
  )
}

function describeSource(draft: ShareDraftRow): string {
  switch (draft.source_kind) {
    case 'spool-session':
      return `session ${draft.source_origin}`
    case 'pasted-url':
      return draft.source_origin ?? 'pasted link'
    case 'imported-file':
      return draft.source_origin ?? 'imported file'
    case 'imported-jsonl':
      return draft.source_origin ?? 'imported transcript'
    default:
      return draft.source_origin ?? 'unknown source'
  }
}

function formatRelative(iso: string): string {
  // SQLite datetime('now') yields 'YYYY-MM-DD HH:MM:SS' in UTC; parse
  // explicitly so we don't fall back to local-time interpretation.
  const parsed = Date.parse(iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(parsed)) return iso
  const now = Date.now()
  const diffSec = Math.max(0, Math.round((now - parsed) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(parsed).toLocaleDateString()
}
