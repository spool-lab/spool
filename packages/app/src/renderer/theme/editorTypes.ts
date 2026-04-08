/** Persisted theme editor payload (Settings → Appearance). */

export const THEME_EDITOR_STORAGE_KEY = 'spool_theme_editor'
export const LEGACY_DARK_PALETTE_KEY = 'spool_dark_palette'

export interface ThemeSideConfig {
  /** Last selected preset; switches to `custom` when user edits colors. */
  preset: string
  accent: string
  background: string
  foreground: string
  uiFont: string
  codeFont: string
  translucentChrome: boolean
  /** 0 = softer secondary text, 100 = stronger separation from background */
  contrast: number
}

export interface ThemeEditorStateV1 {
  v: 1
  light: ThemeSideConfig
  dark: ThemeSideConfig
}

/** Same palette names on light and dark sides (each side applies its own hex set). */
export const THEME_PRESETS = ['spool', 'solarized', 'everforest', 'custom'] as const
export type ThemePresetId = (typeof THEME_PRESETS)[number]

/** @deprecated Use THEME_PRESETS — kept for imports that expect separate lists */
export const LIGHT_PRESETS = THEME_PRESETS
export const DARK_PRESETS = THEME_PRESETS

export function defaultLightSide(): ThemeSideConfig {
  return {
    preset: 'spool',
    accent: '#C85A00',
    background: '#FAFAF8',
    foreground: '#1C1C18',
    uiFont: 'Geist Variable',
    codeFont: 'Geist Mono',
    translucentChrome: false,
    contrast: 45,
  }
}

export function defaultDarkSide(): ThemeSideConfig {
  return {
    preset: 'spool',
    accent: '#F07020',
    background: '#141410',
    foreground: '#F2F2EC',
    uiFont: 'Geist Variable',
    codeFont: 'Geist Mono',
    translucentChrome: false,
    contrast: 45,
  }
}

export function defaultThemeEditorState(): ThemeEditorStateV1 {
  return { v: 1, light: defaultLightSide(), dark: defaultDarkSide() }
}
