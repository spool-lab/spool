import { Star } from 'lucide-react'
import type { FragmentResult, Session, StarKind, StarredItem } from '@spool-lab/core'
import FragmentResults from './FragmentResults.js'
import StarButton from './StarButton.js'
import { SourceBadge } from './Badges.js'
import { DEFAULT_SEARCH_SORT_ORDER, type SearchSortOrder } from '../../shared/searchSort.js'
import { formatRelativeDate } from '../../shared/formatDate.js'

type SessionStarredItem = StarredItem & { kind: 'session' }
type FragmentRowResult = FragmentResult & { kind: 'fragment' }

type Props = {
  items: SessionStarredItem[]
  filterQuery: string
  scopedResults: FragmentRowResult[]
  isScopedSearching: boolean
  starredSessions: Set<string>
  defaultSortOrder: SearchSortOrder
  onOpenSession: (uuid: string, messageId?: number) => void
  onToggleStar: (kind: StarKind, uuid: string, next: boolean) => void
  onCopySessionId: (source: FragmentResult['source']) => void
}

export default function StarredItems({
  items,
  filterQuery,
  scopedResults,
  isScopedSearching,
  starredSessions,
  defaultSortOrder = DEFAULT_SEARCH_SORT_ORDER,
  onOpenSession,
  onToggleStar,
  onCopySessionId,
}: Props) {
  const needle = filterQuery.trim()

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-warm-faint dark:text-dark-muted gap-2 pb-12">
        <Star size={28} strokeWidth={1.4} className="opacity-40" />
        <p className="text-sm text-warm-muted dark:text-dark-muted">You haven&apos;t starred anything yet.</p>
        <p className="text-xs opacity-80">Star sessions to save them here.</p>
      </div>
    )
  }

  // Non-empty query → scoped FTS across starred items.
  if (needle) {
    if (isScopedSearching && scopedResults.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-warm-faint dark:text-dark-muted gap-2 pb-12">
          <span className="w-1.5 h-1.5 rounded-full bg-accent dark:bg-accent-dark animate-pulse" />
          <p className="text-sm text-warm-muted dark:text-dark-muted">Searching your starred items…</p>
        </div>
      )
    }
    if (scopedResults.length === 0) {
      return (
        <div className="flex flex-col h-full">
          <StarredHeader total={items.length} matched={0} filterQuery={needle} />
          <div className="flex flex-col items-center justify-center flex-1 text-warm-faint dark:text-dark-muted gap-2 pb-12">
            <p className="text-sm text-warm-muted dark:text-dark-muted">No starred item matches &ldquo;{needle}&rdquo;.</p>
            <p className="text-[11px] opacity-80">Press <kbd className="font-mono bg-warm-surface dark:bg-dark-surface px-1.5 py-0.5 rounded border border-warm-border dark:border-dark-border">Enter</kbd> to search everywhere instead.</p>
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-col h-full">
        <StarredHeader total={items.length} matched={scopedResults.length} filterQuery={needle} />
        <div className="flex-1 min-h-0">
          <FragmentResults
            results={scopedResults}
            query={needle}
            onOpenSession={onOpenSession}
            defaultSortOrder={defaultSortOrder}
            onCopySessionId={onCopySessionId}
            starredSessions={starredSessions}
            onToggleStar={onToggleStar}
          />
        </div>
      </div>
    )
  }

  // Empty query → list of starred sessions ordered by starred_at DESC
  // (already sorted server-side).
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <StarredHeader total={items.length} />
      <div className="flex-1 overflow-y-auto">
        <div className="divide-y divide-warm-border dark:divide-dark-border">
          {items.map(item => (
            <StarredSessionRow
              key={`s-${item.session.sessionUuid}`}
              session={item.session}
              onOpen={onOpenSession}
              onToggleStar={onToggleStar}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function StarredHeader({
  total,
  matched,
  filterQuery,
}: {
  total: number
  matched?: number
  filterQuery?: string
}) {
  const scoped = filterQuery && matched !== undefined
  return (
    <div className="flex items-center gap-2 border-b border-warm-border dark:border-dark-border px-4 min-h-11 flex-none">
      <Star size={13} strokeWidth={1.8} fill="currentColor" className="text-accent dark:text-accent-dark flex-none" />
      <span className="text-xs font-medium text-warm-text dark:text-dark-text leading-none">Starred</span>
      <span className="text-xs text-warm-faint dark:text-dark-muted tabular-nums leading-none">
        {scoped ? `${matched} of ${total}` : total}
      </span>
      {scoped && (
        <span className="text-[11px] text-warm-faint dark:text-dark-muted italic ml-2 truncate leading-none">
          matching &ldquo;{filterQuery}&rdquo;
        </span>
      )}
    </div>
  )
}

function StarredSessionRow({
  session,
  onOpen,
  onToggleStar,
}: {
  session: Session
  onOpen: (uuid: string) => void
  onToggleStar: (kind: StarKind, uuid: string, next: boolean) => void
}) {
  const date = formatRelativeDate(session.startedAt)
  const handleOpen = () => onOpen(session.sessionUuid)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen() } }}
      data-testid="starred-row"
      data-kind="session"
      className="px-4 py-3 hover:bg-warm-surface dark:hover:bg-dark-surface transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-center gap-2 mb-1">
        <SourceBadge source={session.source} />
        <span className="text-xs text-warm-muted dark:text-dark-muted truncate flex-1">
          You starred this · {session.projectDisplayName}
        </span>
        <span className="text-xs text-warm-faint dark:text-dark-muted flex-none">{date}</span>
        <StarButton
          uuid={session.sessionUuid}
          isStarred={true}
          onToggle={onToggleStar}
          size="sm"
        />
      </div>
      <p className="text-sm text-warm-text dark:text-dark-text truncate">
        {session.title ?? '(no title)'}
      </p>
      <p className="text-xs text-warm-faint dark:text-dark-muted mt-0.5">
        {session.messageCount} messages
        {session.model && ` · ${session.model}`}
      </p>
    </div>
  )
}
