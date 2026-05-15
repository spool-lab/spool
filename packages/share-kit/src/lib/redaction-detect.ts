// Sensitive-data detection. The implementation lives in
// `@spool-lab/redact` so the same pipeline is available to:
//   • Share editor — pre-publish review (here)
//   • Security Scan (planned) — background sweep over local sessions
//   • CLI `spool doctor` (planned) — same headless
//
// Re-exported here for backwards compatibility with existing
// `@spool/share-kit` import paths.

export {
  detectSensitiveSpans,
  groupBySensitiveKind,
  hashValueForRedactExclude,
  SENSITIVE_KIND_LABEL,
  SENSITIVE_KIND_ORDER,
} from '@spool-lab/redact'
export type {
  SensitiveKind,
  SensitiveMatch,
  SensitiveGroup,
  SensitiveValue,
  RedactProvider,
} from '@spool-lab/redact'
