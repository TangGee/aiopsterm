import { type Ref } from 'vue'
import { assetsClient } from '@/services/assetsClient'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import { applyEditorSettingsToDocument } from '@/services/editorRuntime'
import { applyKeywordHighlight } from '@/services/keywordHighlightRuntime'
import { localFilesClient } from '@/services/localFilesClient'
import { settingsConfigClient } from '@/services/settingsConfigClient'
import { addSystemThemeListener, applyThemeToDocument, isThemeId, type ThemeId } from '@/services/themeRuntime'
import {
  appRuntimeClient,
  appUpdateStatusMessage,
  hasAvailableAppUpdate,
  isAppUpdateCheckResult,
  isAppUpdateDownloadData,
  isAppUpdateInstallData,
  isAppUpdateProgressEvent,
  isOpenPathResult,
  isSettingsDocumentationResult,
  resolveUpdateVersion
} from '@/services/appRuntimeClient'
import {
  isModelProviderCheckDataForRequest,
  listAiModelCatalog,
  malformedModelProviderResultMessage,
  modelProviderClient
} from '@/services/modelProviderClient'
import { readStoredAiPanelMode } from '@/services/aiPanelModeRuntime'
import {
  cloneQuickCommandsSnapshot,
  type QuickCommandSnippet,
  type SnippetGroup
} from '@/services/quickCommandsRuntime'
import { cloneKnowledgeNodes } from '@/services/knowledgeRuntime'
import { quickCommandsClient } from '@/services/quickCommandsClient'
import {
  isQuickCommandsSnapshotData,
  malformedQuickCommandsBackendResultMessage
} from '@/services/quickCommandsBackendGuards'
import { applyDocumentLocale, resolveLocale } from '@/i18n/runtime'
import { onboardingTourSteps, createDefaultOnboardingCompleted } from '@/config/onboarding'
import type { OnboardingModuleId } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type { SettingSectionKey } from '@/config/settings'
import {
  backgroundSnapshotsMatch,
  cloneBackgroundSnapshot,
  cloneWorkspacePreferencesSnapshot,
  defaultAiPreferences,
  defaultConfig,
  defaultEditorSettings,
  defaultExtensionSettings,
  defaultKeywordHighlightSettings,
  defaultModelProviders,
  defaultNotificationSettings,
  defaultPrivacySettings,
  defaultSecuritySettings,
  defaultTerminalSettings,
  defaultWorkspacePreferences,
  generalBaseSettingsPatchMatches,
  isAiPreferencesSnapshot,
  isBackgroundSnapshot,
  isCustomBackgroundSaveResult,
  isEditorSettingsSnapshot,
  isGeneralBaseSettingsSnapshot,
  isKnowledgeSearchRuntimeSnapshotForRequest,
  isLayoutPreferencesSnapshot,
  isPrivacyRuntimeSnapshotForRequest,
  isTerminalSettingsSnapshot,
  isVisibleModelSettingsOption,
  isWorkspacePreferencesSnapshot,
  keywordHighlightEditorContentFromFile,
  keywordHighlightSettingsSnapshotsMatch,
  layoutPreferencesPatchMatches,
  layoutWidthFromConfig,
  layoutWidthLimits,
  mergeGenericSavedConfig,
  mergeUserConfig,
  modelOptionProviderForSavedProvider,
  modelSettingsSnapshotsMatch,
  normalizeAiPreferencesConfig,
  normalizeBackgroundConfig,
  normalizeCatalogModelProvider,
  normalizeEditorSettingsConfig,
  normalizeExtensionSettingsConfig,
  normalizeGeneralBaseSettingsPatch,
  normalizeKeywordHighlightConfig,
  normalizeKnowledgeBaseConfig,
  normalizeLayoutPreferencesPatch,
  normalizeMcpServersConfig,
  normalizeModelProviderConfig,
  normalizeModelSettingsConfig,
  normalizeNotificationConfig,
  normalizeOnboardingConfig,
  normalizePrivacyConfig,
  normalizeQuickCommandsConfig,
  normalizeSecurityConfig,
  normalizeSshAgentKeys,
  normalizeSshProxyConfigs,
  normalizeTerminalConfig,
  normalizeUserModelName,
  normalizeUserModelProvider,
  normalizeWorkspacePreferences,
  parseKeywordHighlightEditorContent,
  parseSecurityEditorContent,
  privacyRuntimeSettingsFromSnapshot,
  readSshAgentKeychainOptionsSnapshot,
  securityEditorContentFromFile,
  securitySettingsSnapshotsMatch,
  sshAgentKeySnapshotsMatch,
  sshProxyConfigSnapshotsMatch,
  sshProxyTypes,
  stripBusinessDataConfig,
  visibleBackgroundTuning,
  workspacePreferenceSnapshotsMatch,
  type AiPreferenceSettings,
  type BackgroundUserConfig,
  type EditorSettings,
  type ExtensionSettings,
  type GeneralBaseSettingsPatch,
  type KeywordHighlightSettings,
  type LayoutPreferencesPatch,
  type ModelProviderKey,
  type ModelProviderSettings,
  type PrivacySettings,
  type SecuritySettings,
  type SettingsModelOption,
  type TerminalSettings
} from '@/services/workspaceConfigRuntime'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import type { UserConfig } from '@shared/contracts/userConfig'
import type {
  AiModelCatalog,
  AiModelCatalogOption,
  AiPreferencesUserConfig,
  AppUpdateProgressEvent,
  EditorUserConfig,
  KnowledgeSearchRuntimeSnapshot,
  ModelSettingsUserConfig,
  NotificationUserConfig,
  OpenSettingsDocumentationInput,
  PrivacyRuntimeSnapshot,
  PrivacyUserConfig,
  SettingsDocumentationPage,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  TerminalUserConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { KnowledgeBaseUserConfig, KnowledgeNode } from '@shared/contracts/knowledgeBase'

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
export type WorkspaceMcpSnapshot = ReturnType<typeof normalizeMcpServersConfig>

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

type PrivacyRuntimeApplyData = PrivacyRuntimeSnapshot
type KnowledgeSearchRuntimeApplyData = KnowledgeSearchRuntimeSnapshot

const ONBOARDING_VERSION = defaultConfig.onboarding!.version

const normalizeThemeId = (theme: string): ThemeId => (isThemeId(theme) ? theme : 'dark')

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) => (typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback)

