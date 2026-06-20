import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'

type SettingsPreferencesBridge = Pick<
  AiopsPreloadApi,
  'getSettingsPreferences' | 'saveSettingsRule' | 'deleteSettingsRule' | 'saveSettingsShortcut' | 'resetSettingsShortcuts'
>

const bridgeMethod = <Name extends keyof SettingsPreferencesBridge>(name: Name): SettingsPreferencesBridge[Name] | undefined => {
  const method = window.aiops?.[name]
  return typeof method === 'function' ? (method.bind(window.aiops) as SettingsPreferencesBridge[Name]) : undefined
}

export const settingsPreferencesClient = {
  getSettingsPreferences: () => bridgeMethod('getSettingsPreferences'),
  saveSettingsRule: () => bridgeMethod('saveSettingsRule'),
  deleteSettingsRule: () => bridgeMethod('deleteSettingsRule'),
  saveSettingsShortcut: () => bridgeMethod('saveSettingsShortcut'),
  resetSettingsShortcuts: () => bridgeMethod('resetSettingsShortcuts')
}
