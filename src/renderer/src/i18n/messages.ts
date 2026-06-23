import { zhCN } from './locales/zhCN'

export const supportedLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'pt-PT', 'ru-RU', 'ar-AR'] as const

export type SupportedLocale = (typeof supportedLocales)[number]
export type LocaleSetting = SupportedLocale | 'system'

export const localeDisplayNames: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français',
  'it-IT': 'Italiano',
  'pt-PT': 'Português',
  'ru-RU': 'Русский',
  'ar-AR': 'العربية'
}

export type I18nKey = keyof typeof zhCN
export type LocaleMessages = Record<I18nKey, string>

export { localeMessages } from './locales'
