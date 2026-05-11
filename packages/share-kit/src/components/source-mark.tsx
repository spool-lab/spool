// Tiny vector marks for the supported AI vendors. Vector-only, no logos —
// these stand in as "source signposts" without imitating brand identity.

interface MarkProps {
  kind: 'chatgpt' | 'claude' | 'gemini'
  size?: number
  color?: string
}

export function SourceMark({ kind, size = 12, color = 'currentColor' }: MarkProps) {
  const s = size
  if (kind === 'chatgpt') {
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path d="M6 1.2L10.2 3.6v4.8L6 10.8 1.8 8.4V3.6L6 1.2z" stroke={color} strokeWidth="1.2" />
      </svg>
    )
  }
  if (kind === 'claude') {
    return (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path
          d="M2.5 9L5.4 3.2a.7.7 0 0 1 1.2 0L9.5 9M3.8 7h4.4"
          stroke={color}
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
      <path
        d="M6 1.5c0 2 1 3 3 3-2 0-3 1-3 3 0-2-1-3-3-3 2 0 3-1 3-3z M6 6.5c0 1.2.8 2 2 2-1.2 0-2 .8-2 2 0-1.2-.8-2-2-2 1.2 0 2-.8 2-2z"
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}
