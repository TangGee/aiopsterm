import { type Ref } from 'vue'
import { applyDocumentLocale, resolveLocale } from '@/i18n/runtime'
import { readStoredAiPanelMode } from '@/services/aiPanelModeRuntime'
import { appRuntimeClient } from '@/services/appRuntimeClient'
import { cloneKnowledgeNodes } from '@/services/knowledgeRuntime'
import { isQuickCommandsSnapshotData, malformedQuickCommandsBackendResultMessage } from '@/services/quickCommandsBackendGuards'
import { quickCommandsClient } from '@/services/quickCommandsClient'
import { cloneQuickCommandsSnapshot, type QuickCommandSnippet, type SnippetGroup } from '@/services/quickCommandsRuntime'
import {
  defaultConfig,
  layoutWidthFromConfig,
  mergeGenericSavedConfig,
  mergeUserConfig,
  normalizeAiPreferencesConfig,
  normalizeEditorSettingsConfig,
  normalizeExtensionSettingsConfig,
  normalizeKeywordHighlightConfig,
  normalizeKnowledgeBaseConfig,
  normalizeMcpServersConfig,
  normalizeModelSettingsConfig,
  normalizeNotificationConfig,
  normalizeOnboardingConfig,
  normalizePrivacyConfig,
  normalizeQuickCommandsConfig,
  normalizeSecurityConfig,
  normalizeSshAgentKeys,
  normalizeSshProxyConfigs,
  normalizeTerminalConfig,
  normalizeWorkspacePreferences,
  privacyRuntimeSettingsFromSnapshot,
  type AiPreferenceSettings,
  type EditorSettings,
  type ExtensionSettings,
  type GeneralBaseSettingsPatch,
  type KeywordHighlightSettings,
  type ModelProviderSettings,
  type ModelProviderKey,
  type PrivacySettings,
  type SecuritySettings,
  type SettingsModelOption,
  type TerminalSettings
} from '@/services/workspaceConfigRuntime'
import type { OnboardingModuleId } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type {
  AiModelCatalog,
  AiModelCatalogOption,
  NotificationUserConfig,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { KnowledgeBaseUserConfig, KnowledgeNode } from '@shared/contracts/knowledgeBase'
import type { UserConfig } from '@shared/contracts/userConfig'

export type WorkspaceMcpSnapshot = ReturnType<typeof normalizeMcpServersConfig>

type HydratedAliasResult = {
  normalizedAliasCommands: NonNullable<UserConfig['aliasCommands']>
  aliasCommandsLoadedFromBridge: boolean
}

type WorkspaceSettingsHydrationState = {
  mode: Ref<'terminal' | 'agents'>
  activeModule: Ref<ModuleKey>
  leftPanelOpen: Ref<boolean>
  rightPanelOpen: Ref<boolean>
  agentsLeftOpen: Ref<boolean>
  leftPanelWidth: Ref<number>
  rightPanelWidth: Ref<number>
  agentsLeftWidth: Ref<number>
  onboardingCompleted: Ref<Record<OnboardingModuleId, boolean>>
  config: Ref<UserConfig>
  savedGeneralBaseSettingsSnapshot: Ref<GeneralBaseSettingsPatch>
  workspacePreferences: Ref<WorkspaceUserConfig>
  snippetGroups: Ref<SnippetGroup[]>
  quickCommands: Ref<QuickCommandSnippet[]>
  knowledgeTree: Ref<KnowledgeNode[]>
  kbUsedBytes: Ref<number>
  kbTotalBytes: Ref<number>
  editorSettings: Ref<EditorSettings>
  terminalSettings: Ref<TerminalSettings>
  sshProxyConfigs: Ref<SshProxyConfig[]>
  sshAgentKeys: Ref<SshAgentKeyConfig[]>
  sshAgentKeyChainOptions: Ref<SshAgentKeychainOption[]>
  aiModelOptions: Ref<AiModelCatalogOption[]>
  lockedAiModelOptions: Ref<AiModelCatalogOption[]>
  settingModelOptions: Ref<SettingsModelOption[]>
  addModelSwitch: Ref<boolean>
  modelProviders: Ref<Record<ModelProviderKey, ModelProviderSettings>>
  aiPreferences: Ref<AiPreferenceSettings>
  notificationSettings: Ref<NotificationUserConfig>
  extensionSettings: Ref<ExtensionSettings>
  keywordHighlightSettings: Ref<KeywordHighlightSettings>
  keywordHighlightEditorContent: Ref<string>
  securitySettings: Ref<SecuritySettings>
  securityConfigEditorContent: Ref<string>
  privacySettings: Ref<PrivacySettings>
}

type WorkspaceSettingsHydrationDeps = {
  currentLocale: () => ReturnType<typeof resolveLocale>
  applyCurrentTheme: () => void
  applyCurrentEditorSettings: () => void
  setupThemeBridge: () => void
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
  refreshSshAgentKeychainOptions: () => Promise<boolean>
  refreshAiModelCatalog: (options?: { replaceSettingsOptions?: boolean }) => Promise<AiModelCatalog | null>
  applyModelSettingsSnapshot: (source: unknown) => UserConfig['modelSettings']
  restoreSavedGeneralBaseSettings: () => void
  normalizeThemeId: (theme: string) => UserConfig['theme']
  setTopNotice: (message: string) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const createWorkspaceSettingsHydrationController = (
  state: WorkspaceSettingsHydrationState,
  deps: WorkspaceSettingsHydrationDeps
) => {
  const {
    mode,
    leftPanelOpen,
    rightPanelOpen,
    agentsLeftOpen,
    leftPanelWidth,
    rightPanelWidth,
    agentsLeftWidth,
    onboardingCompleted,
    config,
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
    aiPreferences,
    notificationSettings,
    extensionSettings,
    keywordHighlightSettings,
    keywordHighlightEditorContent,
    securitySettings,
    securityConfigEditorContent,
    privacySettings
  } = state
  const {
    currentLocale,
    applyCurrentTheme,
    applyCurrentEditorSettings,
    setupThemeBridge,
    refreshShortcutRuntime,
    hydrateClassicChatData,
    setupKnowledgeBridgeListeners,
    refreshAgentHookInstallers,
    refreshUserAccount,
    hydrateAliasCommands,
    hydrateSettingsPreferences,
    hydrateSkills,
    readMcpServersSnapshotFromBridge,
    applyMcpServersSnapshot,
    refreshSshAgentKeychainOptions,
    refreshAiModelCatalog,
    applyModelSettingsSnapshot,
    restoreSavedGeneralBaseSettings,
    normalizeThemeId,
    setTopNotice
  } = deps

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
    const aiStartupRefresh = readStoredAiPanelMode() === 'classic' ? hydrateClassicChatData({ restoreIfEmpty: true }) : Promise.resolve(true)
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
    const { normalizedAliasCommands, aliasCommandsLoadedFromBridge } = await hydrateAliasCommands()
    const { normalizedShortcuts, normalizedRules } = await hydrateSettingsPreferences(savedConfig)
    const { normalizedSkills, skillsChanged } = await hydrateSkills(savedConfig.skills)
    const savedMcpSnapshot = normalizeMcpServersConfig(savedConfig.mcpServers, savedConfig.mcpToolStates)
    const bridgeMcpSnapshot = await readMcpServersSnapshotFromBridge()
    const normalizedMcpSnapshot = bridgeMcpSnapshot || savedMcpSnapshot
    if (bridgeMcpSnapshot) {
      applyMcpServersSnapshot(bridgeMcpSnapshot)
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
    refreshShortcutRuntime()
    setupThemeBridge()
    await refreshUserAccount()
    setupKnowledgeBridgeListeners()
    void refreshAgentHookInstallers({ silent: true })
    await aiStartupRefresh
    restoreSavedGeneralBaseSettings()
    applyDocumentLocale(currentLocale())
  }

  return {
    hydrateConfig
  }
}
