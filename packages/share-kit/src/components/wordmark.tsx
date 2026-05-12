interface WordmarkProps {
  size?: number
  className?: string
}

export function Wordmark({ size = 48, className }: WordmarkProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily: 'Geist, sans-serif',
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '-0.04em',
        color: 'var(--text)',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'baseline',
      }}
    >
      Spool<span style={{ color: 'var(--accent)' }}>.</span>
    </span>
  )
}
