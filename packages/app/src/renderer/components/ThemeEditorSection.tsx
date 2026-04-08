import { useEffect, useState } from 'react'
import type { ThemeEditorStateV1, ThemeSideConfig } from '../theme/editorTypes.js'
import { THEME_PRESETS } from '../theme/editorTypes.js'
import { lightPresetSeed, darkPresetSeed } from '../theme/presetSeeds.js'
import { parseHex, toHex, adaptiveCardTone, hexToRgba, mixHex } from '../theme/colorUtils.js'
import SegmentedPill from './SegmentedPill.js'

function colorInputValue(hex: string): string {
  const parsed = parseHex(hex)
  return parsed ? toHex(parsed) : '#888888'
}

const sideInputBase =
  'rounded-full border outline-none transition-colors focus-visible:ring-1 focus-visible:ring-offset-0 focus-visible:ring-[var(--side-accent)]'

function tintForValue(hex: string) {
  const tone = adaptiveCardTone(hex)
  return {
    backgroundColor: hex,
    borderColor: hexToRgba(tone.isLight ? '#000000' : '#FFFFFF', 0.16),
    color: tone.primary,
  }
}

function ColorRow(props: {
  id: string
  label: string
  value: string
  tone: ReturnType<typeof adaptiveCardTone>
  onChange: (next: string) => void
  /** Match outer card border — divide-y ignores parent borderColor (not inherited). */
  showTopRule?: boolean
  ruleColor: string
}) {
  const { id, label, value, tone, onChange, showTopRule, ruleColor } = props
  const swatch = tintForValue(colorInputValue(value))

  return (
    <div
      className={`grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-3 ${showTopRule ? 'border-t border-solid' : ''}`}
      style={showTopRule ? { borderTopColor: ruleColor } : undefined}
    >
      <label
        htmlFor={`${id}-hex`}
        className="text-[11px] font-medium"
        style={{ color: tone.primary }}
      >
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative h-9 w-9 flex-none">
          <input
            id={`${id}-picker`}
            name={`${id}-picker`}
            type="color"
            value={colorInputValue(value)}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={`${label} color`}
          />
          <div className="h-full w-full rounded-full border shadow-sm" style={swatch} />
        </div>
        <input
          id={`${id}-hex`}
          name={`${id}-hex`}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className={`h-9 min-w-0 flex-1 px-3 font-mono text-[11px] ${sideInputBase}`}
          style={swatch}
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  )
}

