// Redact helpers.
//
// `collectRedactList` is the flat string list fed to the Body renderer
// (preprocesses matches into `[redacted]` chips). `detectPII` returns
// a structured view that the Editor's Privacy panel uses to surface
// exactly which names/emails will be redacted and why.
//
// Detection today:
//   • Emails — greedy regex, deduped
//   • Authors — the bracketed author label (e.g. "[Maya]" → "Maya"),
//     excluding the generic `[you]` placeholder
// No regex for personal names in free text — too many false positives
// without an NER step, which we'll add post-MVP if users ask for it.

import type { Turn } from '@/lib/types'

const EMAIL_RX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

export interface PIIDetection {
  emails: string[]
  names: string[]
  /** Flat dedup'd list used by the regex substituter. */
  all: string[]
}

export function detectPII(turns: Turn[]): PIIDetection {
  const joined = turns.map((t) => t.body).join('\n')
  const emails = Array.from(new Set(joined.match(EMAIL_RX) ?? []))
  const names = Array.from(
    new Set(
      turns
        .map((t) => t.author?.replace(/^\[|\]$/g, '').trim())
        .filter((n): n is string => !!n && n.length > 1 && n.toLowerCase() !== 'you'),
    ),
  )
  const manual = turns.flatMap((t) => t.redact ?? [])
  const all = Array.from(new Set([...emails, ...names, ...manual]))
  return { emails, names, all }
}

/** Flat list for the Body renderer — consumes any manually-populated
 *  turn.redact entries plus auto-detected PII. */
export function collectRedactList(turns: Turn[]): string[] {
  return detectPII(turns).all
}
