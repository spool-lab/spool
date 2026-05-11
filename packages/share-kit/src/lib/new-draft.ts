// Shared new-draft flow. Home, the Drafts page, and the editor all
// share the same two entry points: paste a share URL, or hand off a
// `.spool` file. Each caller owns its own UI (pill input,
// dropzone, modal), but the parse → stash → navigate plumbing lives
// here so the behavior stays identical across surfaces.

import type { Conversation } from './types'
import { detectPlatform, ParseError, parseShareUrl } from './parsers'
import { readSpoolFile } from './storage/spool-file'

export const INCOMING_KEY = 'spool:incoming'
export const INCOMING_OPTS_KEY = 'spool:incoming-opts'

export function looksLikeShareUrl(value: string): boolean {
  return detectPlatform(value.trim()) !== null
}

type Navigate = (to: string) => void

function stashAndGo(navigate: Navigate, conversation: Conversation, optsJson?: string) {
  sessionStorage.setItem(INCOMING_KEY, JSON.stringify(conversation))
  if (optsJson !== undefined) {
    sessionStorage.setItem(INCOMING_OPTS_KEY, optsJson)
  } else {
    sessionStorage.removeItem(INCOMING_OPTS_KEY)
  }
  navigate('/editor?from=parsed')
}

/** Fetch + parse a share URL and navigate to the editor.
 *  Throws a `ParseError` (via parseShareUrl) on failure. The caller
 *  decides how to surface the error — inline pill, popover, etc. */
export async function startDraftFromUrl(url: string, navigate: Navigate): Promise<void> {
  if (!looksLikeShareUrl(url)) {
    throw new ParseError(`Not a recognized share URL: ${url}`, 'unknown-host')
  }
  const convo = await parseShareUrl(url)
  stashAndGo(navigate, convo)
}

/** Read a dropped `.spool` file and navigate to the editor.
 *  Throws `ParseError('unknown-host')` for unsupported extensions so
 *  callers can treat it alongside URL errors.
 *
 *  Note: Markdown import is intentionally not supported. MD cannot
 *  faithfully carry tool calls, redaction overlays, or audit chips;
 *  reverse-parsing turn ownership is also ambiguous. Revisit in a
 *  later phase if real demand surfaces. */
export async function startDraftFromFile(file: File, navigate: Navigate): Promise<void> {
  const name = file.name.toLowerCase()
  const isSpoolFile = name.endsWith('.spool')

  if (!isSpoolFile) {
    throw new ParseError(`Unsupported file type: ${file.name}`, 'unknown-host')
  }

  const doc = await readSpoolFile(file)
  // Tag origin as a file drop so the source chip reads "imported
  // file <name>" instead of the original platform.
  const incoming: Conversation = {
    ...doc.conversation,
    origin: { kind: 'file', filename: file.name },
  }
  stashAndGo(navigate, incoming, JSON.stringify(doc.opts))
}
