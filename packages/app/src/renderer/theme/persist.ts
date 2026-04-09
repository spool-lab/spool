import {
  type ThemeEditorStateV1,
  type ThemeSideConfig,
  THEME_EDITOR_STORAGE_KEY,
  LEGACY_DARK_PALETTE_KEY,
  THEME_PRESETS,
  defaultThemeEditorState,
} from './editorTypes.js'
import { darkPresetSeed } from './presetSeeds.js'

const KNOWN_PRESETS = new Set<string>(THEME_PRESETS)

function normalizePresetId(raw: string): string {
  const p = raw === 'forest' ? 'everforest' : raw
  return KNOWN_PRESETS.has(p) ? p : 'custom'
}

export function normalizeSide(partial: Partial<ThemeSideConfig> | undefined, fallback: ThemeSideConfig): ThemeSideConfig {
  if (!partial || typeof partial !== 'object') return { ...fallback }
  const presetRaw = typeof partial.preset === 'string' ? partial.preset : fallback.preset
  return {
    preset: normalizePresetId(presetRaw),
    accent: typeof partial.accent === 'string' ? partial.accent : fallback.accent,
    background: typeof partial.background === 'string' ? partial.background : fallback.background,
    foreground: typeof partial.foreground === 'string' ? partial.foreground : fallback.foreground,
    uiFont: typeof partial.uiFont === 'string' ? partial.uiFont : fallback.uiFont,
    codeFont: typeof partial.codeFont === 'string' ? partial.codeFont : fallback.codeFont,
    translucentChrome: typeof partial.translucentChrome === 'boolean' ? partial.translucentChrome : fallback.translucentChrome,
    contrast: typeof partial.contrast === 'number' && Number.isFinite(partial.contrast)
      ? Math.max(0, Math.min(100, Math.round(partial.contrast)))
      : fallback.contrast,
  }
}

export function normalizeThemeEditorState(raw: unknown): ThemeEditorStateV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o['v'] !== 1) return null
  const base = defaultThemeEditorState()
  return {
    v: 1,
    light: normalizeSide(o['light'] as Partial<ThemeSideConfig>, base.light),
    dark: normalizeSide(o['dark'] as Partial<ThemeSideConfig>, base.dark),
  }
}

/** Merge loose import (e.g. partial JSON) onto current state. */
export function mergeThemeImportLoose(raw: unknown, current: ThemeEditorStateV1): ThemeEditorStateV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const next: ThemeEditorStateV1 = {
    v: 1,
    light: normalizeSide((o['light'] as Partial<ThemeSideConfig>) ?? {}, current.light),
    dark: normalizeSide((o['dark'] as Partial<ThemeSideConfig>) ?? {}, current.dark),
  }
  return next
}

export async function loadThemeEditorState(): Promise<ThemeEditorStateV1> {
  try {
    const raw = window.localStorage.getItem(THEME_EDITOR_STORAGE_KEY)
    if (raw) {
      const parsed = normalizeThemeEditorState(JSON.parse(raw))
      if (parsed) return parsed
    }
    const next = defaultThemeEditorState()
    const legacy = window.localStorage.getItem(LEGACY_DARK_PALETTE_KEY)
    if (legacy === 'forest') {
      next.dark = darkPresetSeed('everforest', next.dark)
    }
    return next
  } catch {
    return defaultThemeEditorState()
  }
}

export async function saveThemeEditorState(state: ThemeEditorStateV1): Promise<void> {
  window.localStorage.setItem(THEME_EDITOR_STORAGE_KEY, JSON.stringify(state))
}
