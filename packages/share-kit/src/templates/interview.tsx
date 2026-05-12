// Template: Interview — long-form Q&A. User prompts render as
// prominent, bold questions with a small "Q." kicker in accent color;
// assistant replies flow as editorial body text underneath. Reads
// like a magazine interview spread. Well suited to multi-turn
// conversations where the questions themselves matter.

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

export function Interview({ convo, opts }: Props) {
  const t = templateTokens(opts.paper)
  const accent = opts.accentHex
  const tf = typefaceFamily(opts.typeface)
  const redactList = collectRedactList(convo.turns)
  const segments = selectSegments(convo, opts)
  const turnGap = opts.density === 'compact' ? 22 : 34

  return (
    <div
      style={{
        fontFamily: tf,
        background: t.paper,
        color: t.text,
        width: '100%',
        padding: '56px 72px 48px',
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
            marginBottom: 30,
          }}
        >
          <span style={{ color: accent, fontWeight: 600 }}>§ An Interview</span>
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
          fontSize: 34,
          letterSpacing: '-0.025em',
          lineHeight: 1.1,
          margin: '0 0 12px',
          color: t.text,
          maxWidth: '86%',
        }}
      >
        {convo.title}
      </h1>
      <div style={{ width: 48, height: 2.5, background: accent, borderRadius: 1, marginBottom: 10 }} />
      <div
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10,
          color: t.muted,
          letterSpacing: '0.04em',
          marginBottom: 34,
        }}
      >
        Stitched {convo.createdAt} · {convo.wordCount.toLocaleString()} words
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: turnGap }}>
        {segments.turns.map((turn, i) => {
          const isUser = turn.role === 'user'
          const showGap = opts.showGaps && segments.gapBefore[i]! > 0
          return (
            <div key={turn.origIndex} data-turn-index={turn.origIndex} style={{ scrollMarginTop: 40 }}>
              {showGap && <GapMarker count={segments.gapBefore[i]!} tokens={t} accent={accent} />}
              {isUser ? (
                <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                  <div
                    style={{
                      flexShrink: 0,
                      width: 24,
                      fontFamily: 'Geist Mono, monospace',
                      fontSize: 13,
                      fontWeight: 600,
                      color: accent,
                      letterSpacing: '0.04em',
                    }}
                  >
                    Q.
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontFamily: tf,
                      fontSize: 17,
                      fontWeight: 500,
                      lineHeight: 1.4,
                      letterSpacing: '-0.015em',
                      color: t.text,
                    }}
                  >
                    <Body
                      text={turn.body}
                      redact={opts.redact ? redactList : undefined}
                      sansFont={tf}
                      fontSize={17}
                      accent={accent}
                      accentBg={t.accentBg}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                  <div
                    style={{
                      flexShrink: 0,
                      width: 24,
                      fontFamily: 'Geist Mono, monospace',
                      fontSize: 13,
                      fontWeight: 500,
                      color: t.muted,
                      letterSpacing: '0.04em',
                    }}
                  >
                    A.
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontFamily: tf,
                      fontSize: 13.5,
                      lineHeight: 1.7,
                      color: t.text,
                    }}
                  >
                    <Body
                      text={turn.body}
                      redact={opts.redact ? redactList : undefined}
                      sansFont={tf}
                      fontSize={13.5}
                      accent={accent}
                      accentBg={t.accentBg}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {opts.showColophon && (
        <div
          style={{
            marginTop: 40,
            paddingTop: 14,
            borderTop: `1px solid ${t.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: 'Geist Mono, monospace',
            fontSize: 9.5,
            color: t.faint,
            letterSpacing: '0.04em',
          }}
        >
          <span>
            Spool<span style={{ color: accent }}>.</span>
            {convo.shortUrl && <> · {convo.shortUrl}</>}
          </span>
          <span style={{ color: accent }}>— interview —</span>
        </div>
      )}
    </div>
  )
}
