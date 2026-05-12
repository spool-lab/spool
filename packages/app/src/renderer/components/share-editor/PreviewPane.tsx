import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import {
  TemplateRender,
  TEMPLATE_RATIO,
  TEMPLATES,
  type Conversation,
  type EditorOpts,
} from '@spool/share-kit'

export type Zoom = number | 'fit'

export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const

const PANE_W = 740

export function fitScale(ratioW: number) {
  return Math.min((PANE_W - 100) / ratioW, 0.7)
}

export function nextZoomStep(current: number, direction: 1 | -1): number {
  const EPS = 0.001
  const last = ZOOM_STEPS[ZOOM_STEPS.length - 1]!
  const first = ZOOM_STEPS[0]!
  if (direction > 0) {
    return ZOOM_STEPS.find((s) => s > current + EPS) ?? last
  }
  return [...ZOOM_STEPS].reverse().find((s) => s < current - EPS) ?? first
}

type Props = {
  convo: Conversation
  opts: EditorOpts
  zoom: Zoom
  setZoom: (z: Zoom) => void
}

/**
 * Zoom-aware preview surface. The inner rasterization target (the
 * unscaled 720px-wide template render) is exposed via a forwarded ref
 * so the export pipeline can capture it at native resolution; the
 * outer wrapper handles scaling, paper-toned backdrop, and per-pane
 * scroll.
 */
export const PreviewPane = forwardRef<HTMLDivElement, Props>(function PreviewPane(
  { convo, opts, zoom, setZoom },
  ref,
) {
  const ratio = TEMPLATE_RATIO[opts.template]
  const fit = fitScale(ratio.w)
  const scale = zoom === 'fit' ? fit : zoom

  const innerRef = useRef<HTMLDivElement>(null)
  const [naturalH, setNaturalH] = useState(ratio.h)
  useLayoutEffect(() => {
    if (!innerRef.current) return
    setNaturalH(Math.max(ratio.h, innerRef.current.scrollHeight))
  }, [convo, opts, ratio.h])

  const handleIn = () => setZoom(nextZoomStep(scale, 1))
  const handleOut = () => setZoom(nextZoomStep(scale, -1))
  const handleFit = () => setZoom('fit')

  // Stash the live ratio onto the forwarded ref's parent target via
  // useImperativeHandle pattern — but since we just need the unscaled
  // 720px node for export, we forward the ref directly to innerRef
  // (the wrapped TemplateRender at natural size).
  const setRefs = (el: HTMLDivElement | null) => {
    innerRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  return (
    <div className="relative flex-1 min-w-0 flex">
      <div className="flex-1 overflow-auto scrollbar-none relative bg-warm-bg dark:bg-dark-bg">
        <div
          className="relative px-10 py-8 flex flex-col items-center gap-3.5"
          style={{ margin: '0 auto', width: 'fit-content', minWidth: '100%', boxSizing: 'border-box' }}
        >
          {/* Header chrome above the canvas — template name + dims. */}
          <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-[0.08em] font-mono text-warm-muted dark:text-dark-muted">
            <span className="w-4 h-px bg-warm-border dark:bg-dark-border" />
            {TEMPLATES.find((x) => x.id === opts.template)?.name} · {ratio.w}×{Math.round(naturalH)}
            <span className="w-4 h-px bg-warm-border dark:bg-dark-border" />
          </div>
          {/* Scaled canvas — width/height transition for smooth zoom.
              The transform lives on a wrapper around the export-ref
              target, so the ref points at the untransformed natural-
              size node. That keeps export pipelines (PNG, PDF clone)
              from picking up the live preview's `scale(0.7)` and
              shipping a tiny artifact on the left of the page.
              Transitions stay off until the pane width is measured —
              otherwise the first paint at fallback scale visibly
              animates into the real scale, looking like a double zoom. */}
          <div
            className="relative overflow-hidden"
            style={{
              width: ratio.w * scale,
              height: naturalH * scale,
              boxShadow: '0 2px 6px rgba(0,0,0,.1), 0 20px 50px rgba(0,0,0,.08)',
              borderRadius: 2,
              transition: 'width 220ms cubic-bezier(.2,.8,.2,1), height 220ms cubic-bezier(.2,.8,.2,1)',
            }}
          >
            <div
              style={{
                width: ratio.w,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                transition: 'transform 220ms cubic-bezier(.2,.8,.2,1)',
                willChange: 'transform',
              }}
            >
              <div ref={setRefs} style={{ width: ratio.w }}>
                <TemplateRender template={opts.template} convo={convo} opts={opts} />
              </div>
            </div>
          </div>
          {/* Footer chrome below. */}
          <div className="text-[10px] font-mono tracking-[0.04em] text-warm-faint dark:text-dark-muted">
            1 / 1 · {convo.wordCount.toLocaleString()} words
          </div>
        </div>
      </div>
      <ZoomControl
        percent={Math.round(scale * 100)}
        isFit={zoom === 'fit'}
        onIn={handleIn}
        onOut={handleOut}
        onFit={handleFit}
      />
    </div>
  )
})

type ZoomControlProps = {
  percent: number
  isFit: boolean
  onIn: () => void
  onOut: () => void
  onFit: () => void
}

function ZoomControl({ percent, isFit, onIn, onOut, onFit }: ZoomControlProps) {
  const minPercent = ZOOM_STEPS[0]! * 100
  const maxPercent = ZOOM_STEPS[ZOOM_STEPS.length - 1]! * 100
  return (
    <div className="absolute right-4 bottom-4 z-20 flex items-center gap-0.5 px-1 h-7 rounded-md bg-warm-surface dark:bg-dark-surface shadow-sm text-[11px] text-warm-text dark:text-dark-text">
      <ZoomBtn label="−" onClick={onOut} ariaLabel="Zoom out" disabled={percent <= minPercent} />
      <span className="min-w-[34px] text-center select-none text-warm-text dark:text-dark-text tabular-nums">
        {percent}%
      </span>
      <ZoomBtn label="+" onClick={onIn} ariaLabel="Zoom in" disabled={percent >= maxPercent} />
      <button
        type="button"
        onClick={onFit}
        aria-label="Zoom to fit"
        aria-pressed={isFit}
        className={`px-2 h-5 rounded transition-colors ${
          isFit
            ? 'text-accent dark:text-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
            : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2'
        }`}
      >
        Fit
      </button>
    </div>
  )
}

function ZoomBtn({
  label,
  onClick,
  ariaLabel,
  disabled,
}: {
  label: string
  onClick: () => void
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`w-5 h-5 grid place-items-center rounded text-[13px] leading-none ${
        disabled
          ? 'text-warm-faint dark:text-dark-muted cursor-default'
          : 'text-warm-muted dark:text-dark-muted hover:text-warm-text dark:hover:text-dark-text hover:bg-warm-surface2 dark:hover:bg-dark-surface2 cursor-pointer'
      }`}
    >
      {label}
    </button>
  )
}
