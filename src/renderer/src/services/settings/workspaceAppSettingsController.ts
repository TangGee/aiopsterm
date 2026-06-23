import { type Ref } from 'vue'
import { copyTextToClipboard } from '@/services/app/clipboardRuntime'
import { applyEditorSettingsToDocument } from '@/services/common/editorRuntime'
import { addSystemThemeListener, applyThemeToDocument, isThemeId, type ThemeId } from '@/services/app/themeRuntime'
import { appRuntimeClient, isOpenPathResult } from '@/services/app/appRuntimeClient'
import { createWorkspaceAppearanceSettingsController } from '@/services/settings/workspaceAppearanceSettingsController'
import { createWorkspaceAppUpdateController } from '@/services/settings/workspaceAppUpdateController'
import { createWorkspaceLayoutSettingsController } from '@/services/settings/workspaceLayoutSettingsController'
import { createWorkspaceModelSettingsController } from '@/services/settings/workspaceModelSettingsController'
import { createWorkspacePreferenceSettingsController } from '@/services/settings/workspacePreferenceSettingsController'
import { createWorkspaceSettingsConfigEditorsController } from '@/services/settings/workspaceSettingsConfigEditorsController'
import { createWorkspaceSettingsGuideController } from '@/services/settings/workspaceSettingsGuideController'
import { createWorkspaceSettingsHydrationController, type WorkspaceMcpSnapshot } from '@/services/settings/workspaceSettingsHydrationController'
import { createWorkspaceSshSettingsController } from '@/services/settings/workspaceSshSettingsController'
import { type QuickCommandSnippet, type SnippetGroup } from '@/services/quick-commands/quickCommandsRuntime'
import { resolveLocale } from '@/i18n/runtime'
import type { OnboardingModuleId } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type { SettingSectionKey } from '@/config/settings'
import {
  defaultConfig,
  mergeGenericSavedConfig,
  mergeUserConfig,
  normalizeEditorSettingsConfig,
  stripBusinessDataConfig,
  type AiPreferenceSettings,
  type EditorSettings,
  type ExtensionSettings,
  type GeneralBaseSettingsPatch,
  type KeywordHighlightSettings,
  type ModelProviderKey,
  type ModelProviderSettings,
  type PrivacySettings,
  type SecuritySettings,
  type SettingsModelOption,
  type TerminalSettings
} from '@/services/settings/workspaceConfigRuntime'
import type { UserConfig } from '@shared/contracts/userConfig'
import type {
  AiModelCatalogOption,
  NotificationUserConfig,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { KnowledgeNode } from '@shared/contracts/knowledgeBase'

export type WorkspaceTopUpdateState = 'idle' | 'checking' | 'local' | 'available' | 'install-requested'
export type WorkspaceGeneralBaseSettingsPatch = GeneralBaseSettingsPatch
export type WorkspaceOnboardingAiRequest =
  | 'none'
  | 'open-mode'
  | 'open-model'
  | 'open-context-main'
  | 'open-context-hosts'
  | 'prepare-send'
export type WorkspaceOnboardingAssetRequest = 'none' | 'open-host-management' | 'open-create-form'
export type WorkspaceSshProxyForm = SshProxyConfig
export type WorkspaceAiPreferencePatch = Partial<Omit<AiPreferenceSettings, 'proxy'>> & {
  proxy?: Partial<AiPreferenceSettings['proxy']>
}
export type WorkspaceAboutSettings = {
  version: string
  updateStatus: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'install-requested' | 'error'
  newVersion: string
  progress: number
}

type WorkspaceAppSettingsState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  leftPanelOpen: Ref<boolean>
  rightPanelOpen: Ref<boolean>
  agentsLeftOpen: Ref<boolean>
  leftPanelWidth: Ref<number>
  rightPanelWidth: Ref<number>
  agentsLeftWidth: Ref<number>
  topUpdateState: Ref<WorkspaceTopUpdateState>
  topNotice: Ref<string>
  onboardingCompleted: Ref<Record<OnboardingModuleId, boolean>>
  onboardingActiveTour: Ref<OnboardingModuleId | null>
  onboardingActiveStepIndex: Ref<number>
  onboardingGuideOpen: Ref<boolean>
  onboardingAiRequest: Ref<{ action: WorkspaceOnboardingAiRequest; stepId: string; sequence: number }>
  onboardingAssetRequest: Ref<{ action: WorkspaceOnboardingAssetRequest; stepId: string; sequence: number }>
  onboardingAutoApprovalEvent: Ref<number>
  config: Ref<UserConfig>
  savedGeneralBaseSettingsSnapshot: Ref<GeneralBaseSettingsPatch>
  themeListenerCleanup: Ref<(() => void) | null>
  workspacePreferences: Ref<WorkspaceUserConfig>
  snippetGroups: Ref<SnippetGroup[]>
  quickCommands: Ref<QuickCommandSnippet[]>
  knowledgeTree: Ref<KnowledgeNode[]>
  kbUsedBytes: Ref<number>
  kbTotalBytes: Ref<number>
  activeSettingsSection: Ref<SettingSectionKey>
  editorSettings: Ref<EditorSettings>
  terminalSettings: Ref<TerminalSettings>
  sshProxyConfigs: Ref<SshProxyConfig[]>
  sshProxyConfigModalOpen: Ref<boolean>
  sshProxyAddModalOpen: Ref<boolean>
  sshProxyForm: Ref<WorkspaceSshProxyForm>
  sshAgentKeys: Ref<SshAgentKeyConfig[]>
  sshAgentConfigModalOpen: Ref<boolean>
  sshAgentSelectedKey: Ref<string>
  sshAgentKeyChainOptions: Ref<SshAgentKeychainOption[]>
  aiModelOptions: Ref<AiModelCatalogOption[]>
  lockedAiModelOptions: Ref<AiModelCatalogOption[]>
  settingModelOptions: Ref<SettingsModelOption[]>
  addModelSwitch: Ref<boolean>
  modelProviders: Ref<Record<ModelProviderKey, ModelProviderSettings>>
  modelCheckState: Ref<Record<ModelProviderKey, 'idle' | 'checking' | 'success' | 'error'>>
  modelCheckRequestSeq: Ref<Record<ModelProviderKey, number>>
  aiPreferences: Ref<AiPreferenceSettings>
  notificationSettings: Ref<NotificationUserConfig>
  extensionSettings: Ref<ExtensionSettings>
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
  settingsDocumentationOpen: Ref<boolean>
  settingsDocumentationTitle: Ref<string>
  settingsDocumentationPath: Ref<string>
  settingsDocumentationContent: Ref<string>
  mcpConfigEditorOpen: Ref<boolean>
  privacySettings: Ref<PrivacySettings>
  aboutSettings: Ref<WorkspaceAboutSettings>
  settingsNotice: Ref<string>
}

