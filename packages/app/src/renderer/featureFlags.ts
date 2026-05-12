/// <reference types="vite/client" />

// Build-time feature flags for renderer surfaces. Default to OFF in
// production so a half-finished feature can be merged to main without
// exposing it to users; flip on for local dev (vite's import.meta.env.DEV)
// and for explicit prod overrides via VITE_FEATURE_<NAME>=1.

const envFlag = (key: string): boolean =>
  ((import.meta.env as Record<string, string | undefined>)[`VITE_FEATURE_${key}`]) === '1'

export const FEATURES = {
  /** Share editor + Shares page + Share-from-session entry points. */
  share: import.meta.env.DEV || envFlag('SHARE'),
} as const
