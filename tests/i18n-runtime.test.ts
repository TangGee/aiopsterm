import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { localeDirection, localeMessages, resolveLocale, supportedLocales, translateWithLocale } from '../src/renderer/src/i18n'
import { hasStaticTextTranslation, installStaticTextI18n, translateStaticText } from '../src/renderer/src/i18n/staticText'

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

  it('keeps placeholders aligned across locales', () => {
    const placeholderPattern = /\{[a-zA-Z0-9_]+\}/g
    for (const key of Object.keys(localeMessages['zh-CN']) as Array<keyof (typeof localeMessages)['zh-CN']>) {
      const expected = [...localeMessages['zh-CN'][key].matchAll(placeholderPattern)].map((match) => match[0]).sort()
      for (const locale of supportedLocales) {
        const actual = [...localeMessages[locale][key].matchAll(placeholderPattern)].map((match) => match[0]).sort()
        expect(actual, `${locale}:${key}`).toEqual(expected)
      }
    }
  })

  it('does not let non-base locale files spread another locale object directly', () => {
    for (const file of ['arAR', 'deDE', 'frFR', 'itIT', 'jaJP', 'koKR', 'ptPT', 'ruRU', 'zhTW']) {
      const source = readFileSync(join(process.cwd(), 'src', 'renderer', 'src', 'i18n', 'locales', `${file}.ts`), 'utf8')
      expect(source).not.toMatch(/\.\.\.(enUS|zhCN)/)
      expect(source).toContain('completeLocaleMessages')
    }
  })

  it('keeps Traditional Chinese fallback on the Chinese base locale', () => {
    expect(localeMessages['zh-TW']['common.add']).toBe(localeMessages['zh-CN']['common.add'])
    expect(localeMessages['zh-TW']['common.add']).not.toBe(localeMessages['en-US']['common.add'])
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

  it('translates legacy static renderer text through the static catalog', () => {
    expect(translateStaticText('en-US', '关闭其他')).toBe('close others')
    expect(translateStaticText('en-US', '选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。')).toContain('Kubernetes resource')
    expect(translateStaticText('zh-TW', '显示主机名')).toBe('顯示主機名稱')
    expect(hasStaticTextTranslation('账号中心服务不可用')).toBe(true)
  })

  it('restores static text when switching back to Chinese', () => {
    let locale: (typeof supportedLocales)[number] = 'en-US'
    const root = document.createElement('section')
    root.innerHTML = '<button title="关闭">关闭其他</button>'
    document.body.append(root)
    const runtime = installStaticTextI18n({ root, locale: () => locale })

    runtime.refresh()
    expect(root.textContent).toBe('close others')
    expect(root.querySelector('button')?.getAttribute('title')).toBe('Close')

    locale = 'zh-CN'
    runtime.refresh()
    expect(root.textContent).toBe('关闭其他')
    expect(root.querySelector('button')?.getAttribute('title')).toBe('关闭')

    runtime.dispose()
    root.remove()
  })
})
