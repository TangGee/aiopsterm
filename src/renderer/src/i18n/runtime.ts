import { localeMessages, supportedLocales, type I18nKey, type LocaleSetting, type SupportedLocale } from './messages'

const fallbackLocale: SupportedLocale = 'zh-CN'

export const isSupportedLocale = (value: unknown): value is SupportedLocale =>
  typeof value === 'string' && supportedLocales.includes(value as SupportedLocale)

export const isLocaleSetting = (value: unknown): value is LocaleSetting => value === 'system' || isSupportedLocale(value)

const normalizeNavigatorLocale = (value: string): SupportedLocale | null => {
  const normalized = value.replace('_', '-')
  if (isSupportedLocale(normalized)) return normalized
  const language = normalized.split('-')[0]?.toLowerCase()
  if (language === 'zh') return normalized.toLowerCase().includes('tw') || normalized.toLowerCase().includes('hk') ? 'zh-TW' : 'zh-CN'
  return supportedLocales.find((locale) => locale.toLowerCase().startsWith(`${language}-`)) || null
}

export const resolveLocale = (setting: unknown, navigatorLanguages: readonly string[] = []): SupportedLocale => {
  if (isSupportedLocale(setting)) return setting
  const detected = navigatorLanguages.map(normalizeNavigatorLocale).find(Boolean)
  return detected || fallbackLocale
}

export const localeDirection = (locale: SupportedLocale) => (locale === 'ar-AR' ? 'rtl' : 'ltr')

export const translateWithLocale = (locale: SupportedLocale, key: I18nKey) => localeMessages[locale]?.[key] || localeMessages[fallbackLocale][key] || key

export const applyDocumentLocale = (locale: SupportedLocale) => {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.documentElement.dir = localeDirection(locale)
}
