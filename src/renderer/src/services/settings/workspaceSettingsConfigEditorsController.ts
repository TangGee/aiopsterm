import { type Ref } from 'vue'
import { settingsConfigClient } from '@/services/settings/settingsConfigClient'
import {
  defaultKeywordHighlightSettings,
  defaultSecuritySettings,
  keywordHighlightEditorContentFromFile,
  keywordHighlightSettingsSnapshotsMatch,
  mergeUserConfig,
  normalizeKeywordHighlightConfig,
  normalizeSecurityConfig,
  parseKeywordHighlightEditorContent,
  parseSecurityEditorContent,
  securityEditorContentFromFile,
  securitySettingsSnapshotsMatch,
  type KeywordHighlightSettings,
  type SecuritySettings
} from '@/services/settings/workspaceConfigRuntime'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type { UserConfig } from '@shared/contracts/userConfig'

type WorkspaceSettingsConfigEditorsControllerState = {
  config: Ref<UserConfig>
  keywordHighlightSettings: Ref<KeywordHighlightSettings>
  keywordHighlightEditorOpen: Ref<boolean>
  keywordHighlightEditorContent: Ref<string>
  keywordHighlightEditorError: Ref<string>
  keywordHighlightEditorLastSaved: Ref<boolean>
  keywordHighlightConfigPath: Ref<string>
  securitySettings: Ref<SecuritySettings>
  securityConfigEditorOpen: Ref<boolean>
  securityConfigEditorContent: Ref<string>
  securityConfigEditorError: Ref<string>
  securityConfigEditorLastSaved: Ref<boolean>
  securityConfigPath: Ref<string>
  mcpConfigEditorOpen: Ref<boolean>
}

type WorkspaceSettingsConfigEditorsControllerDeps = {
  setSettingsNotice: (message: string) => void
  closeMcpConfigEditor: () => void
}

