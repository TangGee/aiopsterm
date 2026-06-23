import { type Ref } from 'vue'
import { appRuntimeClient } from '@/services/app/appRuntimeClient'
import { applyDocumentLocale, resolveLocale } from '@/i18n/runtime'
import { applyThemeToDocument, isThemeId, type ThemeId } from '@/services/app/themeRuntime'
import { applyEditorSettingsToDocument } from '@/services/common/editorRuntime'
import { localFilesClient } from '@/services/app/localFilesClient'
import {
  backgroundSnapshotsMatch,
  cloneBackgroundSnapshot,
  defaultConfig,
  generalBaseSettingsPatchMatches,
  isBackgroundSnapshot,
  isCustomBackgroundSaveResult,
  isEditorSettingsSnapshot,
  isGeneralBaseSettingsSnapshot,
  isTerminalSettingsSnapshot,
  mergeGenericSavedConfig,
  normalizeBackgroundConfig,
  normalizeEditorSettingsConfig,
  normalizeGeneralBaseSettingsPatch,
  normalizeTerminalConfig,
  visibleBackgroundTuning,
  type BackgroundUserConfig,
  type EditorSettings,
  type GeneralBaseSettingsPatch,
  type TerminalSettings
} from '@/services/settings/workspaceConfigRuntime'
import type {
  EditorUserConfig,
  TerminalUserConfig
} from '@shared/contracts/appRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'

type WorkspaceAppearanceSettingsControllerState = {
  config: Ref<UserConfig>
  savedGeneralBaseSettingsSnapshot: Ref<GeneralBaseSettingsPatch>
  editorSettings: Ref<EditorSettings>
  terminalSettings: Ref<TerminalSettings>
}