type HydratedAliasResult = {
  normalizedAliasCommands: NonNullable<UserConfig['aliasCommands']>
  aliasCommandsLoadedFromBridge: boolean
}

type WorkspaceAppSettingsDeps = {
  refreshShortcutRuntime: () => void
  hydrateClassicChatData: (options?: { restoreIfEmpty?: boolean }) => Promise<boolean>
  setupKnowledgeBridgeListeners: () => void
  refreshAgentHookInstallers: (options?: { silent?: boolean }) => Promise<boolean>
  refreshUserAccount: () => Promise<boolean>
  hydrateAliasCommands: () => Promise<HydratedAliasResult>
  hydrateSettingsPreferences: (savedConfig: UserConfig) => Promise<{
    normalizedShortcuts: NonNullable<UserConfig['shortcuts']>
    normalizedRules: NonNullable<UserConfig['rules']>
  }>
  hydrateSkills: (savedSkills: unknown) => Promise<{
    normalizedSkills: NonNullable<UserConfig['skills']>
    skillsChanged: boolean
  }>
  readMcpServersSnapshotFromBridge: () => Promise<WorkspaceMcpSnapshot | null>
  applyMcpServersSnapshot: (snapshot: WorkspaceMcpSnapshot) => void
  loadSkillsFromBridge: () => Promise<unknown> | unknown
  refreshMcpServersFromBridge: () => Promise<unknown> | unknown
  closeMcpConfigEditor: () => void
  refreshControlNotificationAttentionItems: () => void
  ensureSelectedExtensionVisible: () => void
  openAccountCenter: (options?: { activateUserModule?: boolean; notifySettings?: boolean }) => unknown
  setActiveModule?: (key: ModuleKey) => void
}

