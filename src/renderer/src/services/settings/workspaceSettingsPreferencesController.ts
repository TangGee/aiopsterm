import { type Ref } from 'vue'
import {
  isSettingsPreferencesMutationData,
  isSettingsPreferencesSnapshot,
  isSettingsRuleDeleteData,
  malformedSettingsBackendResultMessage
} from '@/services/settings/settingsBackendGuards'
import { settingsPreferencesClient } from '@/services/settings/settingsPreferencesClient'
import { shortcutRuntime, type ShortcutActionHandler } from '@/services/common/shortcutRuntime'
import {
  isValidShortcutForAction,
  mergeUserConfig,
  normalizeRulesConfig,
  normalizeShortcutsConfig
} from '@/services/settings/workspaceConfigRuntime'
import type { SettingsPreferencesSnapshot, ShortcutUserConfig, UserRuleConfig } from '@shared/contracts/settingsPreferences'
import type { UserConfig } from '@shared/contracts/userConfig'

export type WorkspaceSettingsRule = UserRuleConfig & { isEditing?: boolean; isDraft?: boolean }
export type WorkspaceSettingsShortcut = ShortcutUserConfig

type ShortcutRuntimePort = Pick<typeof shortcutRuntime, 'destroy' | 'install' | 'setRecording' | 'update'>

type WorkspaceSettingsPreferencesControllerState = {
  config: Ref<UserConfig>
  settingsRules: Ref<WorkspaceSettingsRule[]>
  settingsShortcuts: Ref<WorkspaceSettingsShortcut[]>
  shortcutRecording: Ref<{ actionId: string | null; tempShortcut: string }>
}

type WorkspaceSettingsPreferencesControllerDeps = {
  runtime?: ShortcutRuntimePort
  setSettingsNotice: (message: string) => void
  shortcutHandlers: Record<string, ShortcutActionHandler>
}

const cloneShortcutConfig = (shortcuts: WorkspaceSettingsShortcut[]): ShortcutUserConfig[] =>
  shortcuts.map((shortcut) => ({
    id: shortcut.id,
    action: shortcut.action,
    shortcut: shortcut.shortcut,
    ...(shortcut.suffix ? { suffix: shortcut.suffix } : {})
  }))

const cloneRuleConfig = (rules: WorkspaceSettingsRule[]): UserRuleConfig[] =>
  rules
    .filter((rule) => !rule.isDraft && rule.content.trim())
    .map((rule) => ({
      id: rule.id,
      content: rule.content.trim(),
      enabled: rule.enabled !== undefined ? rule.enabled : true
    }))

