import { type Ref } from 'vue'
import { appRuntimeClient } from '@/services/app/appRuntimeClient'
import { localFilesClient } from '@/services/app/localFilesClient'
import { notificationSoundPreviewContext, playAiNotificationSound } from '@/services/ai/notificationSoundRuntime'
import {
  cloneWorkspacePreferencesSnapshot,
  isAiPreferencesSnapshot,
  isKnowledgeSearchRuntimeSnapshotForRequest,
  isPrivacyRuntimeSnapshotForRequest,
  isWorkspacePreferencesSnapshot,
  mergeGenericSavedConfig,
  normalizeAiPreferencesConfig,
  normalizeExtensionSettingsConfig,
  normalizeNotificationConfig,
  normalizePrivacyConfig,
  normalizeWorkspacePreferences,
  privacyRuntimeSettingsFromSnapshot,
  workspacePreferenceSnapshotsMatch,
  type AiPreferenceSettings,
  type ExtensionSettings,
  type PrivacySettings
} from '@/services/settings/workspaceConfigRuntime'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type {
  AiPreferencesUserConfig,
  CustomNotificationSoundSaveResult,
  KnowledgeSearchRuntimeSnapshot,
  NotificationUserConfig,
  PrivacyRuntimeSnapshot,
  PrivacyUserConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'

type WorkspaceAiPreferencePatch = Partial<Omit<AiPreferenceSettings, 'proxy'>> & {
  proxy?: Partial<AiPreferenceSettings['proxy']>
}

type WorkspacePreferenceSettingsControllerState = {
  config: Ref<UserConfig>
  workspacePreferences: Ref<WorkspaceUserConfig>
  aiPreferences: Ref<AiPreferenceSettings>
  notificationSettings: Ref<NotificationUserConfig>
  extensionSettings: Ref<ExtensionSettings>
  privacySettings: Ref<PrivacySettings>
  onboardingAutoApprovalEvent: Ref<number>
}

type WorkspacePreferenceSettingsControllerDeps = {
  setSettingsNotice: (message: string) => void
  setTopNotice: (message: string) => void
  ensureSelectedExtensionVisible: () => void
  refreshControlNotificationAttentionItems: () => void
}

type PrivacyRuntimeApplyData = PrivacyRuntimeSnapshot
type KnowledgeSearchRuntimeApplyData = KnowledgeSearchRuntimeSnapshot

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isCustomNotificationSoundSaveResult = (source: unknown): source is CustomNotificationSoundSaveResult =>
  isRecord(source) &&
  isNonEmptyString(source.filePath) &&
  isNonEmptyString(source.url) &&
  isNonEmptyString(source.name) &&
  typeof source.size === 'number' &&
  Number.isInteger(source.size) &&
  source.size > 0 &&
  typeof source.bytes === 'number' &&
  Number.isInteger(source.bytes) &&
  source.bytes === source.size &&
  typeof source.mtimeMs === 'number' &&
  Number.isFinite(source.mtimeMs) &&
  source.mtimeMs > 0

export const createWorkspacePreferenceSettingsController = (
  state: WorkspacePreferenceSettingsControllerState,
  deps: WorkspacePreferenceSettingsControllerDeps
) => {
  const {
    config,
    workspacePreferences,
    aiPreferences,
    notificationSettings,
    extensionSettings,
    privacySettings,
    onboardingAutoApprovalEvent
  } = state
  const {
    setSettingsNotice,
    setTopNotice,
    ensureSelectedExtensionVisible,
    refreshControlNotificationAttentionItems
  } = deps

  const getExtensionSettingsSnapshot = () => ({ ...extensionSettings.value })

  const persistExtensionSettings = async (nextSettings: ExtensionSettings) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('扩展设置保存服务不可用')
      return false
    }
    const normalizedSettings = normalizeExtensionSettingsConfig(nextSettings).normalized
    try {
      const savedConfig = await saveConfigBridge({
        extensionSettings: { ...normalizedSettings }
      })
      if (!isRecord(savedConfig) || !isRecord(savedConfig.extensionSettings)) {
        setSettingsNotice('扩展设置保存失败')
        return false
      }
      const savedSettings = normalizeExtensionSettingsConfig(savedConfig.extensionSettings).normalized
      if (
        savedSettings.autoCompleteStatus !== normalizedSettings.autoCompleteStatus ||
        savedSettings.quickVimStatus !== normalizedSettings.quickVimStatus ||
        savedSettings.highlightStatus !== normalizedSettings.highlightStatus
      ) {
        setSettingsNotice('扩展设置保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        extensionSettings: savedSettings
      })
      extensionSettings.value = { ...savedSettings }
      ensureSelectedExtensionVisible()
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '扩展设置保存失败')
      return false
    }
  }

  const getPrivacySnapshot = (): PrivacyUserConfig => ({
    telemetry: privacySettings.value.telemetry,
    telemetryConsentVersion: privacySettings.value.telemetryConsentVersion,
    secretRedaction: privacySettings.value.secretRedaction,
    dataSync: privacySettings.value.dataSync
  })

  const privacySnapshotsMatch = (left: PrivacyUserConfig, right: PrivacyUserConfig) =>
    left.telemetry === right.telemetry &&
    left.telemetryConsentVersion === right.telemetryConsentVersion &&
    left.secretRedaction === right.secretRedaction &&
    left.dataSync === right.dataSync

  const validatedSavedPrivacy = (savedConfig: unknown, expectedPrivacy: PrivacyUserConfig) => {
    if (!isRecord(savedConfig) || !isRecord(savedConfig.privacy)) return null
    const savedPrivacy = normalizePrivacyConfig(savedConfig.privacy).normalized
    if (!privacySnapshotsMatch(savedPrivacy, expectedPrivacy)) return null
    return {
      savedConfig: savedConfig as Partial<UserConfig>,
      savedPrivacy
    }
  }

  const rollbackPrivacyConfig = async (saveConfigBridge: NonNullable<AiopsPreloadApi['saveConfig']>, previousPrivacy: PrivacyUserConfig) => {
    try {
      const rolledBackConfig = await saveConfigBridge({
        privacy: { ...previousPrivacy }
      })
      const rollback = validatedSavedPrivacy(rolledBackConfig, previousPrivacy)
      if (!rollback) return false
      config.value = mergeGenericSavedConfig(config.value, rollback.savedConfig, {
        privacy: rollback.savedPrivacy
      })
      return true
    } catch {
      return false
    }
  }

  const failPrivacyRuntime = async (
    saveConfigBridge: NonNullable<AiopsPreloadApi['saveConfig']>,
    previousPrivacy: PrivacyUserConfig,
    message: string
  ) => {
    const rolledBack = await rollbackPrivacyConfig(saveConfigBridge, previousPrivacy)
    setSettingsNotice(rolledBack ? message : `${message}；隐私设置回滚失败`)
    return false
  }

  const persistPrivacySettings = async (previousPrivacy: PrivacyUserConfig, nextPrivacy: PrivacyUserConfig) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('隐私设置保存服务不可用')
      return false
    }
    try {
      const savedConfig = await saveConfigBridge({
        privacy: { ...nextPrivacy }
      })
      const saved = validatedSavedPrivacy(savedConfig, nextPrivacy)
      if (!saved) {
        setSettingsNotice('隐私设置保存失败')
        return false
      }

      const runtimeChanged = previousPrivacy.telemetry !== nextPrivacy.telemetry || previousPrivacy.dataSync !== nextPrivacy.dataSync
      let runtimeSnapshot: PrivacyRuntimeApplyData | null = null
      if (runtimeChanged) {
        const runtimeBridge = appRuntimeClient.applyPrivacyRuntimeSettings()
        if (typeof runtimeBridge !== 'function') {
          return failPrivacyRuntime(saveConfigBridge, previousPrivacy, '隐私运行时服务不可用')
        }
        try {
          const runtimeResult = await runtimeBridge({
            previousPrivacy: { ...previousPrivacy },
            nextPrivacy: { ...nextPrivacy }
          })
          if (!isRecord(runtimeResult) || runtimeResult.ok !== true || !isPrivacyRuntimeSnapshotForRequest(runtimeResult.data, nextPrivacy)) {
            const message =
              isRecord(runtimeResult) && runtimeResult.ok === false && typeof runtimeResult.errorMessage === 'string' && runtimeResult.errorMessage.trim()
                ? runtimeResult.errorMessage
                : '隐私运行时服务返回数据无效'
            return failPrivacyRuntime(saveConfigBridge, previousPrivacy, message)
          }
          runtimeSnapshot = runtimeResult.data
        } catch (error) {
          return failPrivacyRuntime(saveConfigBridge, previousPrivacy, error instanceof Error ? error.message : '隐私运行时设置应用失败')
        }
      }

      config.value = mergeGenericSavedConfig(config.value, saved.savedConfig, {
        privacy: saved.savedPrivacy
      })
      privacySettings.value = {
        ...privacySettings.value,
        ...saved.savedPrivacy,
        ...(runtimeSnapshot ? privacyRuntimeSettingsFromSnapshot(runtimeSnapshot) : {})
      }
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '隐私设置保存失败')
      return false
    }
  }

  const getAiPreferencesSnapshot = (): AiPreferencesUserConfig => ({
    ...aiPreferences.value,
    proxy: { ...aiPreferences.value.proxy }
  })

  const cloneAiPreferencesSnapshot = (preferences: AiPreferenceSettings): AiPreferencesUserConfig => ({
    ...preferences,
    proxy: { ...preferences.proxy }
  })

  const aiPreferencesSnapshotsMatch = (left: AiPreferenceSettings, right: AiPreferenceSettings) =>
    JSON.stringify(cloneAiPreferencesSnapshot(left)) === JSON.stringify(cloneAiPreferencesSnapshot(right))

  const validatedSavedAiPreferences = (savedConfig: unknown, expectedPreferences: AiPreferenceSettings) => {
    if (!isRecord(savedConfig) || !isAiPreferencesSnapshot(savedConfig.aiPreferences)) return null
    const savedPreferences = normalizeAiPreferencesConfig(savedConfig.aiPreferences).normalized
    if (!aiPreferencesSnapshotsMatch(savedPreferences, expectedPreferences)) return null
    return {
      savedConfig: savedConfig as Partial<UserConfig>,
      savedPreferences
    }
  }

  const rollbackAiPreferencesConfig = async (saveConfigBridge: NonNullable<AiopsPreloadApi['saveConfig']>, previousPreferences: AiPreferenceSettings) => {
    try {
      const rolledBackConfig = await saveConfigBridge({
        aiPreferences: cloneAiPreferencesSnapshot(previousPreferences)
      })
      const rollback = validatedSavedAiPreferences(rolledBackConfig, previousPreferences)
      if (!rollback) return false
      config.value = mergeGenericSavedConfig(config.value, rollback.savedConfig, {
        aiPreferences: cloneAiPreferencesSnapshot(rollback.savedPreferences)
      })
      return true
    } catch {
      return false
    }
  }

  const failAiPreferencesRuntime = async (
    saveConfigBridge: NonNullable<AiopsPreloadApi['saveConfig']>,
    previousPreferences: AiPreferenceSettings,
    message: string
  ) => {
    const rolledBack = await rollbackAiPreferencesConfig(saveConfigBridge, previousPreferences)
    setSettingsNotice(rolledBack ? message : `${message}；AI 设置回滚失败`)
    return false
  }

  const persistAiPreferences = async (previousPreferences: AiPreferenceSettings, nextPreferences: AiPreferenceSettings) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('AI 设置保存服务不可用')
      return false
    }
    const normalizedPreferences = normalizeAiPreferencesConfig(nextPreferences).normalized
    try {
      const savedConfig = await saveConfigBridge({
        aiPreferences: cloneAiPreferencesSnapshot(normalizedPreferences)
      })
      const saved = validatedSavedAiPreferences(savedConfig, normalizedPreferences)
      if (!saved) {
        setSettingsNotice('AI 设置保存失败')
        return false
      }

      if (previousPreferences.kbSearchEnabled !== normalizedPreferences.kbSearchEnabled) {
        const runtimeBridge = appRuntimeClient.applyKnowledgeSearchRuntimeSetting()
        if (typeof runtimeBridge !== 'function') {
          return failAiPreferencesRuntime(saveConfigBridge, previousPreferences, '知识库搜索运行时服务不可用')
        }
        try {
          const runtimeResult = await runtimeBridge({
            previousEnabled: previousPreferences.kbSearchEnabled,
            nextEnabled: normalizedPreferences.kbSearchEnabled
          })
          if (!isRecord(runtimeResult) || runtimeResult.ok !== true || !isKnowledgeSearchRuntimeSnapshotForRequest(runtimeResult.data, normalizedPreferences.kbSearchEnabled)) {
            const message =
              isRecord(runtimeResult) && runtimeResult.ok === false && typeof runtimeResult.errorMessage === 'string' && runtimeResult.errorMessage.trim()
                ? runtimeResult.errorMessage
                : '知识库搜索运行时服务返回数据无效'
            return failAiPreferencesRuntime(saveConfigBridge, previousPreferences, message)
          }
        } catch (error) {
          return failAiPreferencesRuntime(saveConfigBridge, previousPreferences, error instanceof Error ? error.message : '知识库搜索运行时设置应用失败')
        }
      }

      config.value = mergeGenericSavedConfig(config.value, saved.savedConfig, {
        aiPreferences: cloneAiPreferencesSnapshot(saved.savedPreferences)
      })
      aiPreferences.value = cloneAiPreferencesSnapshot(saved.savedPreferences)
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : 'AI 设置保存失败')
      return false
    }
  }

  const updateWorkspacePreferences = async (patch: Partial<WorkspaceUserConfig>) => {
    const nextPreferences = normalizeWorkspacePreferences({ ...workspacePreferences.value, ...patch }).normalized
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setTopNotice('资源树偏好保存服务不可用')
      return false
    }
    try {
      const savedConfig = await saveConfigBridge({
        workspacePreferences: cloneWorkspacePreferencesSnapshot(nextPreferences)
      })
      if (!isRecord(savedConfig) || !isWorkspacePreferencesSnapshot(savedConfig.workspacePreferences)) {
        setTopNotice('资源树偏好保存失败')
        return false
      }
      const savedPreferences = normalizeWorkspacePreferences(savedConfig.workspacePreferences).normalized
      if (!workspacePreferenceSnapshotsMatch(savedPreferences, nextPreferences)) {
        setTopNotice('资源树偏好保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        workspacePreferences: cloneWorkspacePreferencesSnapshot(savedPreferences)
      })
      workspacePreferences.value = cloneWorkspacePreferencesSnapshot(savedPreferences)
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : '资源树偏好保存失败')
      return false
    }
  }

  const updateAiPreferences = async (patch: WorkspaceAiPreferencePatch) => {
    const previousPreferences = getAiPreferencesSnapshot()
    const nextPreferences = normalizeAiPreferencesConfig({
      ...previousPreferences,
      ...patch,
      proxy: patch.proxy ? { ...aiPreferences.value.proxy, ...patch.proxy } : aiPreferences.value.proxy
    }).normalized
    const saved = await persistAiPreferences(previousPreferences, nextPreferences)
    if (!saved) return false
    const enablesAutoApproval = nextPreferences.autoApproval && !previousPreferences.autoApproval
    if (enablesAutoApproval) {
      onboardingAutoApprovalEvent.value += 1
    }
    setSettingsNotice('AI 设置已保存')
    return true
  }

  const updateNotificationSettings = async (patch: Partial<NotificationUserConfig>) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('通知设置保存服务不可用')
      return false
    }
    const nextSettings = normalizeNotificationConfig({
      ...notificationSettings.value,
      ...patch
    }).normalized
    try {
      const savedConfig = await saveConfigBridge({ notifications: nextSettings })
      if (!isRecord(savedConfig)) {
        setSettingsNotice('通知设置保存失败')
        return false
      }
      const savedSettings = normalizeNotificationConfig(savedConfig.notifications).normalized
      if (JSON.stringify(savedSettings) !== JSON.stringify(nextSettings)) {
        setSettingsNotice('通知设置保存失败')
        return false
      }
      notificationSettings.value = { ...savedSettings }
      config.value = mergeGenericSavedConfig(config.value, savedConfig as Partial<UserConfig>, {
        notifications: { ...savedSettings }
      })
      refreshControlNotificationAttentionItems()
      setSettingsNotice('通知设置已保存')
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '通知设置保存失败')
      return false
    }
  }

  const uploadCustomNotificationSound = async () => {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      setSettingsNotice('自定义通知声音选择服务不可用')
      return false
    }
    const saveCustomNotificationSound = localFilesClient.saveCustomNotificationSound()
    if (!saveCustomNotificationSound) {
      setSettingsNotice('自定义通知声音保存服务不可用')
      return false
    }
    try {
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm'] }]
      })
      if (!result || result.canceled || !result.filePaths.length) return false
      const saved = await saveCustomNotificationSound(result.filePaths[0])
      if (!isCustomNotificationSoundSaveResult(saved)) {
        setSettingsNotice('自定义通知声音保存失败')
        return false
      }
      const persisted = await updateNotificationSettings({
        soundEnabled: true,
        soundPreset: 'custom',
        customSoundPath: saved.filePath,
        customSoundUrl: saved.url,
        customSoundName: saved.name
      })
      if (!persisted) return false
      setSettingsNotice(`自定义通知声音已保存：${saved.name}`)
      return true
    } catch (error) {
      setSettingsNotice(`自定义通知声音保存失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const clearCustomNotificationSound = async () =>
    updateNotificationSettings({
      soundPreset: 'chime',
      customSoundPath: '',
      customSoundUrl: '',
      customSoundName: ''
    })

  const previewNotificationSound = () => {
    const played = playAiNotificationSound(notificationSettings.value, notificationSoundPreviewContext())
    setSettingsNotice(played ? '已播放通知声音' : '当前环境无法播放通知声音')
    return played
  }

  const updateExtensionSettings = async (patch: Partial<ExtensionSettings>) => {
    const nextSettings = normalizeExtensionSettingsConfig({ ...extensionSettings.value, ...patch }).normalized
    const saved = await persistExtensionSettings(nextSettings)
    if (!saved) return false
    setSettingsNotice('扩展设置已保存')
    return true
  }

  const updatePrivacySettings = async (patch: Partial<PrivacySettings>) => {
    const hasPersistentPatch = 'telemetry' in patch || 'telemetryConsentVersion' in patch || 'secretRedaction' in patch || 'dataSync' in patch
    const localPatch = {
      ...(('deactivateModalOpen' in patch) ? { deactivateModalOpen: patch.deactivateModalOpen } : {}),
      ...(('deactivateConfirmationInput' in patch) ? { deactivateConfirmationInput: patch.deactivateConfirmationInput } : {}),
      ...(('deactivateLoading' in patch) ? { deactivateLoading: patch.deactivateLoading } : {})
    }
    if (Object.keys(localPatch).length) {
      privacySettings.value = {
        ...privacySettings.value,
        ...localPatch
      }
    }
    if (!hasPersistentPatch) {
      return true
    }
    const previousPersistent = getPrivacySnapshot()
    const nextPersistent = normalizePrivacyConfig({
      ...previousPersistent,
      ...patch,
      ...('telemetry' in patch && patch.telemetry !== 'undecided' ? { telemetryConsentVersion: 1 } : {})
    }).normalized
    const saved = await persistPrivacySettings(previousPersistent, nextPersistent)
    if (!saved) return false
    setSettingsNotice('隐私设置已保存')
    return true
  }

  return {
    getExtensionSettingsSnapshot,
    updateWorkspacePreferences,
    updateAiPreferences,
    updateNotificationSettings,
    uploadCustomNotificationSound,
    clearCustomNotificationSound,
    previewNotificationSound,
    updateExtensionSettings,
    updatePrivacySettings
  }
}
