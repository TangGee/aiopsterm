import type { IpcMain } from 'electron'
import {
  deleteSettingsRule,
  getSettingsPreferences,
  resetSettingsShortcuts,
  saveSettingsRule,
  saveSettingsShortcut
} from '../backend/settings/settingsPreferences'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { SettingsRuleSaveInput, SettingsShortcutSaveInput } from '@shared/contracts/settingsPreferences'

type RegisterSettingsPreferencesIpcInput = {
  getConfig: () => UserConfig
  saveConfigPatch: (patch: Partial<UserConfig>) => UserConfig
}

export const registerSettingsPreferencesIpc = (ipcMain: IpcMain, input: RegisterSettingsPreferencesIpcInput) => {
  ipcMain.handle('settings-preferences:get', () => {
    const result = getSettingsPreferences(input.getConfig())
    if (result.ok && result.data) {
      input.saveConfigPatch({ shortcuts: result.data.shortcuts, rules: result.data.rules, customInstructions: '' })
    }
    return result
  })
  ipcMain.handle('settings-preferences:save-rule', (_event, ruleInput: SettingsRuleSaveInput) => {
    const result = saveSettingsRule(ruleInput)
    if (result.ok && result.data) {
      input.saveConfigPatch({ rules: result.data.rules, customInstructions: '' })
    }
    return result
  })
  ipcMain.handle('settings-preferences:delete-rule', (_event, id: string) => {
    const result = deleteSettingsRule(id)
    if (result.ok && result.data) {
      input.saveConfigPatch({ rules: result.data.rules, customInstructions: '' })
    }
    return result
  })
  ipcMain.handle('settings-preferences:save-shortcut', (_event, shortcutInput: SettingsShortcutSaveInput) => {
    const result = saveSettingsShortcut(shortcutInput)
    if (result.ok && result.data) {
      input.saveConfigPatch({ shortcuts: result.data.shortcuts })
    }
    return result
  })
  ipcMain.handle('settings-preferences:reset-shortcuts', () => {
    const result = resetSettingsShortcuts()
    if (result.ok && result.data) {
      input.saveConfigPatch({ shortcuts: result.data.shortcuts })
    }
    return result
  })
}
