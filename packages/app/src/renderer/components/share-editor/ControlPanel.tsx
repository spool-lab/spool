import { useState } from 'react'
import {
  COLORWAYS,
  PAPERS,
  TEMPLATES,
  TYPEFACES,
  type EditorOpts,
  type Paper,
  type Typeface,
} from '@spool/share-kit'
import { TemplateThumb } from './TemplateThumb.js'

// Curated subset of share-kit's option sets so the panel feels
// editorial-curated rather than "every variation we've ever shipped".
// share-kit still exports the full lists (5 each) for spool.share web
// and other hosts that may want broader range.
const TEMPLATE_IDS = new Set(['chat', 'letter', 'atelier', 'interview'] as const)
const PAPER_IDS = new Set(['bone', 'snow', 'graphite', 'ink'] as const)
const TYPEFACE_IDS = new Set(['geist', 'grotesk', 'instrument', 'garamond'] as const)
const COLORWAY_IDS = new Set(['amber', 'iris', 'moss', 'ink'] as const)
const TEMPLATE_CHOICES = TEMPLATES.filter((t) => (TEMPLATE_IDS as Set<string>).has(t.id))
const PAPER_CHOICES = PAPERS.filter((p) => (PAPER_IDS as Set<string>).has(p.id))
const TYPEFACE_CHOICES = TYPEFACES.filter((t) => (TYPEFACE_IDS as Set<string>).has(t.id))
const COLORWAY_CHOICES = COLORWAYS.filter((c) => (COLORWAY_IDS as Set<string>).has(c.id))

type Props = {
  opts: EditorOpts
  setOpts: (next: EditorOpts) => void
}

