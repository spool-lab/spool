import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

export type SupportedLocale = 'en' | 'zh-CN' | 'zh-TW'
export type LanguagePreference = 'system' | SupportedLocale

export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'zh-CN', 'zh-TW']

const STORAGE_KEY = 'spool:lang-cache'

/**
 * Last-resort cache so the very first paint after a locale change (or app
 * restart) doesn't flash English while the config IPC is in flight. Synced
 * to localStorage on every `applyLanguage` call.
 */
function readCachedLocale(): SupportedLocale | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'en' || v === 'zh-CN' || v === 'zh-TW') return v
  } catch { /* localStorage disabled — ignore */ }
  return null
}

function writeCachedLocale(locale: SupportedLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch { /* ignore */ }
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      'zh-TW': { translation: zhTW },
    },
    // Initial language: cached value if available, else en. The renderer
    // will call `applyLanguage` once it resolves the user's preference.
    lng: readCachedLocale() ?? 'en',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  })
  .catch((err) => {
    console.error('[i18n] init failed', err)
  })

/**
 * Resolves a `LanguagePreference` (which may be `'system'`) plus a system
 * locale into a concrete supported locale.
 */
export function resolveLocale(
  pref: LanguagePreference | undefined,
  systemLocale: SupportedLocale,
): SupportedLocale {
  if (!pref || pref === 'system') return systemLocale
  return pref
}

/**
 * Apply a locale to the i18n instance and reflect it on <html lang> for
 * accessibility + locale-aware CSS (e.g. CJK-aware font stacks). Cheap to
 * call repeatedly — i18next no-ops when the language is unchanged.
 */
export function applyLanguage(locale: SupportedLocale): void {
  if (i18n.language !== locale) {
    void i18n.changeLanguage(locale)
  }
  if (typeof document !== 'undefined' && document.documentElement.lang !== locale) {
    document.documentElement.lang = locale
  }
  writeCachedLocale(locale)
}

export default i18n
