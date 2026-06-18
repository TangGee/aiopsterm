import { computed } from 'vue'
import { localeDisplayNames, localeMessages, supportedLocales, type I18nKey, type LocaleMessages, type LocaleSetting, type SupportedLocale } from './messages'
import { applyDocumentLocale, isLocaleSetting, isSupportedLocale, localeDirection, resolveLocale, translateWithLocale } from './runtime'
import { useWorkspaceStore } from '@/stores/workspace'

export { applyDocumentLocale, isLocaleSetting, isSupportedLocale, localeDirection, localeDisplayNames, localeMessages, resolveLocale, supportedLocales, translateWithLocale }
export type { I18nKey, LocaleMessages, LocaleSetting, SupportedLocale }

export const useI18n = () => {
  const workspace = useWorkspaceStore()
  const locale = computed(() => resolveLocale(workspace.config.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]))
  const direction = computed(() => localeDirection(locale.value))
  const t = (key: I18nKey, params?: Record<string, string | number>) => {
    const template = translateWithLocale(locale.value, key)
    if (!params) return template
    return Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), template)
  }
  return {
    locale,
    direction,
    t
  }
}
