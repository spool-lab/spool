// Tier 2 storage — the .spool file. A user-owned, portable JSON document
// that captures both the conversation and the current editor settings.
//
// Two distinct call sites:
//   • Autosave draft (IndexedDB) — keeps the RAW conversation so the
//     user can come back later and continue editing. Local-only.
//   • Download — produces a file the user might hand to someone else.
//     Pass `{ sanitize: true }` to bake the redactions into the body
//     so the recipient never sees the original credentials. When
//     sanitised, the file is round-trippable (still valid .spool) but
//     the original text is irrecoverable from the file alone.

import type { Conversation, EditorOpts, SpoolDocument, Turn } from '../types'
import { saveBlob } from '../export'
import { sanitizeFilename } from '../filename'
import { collectRedactList } from '@/templates/redact'

const MIME = 'application/spool+json'

export interface BuildSpoolOptions {
  /** When true, replace every redact-list literal in turn bodies
   *  and author labels with `[redacted]` before serialising. Default
   *  false — the autosave path wants the raw original so the user
   *  can keep editing. The download path passes true. */
  sanitize?: boolean
}

export function buildSpoolDocument(
  conversation: Conversation,
  opts: EditorOpts,
  options: BuildSpoolOptions = {},
): SpoolDocument {
  const willSanitize = options.sanitize && opts.redact
  const conv = willSanitize ? sanitizeConversation(conversation, opts) : conversation
  // When sanitising for download, drop `redactExclude` from the
  // embedded opts. The recipient already sees `[redacted]` markers
  // in the body — they don't need to know which categories or
  // specific items the source user opted out of. That metadata
  // would be pure leak (mild, but unnecessary).
  const exportedOpts = willSanitize && opts.redactExclude
    ? (() => {
        const { redactExclude: _drop, ...rest } = opts
        return rest as EditorOpts
      })()
    : opts
  return {
    version: 1,
    conversation: conv,
    opts: exportedOpts,
    exportedAt: new Date().toISOString(),
  }
}

/** Walk every turn and replace each detected sensitive literal with
 *  its per-kind mask. Operates on a structural clone — the source
 *  object is never mutated, so callers can re-use the conversation. */
function sanitizeConversation(conversation: Conversation, opts: EditorOpts): Conversation {
  const redactList = collectRedactList(conversation.turns, opts)
  if (redactList.length === 0) return conversation
  const replaceMap = new Map(redactList.map((r) => [r.value, r.replacement]))
  const rx = new RegExp(redactList.map((r) => escapeRx(r.value)).join('|'), 'g')
  return {
    ...conversation,
    turns: conversation.turns.map((t) => sanitizeTurn(t, rx, replaceMap)),
  }
}

function sanitizeTurn(turn: Turn, rx: RegExp, replaceMap: Map<string, string>): Turn {
  // Reset rx state — global RegExps carry lastIndex across .replace
  // when reused across multiple inputs in older engines.
  rx.lastIndex = 0
  const next: Turn = {
    ...turn,
    body: turn.body.replace(rx, (match) => replaceMap.get(match) ?? '[redacted]'),
  }
  if (turn.author) {
    const bare = turn.author.replace(/^\[|\]$/g, '').trim()
    if (replaceMap.has(bare)) {
      next.author = `[${replaceMap.get(bare)}]`
    }
  }
  return next
}

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function downloadSpoolFile(
  conversation: Conversation,
  opts: EditorOpts,
  options: BuildSpoolOptions = { sanitize: true },
): Promise<void> {
  // Default to sanitised for the user-facing download — opposite of
  // the in-memory builder, which assumes raw for autosave. The
  // explicit options arg lets callers override either way.
  const doc = buildSpoolDocument(conversation, opts, options)
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: MIME })
  await saveBlob(blob, filenameFor(conversation), {
    description: 'Spool Share document',
    mime: MIME,
    ext: '.spool',
  })
}

export async function readSpoolFile(file: File): Promise<SpoolDocument> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a valid .spool file (malformed JSON).')
  }
  if (!isSpoolDocument(parsed)) {
    throw new Error('Not a valid .spool file (unrecognized shape).')
  }
  return parsed
}

function isSpoolDocument(v: unknown): v is SpoolDocument {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return o.version === 1 && typeof o.conversation === 'object' && typeof o.opts === 'object'
}

function filenameFor(c: Conversation): string {
  const safe = sanitizeFilename(c.title)
  const date = new Date().toISOString().slice(0, 10)
  return `${safe || 'spool'} · ${date}.spool`
}
