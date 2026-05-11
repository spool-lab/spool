import { useState } from 'react'
import { useShareDrafts } from '../hooks/useShareDrafts'
import type { ShareDraftRow } from '@spool-lab/core'

type Tab = 'drafts' | 'published'

export default function SharesPage() {
  const [tab, setTab] = useState<Tab>('drafts')
  const { drafts, loading, error } = useShareDrafts()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="flex-none px-6 pt-6 pb-3">
        <h1 className="text-lg font-semibold tracking-[-0.02em] text-warm-text dark:text-dark-text">
          Shares
        </h1>
      </header>

      <div className="flex-none px-6 border-b border-warm-border dark:border-dark-border">
        <div className="flex gap-1" role="tablist">
          <TabButton
            label="Drafts"
            count={drafts.length}
            active={tab === 'drafts'}
            onClick={() => setTab('drafts')}
          />
          <TabButton
            label="Published"
            active={tab === 'published'}
            onClick={() => setTab('published')}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'drafts' ? (
          <DraftsTab drafts={drafts} loading={loading} error={error} />
        ) : (
          <PublishedTab />
        )}
      </div>
    </div>
  )
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors',
        active
          ? 'border-accent text-warm-text dark:text-dark-text'
          : 'border-transparent text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text',
      ].join(' ')}
    >
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs text-warm-faint dark:text-dark-muted">({count})</span>
      )}
    </button>
  )
}

function DraftsTab({
  drafts,
  loading,
  error,
}: {
  drafts: ShareDraftRow[]
  loading: boolean
  error: string | null
}) {
  if (loading && drafts.length === 0) {
    return <EmptyState label="Loading drafts…" />
  }
  if (error) {
    return <EmptyState label={`Couldn't load drafts: ${error}`} />
  }
  if (drafts.length === 0) {
    return (
      <EmptyState
        label="No drafts yet"
        hint="Create a share from a session, search result, or AI answer to start a draft."
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

function PublishedTab() {
  return (
    <EmptyState
      label="Coming in a future update"
      hint="Once Spool Share supports hosted permalinks, your published shares will appear here."
    />
  )
}

function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-warm-muted dark:text-dark-muted">
      <p className="text-sm">{label}</p>
      {hint && <p className="text-xs mt-1.5 max-w-md">{hint}</p>}
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
