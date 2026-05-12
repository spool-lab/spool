// Rendered between non-adjacent kept turns when the user has excerpted
// a conversation. Keeps the artifact honest: the reader sees at a
// glance that the flow is trimmed, not that they're reading the whole
// thread. Adapts to each template via the `tone` prop.

import type { TemplateTokens } from './tokens'

interface Props {
  count: number
  tokens: TemplateTokens
  accent: string
  /** "rule" → thin line + centered label (inline templates)
   *  "block" → small block with border (transcript-style) */
  variant?: 'rule' | 'block'
}

export function GapMarker({ count, tokens, accent, variant = 'rule' }: Props) {
  if (count <= 0) return null
  const label = `${count} turn${count === 1 ? '' : 's'} skipped`

  if (variant === 'block') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '4px 0 4px 82px',
          fontFamily: 'Geist Mono, monospace',
          fontSize: 9.5,
          color: tokens.faint,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: accent, letterSpacing: '0.1em' }}>⋯</span>
        <span>{label}</span>
        <span style={{ flex: 1, height: 1, background: tokens.border }} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '6px 0',
        breakInside: 'avoid',
        fontFamily: 'Geist Mono, monospace',
        fontSize: 9.5,
        color: tokens.faint,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      <span style={{ flex: 1, height: 1, background: tokens.border }} />
      <span style={{ color: accent, letterSpacing: '0.1em' }}>⋯</span>
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: tokens.border }} />
    </div>
  )
}