const isThemeSnapshot = (value: unknown): value is ThemeId => typeof value === 'string' && isThemeId(value)

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

  let keywordHighlightSaveTimer: number | null = null
  let removeKeywordHighlightConfigFileListener: (() => void) | null = null
  let keywordHighlightLoadRequest = 0
  let securityConfigSaveTimer: number | null = null
  let removeSecurityConfigFileListener: (() => void) | null = null
  let securityConfigLoadRequest = 0
  let removeAppUpdateProgressListener: (() => void) | null = null
  let aiModelCatalogLoadPromise: Promise<AiModelCatalog> | null = null

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

  const refreshSshAgentKeychainOptions = async () => {
    const listSshAgentKeychainOptions = assetsClient.listSshAgentKeychainOptions()
    if (!listSshAgentKeychainOptions) {
      setSettingsNotice('SSH Agent 密钥列表服务不可用')
      return false
    }
    try {
      const options = readSshAgentKeychainOptionsSnapshot(await listSshAgentKeychainOptions())
      if (!options) {
        setSettingsNotice('SSH Agent 密钥列表返回数据无效')
        return false
      }
      sshAgentKeyChainOptions.value = options
      return true
    } catch {
      setSettingsNotice('SSH Agent 密钥列表加载失败')
      return false
    }
  }

  const applyAiModelCatalog = (catalog: AiModelCatalog, options: { replaceSettingsOptions?: boolean } = {}) => {
    aiModelOptions.value = catalog.chatModels.map((model) => ({ ...model }))
    lockedAiModelOptions.value = catalog.lockedChatModels.map((model) => ({ ...model, locked: true }))
    if (options.replaceSettingsOptions) {
      settingModelOptions.value = catalog.settingsModels
        .filter(isVisibleModelSettingsOption)
        .map((model) => ({
          name: model.name,
          displayName: model.displayName,
          locked: model.locked,
          checked: model.checked,
          type: model.type,
          apiProvider: model.apiProvider
        }))
    }
    return catalog
  }

  const refreshAiModelCatalog = async (options: { replaceSettingsOptions?: boolean } = {}) => {
    const replaceSettingsOptions = options.replaceSettingsOptions ?? settingModelOptions.value.length === 0
    if (!modelProviderClient.listAiModels()) {
      setSettingsNotice('模型列表加载服务不可用')
      return null
    }
    aiModelCatalogLoadPromise ||= listAiModelCatalog({ modelSettings: normalizeModelSettingsConfig(config.value.modelSettings).normalized })
      .then((catalog) => catalog || Promise.reject(new Error('模型列表加载服务不可用')))
      .finally(() => {
        aiModelCatalogLoadPromise = null
      })
    try {
      const catalog = await aiModelCatalogLoadPromise
      return applyAiModelCatalog(catalog, {
        replaceSettingsOptions
      })
    } catch (error) {
      setSettingsNotice(`模型列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  const hydrateConfig = async () => {
    const getConfigBridge = appRuntimeClient.getConfig()
    if (!getConfigBridge) return
    const savedConfig = await getConfigBridge()
    const missingAgentsLeftOpen = typeof savedConfig.agentsLeftOpen !== 'boolean'
    const missingTerminalConfig = !isRecord(savedConfig.terminal)
    const missingWorkspacePreferences = !isRecord(savedConfig.workspacePreferences)
    const missingEditorSettings = !isRecord(savedConfig.editorSettings)
    const missingSshProxyConfigs = !Array.isArray(savedConfig.sshProxyConfigs)
    const missingSshAgentKeys = !Array.isArray(savedConfig.sshAgentKeys)
    const missingExtensionSettings = !isRecord(savedConfig.extensionSettings)
    const missingKeywordHighlight = !isRecord(savedConfig.keywordHighlight)
    const missingSecurityConfig = !isRecord(savedConfig.securityConfig)
    const missingPrivacy = !isRecord(savedConfig.privacy)
    const missingAiPreferences = !isRecord(savedConfig.aiPreferences)
    const savedModelSettings: Record<string, unknown> = isRecord(savedConfig.modelSettings) ? savedConfig.modelSettings : {}
    const missingModelSettings = !isRecord(savedConfig.modelSettings)
    const missingModelOptions = !Array.isArray(savedModelSettings.options)
    const missingSkills = !Array.isArray(savedConfig.skills)
    const missingMcpServers = !Array.isArray(savedConfig.mcpServers)
    config.value = mergeUserConfig(defaultConfig, savedConfig)
    restoreSavedGeneralBaseSettings()
    const { normalized: normalizedTerminal, changed: terminalChanged } = normalizeTerminalConfig(config.value.terminal)
    terminalSettings.value = normalizedTerminal
    const { normalized: normalizedWorkspacePreferences, changed: workspacePreferencesChanged } = normalizeWorkspacePreferences(config.value.workspacePreferences)
    workspacePreferences.value = normalizedWorkspacePreferences
    const { normalized: normalizedEditorSettings, changed: editorSettingsChanged } = normalizeEditorSettingsConfig(savedConfig.editorSettings)
    editorSettings.value = normalizedEditorSettings
    const { normalized: normalizedSshProxyConfigs, changed: sshProxyConfigsChanged } = normalizeSshProxyConfigs(savedConfig.sshProxyConfigs)
    sshProxyConfigs.value = normalizedSshProxyConfigs.map((config) => ({ ...config }))
    const { normalized: normalizedSshAgentKeys, changed: sshAgentKeysChanged } = normalizeSshAgentKeys(savedConfig.sshAgentKeys)
    sshAgentKeys.value = normalizedSshAgentKeys.map((key) => ({ ...key }))
    await refreshSshAgentKeychainOptions()
    const { normalized: normalizedExtensionSettings, changed: extensionSettingsChanged } = normalizeExtensionSettingsConfig(savedConfig.extensionSettings)
    extensionSettings.value = normalizedExtensionSettings
    const { normalized: normalizedKeywordHighlight, changed: keywordHighlightChanged } = normalizeKeywordHighlightConfig(savedConfig.keywordHighlight)
    keywordHighlightSettings.value = normalizedKeywordHighlight
    keywordHighlightEditorContent.value = JSON.stringify(normalizedKeywordHighlight, null, 2)
    const { normalized: normalizedSecurityConfig, changed: securityConfigChanged } = normalizeSecurityConfig(savedConfig.securityConfig)
    securitySettings.value = normalizedSecurityConfig
    securityConfigEditorContent.value = JSON.stringify(normalizedSecurityConfig, null, 2)
    const { normalized: normalizedPrivacy, changed: privacyChanged } = normalizePrivacyConfig(savedConfig.privacy)
    privacySettings.value = {
      ...normalizedPrivacy,
      ...privacyRuntimeSettingsFromSnapshot(),
      deactivateModalOpen: false,
      deactivateConfirmationInput: '',
      deactivateLoading: false
    }
    const { normalized: normalizedAiPreferences, changed: aiPreferencesChanged } = normalizeAiPreferencesConfig(savedConfig.aiPreferences)
    aiPreferences.value = {
      ...normalizedAiPreferences,
      proxy: { ...normalizedAiPreferences.proxy }
    }
    const { normalized: normalizedNotifications, changed: notificationsChanged } = normalizeNotificationConfig(savedConfig.notifications)
    notificationSettings.value = { ...normalizedNotifications }
    const aiStartupRefresh = readStoredAiPanelMode() === 'classic' ? deps.hydrateClassicChatData({ restoreIfEmpty: true }) : Promise.resolve(true)
    const modelCatalog = await refreshAiModelCatalog({ replaceSettingsOptions: false })
    const modelCatalogSettingsOptions = modelCatalog?.settingsModels || []
    const modelSettingsSource =
      (missingModelSettings || missingModelOptions) && modelCatalog
        ? {
            ...savedModelSettings,
            options: modelCatalogSettingsOptions
          }
        : savedConfig.modelSettings
    const { changed: modelSettingsChanged } = normalizeModelSettingsConfig(modelSettingsSource, modelCatalogSettingsOptions)
    const normalizedModelSettings = applyModelSettingsSnapshot(modelSettingsSource)
    let normalizedQuickCommands = normalizeQuickCommandsConfig().normalized
    const getQuickCommands = quickCommandsClient.getQuickCommands()
    if (getQuickCommands) {
      try {
        const bridgeQuickCommands = await getQuickCommands()
        if (isQuickCommandsSnapshotData(bridgeQuickCommands)) {
          normalizedQuickCommands = bridgeQuickCommands
        } else {
          setTopNotice(malformedQuickCommandsBackendResultMessage)
        }
      } catch {
        setTopNotice('快捷命令加载失败')
      }
    } else {
      setTopNotice('快捷命令加载服务不可用')
    }
    const quickCommandsSnapshot = cloneQuickCommandsSnapshot(normalizedQuickCommands)
    snippetGroups.value = quickCommandsSnapshot.groups
    quickCommands.value = quickCommandsSnapshot.snippets
    const {
      normalized: normalizedKnowledgeBase
    } = normalizeKnowledgeBaseConfig(savedConfig.knowledgeBase)
    knowledgeTree.value = cloneKnowledgeNodes(normalizedKnowledgeBase.tree)
    kbUsedBytes.value = normalizedKnowledgeBase.usedBytes
    kbTotalBytes.value = normalizedKnowledgeBase.totalBytes
    const { normalizedAliasCommands, aliasCommandsLoadedFromBridge } = await deps.hydrateAliasCommands()
    const { normalizedShortcuts, normalizedRules } = await deps.hydrateSettingsPreferences(savedConfig)
    const { normalizedSkills, skillsChanged } = await deps.hydrateSkills(savedConfig.skills)
    const savedMcpSnapshot = normalizeMcpServersConfig(savedConfig.mcpServers, savedConfig.mcpToolStates)
    const bridgeMcpSnapshot = await deps.readMcpServersSnapshotFromBridge()
    const normalizedMcpSnapshot = bridgeMcpSnapshot || savedMcpSnapshot
    if (bridgeMcpSnapshot) {
      deps.applyMcpServersSnapshot(bridgeMcpSnapshot)
    }
    const { normalized, changed } = normalizeOnboardingConfig(config.value.onboarding)
    onboardingCompleted.value = normalized.completedModules
    config.value = mergeUserConfig(config.value, {
      terminal: normalizedTerminal,
      workspacePreferences: normalizedWorkspacePreferences,
      editorSettings: normalizedEditorSettings,
      sshProxyConfigs: normalizedSshProxyConfigs,
      sshAgentKeys: normalizedSshAgentKeys,
      extensionSettings: normalizedExtensionSettings,
      keywordHighlight: normalizedKeywordHighlight,
      securityConfig: normalizedSecurityConfig,
      privacy: normalizedPrivacy,
      aiPreferences: normalizedAiPreferences,
      notifications: normalizedNotifications,
      modelSettings: normalizedModelSettings,
      quickCommands: normalizedQuickCommands,
      knowledgeBase: normalizedKnowledgeBase as KnowledgeBaseUserConfig,
      ...(aliasCommandsLoadedFromBridge ? { aliasCommands: normalizedAliasCommands } : {}),
      shortcuts: normalizedShortcuts,
      rules: normalizedRules,
      skills: normalizedSkills,
      customInstructions: '',
      mcpServers: normalizedMcpSnapshot.normalized,
      mcpToolStates: normalizedMcpSnapshot.toolStates,
      onboarding: normalized
    })
    restoreSavedGeneralBaseSettings()
    if (
      changed ||
      terminalChanged ||
      missingTerminalConfig ||
      workspacePreferencesChanged ||
      missingWorkspacePreferences ||
      editorSettingsChanged ||
      missingEditorSettings ||
      sshProxyConfigsChanged ||
      missingSshProxyConfigs ||
      sshAgentKeysChanged ||
      missingSshAgentKeys ||
      extensionSettingsChanged ||
      missingExtensionSettings ||
      keywordHighlightChanged ||
      missingKeywordHighlight ||
      securityConfigChanged ||
      missingSecurityConfig ||
      privacyChanged ||
      missingPrivacy ||
      aiPreferencesChanged ||
      missingAiPreferences ||
      notificationsChanged ||
      missingAgentsLeftOpen ||
      modelSettingsChanged ||
      missingModelSettings ||
      skillsChanged ||
      missingSkills ||
      savedMcpSnapshot.changed ||
      missingMcpServers
    ) {
      const saveConfigBridge = appRuntimeClient.saveConfig()
      if (!saveConfigBridge) return
      config.value = mergeGenericSavedConfig(
        config.value,
        await saveConfigBridge({
          agentsLeftOpen: config.value.agentsLeftOpen,
          terminal: normalizedTerminal,
          workspacePreferences: normalizedWorkspacePreferences,
          editorSettings: normalizedEditorSettings,
          sshProxyConfigs: normalizedSshProxyConfigs,
          sshAgentKeys: normalizedSshAgentKeys,
          extensionSettings: normalizedExtensionSettings,
          keywordHighlight: normalizedKeywordHighlight,
          securityConfig: normalizedSecurityConfig,
          privacy: normalizedPrivacy,
          aiPreferences: normalizedAiPreferences,
          notifications: normalizedNotifications,
          modelSettings: normalizedModelSettings,
          skills: normalizedSkills,
          customInstructions: '',
          mcpServers: normalizedMcpSnapshot.normalized,
          mcpToolStates: normalizedMcpSnapshot.toolStates,
          onboarding: normalized
        })
      )
    }
    restoreSavedGeneralBaseSettings()
    mode.value = config.value.defaultMode
    leftPanelOpen.value = config.value.leftPanelOpen
    rightPanelOpen.value = config.value.rightPanelOpen
    agentsLeftOpen.value = config.value.agentsLeftOpen
    leftPanelWidth.value = layoutWidthFromConfig(config.value.leftPanelWidth, defaultConfig.leftPanelWidth!)
    rightPanelWidth.value = layoutWidthFromConfig(config.value.rightPanelWidth, defaultConfig.rightPanelWidth!)
    agentsLeftWidth.value = layoutWidthFromConfig(config.value.agentsLeftWidth, defaultConfig.agentsLeftWidth!)
    config.value.theme = normalizeThemeId(config.value.theme)
    applyDocumentLocale(currentLocale())
    applyCurrentTheme()
    applyCurrentEditorSettings()
    deps.refreshShortcutRuntime()
    setupThemeBridge()
    await deps.refreshUserAccount()
    deps.setupKnowledgeBridgeListeners()
    void deps.refreshAgentHookInstallers({ silent: true })
    await aiStartupRefresh
    restoreSavedGeneralBaseSettings()
    applyDocumentLocale(currentLocale())
  }

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
        savedSettings.aliasStatus !== normalizedSettings.aliasStatus ||
        savedSettings.highlightStatus !== normalizedSettings.highlightStatus
      ) {
        setSettingsNotice('扩展设置保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        extensionSettings: savedSettings
      })
      extensionSettings.value = { ...savedSettings }
      deps.ensureSelectedExtensionVisible()
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '扩展设置保存失败')
      return false
    }
  }

  const getPrivacySnapshot = (): PrivacyUserConfig => ({
    telemetry: privacySettings.value.telemetry,
    secretRedaction: privacySettings.value.secretRedaction,
    dataSync: privacySettings.value.dataSync
  })

  const privacySnapshotsMatch = (left: PrivacyUserConfig, right: PrivacyUserConfig) =>
    left.telemetry === right.telemetry && left.secretRedaction === right.secretRedaction && left.dataSync === right.dataSync

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
    setSettingsNotice(rolledBack ? message : `${message}；AI 偏好设置回滚失败`)
    return false
  }

  const persistAiPreferences = async (previousPreferences: AiPreferenceSettings, nextPreferences: AiPreferenceSettings) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('AI 偏好设置保存服务不可用')
      return false
    }
    const normalizedPreferences = normalizeAiPreferencesConfig(nextPreferences).normalized
    try {
      const savedConfig = await saveConfigBridge({
        aiPreferences: cloneAiPreferencesSnapshot(normalizedPreferences)
      })
      const saved = validatedSavedAiPreferences(savedConfig, normalizedPreferences)
      if (!saved) {
        setSettingsNotice('AI 偏好设置保存失败')
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
      setSettingsNotice(error instanceof Error ? error.message : 'AI 偏好设置保存失败')
      return false
    }
  }

  const getModelSettingsSnapshot = (): ModelSettingsUserConfig => ({
    addModelSwitch: addModelSwitch.value,
    providers: {
      litellm: { ...modelProviders.value.litellm },
      openai: { ...modelProviders.value.openai },
      bedrock: { ...modelProviders.value.bedrock },
      deepseek: { ...modelProviders.value.deepseek },
      anthropic: { ...modelProviders.value.anthropic },
      ollama: { ...modelProviders.value.ollama },
      lmstudio: { ...modelProviders.value.lmstudio }
    },
    options: settingModelOptions.value.filter(isVisibleModelSettingsOption).map((option) => ({
      name: option.name,
      displayName: option.displayName,
      locked: Boolean(option.locked),
      checked: Boolean(option.checked),
      type: option.type || (option.locked ? 'standard' : 'custom'),
      apiProvider: option.apiProvider || (option.locked ? 'default' : 'openai')
    }))
  })

  const getPersistedModelSettingsSnapshot = (): ModelSettingsUserConfig => normalizeModelSettingsConfig(config.value.modelSettings).normalized

  const getModelSettingsSnapshotWithProviderModel = (provider: ModelProviderKey, providerSettings: ModelProviderSettings): ModelSettingsUserConfig => {
    const modelName = providerSettings.modelId.trim()
    const nextSettings = getModelSettingsSnapshot()
    nextSettings.providers = {
      ...nextSettings.providers,
      [provider]: { ...providerSettings }
    }
    if (!modelName) return normalizeModelSettingsConfig(nextSettings).normalized
    const existingIndex = nextSettings.options.findIndex((option) => option.name === modelName)
    const apiProvider = modelOptionProviderForSavedProvider(provider)
    if (existingIndex >= 0) {
      nextSettings.options = nextSettings.options.map((option, index) =>
        index === existingIndex && !option.locked
          ? {
              ...option,
              checked: true,
              type: 'custom',
              displayName: option.displayName,
              apiProvider
            }
          : option
      )
    } else {
      nextSettings.options = [
        ...nextSettings.options,
        {
          name: modelName,
          displayName: undefined,
          locked: false,
          checked: true,
          type: 'custom',
          apiProvider
        }
      ]
    }
    return normalizeModelSettingsConfig(nextSettings).normalized
  }

  const applyModelOptionSettingsSnapshot = (settings: ModelSettingsUserConfig) => {
    addModelSwitch.value = settings.addModelSwitch
    settingModelOptions.value = settings.options.filter(isVisibleModelSettingsOption).map((option) => ({
      name: option.name,
      displayName: option.displayName,
      locked: option.locked,
      checked: option.checked,
      type: option.type,
      apiProvider: option.apiProvider
    }))
  }

  const applyModelSettingsSnapshot = (source: unknown) => {
    const { normalized } = normalizeModelSettingsConfig(source)
    modelProviders.value = {
      litellm: { ...normalized.providers.litellm },
      openai: { ...normalized.providers.openai },
      bedrock: { ...normalized.providers.bedrock },
      deepseek: { ...normalized.providers.deepseek },
      anthropic: { ...normalized.providers.anthropic },
      ollama: { ...normalized.providers.ollama },
      lmstudio: { ...normalized.providers.lmstudio }
    }
    applyModelOptionSettingsSnapshot(normalized)
    return normalized
  }

  const persistModelSettings = async (
    nextSettings: ModelSettingsUserConfig,
    unavailableMessage = '模型设置保存服务不可用',
    failureMessage = '模型设置保存失败'
  ) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice(unavailableMessage)
      return false
    }
    try {
      const savedConfig = await saveConfigBridge({ modelSettings: nextSettings })
      if (!isRecord(savedConfig) || !isRecord(savedConfig.modelSettings)) {
        setSettingsNotice(failureMessage)
        return false
      }
      const savedModelSettings = normalizeModelSettingsConfig(savedConfig.modelSettings).normalized
      if (!modelSettingsSnapshotsMatch(savedModelSettings, nextSettings)) {
        setSettingsNotice(failureMessage)
        return false
      }
      applyModelOptionSettingsSnapshot(savedModelSettings)
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        modelSettings: savedModelSettings
      })
      await refreshAiModelCatalog({ replaceSettingsOptions: false })
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : failureMessage)
      return false
    }
  }

  const persistOnboardingState = async () => {
    await saveConfig({
      onboarding: {
        version: ONBOARDING_VERSION,
        guideTabAutoOpened: Boolean(config.value.onboarding?.guideTabAutoOpened),
        completedModules: { ...onboardingCompleted.value }
      }
    })
  }

  const copySettingsText = async (text: string, label = '内容') => {
    const copied = await copyTextToClipboard(text)
    setSettingsNotice(copied ? `${label}已复制` : `${label}复制失败`)
    return copied
  }

  const closeSettingsInlineEditors = () => {
    if (keywordHighlightEditorOpen.value) {
      closeKeywordHighlightEditor()
    }
    if (securityConfigEditorOpen.value) {
      closeSecurityConfigEditor()
    }
    if (mcpConfigEditorOpen.value) {
      deps.closeMcpConfigEditor()
    }
    settingsDocumentationOpen.value = false
    onboardingGuideOpen.value = false
  }

  const readSettingsDocumentation = async (input?: OpenSettingsDocumentationInput) => {
    const openSettingsDocumentationBridge = appRuntimeClient.openSettingsDocumentation()
    if (!openSettingsDocumentationBridge) {
      setSettingsNotice('文档入口服务不可用')
      return false
    }
    const result = await openSettingsDocumentationBridge(input)
    if (!isSettingsDocumentationResult(result)) {
      setSettingsNotice('文档入口打开失败')
      return false
    }
    settingsDocumentationPath.value = result.path
    settingsDocumentationTitle.value = result.title
    settingsDocumentationContent.value = result.content
    settingsDocumentationOpen.value = true
    setSettingsNotice('已打开文档')
    return true
  }

  const openSettingsDocumentation = async (page?: SettingsDocumentationPage) => {
    if (keywordHighlightEditorOpen.value) closeKeywordHighlightEditor()
    if (securityConfigEditorOpen.value) closeSecurityConfigEditor()
    if (mcpConfigEditorOpen.value) deps.closeMcpConfigEditor()
    onboardingGuideOpen.value = false
    if (!page) activeSettingsSection.value = 'general'
    try {
      return await readSettingsDocumentation(page ? { page, locale: currentLocale() } : undefined)
    } catch {
      setSettingsNotice('文档入口打开失败')
      return false
    }
  }

  const openSettingsPageDocumentation = (page: SettingsDocumentationPage) => openSettingsDocumentation(page)

  const openSettingsDocumentationLink = async (documentPath: string) => {
    const normalizedPath = documentPath.trim()
    if (!normalizedPath) return false
    try {
      return await readSettingsDocumentation({ documentPath: normalizedPath, basePath: settingsDocumentationPath.value })
    } catch {
      setSettingsNotice('文档入口打开失败')
      return false
    }
  }

  const openSettingsDocumentationFile = async (documentPath: string) => {
    const normalizedPath = documentPath.trim()
    if (!normalizedPath) return false
    try {
      return await readSettingsDocumentation({ documentPath: normalizedPath })
    } catch {
      setSettingsNotice('文档入口打开失败')
      return false
    }
  }

  const closeSettingsDocumentation = () => {
    settingsDocumentationOpen.value = false
  }

  const setActiveSettingsSection = (key: SettingSectionKey) => {
    if (key === 'docs') {
      void openSettingsDocumentation()
      return
    }
    closeSettingsInlineEditors()
    activeSettingsSection.value = key
    if (key === 'skills') {
      void deps.loadSkillsFromBridge()
    } else if (key === 'mcp') {
      void deps.refreshMcpServersFromBridge()
    }
  }

  const prepareOnboardingStep = (moduleId: OnboardingModuleId, stepId: string) => {
    if (mode.value !== 'terminal') mode.value = 'terminal'
    onboardingAiRequest.value = {
      action: 'none',
      stepId,
      sequence: onboardingAiRequest.value.sequence + 1
    }
    onboardingAssetRequest.value = {
      action: 'none',
      stepId,
      sequence: onboardingAssetRequest.value.sequence + 1
    }

    if (moduleId === 'interfaceGuide') {
      activeModule.value = 'workspace'
      leftPanelOpen.value = true
      if (stepId === 'ai-sidebar') rightPanelOpen.value = true
      return
    }

    if (moduleId === 'systemSettings') {
      activeModule.value = 'settings'
      rightPanelOpen.value = false
      if (stepId === 'terminal-tab' || stepId === 'terminal-options') {
        activeSettingsSection.value = 'terminal'
      } else if (stepId === 'ai-preferences-tab' || stepId === 'ai-preferences-content' || stepId === 'ai-auto-approval') {
        activeSettingsSection.value = 'ai'
      } else {
        activeSettingsSection.value = 'general'
      }
      return
    }

    if (moduleId === 'addAndConnectHost') {
      activeModule.value = 'assets'
      leftPanelOpen.value = true
      rightPanelOpen.value = true
      const assetRequestMap: Record<string, WorkspaceOnboardingAssetRequest> = {
        'host-management': 'open-host-management',
        'new-host': 'open-host-management',
        'form-fields': 'open-create-form',
        'form-submit': 'open-create-form'
      }
      onboardingAssetRequest.value = {
        action: assetRequestMap[stepId] || 'none',
        stepId,
        sequence: onboardingAssetRequest.value.sequence + 1
      }
      if (stepId === 'new-host') setSettingsNotice('点击新建主机继续引导')
      return
    }

    if (moduleId === 'aiChat') {
      activeModule.value = 'workspace'
      leftPanelOpen.value = true
      rightPanelOpen.value = true
      const requestMap: Record<string, WorkspaceOnboardingAiRequest> = {
        'ai-mode-agent': 'open-mode',
        'ai-model-open': 'none',
        'ai-model-option': 'open-model',
        'ai-context-open': 'none',
        'ai-context-hosts': 'open-context-main',
        'ai-localhost-option': 'open-context-hosts',
        'ai-send': 'prepare-send'
      }
      onboardingAiRequest.value = {
        action: requestMap[stepId] || 'none',
        stepId,
        sequence: onboardingAiRequest.value.sequence + 1
      }
    }
  }

  const openOnboardingGuide = () => {
    activeModule.value = 'settings'
    activeSettingsSection.value = 'general'
    rightPanelOpen.value = false
    onboardingGuideOpen.value = true
    onboardingActiveTour.value = null
    onboardingActiveStepIndex.value = 0
    config.value = {
      ...config.value,
      onboarding: {
        version: ONBOARDING_VERSION,
        guideTabAutoOpened: true,
        completedModules: { ...onboardingCompleted.value }
      }
    }
    persistOnboardingState()
    setSettingsNotice('已打开入门引导')
  }

  const startOnboardingTour = (moduleId: OnboardingModuleId) => {
    onboardingActiveTour.value = moduleId
    onboardingActiveStepIndex.value = 0
    onboardingGuideOpen.value = false
    prepareOnboardingStep(moduleId, onboardingTourSteps[moduleId][0]?.id || '')
  }

  const stopOnboardingTour = () => {
    onboardingActiveTour.value = null
    onboardingActiveStepIndex.value = 0
  }

  const nextOnboardingStep = () => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    const nextIndex = onboardingActiveStepIndex.value + 1
    if (nextIndex >= onboardingTourSteps[moduleId].length) {
      onboardingCompleted.value = { ...onboardingCompleted.value, [moduleId]: true }
      persistOnboardingState()
      stopOnboardingTour()
      setSettingsNotice(`${moduleId === 'interfaceGuide' ? '界面导览' : moduleId === 'systemSettings' ? '系统设置' : moduleId === 'addAndConnectHost' ? '添加并连接主机' : 'AI 会话'} 引导已完成`)
      return
    }
    onboardingActiveStepIndex.value = nextIndex
    prepareOnboardingStep(moduleId, onboardingTourSteps[moduleId][nextIndex]?.id || '')
  }

  const previousOnboardingStep = () => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    onboardingActiveStepIndex.value = Math.max(0, onboardingActiveStepIndex.value - 1)
    prepareOnboardingStep(moduleId, onboardingTourSteps[moduleId][onboardingActiveStepIndex.value]?.id || '')
  }

  const jumpOnboardingStep = (stepId: string) => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    const nextIndex = onboardingTourSteps[moduleId].findIndex((step) => step.id === stepId)
    if (nextIndex < 0) return
    onboardingActiveStepIndex.value = nextIndex
    prepareOnboardingStep(moduleId, stepId)
  }

  const resetOnboarding = () => {
    onboardingCompleted.value = createDefaultOnboardingCompleted()
    stopOnboardingTour()
    config.value = {
      ...config.value,
      onboarding: {
        version: ONBOARDING_VERSION,
        guideTabAutoOpened: false,
        completedModules: { ...onboardingCompleted.value }
      }
    }
    persistOnboardingState()
    setSettingsNotice('入门引导进度已重置')
  }

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
      deps.refreshShortcutRuntime()
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

  const applyLayoutPreferencesSnapshot = (savedConfig: UserConfig) => {
    config.value = mergeGenericSavedConfig(config.value, savedConfig)
    mode.value = config.value.defaultMode
    leftPanelOpen.value = config.value.leftPanelOpen
    rightPanelOpen.value = config.value.rightPanelOpen
    agentsLeftOpen.value = config.value.agentsLeftOpen
    leftPanelWidth.value = layoutWidthFromConfig(config.value.leftPanelWidth, defaultConfig.leftPanelWidth!)
    rightPanelWidth.value = layoutWidthFromConfig(config.value.rightPanelWidth, defaultConfig.rightPanelWidth!)
    agentsLeftWidth.value = layoutWidthFromConfig(config.value.agentsLeftWidth, defaultConfig.agentsLeftWidth!)
  }

  const persistLayoutPreferences = async (patch: LayoutPreferencesPatch) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setTopNotice('布局设置保存服务不可用')
      return false
    }
    const normalizedPatch = normalizeLayoutPreferencesPatch(patch)
    if (!normalizedPatch || !Object.keys(normalizedPatch).length) {
      setTopNotice('布局设置保存失败')
      return false
    }
    try {
      const savedConfig = await saveConfigBridge(normalizedPatch)
      if (!isLayoutPreferencesSnapshot(savedConfig) || !layoutPreferencesPatchMatches(normalizedPatch, savedConfig)) {
        setTopNotice('布局设置保存失败')
        return false
      }
      applyLayoutPreferencesSnapshot(savedConfig)
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : '布局设置保存失败')
      return false
    }
  }

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
      applyCurrentEditorSettings()
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

  const resetSshProxyForm = () => {
    sshProxyForm.value = {
      name: '',
      type: 'SOCKS5',
      host: '127.0.0.1',
      port: 22,
      enableProxyIdentity: false,
      username: '',
      password: ''
    }
  }

  const openSshProxyConfig = () => {
    sshProxyConfigModalOpen.value = true
  }

  const closeSshProxyConfig = () => {
    sshProxyConfigModalOpen.value = false
  }

  const openAddSshProxyConfig = () => {
    resetSshProxyForm()
    sshProxyAddModalOpen.value = true
  }

  const closeAddSshProxyConfig = () => {
    sshProxyAddModalOpen.value = false
    resetSshProxyForm()
  }

  const updateSshProxyForm = (patch: Partial<WorkspaceSshProxyForm>) => {
    sshProxyForm.value = {
      ...sshProxyForm.value,
      ...patch,
      type: stringFromOptions(patch.type || sshProxyForm.value.type, sshProxyTypes, 'SOCKS5'),
      port: patch.port !== undefined ? numberInRange(patch.port, sshProxyForm.value.port, 1, 65535) : sshProxyForm.value.port
    }
  }

  const persistSshProxyConfigs = async (nextConfigs: SshProxyConfig[], unavailableNotice: string, failureNotice: string) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice(unavailableNotice)
      return false
    }
    const normalizedConfigs = normalizeSshProxyConfigs(nextConfigs).normalized
    try {
      const savedConfig = await saveConfigBridge({
        sshProxyConfigs: normalizedConfigs.map((config) => ({ ...config }))
      })
      if (!isRecord(savedConfig) || !Array.isArray(savedConfig.sshProxyConfigs)) {
        setSettingsNotice(failureNotice)
        return false
      }
      const savedProxyConfigs = normalizeSshProxyConfigs(savedConfig.sshProxyConfigs).normalized
      if (!sshProxyConfigSnapshotsMatch(savedProxyConfigs, normalizedConfigs)) {
        setSettingsNotice(failureNotice)
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        sshProxyConfigs: savedProxyConfigs
      })
      sshProxyConfigs.value = savedProxyConfigs.map((config) => ({ ...config }))
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : failureNotice)
      return false
    }
  }

  const saveSshProxyForm = async () => {
    const rawName = sshProxyForm.value.name.trim()
    const rawHost = sshProxyForm.value.host.trim()
    if (!rawName) {
      setSettingsNotice('请输入代理配置名称')
      return false
    }
    if (!rawHost) {
      setSettingsNotice('请输入代理主机')
      return false
    }
    const proxyConfig = normalizeSshProxyConfigs([{ ...sshProxyForm.value, name: rawName, host: rawHost }]).normalized[0]
    if (!proxyConfig) return false
    if (sshProxyConfigs.value.some((config) => config.name === proxyConfig.name)) {
      setSettingsNotice('代理配置名称已存在')
      return false
    }
    const saved = await persistSshProxyConfigs([...sshProxyConfigs.value, proxyConfig], 'SSH 代理配置保存服务不可用', 'SSH 代理配置保存失败')
    if (!saved) return false
    closeAddSshProxyConfig()
    setSettingsNotice('SSH 代理配置已添加')
    return true
  }

  const removeSshProxyConfig = async (name: string) => {
    const nextConfigs = sshProxyConfigs.value.filter((config) => config.name !== name)
    if (nextConfigs.length === sshProxyConfigs.value.length) return false
    const saved = await persistSshProxyConfigs(nextConfigs, 'SSH 代理配置删除服务不可用', 'SSH 代理配置删除失败')
    if (!saved) return false
    setSettingsNotice('SSH 代理配置已删除')
    return true
  }

  const persistSshAgentKeys = async (nextKeys: SshAgentKeyConfig[], unavailableNotice: string, failureNotice: string) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice(unavailableNotice)
      return false
    }
    const normalizedKeys = normalizeSshAgentKeys(nextKeys).normalized
    try {
      const savedConfig = await saveConfigBridge({
        sshAgentKeys: normalizedKeys.map((key) => ({ ...key }))
      })
      if (!isRecord(savedConfig) || !Array.isArray(savedConfig.sshAgentKeys)) {
        setSettingsNotice(failureNotice)
        return false
      }
      const savedKeys = normalizeSshAgentKeys(savedConfig.sshAgentKeys).normalized
      if (!sshAgentKeySnapshotsMatch(savedKeys, normalizedKeys)) {
        setSettingsNotice(failureNotice)
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        sshAgentKeys: savedKeys
      })
      sshAgentKeys.value = savedKeys.map((key) => ({ ...key }))
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : failureNotice)
      return false
    }
  }

  const openSshAgentConfig = () => {
    sshAgentConfigModalOpen.value = true
    void refreshSshAgentKeychainOptions()
  }

  const closeSshAgentConfig = () => {
    sshAgentConfigModalOpen.value = false
  }

  const setSshAgentSelectedKey = (key: string) => {
    sshAgentSelectedKey.value = key
  }

  const addSshAgentKey = async () => {
    const selectedKey = sshAgentSelectedKey.value
    if (!selectedKey) {
      setSettingsNotice('请选择密钥')
      return false
    }
    const option = sshAgentKeyChainOptions.value.find((item) => item.key === selectedKey)
    if (!option) {
      setSettingsNotice('密钥不存在')
      return false
    }
    if (sshAgentKeys.value.some((key) => key.keyChainId === option.key || key.id === option.key)) {
      setSettingsNotice('密钥已添加')
      sshAgentSelectedKey.value = ''
      return false
    }
    const agentKey: SshAgentKeyConfig = {
      id: option.key,
      fingerprint: option.fingerprint,
      comment: option.label,
      keyType: option.keyType,
      keyChainId: option.key
    }
    const saved = await persistSshAgentKeys([...sshAgentKeys.value, agentKey], 'SSH Agent 密钥保存服务不可用', 'SSH Agent 密钥保存失败')
    if (!saved) return false
    sshAgentSelectedKey.value = ''
    setSettingsNotice('SSH Agent 密钥已添加')
    return true
  }

  const removeSshAgentKey = async (id: string) => {
    const nextKeys = sshAgentKeys.value.filter((key) => key.id !== id)
    if (nextKeys.length === sshAgentKeys.value.length) return false
    const saved = await persistSshAgentKeys(nextKeys, 'SSH Agent 密钥移除服务不可用', 'SSH Agent 密钥移除失败')
    if (!saved) return false
    setSettingsNotice('SSH Agent 密钥已移除')
    return true
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

  const selectAiModel = async (modelId: string) => {
    const nextModelName = normalizeUserModelName(modelId)
    if (!nextModelName) return false
    const modelOption = aiModelOptions.value.find((option) => normalizeUserModelName(option.id) === nextModelName)
    if (!modelOption && lockedAiModelOptions.value.some((option) => normalizeUserModelName(option.id) === nextModelName)) {
      setTopNotice('AI 模型不可用')
      return false
    }
    const nextModelProvider = normalizeCatalogModelProvider(modelOption?.apiProvider || config.value.modelProvider)
    if (nextModelName === config.value.modelName && nextModelProvider === config.value.modelProvider) return true
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setTopNotice('AI 模型保存服务不可用')
      return false
    }
    try {
      const savedConfig = await saveConfigBridge({ modelName: nextModelName, modelProvider: nextModelProvider })
      if (
        !isRecord(savedConfig) ||
        normalizeUserModelName(savedConfig.modelName) !== nextModelName ||
        normalizeUserModelProvider(savedConfig.modelProvider) !== nextModelProvider
      ) {
        setTopNotice('AI 模型保存失败')
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        modelName: nextModelName,
        modelProvider: nextModelProvider
      })
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : 'AI 模型保存失败')
      return false
    }
  }

  const updateModelOption = async (name: string, checked: boolean) => {
    const model = settingModelOptions.value.find((item) => item.name === name)
    if (!model || model.locked) return false
    const nextSettings = getPersistedModelSettingsSnapshot()
    nextSettings.options = getModelSettingsSnapshot().options.map((item) => (item.name === name ? { ...item, checked } : item))
    return persistModelSettings(nextSettings)
  }

  const removeModelOption = async (name: string) => {
    const model = settingModelOptions.value.find((item) => item.name === name)
    if (!model || model.locked || model.type !== 'custom') return false
    const nextSettings = getPersistedModelSettingsSnapshot()
    nextSettings.options = getModelSettingsSnapshot().options.filter((item) => item.name !== name || item.locked)
    return persistModelSettings(nextSettings)
  }

  const renameModelOption = async (name: string, displayName: string) => {
    const model = settingModelOptions.value.find((item) => item.name === name)
    if (!model || model.locked || model.type !== 'custom') return false
    const nextDisplayName = displayName.trim()
    const nextSettings = getPersistedModelSettingsSnapshot()
    nextSettings.options = getModelSettingsSnapshot().options.map((item) =>
      item.name === name
        ? {
            ...item,
            displayName: nextDisplayName && nextDisplayName !== name ? nextDisplayName : undefined
          }
        : item
    )
    return persistModelSettings(nextSettings)
  }

  const toggleAddModelSwitch = async (checked: boolean) => {
    const nextSettings = {
      ...getPersistedModelSettingsSnapshot(),
      addModelSwitch: checked
    }
    return persistModelSettings(nextSettings)
  }

  const updateModelProviderConfig = (provider: ModelProviderKey, patch: Partial<ModelProviderSettings>) => {
    modelProviders.value[provider] = { ...modelProviders.value[provider], ...patch }
  }

  const checkModelProvider = async (provider: ModelProviderKey) => {
    const requestSeq = (modelCheckRequestSeq.value[provider] || 0) + 1
    modelCheckRequestSeq.value = { ...modelCheckRequestSeq.value, [provider]: requestSeq }
    modelCheckState.value = { ...modelCheckState.value, [provider]: 'checking' }
    const providerConfig = { ...modelProviders.value[provider] }
    const checkProviderBridge = modelProviderClient.checkModelProvider()
    if (typeof checkProviderBridge !== 'function') {
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
      setSettingsNotice('模型 Provider 检查服务不可用')
      return
    }
    try {
      const result = await checkProviderBridge({ provider, config: providerConfig })
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      if (result.ok) {
        if (!isModelProviderCheckDataForRequest(result.data, provider, providerConfig)) {
          modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
          setSettingsNotice(malformedModelProviderResultMessage)
          return
        }
        modelCheckState.value = { ...modelCheckState.value, [provider]: 'success' }
        setSettingsNotice(result.data.message)
      } else {
        modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
        setSettingsNotice(result.errorMessage || `${provider} Check 失败`)
      }
    } catch (error) {
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
      setSettingsNotice(`模型 Provider 检查失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const saveModelProvider = async (provider: ModelProviderKey) => {
    const saveConfigBridge = appRuntimeClient.saveConfig()
    if (typeof saveConfigBridge !== 'function') {
      setSettingsNotice('模型 Provider 保存服务不可用')
      return false
    }
    const configPatch = modelProviders.value[provider]
    const providerName: Record<ModelProviderKey, UserConfig['modelProvider']> = {
      litellm: 'litellm',
      openai: 'openai-compatible',
      bedrock: 'bedrock',
      deepseek: 'deepseek',
      anthropic: 'anthropic',
      ollama: 'ollama',
      lmstudio: 'lmstudio'
    }
    const providerLabel: Record<ModelProviderKey, string> = {
      litellm: 'LiteLLM',
      openai: 'OpenAI Compatible',
      bedrock: 'Amazon Bedrock',
      deepseek: 'DeepSeek',
      anthropic: 'Anthropic',
      ollama: 'Ollama',
      lmstudio: 'LM Studio'
    }
    const nextModelSettings = getModelSettingsSnapshotWithProviderModel(provider, configPatch)
    try {
      const savedConfig = await saveConfigBridge({
        modelProvider: providerName[provider],
        modelEndpoint: configPatch.baseUrl,
        modelName: configPatch.modelId,
        modelSettings: nextModelSettings
      })
      if (!isRecord(savedConfig) || !isRecord(savedConfig.modelSettings) || !isRecord(savedConfig.modelSettings.providers) || !Array.isArray(savedConfig.modelSettings.options)) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedModelSettings = normalizeModelSettingsConfig(savedConfig.modelSettings).normalized
      if (!modelSettingsSnapshotsMatch(savedModelSettings, nextModelSettings)) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedProviderSettings = normalizeModelProviderConfig(savedConfig.modelSettings.providers[provider], defaultModelProviders[provider])
      if (savedProviderSettings.baseUrl !== configPatch.baseUrl || savedProviderSettings.modelId !== configPatch.modelId) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedProvider = normalizeUserModelProvider(savedConfig.modelProvider)
      const savedModelName = normalizeUserModelName(savedConfig.modelName)
      if (typeof savedConfig.modelEndpoint !== 'string') {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      const savedEndpoint = savedConfig.modelEndpoint
      if (savedProvider !== providerName[provider] || savedModelName !== configPatch.modelId || savedEndpoint !== configPatch.baseUrl) {
        setSettingsNotice('模型 Provider 保存失败')
        return false
      }
      applyModelSettingsSnapshot(savedModelSettings)
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        modelProvider: savedProvider,
        modelEndpoint: savedEndpoint,
        modelName: savedModelName,
        modelSettings: savedModelSettings
      })
      await refreshAiModelCatalog({ replaceSettingsOptions: false })
      setSettingsNotice(`${providerLabel[provider]} Save 成功`)
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '模型 Provider 保存失败')
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
    setSettingsNotice('AI 偏好设置已保存')
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
      deps.refreshControlNotificationAttentionItems()
      setSettingsNotice('通知设置已保存')
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : '通知设置保存失败')
      return false
    }
  }

  const updateExtensionSettings = async (patch: Partial<ExtensionSettings>) => {
    const nextSettings = normalizeExtensionSettingsConfig({ ...extensionSettings.value, ...patch }).normalized
    const saved = await persistExtensionSettings(nextSettings)
    if (!saved) return false
    setSettingsNotice('扩展设置已保存')
    return true
  }

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
      deps.closeMcpConfigEditor()
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
      deps.closeMcpConfigEditor()
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

  const updatePrivacySettings = async (patch: Partial<PrivacySettings>) => {
    const hasPersistentPatch = 'telemetry' in patch || 'secretRedaction' in patch || 'dataSync' in patch
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
    const nextPersistent = normalizePrivacyConfig({ ...previousPersistent, ...patch }).normalized
    const saved = await persistPrivacySettings(previousPersistent, nextPersistent)
    if (!saved) return false
    setSettingsNotice('隐私设置已保存')
    return true
  }

  const handleAppUpdateProgress = (event: AppUpdateProgressEvent) => {
    if (!isAppUpdateProgressEvent(event)) {
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'error',
        progress: 0
      }
      setSettingsNotice(appUpdateStatusMessage)
      return
    }
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: event.status === 'downloaded' ? 'downloaded' : event.status,
      newVersion: event.version || aboutSettings.value.newVersion,
      progress: Math.max(0, Math.min(100, Math.round(event.percent)))
    }
    if (event.status === 'downloaded') setSettingsNotice('更新已下载，可执行安装')
    if (event.status === 'error') setSettingsNotice(event.message || '更新下载失败')
  }

  const installAppUpdateProgressListener = () => {
    const onAppUpdateProgress = appRuntimeClient.onAppUpdateProgress()
    if (removeAppUpdateProgressListener || !onAppUpdateProgress) return
    removeAppUpdateProgressListener = onAppUpdateProgress(handleAppUpdateProgress)
  }

  const applyRequestedAppUpdateInstall = (version: string) => {
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: 'install-requested',
      newVersion: version,
      progress: 100
    }
  }

  const startAboutDownload = async () => {
    const version = aboutSettings.value.newVersion || aboutSettings.value.version
    const downloadAppUpdateBridge = appRuntimeClient.downloadAppUpdate()
    if (typeof downloadAppUpdateBridge !== 'function') {
      aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
      setSettingsNotice('更新下载服务不可用')
      return false
    }
    installAppUpdateProgressListener()
    aboutSettings.value.updateStatus = 'downloading'
    aboutSettings.value.progress = 0
    setSettingsNotice('正在下载更新')
    try {
      const result = await downloadAppUpdateBridge(version)
      if (!result?.ok || !result.data) {
        aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
        setSettingsNotice(result?.errorMessage || '更新下载失败')
        return false
      }
      if (!isAppUpdateDownloadData(result.data, version)) {
        aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
        setSettingsNotice(appUpdateStatusMessage)
        return false
      }
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'downloaded',
        newVersion: result.data.version,
        progress: result.data.percent
      }
      setSettingsNotice('更新已下载，可执行安装')
      return true
    } catch (error) {
      aboutSettings.value = { ...aboutSettings.value, updateStatus: 'error', progress: 0 }
      setSettingsNotice(error instanceof Error ? error.message : '更新下载失败')
      return false
    }
  }

  const requestAppUpdateInstall = async (version: string, setNotice: (message: string) => void) => {
    const installAppUpdateBridge = appRuntimeClient.installAppUpdate()
    if (typeof installAppUpdateBridge !== 'function') {
      setNotice('更新安装服务不可用')
      return false
    }
    try {
      const result = await installAppUpdateBridge(version)
      if (!result?.ok || !result.data) {
        setNotice(result?.errorMessage || '更新安装失败')
        return false
      }
      if (!isAppUpdateInstallData(result.data, version)) {
        setNotice(appUpdateStatusMessage)
        return false
      }
      applyRequestedAppUpdateInstall(result.data.version)
      setNotice('更新安装请求已提交')
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '更新安装失败')
      return false
    }
  }

  const checkAboutUpdate = async () => {
    if (aboutSettings.value.updateStatus === 'available') {
      return startAboutDownload()
    }
    if (aboutSettings.value.updateStatus === 'downloaded') {
      const installed = await requestAppUpdateInstall(aboutSettings.value.newVersion || aboutSettings.value.version, setSettingsNotice)
      if (!installed) aboutSettings.value.updateStatus = 'error'
      return installed
    }
    const checkUpdateBridge = appRuntimeClient.checkUpdate()
    if (typeof checkUpdateBridge !== 'function') {
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'error',
        progress: 0
      }
      setSettingsNotice('更新检查服务不可用')
      return false
    }
    aboutSettings.value = {
      ...aboutSettings.value,
      updateStatus: 'checking',
      progress: 0
    }
    setSettingsNotice('正在检查更新')
    try {
      const result = await checkUpdateBridge()
      if (!isAppUpdateCheckResult(result)) {
        aboutSettings.value = {
          ...aboutSettings.value,
          updateStatus: 'error',
          progress: 0
        }
        setSettingsNotice(appUpdateStatusMessage)
        return false
      }
      const detectedVersion = resolveUpdateVersion(result)
      if (hasAvailableAppUpdate(result)) {
        if (!detectedVersion) {
          aboutSettings.value = {
            ...aboutSettings.value,
            updateStatus: 'error',
            progress: 0
          }
          setSettingsNotice(appUpdateStatusMessage)
          return false
        }
        aboutSettings.value = {
          ...aboutSettings.value,
          updateStatus: 'available',
          newVersion: detectedVersion
        }
        setSettingsNotice(`检测到可用更新 ${aboutSettings.value.newVersion}`)
        return true
      }
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'latest',
        newVersion: detectedVersion || aboutSettings.value.version,
        progress: 0
      }
      setSettingsNotice('当前已是最新版本')
      return true
    } catch {
      aboutSettings.value = {
        ...aboutSettings.value,
        updateStatus: 'error',
        progress: 0
      }
      setSettingsNotice('更新检查失败')
      return false
    }
  }

  const checkTopUpdate = async () => {
    const checkUpdateBridge = appRuntimeClient.checkUpdate()
    if (typeof checkUpdateBridge !== 'function') {
      topUpdateState.value = 'local'
      setTopNotice('更新检查服务不可用')
      return false
    }
    topUpdateState.value = 'checking'
    try {
      const result = await checkUpdateBridge()
      if (!isAppUpdateCheckResult(result)) {
        topUpdateState.value = 'local'
        setTopNotice(appUpdateStatusMessage)
        return false
      }
      const available = hasAvailableAppUpdate(result)
      const detectedVersion = resolveUpdateVersion(result)
      if (available && !detectedVersion) {
        topUpdateState.value = 'local'
        setTopNotice(appUpdateStatusMessage)
        return false
      }
      topUpdateState.value = available ? 'available' : 'local'
      if (available) {
        aboutSettings.value.newVersion = detectedVersion
        setTopNotice(detectedVersion ? `检测到可用更新 ${detectedVersion}` : '检测到可用更新')
      }
      return true
    } catch {
      topUpdateState.value = 'local'
      setTopNotice('更新检查不可用')
      return false
    }
  }

  const handleTopUpdateClick = async () => {
    if (topUpdateState.value === 'available') {
      const version = aboutSettings.value.newVersion || aboutSettings.value.version
      topUpdateState.value = 'checking'
      const downloaded = await startAboutDownload()
      if (!downloaded || aboutSettings.value.updateStatus !== 'downloaded') {
        topUpdateState.value = 'available'
        setTopNotice(settingsNotice.value || '更新下载失败')
        return
      }
      const installed = await requestAppUpdateInstall(version, setTopNotice)
      if (!installed) {
        topUpdateState.value = 'available'
        return
      }
      topUpdateState.value = 'install-requested'
      return
    }
    await checkTopUpdate()
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

  const openAiSessionSettings = () => {
    mode.value = 'terminal'
    activeModule.value = 'settings'
    leftPanelOpen.value = true
    rightPanelOpen.value = false
    onboardingGuideOpen.value = false
    setActiveSettingsSection('ai')
    void deps.refreshAgentHookInstallers({ silent: true })
    setTopNotice('已打开 AI 会话设置')
  }

  const toggleMode = async () => {
    const nextMode = mode.value === 'terminal' ? 'agents' : 'terminal'
    const saved = await persistLayoutPreferences({ defaultMode: nextMode })
    if (!saved) return false
    if (nextMode === 'terminal' && (activeModule.value === 'database' || activeModule.value === 'user')) {
      rightPanelOpen.value = false
    }
    setTopNotice(`已切换到 ${mode.value === 'agents' ? 'Agents' : 'Terminal'} 模式`)
    return true
  }

  const toggleLeft = async () => {
    if (mode.value === 'agents') {
      const nextOpen = !agentsLeftOpen.value
      const saved = await persistLayoutPreferences({ agentsLeftOpen: nextOpen })
      if (saved) setTopNotice(`Agents 会话侧栏已${agentsLeftOpen.value ? '打开' : '关闭'}`)
      return saved
    }
    const nextOpen = !leftPanelOpen.value
    const saved = await persistLayoutPreferences({ leftPanelOpen: nextOpen })
    if (saved) setTopNotice(`左侧面板已${leftPanelOpen.value ? '打开' : '关闭'}`)
    return saved
  }

  const toggleRight = async () => {
    if (mode.value !== 'terminal' || activeModule.value === 'database' || activeModule.value === 'user') return false
    const nextOpen = !rightPanelOpen.value
    const saved = await persistLayoutPreferences({ rightPanelOpen: nextOpen })
    if (saved) setTopNotice(`AI 侧栏已${rightPanelOpen.value ? '打开' : '关闭'}`)
    return saved
  }

  const resizeLeftPanel = async (width: number) => {
    const previousWidth = mode.value === 'agents' ? agentsLeftWidth.value : leftPanelWidth.value
    const normalizedWidth = Math.round(numberInRange(width, previousWidth, layoutWidthLimits.min, layoutWidthLimits.max))
    if (mode.value === 'agents') {
      agentsLeftWidth.value = normalizedWidth
      const saved = await persistLayoutPreferences({ agentsLeftOpen: true, agentsLeftWidth: normalizedWidth })
      if (!saved) agentsLeftWidth.value = previousWidth
      if (saved) setTopNotice(`Agents 会话侧栏宽度已保存为 ${agentsLeftWidth.value}px`)
      return saved
    }
    leftPanelWidth.value = normalizedWidth
    const saved = await persistLayoutPreferences({ leftPanelOpen: true, leftPanelWidth: normalizedWidth })
    if (!saved) leftPanelWidth.value = previousWidth
    if (saved) setTopNotice(`左侧面板宽度已保存为 ${leftPanelWidth.value}px`)
    return saved
  }

  const resizeRightPanel = async (width: number) => {
    if (mode.value !== 'terminal' || activeModule.value === 'database' || activeModule.value === 'user') return false
    const previousWidth = rightPanelWidth.value
    const normalizedWidth = Math.round(numberInRange(width, previousWidth, layoutWidthLimits.min, layoutWidthLimits.max))
    rightPanelWidth.value = normalizedWidth
    const saved = await persistLayoutPreferences({ rightPanelOpen: true, rightPanelWidth: normalizedWidth })
    if (!saved) rightPanelWidth.value = previousWidth
    if (saved) setTopNotice(`AI 侧栏宽度已保存为 ${rightPanelWidth.value}px`)
    return saved
  }

  const quickCloseLeftPanel = async () => {
    const saved = await persistLayoutPreferences(mode.value === 'agents' ? { agentsLeftOpen: false } : { leftPanelOpen: false })
    if (saved) setTopNotice(mode.value === 'agents' ? 'Agents 会话侧栏已关闭' : '左侧面板已关闭')
    return saved
  }

  const quickCloseRightPanel = async () => {
    if (mode.value !== 'terminal' || activeModule.value === 'database' || activeModule.value === 'user') return false
    const saved = await persistLayoutPreferences({ rightPanelOpen: false })
    if (saved) setTopNotice('AI 侧栏已关闭')
    return saved
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
