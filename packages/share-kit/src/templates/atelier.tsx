// Template: Atelier — editorial two-column, serif-free.

import type { Conversation, EditorOpts } from '@/lib/types'
import { typefaceFamily } from '@/lib/types'
import { templateTokens } from './tokens'
import { collectRedactList } from './redact'
import { selectSegments } from './selection'
import { GapMarker } from './gap-marker'
import { Body } from './body'

interface Props {
  convo: Conversation
  opts: EditorOpts
}

export function Atelier({ convo, opts }: Props) {
  const t = templateTokens(opts.paper)
  const accent = opts.accentHex
  const tf = typefaceFamily(opts.typeface)
  const redactList = collectRedactList(convo.turns)
  const gap = opts.density === 'compact' ? 14 : 22
  const segments = selectSegments(convo, opts)

  return (
    <div
      style={{
        fontFamily: tf,
        background: t.paper,
        color: t.text,
        padding: '56px 64px 48px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {opts.showMasthead && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ color: accent, fontWeight: 600 }}>§ Atelier</span>
          <span style={{ flex: 1, height: 1, background: t.border }} />
          <span style={{ color: t.muted }}>with {convo.sourceLabel}</span>
          <span style={{ color: t.muted }}>·</span>
          <span style={{ color: t.muted }}>
            {segments.isExcerpt
              ? `${segments.kept} of ${segments.total} turns`
              : `${segments.total} turns`}
          </span>
          <span style={{ color: t.muted }}>·</span>
          <span style={{ color: t.muted }}>~{convo.readMin} min</span>
        </div>
      )}

      <h1
        style={{
          fontFamily: tf,
          fontWeight: 600,
          fontSize: 32,
          letterSpacing: '-0.025em',
          lineHeight: 1.08,
          margin: '18px 0 10px',
          color: t.text,
          maxWidth: '90%',
        }}
      >
        {convo.title}
      </h1>
      <div style={{ width: 48, height: 2.5, background: accent, borderRadius: 1, marginBottom: 10 }} />
      <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, color: t.muted }}>
        Stitched {convo.createdAt} · {convo.wordCount.toLocaleString()} words
      </div>
      <div style={{ height: 1, background: t.border, margin: '20px 0 24px' }} />

      <div
        style={{
          columnCount: 2,
          columnGap: 32,
          color: t.text,
        }}
      >
        {segments.turns.map((turn, i) => (
          <div
            key={turn.origIndex}
            data-turn-index={turn.origIndex}
            style={{ breakInside: 'avoid', scrollMarginTop: 40 }}
          >
            {opts.showGaps && segments.gapBefore[i]! > 0 && (
              <GapMarker count={segments.gapBefore[i]!} tokens={t} accent={accent} />
            )}
            <div data-turn-body style={{ marginBottom: gap }}>
              <div
                style={{
                  fontFamily: tf,
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: turn.role === 'user' ? accent : t.muted,
                  marginBottom: 4,
                }}
              >
                {turn.role === 'user' ? turn.author ?? 'User' : convo.sourceLabel}
              </div>
              <Body
                text={turn.body}
                redact={opts.redact ? redactList : undefined}
                mono
                accent={accent}
                accentBg={t.accentBg}
              />
            </div>
          </div>
        ))}
      </div>

      {opts.showColophon && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10,
            color: t.faint,
            marginTop: 24,
            paddingTop: 14,
            borderTop: `1px solid ${t.border}`,
          }}
        >
          <span>
            Spool<span style={{ color: accent }}>.</span>
            {convo.shortUrl && <> · {convo.shortUrl}</>}
          </span>
          <span style={{ color: accent }}>— 1 —</span>
        </div>
      )}
    </div>
  )
}
