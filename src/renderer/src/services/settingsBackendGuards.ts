import type {
  SettingsPreferencesMutationResult,
  SettingsPreferencesSnapshot,
  SettingsRuleDeleteResult,
  ShortcutUserConfig,
  UserRuleConfig
} from '@shared/preload'

export const malformedSettingsBackendResultMessage = '设置服务返回数据无效'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const isOptionalNonEmptyString = (value: unknown) => value === undefined || isNonEmptyString(value)

const isSettingsShortcutConfig = (value: unknown): value is ShortcutUserConfig => {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.action) && isNonEmptyString(value.shortcut) && isOptionalNonEmptyString(value.suffix)
}

const isSettingsRuleConfig = (value: unknown): value is UserRuleConfig => {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.content) && typeof value.enabled === 'boolean'
}

export const isSettingsPreferencesSnapshot = (value: unknown): value is SettingsPreferencesSnapshot =>
  isRecord(value) && Array.isArray(value.shortcuts) && value.shortcuts.every(isSettingsShortcutConfig) && Array.isArray(value.rules) && value.rules.every(isSettingsRuleConfig)

export type SettingsPreferencesMutationData = NonNullable<SettingsPreferencesMutationResult['data']>
export type SettingsRuleDeleteData = NonNullable<SettingsRuleDeleteResult['data']>

export const isSettingsPreferencesMutationData = (value: unknown): value is SettingsPreferencesMutationData => {
  if (!isSettingsPreferencesSnapshot(value) || !isRecord(value)) return false
  const record: Record<string, unknown> = value
  return isNonEmptyString(record.message)
}

export const isSettingsRuleDeleteData = (value: unknown): value is SettingsRuleDeleteData => {
  if (!isSettingsPreferencesSnapshot(value) || !isRecord(value)) return false
  const record: Record<string, unknown> = value
  return isSettingsRuleConfig(record.deleted)
}
