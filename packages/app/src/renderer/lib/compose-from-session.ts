import type { Session, Message, SessionSource } from '@spool-lab/core'
import type { Conversation, Platform, SpoolDocument, Turn } from '@spool/share-kit'

/** Number of turns the Shares-grid card thumbnail actually renders.
 *  Anything beyond this is fade-clipped, so storing them in
 *  preview_json is pure waste. */
export const PREVIEW_TURN_COUNT = 6

/**
 * Slim a SpoolDocument down to the fields the Shares grid card needs:
 * full opts (template / paper / typeface / colorway drive the
 * thumbnail), conversation metadata, and the first PREVIEW_TURN_COUNT
 * turns. The result is structurally a SpoolDocument so the grid can
 * feed it to TemplateRender unchanged — just smaller.
 *
 * Callers serialize the result into share_drafts.preview_json
 * alongside the full snapshot_json.
 */
export function buildPreviewDocument(doc: SpoolDocument): SpoolDocument {
  return {
    ...doc,
    conversation: {
      ...doc.conversation,
      turns: doc.conversation.turns.slice(0, PREVIEW_TURN_COUNT),
    },
  }
}

/**
 * Stable per-session draft id. Re-opening the same Spool session always
 * lands on the same draft row instead of accumulating one per Share
 * click. Format mirrors quilt's draftIdFor() so the namespace is
 * recognizable; the prefix doubles as the snapshot's source_origin
 * carrier when the host queries share_drafts.
 */
export function sessionDraftId(sessionUuid: string): string {
  return `session:${sessionUuid}`
}

/**
 * share-kit's Platform union currently covers ChatGPT / Claude / Gemini —
 * Codex doesn't exist there yet. We map it onto 'ChatGPT' since the two
 * share OpenAI tooling lineage; the field only drives the source chip's
 * label tinting, not behavior. TODO: extend share-kit's Platform with
 * 'Codex' when the kit's parsers grow Codex support.
 */
const PLATFORM_BY_SOURCE: Record<SessionSource, Platform> = {
  claude: 'Claude',
  codex: 'ChatGPT',
  gemini: 'Gemini',
}

const SOURCE_LABEL: Record<SessionSource, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
}

interface ComposeOpts {
  /** Override the conversation title (otherwise derives from session.title). */
  titleOverride?: string
}

/**
 * Map a Spool session + its messages onto a share-kit Conversation
 * suitable for feeding into a template renderer.
 *
 * - System messages drop (share-kit has no system role).
 * - Sidechain messages drop (tool/sub-conversation noise users
 *   wouldn't want in a published artifact).
 * - Author labels are left undefined; the templates fall back to
 *   "you" / source-label.
 * - Word count and read time are computed naively (whitespace split,
 *   220 wpm); the templates display them in the masthead but nothing
 *   downstream depends on exactness.
 */
export function composeFromSession(
  session: Session,
  messages: Message[],
  opts: ComposeOpts = {},
): Conversation {
  const platform = PLATFORM_BY_SOURCE[session.source]
  const sourceLabel = SOURCE_LABEL[session.source]

  const turns: Turn[] = messages
    .filter((m) => !m.isSidechain && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      body: m.contentText,
      timestamp: m.timestamp,
    }))

  const wordCount = countWords(turns.map((t) => t.body).join(' '))
  const readMin = Math.max(1, Math.round(wordCount / 220))

  const title = opts.titleOverride ?? session.title ?? deriveTitle(turns)

  return {
    source: session.source,
    sourceLabel,
    origin: { kind: 'pasted', platform },
    title,
    shareUrl: null,
    createdAt: formatCreatedAt(session.startedAt),
    wordCount,
    readMin,
    turns,
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function deriveTitle(turns: Turn[]): string {
  const firstUser = turns.find((t) => t.role === 'user')
  if (!firstUser) return 'Untitled'
  const flat = firstUser.body.replace(/\s+/g, ' ').trim()
  return flat.length <= 60 ? flat : flat.slice(0, 59) + '…'
}

function formatCreatedAt(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