type SecuritySettingsPatch = Partial<Omit<SecuritySettings['security'], 'securityPolicy'>> & {
  securityPolicy?: Partial<SecuritySettings['security']['securityPolicy']>
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const createWorkspaceSettingsConfigEditorsController = (
  state: WorkspaceSettingsConfigEditorsControllerState,
  deps: WorkspaceSettingsConfigEditorsControllerDeps
) => {
  const {
    config,
    keywordHighlightSettings,
    keywordHighlightEditorOpen,
    keywordHighlightEditorContent,
    keywordHighlightEditorError,
    keywordHighlightEditorLastSaved,
    keywordHighlightConfigPath,
    securitySettings,
    securityConfigEditorOpen,
    securityConfigEditorContent,
    securityConfigEditorError,
    securityConfigEditorLastSaved,
    securityConfigPath,
    mcpConfigEditorOpen
  } = state
  const { setSettingsNotice, closeMcpConfigEditor } = deps

  let keywordHighlightSaveTimer: number | null = null
  let removeKeywordHighlightConfigFileListener: (() => void) | null = null
  let keywordHighlightLoadRequest = 0
  let securityConfigSaveTimer: number | null = null
  let removeSecurityConfigFileListener: (() => void) | null = null
  let securityConfigLoadRequest = 0

  const applyKeywordHighlightSettingsSnapshot = (settings: KeywordHighlightSettings) => {
    const normalized = normalizeKeywordHighlightConfig(settings).normalized
    keywordHighlightSettings.value = normalized
    config.value = mergeUserConfig(config.value, { keywordHighlight: normalized })
    return normalized
  }

  const applySavedKeywordHighlightConfig = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['writeKeywordHighlightConfig']>>>,
    expected: KeywordHighlightSettings,
    prefix: 'Save' | 'Reset'
  ) => {
    if (!result?.ok || !result.data || !isRecord(result.data.keywordHighlight)) {
      keywordHighlightEditorError.value = `${prefix} failed: ${result?.errorMessage || 'keyword highlight config write did not return saved settings'}`
      keywordHighlightEditorLastSaved.value = false
      return false
    }
    const saved = normalizeKeywordHighlightConfig(result.data.keywordHighlight).normalized
    if (!keywordHighlightSettingsSnapshotsMatch(saved, expected)) {
      keywordHighlightEditorError.value = `${prefix} failed: keyword highlight config write returned different settings`
      keywordHighlightEditorLastSaved.value = false
      return false
    }
    applyKeywordHighlightSettingsSnapshot(saved)
    keywordHighlightEditorContent.value = JSON.stringify(saved, null, 2)
    keywordHighlightEditorError.value = ''
    keywordHighlightEditorLastSaved.value = true
    return true
  }

  const applyKeywordHighlightConfigFileContent = (content: string, markSaved = true) => {
    const editorContent = keywordHighlightEditorContentFromFile(content)
    keywordHighlightEditorContent.value = editorContent
    try {
      const parsed = parseKeywordHighlightEditorContent(editorContent)
      const { normalized } = normalizeKeywordHighlightConfig(parsed)
      applyKeywordHighlightSettingsSnapshot(normalized)
      keywordHighlightEditorError.value = ''
      keywordHighlightEditorLastSaved.value = markSaved
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Invalid JSON: ${message}`
      keywordHighlightEditorLastSaved.value = false
      return false
    }
  }

  const installKeywordHighlightConfigFileListener = () => {
    const onKeywordHighlightConfigFileChanged = settingsConfigClient.onKeywordHighlightConfigFileChanged()
    if (removeKeywordHighlightConfigFileListener || !onKeywordHighlightConfigFileChanged) return
    removeKeywordHighlightConfigFileListener = onKeywordHighlightConfigFileChanged((content) => {
      applyKeywordHighlightConfigFileContent(content, true)
    })
  }

  const openKeywordHighlightEditor = async () => {
    if (securityConfigEditorOpen.value) {
      closeSecurityConfigEditor()
    }
    if (mcpConfigEditorOpen.value) {
      closeMcpConfigEditor()
    }
    const requestId = ++keywordHighlightLoadRequest
    keywordHighlightEditorOpen.value = true
    keywordHighlightEditorContent.value = JSON.stringify(keywordHighlightSettings.value, null, 2)
    keywordHighlightEditorError.value = ''
    keywordHighlightEditorLastSaved.value = false
    installKeywordHighlightConfigFileListener()
    const getKeywordHighlightConfigPath = settingsConfigClient.getKeywordHighlightConfigPath()
    const readKeywordHighlightConfig = settingsConfigClient.readKeywordHighlightConfig()
    if (!getKeywordHighlightConfigPath || !readKeywordHighlightConfig) {
      keywordHighlightEditorError.value = 'Failed to read keyword highlight config: keyword highlight config service unavailable'
      return
    }
    try {
      const [path, content] = await Promise.all([getKeywordHighlightConfigPath(), readKeywordHighlightConfig()])
      if (requestId !== keywordHighlightLoadRequest) return
      keywordHighlightConfigPath.value = path
      applyKeywordHighlightConfigFileContent(content, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Failed to read keyword highlight config: ${message}`
    }
  }

  const closeKeywordHighlightEditor = () => {
    keywordHighlightLoadRequest += 1
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    if (removeKeywordHighlightConfigFileListener) {
      removeKeywordHighlightConfigFileListener()
      removeKeywordHighlightConfigFileListener = null
    }
    keywordHighlightEditorOpen.value = false
  }

  const updateKeywordHighlightEditorContent = (content: string) => {
    keywordHighlightEditorContent.value = content
    keywordHighlightEditorLastSaved.value = false
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    try {
      parseKeywordHighlightEditorContent(content)
      keywordHighlightEditorError.value = ''
      keywordHighlightSaveTimer = window.setTimeout(() => {
        void saveKeywordHighlightEditor()
        keywordHighlightSaveTimer = null
      }, 1000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Invalid JSON: ${message}`
    }
  }

  const saveKeywordHighlightEditor = async () => {
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    let parsed: unknown
    try {
      parsed = parseKeywordHighlightEditorContent(keywordHighlightEditorContent.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Invalid JSON: ${message}`
      return false
    }
    const { normalized } = normalizeKeywordHighlightConfig(parsed)
    const normalizedContent = JSON.stringify(normalized, null, 2)
    const writeKeywordHighlightConfig = settingsConfigClient.writeKeywordHighlightConfig()
    if (!writeKeywordHighlightConfig) {
      keywordHighlightEditorError.value = 'Save failed: keyword highlight config service unavailable'
      keywordHighlightEditorLastSaved.value = false
      return false
    }
    try {
      const result = await writeKeywordHighlightConfig(normalizedContent)
      if (!applySavedKeywordHighlightConfig(result, normalized, 'Save')) return false
      setSettingsNotice('关键词高亮配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Save failed: ${message}`
      keywordHighlightEditorLastSaved.value = false
      return false
    }
  }

  const resetKeywordHighlightEditor = async () => {
    if (keywordHighlightSaveTimer) {
      window.clearTimeout(keywordHighlightSaveTimer)
      keywordHighlightSaveTimer = null
    }
    const normalized = normalizeKeywordHighlightConfig(defaultKeywordHighlightSettings).normalized
    const normalizedContent = JSON.stringify(normalized, null, 2)
    const writeKeywordHighlightConfig = settingsConfigClient.writeKeywordHighlightConfig()
    if (!writeKeywordHighlightConfig) {
      keywordHighlightEditorError.value = 'Reset failed: keyword highlight config service unavailable'
      keywordHighlightEditorLastSaved.value = false
      return false
    }
    try {
      const result = await writeKeywordHighlightConfig(normalizedContent)
      if (!applySavedKeywordHighlightConfig(result, normalized, 'Reset')) return false
      setSettingsNotice('关键词高亮配置已重置')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      keywordHighlightEditorError.value = `Reset failed: ${message}`
      keywordHighlightEditorLastSaved.value = false
      return false
    }
  }

  const applySecuritySettingsSnapshot = (settings: SecuritySettings) => {
    const normalized = normalizeSecurityConfig(settings).normalized
    securitySettings.value = normalized
    config.value = mergeUserConfig(config.value, { securityConfig: normalized })
    return normalized
  }

  const applySavedSecurityConfig = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['writeSecurityConfig']>>>,
    expected: SecuritySettings,
    prefix: 'Save' | 'Reset'
  ) => {
    if (!result?.ok || !result.data || !isRecord(result.data.securityConfig)) {
      securityConfigEditorError.value = `${prefix} failed: ${result?.errorMessage || 'security config write did not return saved settings'}`
      securityConfigEditorLastSaved.value = false
      return false
    }
    const saved = normalizeSecurityConfig(result.data.securityConfig).normalized
    if (!securitySettingsSnapshotsMatch(saved, expected)) {
      securityConfigEditorError.value = `${prefix} failed: security config write returned different settings`
      securityConfigEditorLastSaved.value = false
      return false
    }
    applySecuritySettingsSnapshot(saved)
    securityConfigEditorContent.value = JSON.stringify(saved, null, 2)
    securityConfigEditorError.value = ''
    securityConfigEditorLastSaved.value = true
    return true
  }

  const applySecurityConfigFileContent = (content: string, markSaved = true) => {
    const editorContent = securityEditorContentFromFile(content)
    securityConfigEditorContent.value = editorContent
    try {
      const parsed = parseSecurityEditorContent(editorContent)
      const { normalized } = normalizeSecurityConfig(parsed)
      applySecuritySettingsSnapshot(normalized)
      securityConfigEditorError.value = ''
      securityConfigEditorLastSaved.value = markSaved
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Invalid JSON: ${message}`
      securityConfigEditorLastSaved.value = false
      return false
    }
  }

  const installSecurityConfigFileListener = () => {
    const onSecurityConfigFileChanged = settingsConfigClient.onSecurityConfigFileChanged()
    if (removeSecurityConfigFileListener || !onSecurityConfigFileChanged) return
    removeSecurityConfigFileListener = onSecurityConfigFileChanged((content) => {
      applySecurityConfigFileContent(content, true)
    })
  }

  const openSecurityConfigEditor = async () => {
    if (keywordHighlightEditorOpen.value) {
      closeKeywordHighlightEditor()
    }
    if (mcpConfigEditorOpen.value) {
      closeMcpConfigEditor()
    }
    const requestId = ++securityConfigLoadRequest
    securityConfigEditorOpen.value = true
    securityConfigEditorContent.value = JSON.stringify(securitySettings.value, null, 2)
    securityConfigEditorError.value = ''
    securityConfigEditorLastSaved.value = false
    installSecurityConfigFileListener()
    const getSecurityConfigPath = settingsConfigClient.getSecurityConfigPath()
    const readSecurityConfig = settingsConfigClient.readSecurityConfig()
    if (!getSecurityConfigPath || !readSecurityConfig) {
      securityConfigEditorError.value = 'Failed to read security config: security config service unavailable'
      return
    }
    try {
      const [path, content] = await Promise.all([getSecurityConfigPath(), readSecurityConfig()])
      if (requestId !== securityConfigLoadRequest) return
      securityConfigPath.value = path
      applySecurityConfigFileContent(content, false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Failed to read security config: ${message}`
    }
  }

  const closeSecurityConfigEditor = () => {
    securityConfigLoadRequest += 1
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    if (removeSecurityConfigFileListener) {
      removeSecurityConfigFileListener()
      removeSecurityConfigFileListener = null
    }
    securityConfigEditorOpen.value = false
  }

  const updateSecurityConfigEditorContent = (content: string) => {
    securityConfigEditorContent.value = content
    securityConfigEditorLastSaved.value = false
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    try {
      parseSecurityEditorContent(content)
      securityConfigEditorError.value = ''
      securityConfigSaveTimer = window.setTimeout(() => {
        void saveSecurityConfigEditor()
        securityConfigSaveTimer = null
      }, 1000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Invalid JSON: ${message}`
    }
  }

  const saveSecurityConfigEditor = async () => {
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    let parsed: unknown
    try {
      parsed = parseSecurityEditorContent(securityConfigEditorContent.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Invalid JSON: ${message}`
      return false
    }
    const { normalized } = normalizeSecurityConfig(parsed)
    const normalizedContent = JSON.stringify(normalized, null, 2)
    const writeSecurityConfig = settingsConfigClient.writeSecurityConfig()
    if (!writeSecurityConfig) {
      securityConfigEditorError.value = 'Save failed: security config service unavailable'
      securityConfigEditorLastSaved.value = false
      return false
    }
    try {
      const result = await writeSecurityConfig(normalizedContent)
      if (!applySavedSecurityConfig(result, normalized, 'Save')) return false
      setSettingsNotice('安全配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Save failed: ${message}`
      securityConfigEditorLastSaved.value = false
      return false
    }
  }

  const updateSecuritySettings = async (patch: SecuritySettingsPatch) => {
    const current = securitySettings.value.security
    const normalized = normalizeSecurityConfig({
      security: {
        ...current,
        ...patch,
        securityPolicy: {
          ...current.securityPolicy,
          ...(patch.securityPolicy || {})
        }
      }
    }).normalized
    const writeSecurityConfig = settingsConfigClient.writeSecurityConfig()
    if (!writeSecurityConfig) {
      securityConfigEditorError.value = 'Save failed: security config service unavailable'
      securityConfigEditorLastSaved.value = false
      setSettingsNotice('安全配置保存服务不可用')
      return false
    }
    try {
      const result = await writeSecurityConfig(JSON.stringify(normalized, null, 2))
      if (!applySavedSecurityConfig(result, normalized, 'Save')) {
        setSettingsNotice(securityConfigEditorError.value || '安全配置保存失败')
        return false
      }
      setSettingsNotice('安全配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Save failed: ${message}`
      securityConfigEditorLastSaved.value = false
      setSettingsNotice(message || '安全配置保存失败')
      return false
    }
  }

  const resetSecurityConfigEditor = async () => {
    if (securityConfigSaveTimer) {
      window.clearTimeout(securityConfigSaveTimer)
      securityConfigSaveTimer = null
    }
    const normalized = normalizeSecurityConfig(defaultSecuritySettings).normalized
    const normalizedContent = JSON.stringify(normalized, null, 2)
    const writeSecurityConfig = settingsConfigClient.writeSecurityConfig()
    if (!writeSecurityConfig) {
      securityConfigEditorError.value = 'Reset failed: security config service unavailable'
      securityConfigEditorLastSaved.value = false
      return false
    }
    try {
      const result = await writeSecurityConfig(normalizedContent)
      if (!applySavedSecurityConfig(result, normalized, 'Reset')) return false
      setSettingsNotice('安全配置已重置')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      securityConfigEditorError.value = `Reset failed: ${message}`
      securityConfigEditorLastSaved.value = false
      return false
    }
  }

  const closeSettingsConfigEditors = () => {
    if (keywordHighlightEditorOpen.value) {
      closeKeywordHighlightEditor()
    }
    if (securityConfigEditorOpen.value) {
      closeSecurityConfigEditor()
    }
    if (mcpConfigEditorOpen.value) {
      closeMcpConfigEditor()
    }
  }

  return {
    closeSettingsConfigEditors,
    openKeywordHighlightEditor,
    closeKeywordHighlightEditor,
    updateKeywordHighlightEditorContent,
    saveKeywordHighlightEditor,
    resetKeywordHighlightEditor,
    openSecurityConfigEditor,
    closeSecurityConfigEditor,
    updateSecurityConfigEditorContent,
    saveSecurityConfigEditor,
    updateSecuritySettings,
    resetSecurityConfigEditor
  }
}