export const createWorkspaceSettingsPreferencesController = (
  {
    config,
    settingsRules,
    settingsShortcuts,
    shortcutRecording
  }: WorkspaceSettingsPreferencesControllerState,
  deps: WorkspaceSettingsPreferencesControllerDeps
) => {
  const runtime = deps.runtime ?? shortcutRuntime

  const getShortcutsSnapshot = (): ShortcutUserConfig[] => cloneShortcutConfig(settingsShortcuts.value)

  const getRulesSnapshot = (): UserRuleConfig[] => cloneRuleConfig(settingsRules.value)

  const refreshShortcutRuntime = () => {
    runtime.update(getShortcutsSnapshot(), deps.shortcutHandlers)
  }

  const applySettingsPreferencesSnapshot = (snapshot: SettingsPreferencesSnapshot) => {
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(snapshot.shortcuts)
    const { normalized: normalizedRules } = normalizeRulesConfig(snapshot.rules)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    config.value = mergeUserConfig(config.value, {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules,
      customInstructions: ''
    })
    refreshShortcutRuntime()
    return {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules
    }
  }

  const hydrateSettingsPreferences = async (savedConfig: UserConfig) => {
    let bridgeSettingsPreferences: SettingsPreferencesSnapshot = {
      shortcuts: normalizeShortcutsConfig(savedConfig.shortcuts).normalized,
      rules: normalizeRulesConfig(savedConfig.rules, savedConfig.customInstructions).normalized
    }
    try {
      const getSettingsPreferences = settingsPreferencesClient.getSettingsPreferences()
      const result = await getSettingsPreferences?.()
      if (result?.ok && isSettingsPreferencesSnapshot(result.data)) {
        bridgeSettingsPreferences = result.data
      } else if (result?.ok) {
        deps.setSettingsNotice(malformedSettingsBackendResultMessage)
      } else if (result && !result.ok) {
        deps.setSettingsNotice(result.errorMessage || '设置偏好加载失败')
      }
    } catch {
      deps.setSettingsNotice('设置偏好加载失败')
    }
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(bridgeSettingsPreferences.shortcuts)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    const { normalized: normalizedRules } = normalizeRulesConfig(bridgeSettingsPreferences.rules)
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    return {
      normalizedShortcuts,
      normalizedRules
    }
  }

  const addSettingsRule = () => {
    if (settingsRules.value.some((rule) => rule.isEditing)) return
    settingsRules.value.unshift({ id: 'rule-draft-new', content: '', enabled: true, isEditing: true, isDraft: true })
  }

  const editSettingsRule = (id: string) => {
    settingsRules.value.forEach((rule) => {
      rule.isEditing = rule.id === id
    })
  }

  const updateSettingsRuleDraft = (id: string, content: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (rule) rule.content = content
  }

  const saveSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    if (!rule.content.trim()) {
      if (rule.isDraft) {
        settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
        return false
      }
      return deleteSettingsRule(id)
    }
    const saveSettingsRuleBridge = settingsPreferencesClient.saveSettingsRule()
    if (!saveSettingsRuleBridge) {
      deps.setSettingsNotice('规则保存服务不可用')
      return false
    }
    try {
      const result = await saveSettingsRuleBridge({
        ...(rule.isDraft ? {} : { id }),
        content: rule.content,
        enabled: rule.enabled
      })
      if (!result?.ok || !result.data) {
        deps.setSettingsNotice(result?.errorMessage || '规则保存失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        deps.setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      deps.setSettingsNotice(result.data.message || '规则已保存')
      return true
    } catch {
      deps.setSettingsNotice('规则保存失败')
      return false
    }
  }

  const cancelSettingsRuleEdit = (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return
    if (!rule.content.trim()) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return
    }
    const savedRule = config.value.rules?.find((item) => item.id === id)
    if (savedRule) {
      rule.content = savedRule.content
      rule.enabled = savedRule.enabled
      rule.isDraft = false
    }
    rule.isEditing = false
  }

  const toggleSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    const nextEnabled = !rule.enabled
    const saveSettingsRuleBridge = settingsPreferencesClient.saveSettingsRule()
    if (!saveSettingsRuleBridge) {
      deps.setSettingsNotice('规则更新服务不可用')
      return false
    }
    try {
      const result = await saveSettingsRuleBridge({
        id,
        content: rule.content,
        enabled: nextEnabled
      })
      if (!result?.ok || !result.data) {
        deps.setSettingsNotice(result?.errorMessage || '规则更新失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        deps.setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      deps.setSettingsNotice(`规则${nextEnabled ? '已启用' : '已禁用'}`)
      return true
    } catch {
      deps.setSettingsNotice('规则更新失败')
      return false
    }
  }

  const deleteSettingsRule = async (id: string) => {
    const existing = settingsRules.value.find((item) => item.id === id)
    if (!existing) return false
    if (!existing.content.trim() && existing.isDraft) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return true
    }
    const deleteSettingsRuleBridge = settingsPreferencesClient.deleteSettingsRule()
    if (!deleteSettingsRuleBridge) {
      deps.setSettingsNotice('规则删除服务不可用')
      return false
    }
    try {
      const result = await deleteSettingsRuleBridge(id)
      if (!result?.ok || !result.data) {
        deps.setSettingsNotice(result?.errorMessage || '规则删除失败')
        return false
      }
      if (!isSettingsRuleDeleteData(result.data)) {
        deps.setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      deps.setSettingsNotice('规则已删除')
      return true
    } catch {
      deps.setSettingsNotice('规则删除失败')
      return false
    }
  }

  const startShortcutRecording = (actionId: string) => {
    shortcutRecording.value = { actionId, tempShortcut: '' }
    runtime.setRecording(true)
  }

  const updateShortcutRecording = (shortcut: string) => {
    shortcutRecording.value.tempShortcut = shortcut
  }

  const saveShortcutRecording = async () => {
    const { actionId, tempShortcut } = shortcutRecording.value
    const nextShortcut = tempShortcut.trim()
    if (!actionId || !nextShortcut) return false
    const shortcut = settingsShortcuts.value.find((item) => item.id === actionId)
    if (!shortcut) return false
    if (!isValidShortcutForAction(actionId, nextShortcut)) {
      deps.setSettingsNotice('快捷键格式无效')
      return false
    }
    const conflicted = settingsShortcuts.value.some((item) => item.id !== actionId && item.shortcut === nextShortcut)
    if (conflicted) {
      deps.setSettingsNotice('快捷键已被占用')
      return false
    }
    const saveSettingsShortcutBridge = settingsPreferencesClient.saveSettingsShortcut()
    if (!saveSettingsShortcutBridge) {
      deps.setSettingsNotice('快捷键保存服务不可用')
      return false
    }
    try {
      const result = await saveSettingsShortcutBridge({
        id: actionId,
        shortcut: nextShortcut
      })
      if (!result?.ok || !result.data) {
        deps.setSettingsNotice(result?.errorMessage || '快捷键保存失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        deps.setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      runtime.setRecording(false)
      deps.setSettingsNotice(result.data.message || '快捷键已保存')
      return true
    } catch {
      deps.setSettingsNotice('快捷键保存失败')
      return false
    }
  }

  const cancelShortcutRecording = () => {
    shortcutRecording.value = { actionId: null, tempShortcut: '' }
    runtime.setRecording(false)
  }

  const resetAllShortcuts = async () => {
    const resetSettingsShortcutsBridge = settingsPreferencesClient.resetSettingsShortcuts()
    if (!resetSettingsShortcutsBridge) {
      deps.setSettingsNotice('快捷键重置服务不可用')
      return false
    }
    try {
      const result = await resetSettingsShortcutsBridge()
      if (!result?.ok || !result.data) {
        deps.setSettingsNotice(result?.errorMessage || '快捷键重置失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        deps.setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      runtime.setRecording(false)
      deps.setSettingsNotice(result.data.message || '快捷键已全部重置')
      return true
    } catch {
      deps.setSettingsNotice('快捷键重置失败')
      return false
    }
  }

  const installShortcutRuntime = () => {
    runtime.install(getShortcutsSnapshot(), deps.shortcutHandlers)
  }

  const uninstallShortcutRuntime = () => {
    runtime.destroy()
  }

  return {
    getShortcutsSnapshot,
    getRulesSnapshot,
    refreshShortcutRuntime,
    applySettingsPreferencesSnapshot,
    hydrateSettingsPreferences,
    addSettingsRule,
    editSettingsRule,
    updateSettingsRuleDraft,
    saveSettingsRule,
    cancelSettingsRuleEdit,
    toggleSettingsRule,
    deleteSettingsRule,
    startShortcutRecording,
    updateShortcutRecording,
    saveShortcutRecording,
    cancelShortcutRecording,
    resetAllShortcuts,
    installShortcutRuntime,
    uninstallShortcutRuntime
  }
}

export type WorkspaceSettingsPreferencesController = ReturnType<typeof createWorkspaceSettingsPreferencesController>
