import type { AiopsMutationResult } from './common'

export type ShortcutUserConfig = {
  id: string
  action: string
  shortcut: string
  suffix?: string
}

export type UserRuleConfig = {
  id: string
  content: string
  enabled: boolean
}

export type SettingsPreferencesSnapshot = {
  shortcuts: ShortcutUserConfig[]
  rules: UserRuleConfig[]
}

export type SettingsPreferencesResult = AiopsMutationResult<SettingsPreferencesSnapshot>

export type SettingsRuleSaveInput = {
  id?: string
  content: string
  enabled?: boolean
}

export type SettingsRuleDeleteResult = AiopsMutationResult<SettingsPreferencesSnapshot & { deleted: UserRuleConfig }>

export type SettingsPreferencesMutationResult = AiopsMutationResult<SettingsPreferencesSnapshot & { message: string }>

export type SettingsShortcutSaveInput = {
  id: string
  shortcut: string
}
