import { describe, expect, it } from 'vitest'
import { localeDirection, localeMessages, resolveLocale, supportedLocales, translateWithLocale } from '../src/renderer/src/i18n'

const external-referenceSupportedLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'it-IT', 'pt-PT', 'ru-RU', 'ar-AR']

describe('renderer i18n runtime', () => {
  it('matches the External reference-supported locale set', () => {
    expect([...supportedLocales]).toEqual(external-referenceSupportedLocales)
  })

  it('keeps every locale complete against zh-CN keys', () => {
    const requiredKeys = Object.keys(localeMessages['zh-CN'])
    for (const locale of supportedLocales) {
      expect(Object.keys(localeMessages[locale]).sort()).toEqual([...requiredKeys].sort())
    }
  })

  it('resolves explicit and system locale settings with fallback', () => {
    expect(resolveLocale('en-US', ['zh-CN'])).toBe('en-US')
    expect(resolveLocale('system', ['fr-CA', 'en-US'])).toBe('fr-FR')
    expect(resolveLocale('system', ['zh-HK'])).toBe('zh-TW')
    expect(resolveLocale('unsupported', ['xx-YY'])).toBe('zh-CN')
  })

  it('translates core shell labels and sets RTL only for Arabic', () => {
    expect(translateWithLocale('en-US', 'settings.nav.general')).toBe('General')
    expect(translateWithLocale('ja-JP', 'module.workspace')).toBe('ワークスペース')
    expect(localeDirection('ar-AR')).toBe('rtl')
    expect(localeDirection('en-US')).toBe('ltr')
  })
})
