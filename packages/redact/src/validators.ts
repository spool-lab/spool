// Small validators used by the detector rules to suppress false
// positives that pure regex can't. Each is side-effect-free and
// returns boolean — discard-on-false at the detector level.
//
// Also home to `hashValueForRedactExclude`: the non-crypto hash
// used by the Share editor to record per-item opt-outs WITHOUT
// writing the literal value back to disk. See `RedactExclude` in
// `@spool/share-kit` for the threat model and rationale.

/** Luhn check for credit-card-shaped digit runs. Operates on the
 *  raw match (separators allowed); returns true if the embedded
 *  digit sequence is a valid mod-10 checksum. */
export function luhnOk(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

/** Stable 32-bit non-cryptographic hash of `value`, hex-encoded as
 *  8 lowercase characters. Used by the Share editor to persist per-
 *  item redact opt-outs in `RedactExclude.valueHashes` *without*
 *  storing the literal value.
 *
 *  Threat model: an attacker who can read the persisted draft can
 *  also read the conversation body in the same file, so a stronger
 *  hash would not raise the bar. The goal here is to ensure the
 *  Share editor itself doesn't produce a NEW on-disk artifact that
 *  names a sensitive literal. FNV-1a is deterministic, sync, and
 *  fast enough to call inside a React render. */
export function hashValueForRedactExclude(value: string): string {
  // FNV-1a 32-bit. Offset basis 0x811c9dc5, prime 0x01000193.
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    // Force back to unsigned 32-bit after each multiply so JS's
    // 53-bit-mantissa Number doesn't drift into floating-point.
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Shannon entropy of a string. Used to gate the generic-secret rule
 *  so that `password = "letmeinletmeinletmein"` (low-entropy) doesn't
 *  trigger but `password = "j82H1xK9pQrSt7VwYzA3"` does. */
export function shannon(s: string): number {
  if (!s) return 0
  const counts = new Map<string, number>()
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1)
  const len = s.length
  let h = 0
  for (const n of counts.values()) {
    const p = n / len
    h -= p * Math.log2(p)
  }
  return h
}

/** Curried entropy floor for use as a rule validator. The match
 *  string is expected to be a "keyword = value" capture; we pull the
 *  quoted body so we don't include the key name in the entropy. */
export function hasQuotedEntropy(min: number): (value: string) => boolean {
  return (value: string) => {
    const inner = value.match(/["']([^"']{6,})["']/)?.[1] ?? value
    return shannon(inner) >= min
  }
}
