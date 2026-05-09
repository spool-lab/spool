/**
 * Spool wraps its agent-search system instructions in this marker before
 * sending them to ACP, so the parsers can strip them back out when indexing
 * the on-disk JSONL. Without the marker, our system prompt would appear as
 * the first user message in every agent-search session — polluting the
 * derived title, the FTS index, and the session detail view.
 *
 * The user's actual query is sent OUTSIDE the marker block (at the end of
 * the message text), so after stripping the prelude only the bare query
 * remains.
 */
export const SPOOL_SYSTEM_PRELUDE_OPEN = '<spool-system-prelude>'
export const SPOOL_SYSTEM_PRELUDE_CLOSE = '</spool-system-prelude>'

export function wrapSpoolSystemPrelude(systemBody: string, userQuery: string): string {
  return `${SPOOL_SYSTEM_PRELUDE_OPEN}\n${systemBody}\n${SPOOL_SYSTEM_PRELUDE_CLOSE}\n\n${userQuery}`
}

const STRIP_RE = /<spool-system-prelude>[\s\S]*?<\/spool-system-prelude>/g

export function stripSpoolSystemPrelude(text: string): string {
  return text.replace(STRIP_RE, '').trim()
}