const ONBOARDING_VERSION = defaultConfig.onboarding!.version

const normalizeThemeId = (theme: string): ThemeId => (isThemeId(theme) ? theme : 'dark')

export const createDefaultWorkspaceAboutSettings = (): WorkspaceAboutSettings => ({
  version: '0.1.0',
  updateStatus: 'idle',
  newVersion: '',
  progress: 0
})

export const createWorkspaceAppSettingsController = (state: WorkspaceAppSettingsState, deps: WorkspaceAppSettingsDeps) => {
  const {
    mode,
    activeModule,
    leftPanelOpen,
    rightPanelOpen,
    agentsLeftOpen,
    leftPanelWidth,
    rightPanelWidth,
    agentsLeftWidth,
    topUpdateState,
    topNotice,
    onboardingCompleted,
    onboardingActiveTour,
    onboardingActiveStepIndex,
    onboardingGuideOpen,
    onboardingAiRequest,
    onboardingAssetRequest,
    onboardingAutoApprovalEvent,
    config,
    savedGeneralBaseSettingsSnapshot,
    themeListenerCleanup,
    workspacePreferences,
    snippetGroups,
    quickCommands,
    knowledgeTree,
    kbUsedBytes,
    kbTotalBytes,
    activeSettingsSection,
    editorSettings,
    terminalSettings,
    sshProxyConfigs,
    sshProxyConfigModalOpen,
    sshProxyAddModalOpen,
    sshProxyForm,
    sshAgentKeys,
    sshAgentConfigModalOpen,
    sshAgentSelectedKey,
    sshAgentKeyChainOptions,
    aiModelOptions,
    lockedAiModelOptions,
    settingModelOptions,
    addModelSwitch,
    modelProviders,
    modelCheckState,
    modelCheckRequestSeq,
    aiPreferences,
    notificationSettings,
    extensionSettings,
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
    settingsDocumentationOpen,
    settingsDocumentationTitle,
    settingsDocumentationPath,
    settingsDocumentationContent,
    mcpConfigEditorOpen,
    privacySettings,
    aboutSettings,
    settingsNotice
  } = state

  const currentLocale = () => resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language])

  const applyCurrentTheme = () => {
    applyThemeToDocument(config.value.theme)
  }

  const applyCurrentEditorSettings = () => {
    applyEditorSettingsToDocument(editorSettings.value)
  }

  const hasSavedGeneralBaseSettingsSnapshot = () => Object.keys(savedGeneralBaseSettingsSnapshot.value).length > 0

  const restoreSavedGeneralBaseSettings = () => {
    if (!hasSavedGeneralBaseSettingsSnapshot()) return
    config.value = mergeGenericSavedConfig(config.value, savedGeneralBaseSettingsSnapshot.value)
  }

  const setupThemeBridge = () => {
    if (themeListenerCleanup.value) return
    themeListenerCleanup.value = addSystemThemeListener(() => {
      if (config.value.theme === 'auto') applyCurrentTheme()
    })
  }

  const setSettingsNotice = (text: string) => {
    settingsNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (settingsNotice.value === text) settingsNotice.value = ''
    }, 2400)
  }

  const setTopNotice = (message: string) => {
    topNotice.value = message
    if (!message) return
    window.setTimeout(() => {
      if (topNotice.value === message) topNotice.value = ''
    }, 2400)
  }

  const {
    refreshSshAgentKeychainOptions,
    openSshProxyConfig,
    closeSshProxyConfig,
    openAddSshProxyConfig,
    closeAddSshProxyConfig,
    updateSshProxyForm,
    saveSshProxyForm,
    removeSshProxyConfig,
    openSshAgentConfig,
    closeSshAgentConfig,
    setSshAgentSelectedKey,
    addSshAgentKey,
    removeSshAgentKey
  } = createWorkspaceSshSettingsController(
    {
      config,
      sshProxyConfigs,
      sshProxyConfigModalOpen,
      sshProxyAddModalOpen,
      sshProxyForm,
      sshAgentKeys,
      sshAgentConfigModalOpen,
      sshAgentSelectedKey,
      sshAgentKeyChainOptions
    },
    {
      setSettingsNotice
    }
  )

  const {
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
  } = createWorkspaceAppearanceSettingsController(
    {
      config,
      savedGeneralBaseSettingsSnapshot,
      editorSettings,
      terminalSettings
    },
    {
      currentLocale,
      applyCurrentTheme,
      applyCurrentEditorSettings,
      setupThemeBridge,
      refreshShortcutRuntime: deps.refreshShortcutRuntime,
      setSettingsNotice
    }
  )

  const {
    getExtensionSettingsSnapshot,
    updateWorkspacePreferences,
    updateAiPreferences,
    updateNotificationSettings,
    updateExtensionSettings,
    updatePrivacySettings
  } = createWorkspacePreferenceSettingsController(
    {
      config,
      workspacePreferences,
      aiPreferences,
      notificationSettings,
      extensionSettings,
      privacySettings,
      onboardingAutoApprovalEvent
    },
    {
      setSettingsNotice,
      setTopNotice,
      ensureSelectedExtensionVisible: deps.ensureSelectedExtensionVisible,
      refreshControlNotificationAttentionItems: deps.refreshControlNotificationAttentionItems
    }
  )

  const {
    applyModelSettingsSnapshot,
    refreshAiModelCatalog,
    selectAiModel,
    updateModelOption,
    removeModelOption,
    renameModelOption,
    toggleAddModelSwitch,
    updateModelProviderConfig,
    checkModelProvider,
    saveModelProvider
  } = createWorkspaceModelSettingsController(
    {
      config,
      aiModelOptions,
      lockedAiModelOptions,
      settingModelOptions,
      addModelSwitch,
      modelProviders,
      modelCheckState,
      modelCheckRequestSeq
    },
    {
      setSettingsNotice,
      setTopNotice
    }
  )

  const {
    checkAboutUpdate,
    checkTopUpdate,
    handleTopUpdateClick
  } = createWorkspaceAppUpdateController(
    {
      topUpdateState,
      aboutSettings,
      settingsNotice
    },
    {
      setSettingsNotice,
      setTopNotice
    }
  )

  const {
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
    resetSecurityConfigEditor
  } = createWorkspaceSettingsConfigEditorsController(
    {
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
    },
    {
      setSettingsNotice,
      closeMcpConfigEditor: deps.closeMcpConfigEditor
    }
  )

  const { hydrateConfig } = createWorkspaceSettingsHydrationController(
    {
      mode,
      activeModule,
      leftPanelOpen,
      rightPanelOpen,
      agentsLeftOpen,
      leftPanelWidth,
      rightPanelWidth,
      agentsLeftWidth,
      onboardingCompleted,
      config,
      savedGeneralBaseSettingsSnapshot,
      workspacePreferences,
      snippetGroups,
      quickCommands,
      knowledgeTree,
      kbUsedBytes,
      kbTotalBytes,
      editorSettings,
      terminalSettings,
      sshProxyConfigs,
      sshAgentKeys,
      sshAgentKeyChainOptions,
      aiModelOptions,
      lockedAiModelOptions,
      settingModelOptions,
      addModelSwitch,
      modelProviders,
      aiPreferences,
      notificationSettings,
      extensionSettings,
      keywordHighlightSettings,
      keywordHighlightEditorContent,
      securitySettings,
      securityConfigEditorContent,
      privacySettings
    },
    {
      currentLocale,
      applyCurrentTheme,
      applyCurrentEditorSettings,
      setupThemeBridge,
      refreshShortcutRuntime: deps.refreshShortcutRuntime,
      hydrateClassicChatData: deps.hydrateClassicChatData,
      setupKnowledgeBridgeListeners: deps.setupKnowledgeBridgeListeners,
      refreshAgentHookInstallers: deps.refreshAgentHookInstallers,
      refreshUserAccount: deps.refreshUserAccount,
      hydrateAliasCommands: deps.hydrateAliasCommands,
      hydrateSettingsPreferences: deps.hydrateSettingsPreferences,
      hydrateSkills: deps.hydrateSkills,
      readMcpServersSnapshotFromBridge: deps.readMcpServersSnapshotFromBridge,
      applyMcpServersSnapshot: deps.applyMcpServersSnapshot,
      refreshSshAgentKeychainOptions,
      refreshAiModelCatalog,
      applyModelSettingsSnapshot,
      restoreSavedGeneralBaseSettings,
      normalizeThemeId,
      setTopNotice
    }
  )

  const saveConfig = async (patch: Partial<UserConfig>) => {
    const normalizedPatch = stripBusinessDataConfig(patch.theme ? { ...patch, theme: normalizeThemeId(patch.theme) } : patch)
    config.value = mergeUserConfig(config.value, normalizedPatch)
    config.value.theme = normalizeThemeId(config.value.theme)
    applyCurrentTheme()
    setupThemeBridge()
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (saveConfigBridge) {
      config.value = mergeGenericSavedConfig(config.value, await saveConfigBridge(normalizedPatch))
    }
    config.value.theme = normalizeThemeId(config.value.theme)
    editorSettings.value = normalizeEditorSettingsConfig(config.value.editorSettings).normalized
    applyCurrentTheme()
    applyCurrentEditorSettings()
    deps.refreshShortcutRuntime()
    setupThemeBridge()
  }

  const {
    setActiveSettingsSection,
    openSettingsPageDocumentation,
    openSettingsDocumentationLink,
    openSettingsDocumentationFile,
    closeSettingsDocumentation,
    openOnboardingGuide,
    startOnboardingTour,
    stopOnboardingTour,
    nextOnboardingStep,
    previousOnboardingStep,
    jumpOnboardingStep,
    resetOnboarding
  } = createWorkspaceSettingsGuideController(
    {
      mode,
      activeModule,
      leftPanelOpen,
      rightPanelOpen,
      config,
      activeSettingsSection,
      settingsDocumentationOpen,
      settingsDocumentationTitle,
      settingsDocumentationPath,
      settingsDocumentationContent,
      onboardingCompleted,
      onboardingActiveTour,
      onboardingActiveStepIndex,
      onboardingGuideOpen,
      onboardingAiRequest,
      onboardingAssetRequest
    },
    {
      onboardingVersion: ONBOARDING_VERSION,
      currentLocale,
      saveConfig,
      setSettingsNotice,
      closeSettingsConfigEditors,
      loadSkillsFromBridge: deps.loadSkillsFromBridge,
      refreshMcpServersFromBridge: deps.refreshMcpServersFromBridge
    }
  )

  const {
    persistLayoutPreferences,
    openAiSessionSettings,
    toggleMode,
    toggleLeft,
    toggleRight,
    resizeLeftPanel,
    resizeRightPanel,
    quickCloseLeftPanel,
    quickCloseRightPanel
  } = createWorkspaceLayoutSettingsController(
    {
      mode,
      activeModule,
      leftPanelOpen,
      rightPanelOpen,
      agentsLeftOpen,
      leftPanelWidth,
      rightPanelWidth,
      agentsLeftWidth,
      onboardingGuideOpen,
      config
    },
    {
      setTopNotice,
      setActiveSettingsSection,
      refreshAgentHookInstallers: deps.refreshAgentHookInstallers
    }
  )

  const copySettingsText = async (text: string, label = '内容') => {
    const copied = await copyTextToClipboard(text)
    setSettingsNotice(copied ? `${label}已复制` : `${label}复制失败`)
    return copied
  }

  const openSettingsExternalAction = async (label: '日志目录' | '反馈页面' | '账户中心' | string) => {
    try {
      if (label === '日志目录') {
        const openLogDir = appRuntimeClient.openLogDir()
        if (!openLogDir) {
          setSettingsNotice('日志目录服务不可用')
          return false
        }
        const result = await openLogDir()
        if (!isOpenPathResult(result)) {
          setSettingsNotice('日志目录打开失败')
          return false
        }
        setSettingsNotice('日志目录已打开')
        return true
      }
      if (label === '反馈页面') {
        const submitSettingsFeedbackReport = appRuntimeClient.submitSettingsFeedbackReport()
        if (!submitSettingsFeedbackReport) {
          setSettingsNotice('反馈报告服务不可用')
          return false
        }
        const result = await submitSettingsFeedbackReport()
        if (!isOpenPathResult(result)) {
          setSettingsNotice('反馈报告生成失败')
          return false
        }
        setSettingsNotice('反馈报告已打开')
        return true
      }
      if (label === '账户中心') {
        return deps.openAccountCenter({ activateUserModule: true, notifySettings: true })
      }
      setSettingsNotice(`${label}服务不可用`)
      return false
    } catch {
      setSettingsNotice(`${label} 打开失败`)
      return false
    }
  }

  return {
    currentLocale,
    applyCurrentTheme,
    applyCurrentEditorSettings,
    restoreSavedGeneralBaseSettings,
    setupThemeBridge,
    refreshSshAgentKeychainOptions,
    hydrateConfig,
    saveConfig,
    setSettingsNotice,
    setTopNotice,
    copySettingsText,
    setActiveSettingsSection,
    openSettingsPageDocumentation,
    openSettingsDocumentationLink,
    openSettingsDocumentationFile,
    closeSettingsDocumentation,
    openOnboardingGuide,
    startOnboardingTour,
    stopOnboardingTour,
    nextOnboardingStep,
    previousOnboardingStep,
    jumpOnboardingStep,
    resetOnboarding,
    selectTheme,
    selectBackground,
    uploadCustomBackground,
    selectCustomBackground,
    clearCustomBackground,
    updateBackgroundTuning,
    updateDefaultLayout,
    updateLanguage,
    updateWatermark,
    persistLayoutPreferences,
    updateEditorSettings,
    updateTerminalSettings,
    openSshProxyConfig,
    closeSshProxyConfig,
    openAddSshProxyConfig,
    closeAddSshProxyConfig,
    updateSshProxyForm,
    saveSshProxyForm,
    removeSshProxyConfig,
    openSshAgentConfig,
    closeSshAgentConfig,
    setSshAgentSelectedKey,
    addSshAgentKey,
    removeSshAgentKey,
    updateWorkspacePreferences,
    refreshAiModelCatalog,
    selectAiModel,
    updateModelOption,
    removeModelOption,
    renameModelOption,
    toggleAddModelSwitch,
    updateModelProviderConfig,
    checkModelProvider,
    saveModelProvider,
    updateAiPreferences,
    updateNotificationSettings,
    updateExtensionSettings,
    openKeywordHighlightEditor,
    closeKeywordHighlightEditor,
    updateKeywordHighlightEditorContent,
    saveKeywordHighlightEditor,
    resetKeywordHighlightEditor,
    openSecurityConfigEditor,
    closeSecurityConfigEditor,
    updateSecurityConfigEditorContent,
    saveSecurityConfigEditor,
    resetSecurityConfigEditor,
    updatePrivacySettings,
    checkAboutUpdate,
    checkTopUpdate,
    handleTopUpdateClick,
    openSettingsExternalAction,
    openAiSessionSettings,
    toggleMode,
    toggleLeft,
    toggleRight,
    resizeLeftPanel,
    resizeRightPanel,
    quickCloseLeftPanel,
    quickCloseRightPanel,
    getExtensionSettingsSnapshot
  }
}