type WorkspaceAppearanceSettingsControllerDeps = {
  currentLocale: () => ReturnType<typeof resolveLocale>
  applyCurrentTheme: () => void
  applyCurrentEditorSettings: () => void
  setupThemeBridge: () => void
  refreshShortcutRuntime: () => void
  setSettingsNotice: (message: string) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const normalizeThemeId = (theme: string): ThemeId => (isThemeId(theme) ? theme : 'dark')

const isThemeSnapshot = (value: unknown): value is ThemeId => typeof value === 'string' && isThemeId(value)

export const createWorkspaceAppearanceSettingsController = (
  state: WorkspaceAppearanceSettingsControllerState,
  deps: WorkspaceAppearanceSettingsControllerDeps
) => {
  const {
    config,
    savedGeneralBaseSettingsSnapshot,
    editorSettings,
    terminalSettings
  } = state
  const {
    currentLocale,
    applyCurrentTheme,
    applyCurrentEditorSettings,
    setupThemeBridge,
    refreshShortcutRuntime,
    setSettingsNotice
  } = deps

  const selectTheme = async (theme: string) => {
    const nextTheme = normalizeThemeId(theme)
    const previousTheme = config.value.theme
    applyThemeToDocument(nextTheme)
    setupThemeBridge()

    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      applyThemeToDocument(previousTheme)
      setSettingsNotice('主题设置保存服务不可用')
      return false
    }

    try {
      const savedConfig = await saveConfigBridge({ theme: nextTheme })
      if (!isRecord(savedConfig) || !isThemeSnapshot(savedConfig.theme) || savedConfig.theme !== nextTheme) {
        applyThemeToDocument(previousTheme)
        setSettingsNotice('主题设置保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        theme: savedConfig.theme
      })
      config.value.theme = normalizeThemeId(config.value.theme)
      editorSettings.value = normalizeEditorSettingsConfig(config.value.editorSettings).normalized
      applyCurrentTheme()
      applyCurrentEditorSettings()
      refreshShortcutRuntime()
      setupThemeBridge()
      setSettingsNotice('主题设置已保存')
      return true
    } catch (error) {
      applyThemeToDocument(previousTheme)
      setSettingsNotice(error instanceof Error ? error.message : '主题设置保存失败')
      return false
    }
  }

  const getBackgroundSnapshot = (): BackgroundUserConfig => cloneBackgroundSnapshot(config.value.background)

  const persistBackground = async (nextBackground: BackgroundUserConfig) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('背景设置保存服务不可用')
      return false
    }
    const normalizedBackground = normalizeBackgroundConfig(nextBackground).normalized
    try {
      const savedConfig = await saveConfigBridge({
        background: cloneBackgroundSnapshot(normalizedBackground)
      })
      if (!isRecord(savedConfig) || !isBackgroundSnapshot(savedConfig.background)) {
        setSettingsNotice('背景设置保存失败')
        return false
      }
      const savedBackground = normalizeBackgroundConfig(savedConfig.background).normalized
      if (!backgroundSnapshotsMatch(savedBackground, normalizedBackground)) {
        setSettingsNotice('背景设置保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        background: cloneBackgroundSnapshot(savedBackground)
      })
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '背景设置保存失败')
      return false
    }
  }

  const selectBackground = async (mode: UserConfig['background']['mode'], image = '') => {
    const nextBackground = visibleBackgroundTuning(
      normalizeBackgroundConfig({
        ...getBackgroundSnapshot(),
        mode,
        image
      }).normalized
    )
    const saved = await persistBackground(nextBackground)
    if (saved) {
      setSettingsNotice('背景设置已保存')
    }
    return saved
  }

  const uploadCustomBackground = async () => {
    const showOpenDialog = localFilesClient.showOpenDialog()
    if (!showOpenDialog) {
      setSettingsNotice('自定义背景选择服务不可用')
      return false
    }
    const saveCustomBackground = localFilesClient.saveCustomBackground()
    if (!saveCustomBackground) {
      setSettingsNotice('自定义背景保存服务不可用')
      return false
    }
    try {
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }]
      })
      if (!result || result.canceled || !result.filePaths.length) return false
      const saved = await saveCustomBackground(result.filePaths[0])
      if (!isCustomBackgroundSaveResult(saved)) {
        setSettingsNotice('自定义背景保存失败')
        return false
      }
      const persisted = await persistBackground(
        visibleBackgroundTuning({
          ...getBackgroundSnapshot(),
          mode: 'custom',
          image: saved.url,
          lastCustomImage: saved.url
        })
      )
      if (!persisted) return false
      setSettingsNotice(`自定义背景已保存：${saved.name}`)
      return true
    } catch (error) {
      setSettingsNotice(`自定义背景保存失败：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  const selectCustomBackground = async () => {
    const customImage = config.value.background.lastCustomImage || (config.value.background.mode === 'custom' ? config.value.background.image : '')
    if (!customImage) {
      setSettingsNotice('请先上传自定义背景')
      return false
    }
    const saved = await persistBackground(
      visibleBackgroundTuning({
        ...getBackgroundSnapshot(),
        mode: 'custom',
        image: customImage,
        lastCustomImage: customImage
      })
    )
    if (saved) {
      setSettingsNotice('背景设置已保存')
    }
    return saved
  }

  const clearCustomBackground = async () => {
    const wasSelected = config.value.background.mode === 'custom'
    const saved = await persistBackground({
      ...getBackgroundSnapshot(),
      mode: wasSelected ? 'none' : config.value.background.mode,
      image: wasSelected ? '' : config.value.background.image,
      lastCustomImage: ''
    })
    if (saved) {
      setSettingsNotice('自定义背景已清除')
    }
    return saved
  }

  const updateBackgroundTuning = async (patch: Partial<Pick<UserConfig['background'], 'opacity' | 'brightness'>>) => {
    const saved = await persistBackground(
      normalizeBackgroundConfig({
        ...getBackgroundSnapshot(),
        ...patch
      }).normalized
    )
    if (saved) {
      setSettingsNotice('背景设置已保存')
    }
    return saved
  }

  const saveGeneralBaseSettings = async (patch: GeneralBaseSettingsPatch) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('基础设置保存服务不可用')
      return false
    }
    const normalizedPatch = normalizeGeneralBaseSettingsPatch(patch)
    if (!normalizedPatch || !Object.keys(normalizedPatch).length) {
      setSettingsNotice('基础设置保存失败')
      return false
    }
    try {
      const savedConfig = await saveConfigBridge(normalizedPatch)
      if (!isGeneralBaseSettingsSnapshot(savedConfig) || !generalBaseSettingsPatchMatches(normalizedPatch, savedConfig)) {
        setSettingsNotice('基础设置保存失败')
        return false
      }
      savedGeneralBaseSettingsSnapshot.value = {
        defaultMode: savedConfig.defaultMode,
        language: savedConfig.language,
        watermark: savedConfig.watermark
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig)
      if (normalizedPatch.language !== undefined) {
        applyDocumentLocale(currentLocale())
      }
      setSettingsNotice('基础设置已保存')
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '基础设置保存失败')
      return false
    }
  }

  const updateDefaultLayout = (mode: 'terminal' | 'agents') => saveGeneralBaseSettings({ defaultMode: mode })

  const updateLanguage = (language: string) => saveGeneralBaseSettings({ language })

  const updateWatermark = (watermark: 'open' | 'close') => saveGeneralBaseSettings({ watermark })

  const getEditorSettingsSnapshot = (): EditorUserConfig => ({ ...editorSettings.value })

  const cloneEditorSettingsSnapshot = (settings: EditorSettings): EditorUserConfig => ({ ...settings })

  const editorSettingsSnapshotsMatch = (left: EditorSettings, right: EditorSettings) =>
    JSON.stringify(cloneEditorSettingsSnapshot(left)) === JSON.stringify(cloneEditorSettingsSnapshot(right))

  const persistEditorSettings = async (nextSettings: EditorSettings) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('编辑器设置保存服务不可用')
      return false
    }
    const normalizedSettings = normalizeEditorSettingsConfig(nextSettings).normalized
    try {
      const savedConfig = await saveConfigBridge({
        editorSettings: cloneEditorSettingsSnapshot(normalizedSettings)
      })
      if (!isRecord(savedConfig) || !isEditorSettingsSnapshot(savedConfig.editorSettings)) {
        setSettingsNotice('编辑器设置保存失败')
        return false
      }
      const savedSettings = normalizeEditorSettingsConfig(savedConfig.editorSettings).normalized
      if (!editorSettingsSnapshotsMatch(savedSettings, normalizedSettings)) {
        setSettingsNotice('编辑器设置保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        editorSettings: cloneEditorSettingsSnapshot(savedSettings)
      })
      editorSettings.value = cloneEditorSettingsSnapshot(savedSettings)
      applyEditorSettingsToDocument(savedSettings)
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '编辑器设置保存失败')
      return false
    }
  }

  const updateEditorSettings = async (patch: Partial<EditorSettings>) => {
    const nextSettings = normalizeEditorSettingsConfig({ ...getEditorSettingsSnapshot(), ...patch }).normalized
    const saved = await persistEditorSettings(nextSettings)
    if (saved) {
      setSettingsNotice('编辑器设置已保存')
    }
    return saved
  }

  const getTerminalSettingsSnapshot = (): TerminalUserConfig => ({ ...terminalSettings.value })

  const cloneTerminalSettingsSnapshot = (settings: TerminalSettings): TerminalUserConfig => ({ ...settings })

  const terminalSettingsSnapshotsMatch = (left: TerminalSettings, right: TerminalSettings) =>
    JSON.stringify(cloneTerminalSettingsSnapshot(left)) === JSON.stringify(cloneTerminalSettingsSnapshot(right))

  const persistTerminalSettings = async (nextSettings: TerminalSettings) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('终端设置保存服务不可用')
      return false
    }
    const normalizedSettings = normalizeTerminalConfig(nextSettings).normalized
    try {
      const savedConfig = await saveConfigBridge({
        terminal: cloneTerminalSettingsSnapshot(normalizedSettings)
      })
      if (!isRecord(savedConfig) || !isTerminalSettingsSnapshot(savedConfig.terminal)) {
        setSettingsNotice('终端设置保存失败')
        return false
      }
      const savedSettings = normalizeTerminalConfig(savedConfig.terminal).normalized
      if (!terminalSettingsSnapshotsMatch(savedSettings, normalizedSettings)) {
        setSettingsNotice('终端设置保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        terminal: cloneTerminalSettingsSnapshot(savedSettings)
      })
      terminalSettings.value = cloneTerminalSettingsSnapshot(savedSettings)
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '终端设置保存失败')
      return false
    }
  }

  const updateTerminalSettings = async (patch: Partial<TerminalSettings>) => {
    const nextSettings = normalizeTerminalConfig({ ...getTerminalSettingsSnapshot(), ...patch }).normalized
    const saved = await persistTerminalSettings(nextSettings)
    if (saved) {
      setSettingsNotice('终端设置已保存')
    }
    return saved
  }

  return {
    selectTheme,
    selectBackground,
    uploadCustomBackground,
    selectCustomBackground,
    clearCustomBackground,
    updateBackgroundTuning,
    updateDefaultLayout,
    updateLanguage,
    updateWatermark,
    updateEditorSettings,
    updateTerminalSettings
  }
}
