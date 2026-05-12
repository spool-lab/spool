import { useMemo, type ReactNode } from 'react'
import { Newspaper } from 'lucide-react'
import { useShareDrafts } from '../hooks/useShareDrafts'
import type { ShareDraftListItem } from '@spool-lab/core'
import {
  TemplateRender,
  TEMPLATE_RATIO,
  TEMPLATES,
  paperTokens,
  type SpoolDocument,
} from '@spool/share-kit'
import { getSessionSourceColor } from '../../shared/sessionSources.js'

type Props = {
  onOpenDraft?: ((draft: ShareDraftListItem) => void) | undefined
}

/**
 * The Drafts / Published tab strip is intentionally not rendered yet:
 * Phase 0 only has Drafts, and showing a Published tab that maps to a
 * "Coming in a future update" placeholder reads as a broken promise.
 * The tab strip lands in Phase 2 alongside the actual publish flow.
 */
export default function SharesPage({ onOpenDraft }: Props) {
  const { drafts, loading, error } = useShareDrafts()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <DraftsList drafts={drafts} loading={loading} error={error} onOpenDraft={onOpenDraft} />
      </div>
    </div>
  )
}

function DraftsList({
  drafts,
  loading,
  error,
  onOpenDraft,
}: {
  drafts: ShareDraftListItem[]
  loading: boolean
  error: string | null
  onOpenDraft?: ((draft: ShareDraftListItem) => void) | undefined
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
    <ul
      className="grid gap-5 px-6 pt-3 pb-6"
      style={{ gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)` }}
    >
      {drafts.map((draft) => (
        <li key={draft.draft_id}>
          <DraftCard draft={draft} onClick={onOpenDraft} />
        </li>
      ))}
    </ul>
  )
}

const CARD_W = 170
const FALLBACK_RATIO = { w: 720, h: 960 }

function DraftCard({
  draft,
  onClick,
}: {
  draft: ShareDraftListItem
  onClick?: ((draft: ShareDraftListItem) => void) | undefined
}) {
  // The preview blob is a SpoolDocument-shaped subset: full opts +
  // conversation metadata + first ~6 turns. Card rendering only ever
  // reads at most that many turns (see thumbConvo below), so we never
  // need to hydrate the full snapshot here.
  const doc = useMemo<SpoolDocument | null>(() => {
    try {
      return JSON.parse(draft.preview_json) as SpoolDocument
    } catch {
      return null
    }
  }, [draft.preview_json])

  if (!doc) {
    return <CorruptDraftCard draft={draft} onClick={onClick} />
  }

  const ratio = TEMPLATE_RATIO[doc.opts.template] ?? FALLBACK_RATIO
  const scale = CARD_W / ratio.w
  const cardH = Math.round(CARD_W * (ratio.h / ratio.w))
  const tokens = paperTokens(doc.opts.paper)
  const templateName = TEMPLATES.find((t) => t.id === doc.opts.template)?.name ?? doc.opts.template

  // The template renders the whole conversation at native size; clipping
  // does the rest. Cap at 6 turns so a 200-message session doesn't make
  // every Shares-page mount measure the same 800-paragraph DOM tree
  // times the number of cards on screen.
  const thumbConvo = useMemo(
    () => ({ ...doc.conversation, turns: doc.conversation.turns.slice(0, 6) }),
    [doc.conversation],
  )

  const title = doc.conversation.title || 'Untitled'

  return (
    <button
      type="button"
      data-testid="shares-draft-row"
      onClick={() => onClick?.(draft)}
      disabled={!onClick}
      aria-label={`Open ${title}`}
      className="group relative block overflow-hidden rounded-md cursor-pointer disabled:cursor-default"
      style={{
        width: CARD_W,
        height: cardH,
        background: tokens.paper,
        border: `1px solid ${tokens.border}`,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.04)',
        textAlign: 'left',
        padding: 0,
        margin: 0,
      }}
    >
      {/* Scaled artifact preview clipped to the card. */}
      <span aria-hidden className="absolute inset-0 overflow-hidden block pointer-events-none">
        <span
          className="block"
          style={{
            width: ratio.w,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <TemplateRender template={doc.opts.template} convo={thumbConvo} opts={doc.opts} />
        </span>
      </span>

      {/* Paper-tinted fade so long conversations don't look hard-cropped. */}
      <span
        aria-hidden
        className="absolute left-0 right-0 bottom-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-0"
        style={{
          height: Math.round(cardH * 0.45),
          background: `linear-gradient(to bottom, ${tokens.paper}00 0%, ${tokens.paper}DD 55%, ${tokens.paper} 100%)`,
        }}
      />

      {/* Hover overlay — slim frosted-paper caption at the bottom.
          Backdrop-blur + paper color at ~75% opacity makes the strip
          read as a tinted glass band over the thumbnail rather than a
          flat shade. tokens.text drives the text color so any paper
          (bone / ink / linen / …) gets a legible caption without a
          theme branch. */}
      <span
        aria-hidden
        className="absolute left-0 right-0 bottom-0 flex flex-col gap-0.5 px-3 pt-2.5 pb-2.5 pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{
          background: `${tokens.paper}BF`,
          backdropFilter: 'blur(8px) saturate(140%)',
          WebkitBackdropFilter: 'blur(8px) saturate(140%)',
          color: tokens.text,
        }}
      >
        <span className="text-[10.5px] font-medium leading-snug line-clamp-2 tracking-[-0.01em]">
          {title}
        </span>
        <span className="flex items-center gap-1.5 text-[9px]" style={{ color: tokens.muted }}>
          <span
            aria-hidden
            className="block w-1.5 h-1.5 rounded-full flex-none"
            style={{ background: getSessionSourceColor(doc.conversation.source) }}
          />
          <span className="font-mono uppercase tracking-[0.04em] flex-none">{formatRelative(draft.updated_at)}</span>
        </span>
      </span>
    </button>
  )
}

function CorruptDraftCard({ draft }: { draft: ShareDraftListItem; onClick?: unknown }) {
  const ratio = FALLBACK_RATIO
  const cardH = Math.round(CARD_W * (ratio.h / ratio.w))
  return (
    <div
      className="block rounded-md border border-dashed border-warm-border dark:border-dark-border bg-warm-surface dark:bg-dark-surface text-warm-faint dark:text-dark-muted text-xs flex flex-col items-center justify-center gap-1 px-3 text-center"
      style={{ width: CARD_W, height: cardH }}
    >
      <span className="font-medium text-warm-text dark:text-dark-text line-clamp-2">
        {draft.title || 'Untitled'}
      </span>
      <span>snapshot unreadable</span>
      <span>edited {formatRelative(draft.updated_at)}</span>
    </div>
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

function formatRelative(iso: string): string {
  const parsed = Date.parse(iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(parsed)) return iso
  const diffSec = Math.max(0, Math.round((Date.now() - parsed) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(parsed).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
