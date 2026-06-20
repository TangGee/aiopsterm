import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { createBridgeMethod } from '@/services/preloadBridgeClient'

type SettingsPreferencesBridge = Pick<
  AiopsPreloadApi,
  'getSettingsPreferences' | 'saveSettingsRule' | 'deleteSettingsRule' | 'saveSettingsShortcut' | 'resetSettingsShortcuts'
>

const bridgeMethod = createBridgeMethod<SettingsPreferencesBridge>()

export const settingsPreferencesClient = {
  getSettingsPreferences: () => bridgeMethod('getSettingsPreferences'),
  saveSettingsRule: () => bridgeMethod('saveSettingsRule'),
  deleteSettingsRule: () => bridgeMethod('deleteSettingsRule'),
  saveSettingsShortcut: () => bridgeMethod('saveSettingsShortcut'),
  resetSettingsShortcuts: () => bridgeMethod('resetSettingsShortcuts')
}