function SideBlock(props: {
  title: string
  mode: 'light' | 'dark'
  slot: ThemeSideConfig
  onSlotChange: (next: ThemeSideConfig) => void
}) {
  const { title, mode, slot, onSlotChange } = props

  const patch = (partial: Partial<ThemeSideConfig>) => {
    const next = { ...slot, ...partial }
    if (partial.accent != null || partial.background != null || partial.foreground != null) {
      if (next.preset !== 'custom') next.preset = 'custom'
    }
    onSlotChange(next)
  }

  const onPreset = (value: string) => {
    if (value === 'custom') {
      onSlotChange({ ...slot, preset: 'custom' })
      return
    }
    if (mode === 'light') {
      if (value === 'spool') onSlotChange(lightPresetSeed('spool', slot))
      else if (value === 'solarized') onSlotChange(lightPresetSeed('solarized', slot))
      else if (value === 'everforest') onSlotChange(lightPresetSeed('everforest', slot))
    } else {
      if (value === 'spool') onSlotChange(darkPresetSeed('spool', slot))
      else if (value === 'solarized') onSlotChange(darkPresetSeed('solarized', slot))
      else if (value === 'everforest') onSlotChange(darkPresetSeed('everforest', slot))
    }
  }

  const normalizedPreset = slot.preset === 'forest' ? 'everforest' : slot.preset
  const presetValue =
    THEME_PRESETS.includes(normalizedPreset as (typeof THEME_PRESETS)[number])
      ? normalizedPreset
      : 'custom'

  const tone = adaptiveCardTone(slot.background)
  const prefix = `theme-${mode}`
  const surface = mixHex(slot.background, slot.foreground, mode === 'light' ? 0.035 : 0.05)
  /**
   * Card outline + internal rules: same mix as DESIGN.md dividers (subtle fg on bg),
   * not Tailwind defaults (divide-y would ignore parent inline borderColor).
   */
  const divider = mixHex(slot.background, slot.foreground, mode === 'light' ? 0.1 : 0.11)
  const fieldBg = mixHex(slot.background, slot.foreground, mode === 'light' ? 0.06 : 0.12)

  return (
    <section
      className="mb-4 overflow-hidden rounded-[10px] border"
      style={{
        ['--side-accent' as string]: slot.accent,
        borderColor: divider,
        backgroundColor: slot.background,
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
        style={{
          borderColor: divider,
          backgroundColor: surface,
        }}
      >
        <div className="min-w-0">
          <h4 className="text-xs font-semibold" style={{ color: tone.primary }}>{title}</h4>
        </div>
        <div className="relative min-w-[168px]">
          <select
            id={`${prefix}-preset`}
            name={`${prefix}-preset`}
            value={presetValue}
            onChange={(e) => onPreset(e.target.value)}
            className={`h-9 w-full appearance-none pl-3 pr-9 text-[11px] font-medium ${sideInputBase}`}
            style={{
              backgroundColor: fieldBg,
              borderColor: divider,
              color: tone.primary,
            }}
            aria-label={`${title} preset`}
          >
            <>
              <option value="spool">Spool</option>
              <option value="solarized">Solarized</option>
              <option value="everforest">Everforest</option>
              <option value="custom">Custom</option>
            </>
          </select>
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2"
            fill="none"
            style={{ color: tone.muted }}
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <div className="flex flex-col">
        <ColorRow
          id={`${prefix}-accent`}
          label="Accent"
          value={slot.accent}
          tone={tone}
          ruleColor={divider}
          onChange={(next) => patch({ accent: next })}
        />
        <ColorRow
          id={`${prefix}-background`}
          label="Background"
          value={slot.background}
          tone={tone}
          showTopRule
          ruleColor={divider}
          onChange={(next) => patch({ background: next })}
        />
        <ColorRow
          id={`${prefix}-foreground`}
          label="Foreground"
          value={slot.foreground}
          tone={tone}
          showTopRule
          ruleColor={divider}
          onChange={(next) => patch({ foreground: next })}
        />

        <div
          className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 border-t border-solid px-4 py-3"
          style={{ borderTopColor: divider }}
        >
          <label
            htmlFor={`${prefix}-contrast`}
            className="text-[11px] font-medium"
            style={{ color: tone.primary }}
          >
            Contrast
          </label>
          <div className="flex items-center gap-3">
            <input
              id={`${prefix}-contrast`}
              name={`${prefix}-contrast`}
              type="range"
              min={0}
              max={100}
              value={slot.contrast}
              onChange={(e) => onSlotChange({ ...slot, contrast: Number(e.target.value) })}
              className="w-full"
              style={{ accentColor: slot.accent }}
            />
            <span className="w-8 text-right font-mono text-[11px] tabular-nums" style={{ color: tone.faint }}>
              {slot.contrast}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function ThemeEditorSection(props: {
  state: ThemeEditorStateV1
  onChange: (s: ThemeEditorStateV1) => void
  themeSource: 'system' | 'light' | 'dark'
  onThemeMode: (m: 'system' | 'light' | 'dark') => void | Promise<void>
}) {
  const { state, onChange, themeSource, onThemeMode } = props
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const preferredMode =
    themeSource === 'system'
      ? (systemDark ? 'dark' : 'light')
      : themeSource

  const orderedSides = preferredMode === 'dark'
    ? ([
        {
          title: 'Dark Theme',
          mode: 'dark' as const,
          slot: state.dark,
          onSlotChange: (dark: ThemeSideConfig) => onChange({ ...state, dark }),
        },
        {
          title: 'Light Theme',
          mode: 'light' as const,
          slot: state.light,
          onSlotChange: (light: ThemeSideConfig) => onChange({ ...state, light }),
        },
      ])
    : ([
        {
          title: 'Light Theme',
          mode: 'light' as const,
          slot: state.light,
          onSlotChange: (light: ThemeSideConfig) => onChange({ ...state, light }),
        },
        {
          title: 'Dark Theme',
          mode: 'dark' as const,
          slot: state.dark,
          onSlotChange: (dark: ThemeSideConfig) => onChange({ ...state, dark }),
        },
      ])

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-[11px] font-medium text-warm-faint dark:text-dark-muted tracking-[0.04em] uppercase">
          Theme
        </h4>
        <SegmentedPill
          value={themeSource}
          onChange={(value) => {
            void onThemeMode(value)
          }}
          ariaLabel="Theme mode"
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
      </div>

      {orderedSides.map((side) => (
        <SideBlock
          key={side.mode}
          title={side.title}
          mode={side.mode}
          slot={side.slot}
          onSlotChange={side.onSlotChange}
        />
      ))}

    </div>
  )
}