export function ControlPanel({ opts, setOpts }: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const currentColor = COLORWAY_CHOICES.find((c) => c.id === opts.colorway) ?? COLORWAY_CHOICES[0]!
  const currentPaper = PAPER_CHOICES.find((p) => p.id === opts.paper) ?? PAPER_CHOICES[0]!
  const currentTypeface = TYPEFACE_CHOICES.find((t) => t.id === opts.typeface) ?? TYPEFACE_CHOICES[0]!

  return (
    <aside
      data-testid="share-editor-style-panel"
      className="w-full h-full bg-warm-surface dark:bg-dark-surface overflow-y-auto scrollbar-none flex flex-col"
    >
      {/* First section's header lives in an h-9 row so it sits in the
          same vertical band as the AppTopBar to the left — TEMPLATE
          label visually aligns with Export. */}
      <div className="flex-none h-9 px-4 flex items-center justify-between">
        <div className="text-[11px] font-medium tracking-[0.08em] uppercase text-warm-muted dark:text-dark-muted leading-none">
          Template
        </div>
        <div className="text-[11px] text-warm-faint dark:text-dark-muted leading-none">
          {TEMPLATE_CHOICES.length} looks
        </div>
      </div>
      <div className="px-4 pb-4">
        <div className="flex flex-col gap-1.5">
          {TEMPLATE_CHOICES.map((tpl) => {
            const active = opts.template === tpl.id
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setOpts({ ...opts, template: tpl.id })}
                className={`flex items-center gap-2.5 text-left px-2.5 py-2 rounded-md border transition-colors focus:outline-none ${
                  active
                    ? 'border-accent dark:border-accent-dark bg-accent-bg dark:bg-accent-bg-dark'
                    : 'border-warm-border dark:border-dark-border bg-warm-bg dark:bg-dark-bg hover:border-warm-faint/50 dark:hover:border-dark-muted/40'
                }`}
              >
                <TemplateThumb
                  id={tpl.id}
                  accent={opts.accentHex}
                  paper={currentPaper.tokens.paper}
                  border={currentPaper.tokens.border}
                  text={currentPaper.tokens.text}
                  muted={currentPaper.tokens.muted}
                  surface={currentPaper.tokens.surface}
                />
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[13px] font-medium ${
                      active ? 'text-accent dark:text-accent-dark' : 'text-warm-text dark:text-dark-text'
                    }`}
                  >
                    {tpl.name}
                  </div>
                  <div className="text-[10.5px] text-warm-muted dark:text-dark-muted font-mono leading-snug mt-0.5 truncate">
                    {tpl.blurb}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <Section label="Paper" hint={currentPaper.name}>
        <PaperPicker value={opts.paper} onChange={(p) => setOpts({ ...opts, paper: p })} />
      </Section>

      <Section label="Typeface" hint={currentTypeface.name}>
        <TypefacePicker value={opts.typeface} onChange={(tf) => setOpts({ ...opts, typeface: tf })} />
      </Section>

      <Section label="Colorway" hint={currentColor.name}>
        <div className="flex items-center gap-3">
          {COLORWAY_CHOICES.map((c) => {
            const active = opts.colorway === c.id
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpts({ ...opts, colorway: c.id, accentHex: c.swatch })}
                title={c.name}
                aria-label={c.name}
                className="w-6 h-6 rounded-full p-0 focus:outline-none"
                style={{
                  background: c.swatch,
                  boxShadow: active
                    ? `inset 0 0 0 2px var(--color-warm-text), 0 0 0 2px var(--color-warm-surface), 0 0 0 4px ${c.swatch}`
                    : 'none',
                }}
              />
            )
          })}
        </div>
      </Section>


      <Collapsible
        label="More options"
        open={advancedOpen}
        onToggle={() => setAdvancedOpen(!advancedOpen)}
      >
        <div className="flex items-center justify-between py-2">
          <span className="text-[12px] text-warm-text/85 dark:text-dark-text/85">Density</span>
          <div className="flex gap-1">
            <Chip active={opts.density === 'compact'} onClick={() => setOpts({ ...opts, density: 'compact' })}>
              Compact
            </Chip>
            <Chip active={opts.density === 'relaxed'} onClick={() => setOpts({ ...opts, density: 'relaxed' })}>
              Relaxed
            </Chip>
          </div>
        </div>
        <Toggle
          label="Gap markers"
          sub="Show ⋯ where turns are skipped"
          value={opts.showGaps}
          onChange={(v) => setOpts({ ...opts, showGaps: v })}
        />
        <Toggle
          label="Show source mark"
          sub="Small glyph next to assistant turns"
          value={opts.avatars}
          onChange={(v) => setOpts({ ...opts, avatars: v })}
        />
        <Toggle
          label="Masthead"
          sub="Spool wordmark and template label on top"
          value={opts.showMasthead}
          onChange={(v) => setOpts({ ...opts, showMasthead: v })}
        />
        <Toggle
          label="Colophon"
          sub='"Stitched on Spool" footer'
          value={opts.showColophon}
          onChange={(v) => setOpts({ ...opts, showColophon: v })}
        />
      </Collapsible>
    </aside>
  )
}

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-medium tracking-[0.08em] uppercase text-warm-muted dark:text-dark-muted leading-none">
          {label}
        </div>
        {hint && <div className="text-[11px] text-warm-faint dark:text-dark-muted leading-none">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Collapsible({
  label,
  open,
  onToggle,
  hint,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full text-left px-4 py-3.5 flex items-center justify-between hover:bg-warm-surface2/60 dark:hover:bg-dark-surface2/60 transition-colors"
      >
        <span className="text-[11px] font-medium tracking-[0.08em] uppercase text-warm-muted dark:text-dark-muted">
          {label}
        </span>
        <span className="flex items-center gap-2.5">
          {hint && <span className="text-[10px] font-mono">{hint}</span>}
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-warm-muted dark:text-dark-muted transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          >
            <path d="M2 4l3.5 3.5L9 4" />
          </svg>
        </span>
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  )
}

function Toggle({
  label,
  sub,
  value,
  onChange,
}: {
  label: string
  sub?: string
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-2 gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[12px] text-warm-text/85 dark:text-dark-text/85">{label}</div>
        {sub && <div className="text-[11px] text-warm-faint dark:text-dark-muted mt-0.5">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative flex-none w-8 h-[18px] rounded-full transition-colors focus:outline-none ${
          value ? 'bg-accent dark:bg-accent-dark' : 'bg-warm-border dark:bg-dark-border'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-[2px] block w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all ${
            value ? 'left-[16px]' : 'left-[2px]'
          }`}
        />
      </button>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[11.5px] border transition-colors focus:outline-none ${
        active
          ? 'bg-accent-bg dark:bg-accent-bg-dark border-accent dark:border-accent-dark text-accent dark:text-accent-dark font-medium'
          : 'border-transparent text-warm-muted dark:text-dark-muted hover:bg-warm-surface2 dark:hover:bg-dark-surface2 hover:text-warm-text dark:hover:text-dark-text'
      }`}
    >
      {children}
    </button>
  )
}


function TypefacePicker({ value, onChange }: { value: Typeface; onChange: (next: Typeface) => void }) {
  return (
    <div className="flex gap-1.5">
      {TYPEFACE_CHOICES.map((tf) => {
        const active = tf.id === value
        return (
          <button
            key={tf.id}
            type="button"
            onClick={() => onChange(tf.id)}
            title={tf.name}
            aria-label={tf.name}
            className={`flex-1 h-10 rounded-md flex items-center justify-center transition-colors focus:outline-none border ${
              active
                ? 'bg-accent-bg dark:bg-accent-bg-dark border-accent dark:border-accent-dark'
                : 'bg-warm-bg dark:bg-dark-bg border-warm-border dark:border-dark-border hover:border-warm-faint/50 dark:hover:border-dark-muted/50'
            }`}
          >
            <span
              className={`text-[16px] leading-none ${
                active ? 'text-accent dark:text-accent-dark' : 'text-warm-text/85 dark:text-dark-text/85'
              }`}
              style={{ fontFamily: tf.family, letterSpacing: '-0.02em' }}
            >
              {tf.sample}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PaperPicker({ value, onChange }: { value: Paper; onChange: (next: Paper) => void }) {
  return (
    <div className="flex gap-2.5">
      {PAPER_CHOICES.map((p) => {
        const active = p.id === value
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            title={p.name}
            aria-label={p.name}
            className="w-11 h-8 rounded-md flex items-center justify-center p-0 focus:outline-none"
            style={{
              background: p.tokens.paper,
              boxShadow: active
                ? `0 0 0 2px var(--color-warm-surface), 0 0 0 3px var(--color-accent)`
                : `inset 0 0 0 1px ${p.tokens.border}`,
            }}
          >
            <span
              className="text-[12px] font-semibold pointer-events-none"
              style={{ color: p.tokens.text, letterSpacing: '-0.02em' }}
            >
              Aa
            </span>
          </button>
        )
      })}
    </div>
  )
}
