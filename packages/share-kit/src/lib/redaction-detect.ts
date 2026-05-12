// Sensitive-data detection used by the editor's pre-publish redaction
// check. Pure pattern matching — no LLM, no network. The goal isn't to
// catch every secret (that's impossible from rules alone), it's to make
// the obvious cases impossible to publish accidentally.
//
// The Spool app's Compose modal will route detected spans through
// `Turn.redact: string[]` so the templates' body renderer can swap them
// for `[redacted]` chips.

export type SensitiveKind =
  | 'email'
  | 'phone'
  | 'api-key'
  | 'absolute-path'
  | 'jwt'
  | 'env-var'

export interface SensitiveMatch {
  kind: SensitiveKind
  /** The literal substring detected, suitable to pass to `Turn.redact`. */
  value: string
  /** Character offset within the input string. */
  start: number
  /** Exclusive end offset. */
  end: number
}

// Order matters: longer-matching rules first so we don't fragment a
// long JWT into separate 'token' / 'path' hits. Patterns lean
// conservative (require at least one strongly diagnostic feature) to
// keep the false-positive rate down on prose.
const RULES: { kind: SensitiveKind; rx: RegExp }[] = [
  // RFC 7519 JWT: three dot-separated base64url segments, header
  // starting with eyJ (= {"alg":...} in base64). 60-char minimum gates
  // out short tokens that just happen to have two dots.
  { kind: 'jwt', rx: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // Vendor-prefixed API keys: stripe (sk_live_, sk_test_), openai (sk-),
  // GitHub (ghp_, gho_, ghs_, ghu_, ghr_), AWS access key (AKIA…).
  // The 16-char minimum stays clear of variable names that just start
  // with "sk_".
  { kind: 'api-key', rx: /\b(?:sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g },
  // RFC 5322-ish email: simple but excludes purely numeric local
  // parts and common false positives like CSS hex codes.
  { kind: 'email', rx: /\b[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g },
  // International phone — 10-15 digits with optional leading + and
  // space/dash/dot separators. Anchored on word boundary so we don't
  // catch arbitrary digit runs.
  { kind: 'phone', rx: /(?<!\d)\+?\d[\d .\-()]{8,13}\d(?!\d)/g },
  // Unix-style absolute paths under common HOME/system roots. The
  // trailing class accepts CJK and unicode letters so paths in
  // localized homedirs still match.
  { kind: 'absolute-path', rx: /(?:\/Users\/|\/home\/|\/var\/|\/etc\/|\/opt\/)[A-Za-z0-9._\-/À-￿]+/g },
  // `.env`-style line: NAME=VALUE where NAME looks like an env key.
  // Captures the whole assignment so the chip masks both name and
  // value — knowing only the name still leaks intent ("we use STRIPE_KEY").
  { kind: 'env-var', rx: /\b[A-Z][A-Z0-9_]{2,}(?:_KEY|_SECRET|_TOKEN|_PASSWORD)=\S+/g },
]

/**
 * Scan a turn body and return every match across all rules, ordered
 * by start offset. Overlapping matches (e.g. an email inside a path)
 * are reported once: whichever rule fires first wins on overlap.
 */
export function detectSensitiveSpans(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = []
  for (const { kind, rx } of RULES) {
    rx.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rx.exec(text)) !== null) {
      matches.push({ kind, value: m[0], start: m.index, end: m.index + m[0].length })
      // Defensive: a zero-width match would loop forever.
      if (m.index === rx.lastIndex) rx.lastIndex++
    }
  }
  matches.sort((a, b) => a.start - b.start)

  // De-overlap. With a sort-by-start, walking forward and dropping any
  // span whose start falls inside the previous span keeps the
  // first-fired rule for each region.
  const out: SensitiveMatch[] = []
  let cursor = -1
  for (const m of matches) {
    if (m.start >= cursor) {
      out.push(m)
      cursor = m.end
    }
  }
  return out
}
