// Template: Transcript — faithful chat-like flow.

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

export function Transcript({ convo, opts }: Props) {
  const t = templateTokens(opts.paper)
  const accent = opts.accentHex
  const tf = typefaceFamily(opts.typeface)
  const redactList = collectRedactList(convo.turns)
  const gap = opts.density === 'compact' ? 14 : 24
  const segments = selectSegments(convo, opts)

  return (
    <div
      style={{
        fontFamily: tf,
        background: t.paper,
        color: t.text,
        padding: '48px 56px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {opts.showMasthead && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.03em' }}>
            Spool<span style={{ color: accent }}>.</span>
          </span>
          <span style={{ flex: 1, height: 1, background: t.border }} />
          <span
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 10,
              color: accent,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}
          >
            § Transcript
          </span>
          <span style={{ flex: 1, height: 1, background: t.border }} />
          <span
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 10,
              color: t.muted,
              letterSpacing: '0.04em',
            }}
          >
            {convo.sourceLabel} · {convo.createdAt}
          </span>
        </div>
      )}
      <h2
        style={{
          fontWeight: 600,
          fontSize: 22,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          margin: 0,
        }}
      >
        {convo.title}
      </h2>
      <div style={{ width: 36, height: 2, background: accent, borderRadius: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {segments.turns.map((turn, i) => (
          <div
            key={turn.origIndex}
            data-turn-index={turn.origIndex}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, scrollMarginTop: 40 }}
          >
            {opts.showGaps && segments.gapBefore[i]! > 0 && (
              <GapMarker count={segments.gapBefore[i]!} tokens={t} accent={accent} variant="block" />
            )}
            <div data-turn-body style={{ display: 'flex', gap: 14 }}>
              <div style={{ width: 68, flexShrink: 0, paddingTop: 2 }}>
                <div
                  style={{
                    fontFamily: tf,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: turn.role === 'user' ? accent : t.muted,
                  }}
                >
                  {turn.role === 'user' ? (turn.author ?? 'User').replace(/[\[\]]/g, '') : convo.sourceLabel}
                </div>
              </div>
              <div
                style={{
                  flex: 1,
                  borderLeft: `1px solid ${turn.role === 'user' ? accent : t.border}`,
                  paddingLeft: 14,
                }}
              >
                <Body
                  text={turn.body}
                  redact={opts.redact ? redactList : undefined}
                  mono
                  accent={accent}
                  accentBg={t.accentBg}
                  blockBorder={turn.role === 'user' ? t.border : undefined}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      {opts.showColophon && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'Geist Mono, monospace',
            fontSize: 9.5,
            color: t.faint,
            paddingTop: 10,
            borderTop: `1px solid ${t.border}`,
          }}
        >
          <span>Stitched on Spool</span>
          {convo.shortUrl && <span>{convo.shortUrl}</span>}
        </div>
      )}
    </div>
  )
}
