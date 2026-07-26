import { computed, ref } from 'vue'
import { type KbClipboard, type KnowledgeImportJob } from '@/services/knowledge/knowledgeRuntime'
import { createWorkspaceKubernetesState } from '@/stores/workspaceKubernetesState'
import { type FilesUiMode } from '@/services/files/workspaceFilesController'
import { type ChatMessage, type ConversationItem, type TodoItem } from '@/services/ai/workspaceAiChatController'
import {
  type WorkspaceExtensionInstallProgress,
  type WorkspaceExtensionPlugin
} from '@/services/extensions/workspaceExtensionsController'
import {
  createDefaultWorkspaceAboutSettings,
  type WorkspaceAboutSettings,
  type WorkspaceGeneralBaseSettingsPatch,
  type WorkspaceOnboardingAiRequest,
  type WorkspaceOnboardingAssetRequest,
  type WorkspaceTopUpdateState
} from '@/services/settings/workspaceAppSettingsController'
import {
  defaultAgentHibernationConfig,
  type AiAttentionFocusRequest,
  type AiAttentionItem,
  type ManagedAiSession
} from '@/services/ai/workspaceManagedAiController'
import { createInitialWorkspaceTerminalPanels } from '@/services/terminal/workspaceTerminalPanelsController'
import { type TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'
import { type TerminalSecurityPrompt } from '@/services/terminal/workspaceTerminalExecutionController'
import { type WorkspaceMcpOperationRecord, type WorkspaceMcpServer } from '@/services/settings/workspaceMcpController'
import {
  type WorkspaceSettingsRule,
  type WorkspaceSettingsShortcut,
  type WorkspaceSettingsSkill
} from '@/services/settings/workspaceSettingsController'
import { type AssetManagementOpenRequest } from '@/services/workspace/workspaceShellController'
import { type ShortcutActionHandler } from '@/services/common/shortcutRuntime'
import {
  createEmptyMacroRecordingState,
  type MacroRecordingState,
  type QuickCommandSnippet,
  type SnippetGroup
} from '@/services/quick-commands/quickCommandsRuntime'
import { MACRO_DEFAULT_SLEEP_THRESHOLD_MS } from '@/services/terminal/terminalMacroRuntime'
import { type TerminalPanel } from '@/services/terminal/terminalPanelRuntime'
import {
  createDefaultWorkspaceBillingSettings,
  createEmptyWorkspaceUserProfile,
  type WorkspaceBillingSettings,
  type WorkspaceTrustedDevice,
  type WorkspaceTrustedDeviceModal,
  type WorkspaceUserLoginTab
} from '@/services/user/workspaceUserController'
import { createDefaultOnboardingCompleted, onboardingTourSteps, type OnboardingModuleId } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import { type SettingSectionKey } from '@/config/settings'
import {
  defaultAiPreferences,
  defaultConfig,
  defaultEditorSettings,
  defaultExtensionSettings,
  defaultKeywordHighlightSettings,
  defaultMcpConfigFile,
  defaultModelProviders,
  defaultNotificationSettings,
  defaultPrivacySettings,
  defaultSecuritySettings,
  defaultTerminalSettings,
  defaultWorkspacePreferences,
  layoutWidthLimits,
  normalizeKeywordHighlightConfig,
  normalizeSecurityConfig,
  type AiPreferenceSettings,
  type EditorSettings,
  type ExtensionSettings,
  type KeywordHighlightSettings,
  type ModelProviderKey,
  type ModelProviderSettings,
  type PrivacySettings,
  type SecuritySettings,
  type SettingsModelOption,
  type TerminalSettings
} from '@/services/settings/workspaceConfigRuntime'
import { resolveLocale, translateWithLocale } from '@/i18n/runtime'
import type { I18nKey } from '@/i18n/messages'
import type { UserConfig } from '@shared/contracts/userConfig'
import type {
  AiChatContextUsageSnapshot,
  AiCommandCatalogOption,
  AiCommandChipRef,
  AiContextCatalog,
  AiContextOption
} from '@shared/contracts/aiChat'
import type {
  AiModelCatalogOption,
  NotificationUserConfig,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { FileSessionFolderRecord, FileSessionInfo, FileTransferTask } from '@shared/contracts/files'
import type { AiopsUserProfile } from '@shared/contracts/userAccount'
import type {
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeNode
} from '@shared/contracts/knowledgeBase'
import type { AgentHibernationConfig } from '@shared/contracts/managedAiSessions'
import type { ControlNotificationRecord } from '@shared/contracts/control'
import type { AgentHookInstallerSource, AgentHookInstallerStatus } from '@shared/contracts/agentHooks'
import type { ExportMcpBridgeStatus, ExportMcpClientStatus } from '@shared/contracts/exportMcp'

type AiContextUsage = AiChatContextUsageSnapshot
type RendererLocalIdPrefix = 'panel' | 'terminal-security' | 'aichat-agent-loop'
type ShellShortcutAction = (actionId: string, digit?: number) => boolean

const createRendererLocalId = (prefix: RendererLocalIdPrefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

export const createWorkspaceStoreState = () => {
  const mode = ref<'terminal' | 'agents'>('terminal')
  const activeModule = ref<ModuleKey>('workspace')
  const leftPanelOpen = ref(true)
  const rightPanelOpen = ref(true)
  const agentsLeftOpen = ref(true)
  const leftPanelWidth = ref(layoutWidthLimits.defaults.leftPanelWidth)
  const rightPanelWidth = ref(layoutWidthLimits.defaults.rightPanelWidth)
  const agentsLeftWidth = ref(layoutWidthLimits.defaults.agentsLeftWidth)
  const topUpdateState = ref<WorkspaceTopUpdateState>('idle')
  const topNotice = ref('')
  const aiAttentionItems = ref<AiAttentionItem[]>([])
  const controlNotifications = ref<ControlNotificationRecord[]>([])
  const aiAttentionFocusRequest = ref<AiAttentionFocusRequest>({ sequence: 0, item: null })
  const managedAiSessions = ref<ManagedAiSession[]>([])
  const agentHibernationConfig = ref<AgentHibernationConfig>({ ...defaultAgentHibernationConfig })
  const managedAiSessionsLoading = ref(false)
  const managedAiSessionsError = ref('')
  const managedAiSessionFocusRequest = ref<{ sequence: number; session: ManagedAiSession | null }>({ sequence: 0, session: null })
  const selectedManagedAiSessionKey = ref('')
  const onboardingCompleted = ref<Record<OnboardingModuleId, boolean>>(createDefaultOnboardingCompleted())
  const onboardingActiveTour = ref<OnboardingModuleId | null>(null)
  const onboardingActiveStepIndex = ref(0)
  const onboardingGuideOpen = ref(false)
  const onboardingAiRequest = ref<{ action: WorkspaceOnboardingAiRequest; stepId: string; sequence: number }>({
    action: 'none',
    stepId: '',
    sequence: 0
  })
  const onboardingAssetRequest = ref<{ action: WorkspaceOnboardingAssetRequest; stepId: string; sequence: number }>({
    action: 'none',
    stepId: '',
    sequence: 0
  })
  const onboardingAutoApprovalEvent = ref(0)
  const config = ref<UserConfig>(defaultConfig)
  const savedGeneralBaseSettingsSnapshot = ref<WorkspaceGeneralBaseSettingsPatch>({})
  const themeListenerCleanup = ref<(() => void) | null>(null)
  const workspacePreferences = ref<WorkspaceUserConfig>({
    ...defaultWorkspacePreferences,
    expandedGroups: [...defaultWorkspacePreferences.expandedGroups]
  })
  const activePanelId = ref('panel-main')
  const panels = ref<TerminalPanel[]>(createInitialWorkspaceTerminalPanels())

  let shellShortcutAction: ShellShortcutAction | null = null
  const setShellShortcutAction = (action: ShellShortcutAction | null) => {
    shellShortcutAction = action
  }
  const shortcutHandlers: Record<string, ShortcutActionHandler> = {
    newTerminal: () => shellShortcutAction?.('newTerminal') ?? false,
    toggleAi: () => shellShortcutAction?.('toggleAi') ?? false,
    switchToSpecificTab: (payload) => shellShortcutAction?.('switchToSpecificTab', payload?.digit) ?? false,
    quickCommand: () => shellShortcutAction?.('quickCommand') ?? false
  }

  const selectedConversationId = ref('')
  const conversations = ref<ConversationItem[]>([])
  const aiContextCatalog = ref<AiContextCatalog>({
    categories: [],
    openedHosts: [],
    selectedDefaults: []
  })
  const aiCommandOptions = ref<AiCommandCatalogOption[]>([])
  const selectedContexts = ref<AiContextOption[]>([])
  const selectedCommandId = ref<string | null>(null)
  const selectedCommandRef = ref<AiCommandChipRef | null>(null)
  const filesUiMode = ref<FilesUiMode>('transfer')
  const fileSessions = ref<FileSessionInfo[]>([])
  const fileSessionFolders = ref<FileSessionFolderRecord[]>([])
  const selectedLeftFileSessionId = ref<string | null>(null)
  const selectedRightFileSessionId = ref<string | null>('local')
  const fileTransferTasks = ref<FileTransferTask[]>([])
  const snippetGroups = ref<SnippetGroup[]>([])
  const quickCommands = ref<QuickCommandSnippet[]>([])
  const selectedSnippetGroupUuid = ref<string | null>(null)
  const snippetSearchQuery = ref('')
  const macroRecording = ref<MacroRecordingState>(createEmptyMacroRecordingState())
  const macroRecordControlKeys = ref(true)
  const macroSleepThresholdMs = ref(MACRO_DEFAULT_SLEEP_THRESHOLD_MS)
  const knowledgeTree = ref<KnowledgeNode[]>([])
  const kbExpandedKeys = ref<string[]>(['commands', 'images'])
  const kbSelectedKeys = ref<string[]>([])
  const kbSearchQuery = ref('')
  const kbContentSearchResults = ref<KnowledgeBaseSearchResult[]>([])
  const kbSearchStatus = ref<KnowledgeBaseSearchStatus | null>(null)
  const kbSearchLoading = ref(false)
  const kbSearchError = ref('')
  const kbClipboard = ref<KbClipboard>(null)
  const kbImportJobs = ref<KnowledgeImportJob[]>([])
  const kbUsedBytes = ref(0)
  const kbTotalBytes = ref(1024 * 1024 * 1024)
  const extensionSearchQuery = ref('')
  const extensionPlugins = ref<WorkspaceExtensionPlugin[]>([])
  const selectedExtensionId = ref<string>('')
  const extensionDetailTab = ref<'details' | 'features'>('details')
  const extensionNotice = ref('')
  const extensionInstallLoadingMap = ref<Record<string, boolean>>({})
  const extensionUpdateLoadingMap = ref<Record<string, boolean>>({})
  const extensionInstallProgressMap = ref<Record<string, WorkspaceExtensionInstallProgress>>({})
  const extensionDragActive = ref(false)
  const extensionInstallingPackageName = ref('')
  const assetManagementOpenRequest = ref<AssetManagementOpenRequest>({ sequence: 0, action: 'none' })
  const k8sState = createWorkspaceKubernetesState()
  const activeSettingsSection = ref<SettingSectionKey>('general')
  const editorSettings = ref<EditorSettings>({ ...defaultEditorSettings })
  const terminalSettings = ref<TerminalSettings>({ ...defaultTerminalSettings })
  const sshProxyConfigs = ref<SshProxyConfig[]>([])
  const sshProxyConfigModalOpen = ref(false)
  const sshProxyAddModalOpen = ref(false)
  const sshProxyForm = ref<SshProxyConfig>({
    name: '',
    type: 'SOCKS5',
    host: '127.0.0.1',
    port: 22,
    enableProxyIdentity: false,
    username: '',
    password: ''
  })
  const sshAgentKeys = ref<SshAgentKeyConfig[]>([])
  const sshAgentConfigModalOpen = ref(false)
  const sshAgentSelectedKey = ref('')
  const sshAgentKeyChainOptions = ref<SshAgentKeychainOption[]>([])
  const aiModelOptions = ref<AiModelCatalogOption[]>([])
  const lockedAiModelOptions = ref<AiModelCatalogOption[]>([])
  const settingModelOptions = ref<SettingsModelOption[]>([])
  const addModelSwitch = ref(true)
  const modelProviders = ref<Record<ModelProviderKey, ModelProviderSettings>>({
    litellm: { ...defaultModelProviders.litellm },
    openai: { ...defaultModelProviders.openai },
    bedrock: { ...defaultModelProviders.bedrock },
    deepseek: { ...defaultModelProviders.deepseek },
    anthropic: { ...defaultModelProviders.anthropic },
    ollama: { ...defaultModelProviders.ollama },
    lmstudio: { ...defaultModelProviders.lmstudio }
  })
  const modelCheckState = ref<Record<ModelProviderKey, 'idle' | 'checking' | 'success' | 'error'>>({
    litellm: 'idle',
    openai: 'idle',
    bedrock: 'idle',
    deepseek: 'idle',
    anthropic: 'idle',
    ollama: 'idle',
    lmstudio: 'idle'
  })
  const modelCheckRequestSeq = ref<Record<ModelProviderKey, number>>({
    litellm: 0,
    openai: 0,
    bedrock: 0,
    deepseek: 0,
    anthropic: 0,
    ollama: 0,
    lmstudio: 0
  })
  const aiPreferences = ref<AiPreferenceSettings>({
    ...defaultAiPreferences,
    proxy: { ...defaultAiPreferences.proxy }
  })
  const notificationSettings = ref<NotificationUserConfig>({ ...defaultNotificationSettings })
  const extensionSettings = ref<ExtensionSettings>({ ...defaultExtensionSettings })
  const keywordHighlightSettings = ref<KeywordHighlightSettings>(normalizeKeywordHighlightConfig(defaultKeywordHighlightSettings).normalized)
  const keywordHighlightEditorOpen = ref(false)
  const keywordHighlightEditorContent = ref(JSON.stringify(defaultKeywordHighlightSettings, null, 2))
  const keywordHighlightEditorError = ref('')
  const keywordHighlightEditorLastSaved = ref(false)
  const keywordHighlightConfigPath = ref('~/.config/aiopsterm/keyword-highlight.json')
  const securitySettings = ref<SecuritySettings>(normalizeSecurityConfig(defaultSecuritySettings).normalized)
  const securityConfigEditorOpen = ref(false)
  const securityConfigEditorContent = ref(JSON.stringify(defaultSecuritySettings, null, 2))
  const securityConfigEditorError = ref('')
  const securityConfigEditorLastSaved = ref(false)
  const securityConfigPath = ref('~/.config/aiopsterm/security-config.json')
  const settingsDocumentationOpen = ref(false)
  const settingsDocumentationTitle = ref('')
  const settingsDocumentationPath = ref('')
  const settingsDocumentationContent = ref('')
  const agentHookInstallers = ref<AgentHookInstallerStatus[]>([])
  const agentHookInstallersLoading = ref(false)
  const agentHookInstallerBusySource = ref<AgentHookInstallerSource | ''>('')
  const agentHookInstallerError = ref('')
  const exportMcpInstallers = ref<ExportMcpClientStatus[]>([])
  const exportMcpInstallerBridge = ref<ExportMcpBridgeStatus | null>(null)
  const exportMcpInstallersLoading = ref(false)
  const exportMcpInstallerBusySource = ref('')
  const exportMcpInstallerError = ref('')
  const mcpConfigEditorOpen = ref(false)
  const mcpConfigEditorContent = ref(JSON.stringify(defaultMcpConfigFile(), null, 2))
  const mcpConfigEditorError = ref('')
  const mcpConfigEditorLastSaved = ref(false)
  const mcpConfigPath = ref('~/.config/aiopsterm/setting/mcp_settings.json')
  const privacySettings = ref<PrivacySettings>({ ...defaultPrivacySettings })
  const billingSettings = ref<WorkspaceBillingSettings>(createDefaultWorkspaceBillingSettings())
  const aboutSettings = ref<WorkspaceAboutSettings>(createDefaultWorkspaceAboutSettings())
  const userProfile = ref<AiopsUserProfile>(createEmptyWorkspaceUserProfile())
  const userNotice = ref('')
  const mcpServers = ref<WorkspaceMcpServer[]>([])
  const expandedMcpServerNames = ref<string[]>([])
  const activeMcpServerTab = ref<Record<string, 'tools' | 'resources'>>({})
  const mcpToolArgumentDrafts = ref<Record<string, string>>({})
  const mcpOperationResults = ref<Record<string, WorkspaceMcpOperationRecord>>({})
  const settingsSkills = ref<WorkspaceSettingsSkill[]>([])
  const skillsUserPath = ref('~/.config/aiopsterm/skills')
  const skillModal = ref<{ mode: 'create' | 'edit' | null; name: string; description: string; content: string }>({
    mode: null,
    name: '',
    description: '',
    content: ''
  })
  const settingsRules = ref<WorkspaceSettingsRule[]>([])
  const settingsShortcuts = ref<WorkspaceSettingsShortcut[]>([])
  const shortcutRecording = ref<{ actionId: string | null; tempShortcut: string }>({ actionId: null, tempShortcut: '' })
  const trustedDevices = ref<WorkspaceTrustedDevice[]>([])
  const trustedDeviceModal = ref<WorkspaceTrustedDeviceModal>({ open: false, id: null })
  const settingsNotice = ref('')
  const todoItems = ref<TodoItem[]>([])
  const chatMessages = ref<ChatMessage[]>([])
  const aiContextUsage = ref<AiContextUsage | null>(null)
  const terminalSecurityPrompt = ref<TerminalSecurityPrompt>(null)
  const terminalCommandGenerationRecords = ref<TerminalCommandGenerationRecord[]>([])

  const currentLocale = () => resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language])
  const i18nText = (key: I18nKey, params: Record<string, string | number> = {}) =>
    Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), translateWithLocale(currentLocale(), key))
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

  const activePanel = computed(() => panels.value.find((panel) => panel.id === activePanelId.value) || panels.value[0])
  const isLeftVisible = computed(() => mode.value === 'terminal' && leftPanelOpen.value)
  const isRightVisible = computed(() => mode.value === 'terminal' && rightPanelOpen.value)
  const onboardingCompletedCount = computed(() => Object.values(onboardingCompleted.value).filter(Boolean).length)
  const onboardingActiveSteps = computed(() => (onboardingActiveTour.value ? onboardingTourSteps[onboardingActiveTour.value] : []))
  const onboardingActiveStep = computed(() => onboardingActiveSteps.value[onboardingActiveStepIndex.value] || null)

  const userAccountCenterOpen = ref(false)
  const userContactCodeCountdown = ref<Record<'email' | 'mobile', number>>({
    email: 0,
    mobile: 0
  })
  const userContactCodeSending = ref<Record<'email' | 'mobile', boolean>>({
    email: false,
    mobile: false
  })
  const userLoginTab = ref<WorkspaceUserLoginTab>('account')
  const userLoginLoading = ref(false)
  const userLoginCodeCountdown = ref<Record<'email' | 'mobile', number>>({
    email: 0,
    mobile: 0
  })
  const userLoginCodeSending = ref<Record<'email' | 'mobile', boolean>>({
    email: false,
    mobile: false
  })

  return {
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
    aiAttentionItems,
    controlNotifications,
    aiAttentionFocusRequest,
    managedAiSessions,
    agentHibernationConfig,
    managedAiSessionsLoading,
    managedAiSessionsError,
    managedAiSessionFocusRequest,
    selectedManagedAiSessionKey,
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
    activePanelId,
    panels,
    shortcutHandlers,
    setShellShortcutAction,
    selectedConversationId,
    conversations,
    aiContextCatalog,
    aiCommandOptions,
    selectedContexts,
    selectedCommandId,
    selectedCommandRef,
    filesUiMode,
    fileSessions,
    fileSessionFolders,
    selectedLeftFileSessionId,
    selectedRightFileSessionId,
    fileTransferTasks,
    snippetGroups,
    quickCommands,
    selectedSnippetGroupUuid,
    snippetSearchQuery,
    macroRecording,
    macroRecordControlKeys,
    macroSleepThresholdMs,
    knowledgeTree,
    kbExpandedKeys,
    kbSelectedKeys,
    kbSearchQuery,
    kbContentSearchResults,
    kbSearchStatus,
    kbSearchLoading,
    kbSearchError,
    kbClipboard,
    kbImportJobs,
    kbUsedBytes,
    kbTotalBytes,
    extensionSearchQuery,
    extensionPlugins,
    selectedExtensionId,
    extensionDetailTab,
    extensionNotice,
    extensionInstallLoadingMap,
    extensionUpdateLoadingMap,
    extensionInstallProgressMap,
    extensionDragActive,
    extensionInstallingPackageName,
    assetManagementOpenRequest,
    ...k8sState,
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
    agentHookInstallers,
    agentHookInstallersLoading,
    agentHookInstallerBusySource,
    agentHookInstallerError,
    exportMcpInstallers,
    exportMcpInstallerBridge,
    exportMcpInstallersLoading,
    exportMcpInstallerBusySource,
    exportMcpInstallerError,
    mcpConfigEditorOpen,
    mcpConfigEditorContent,
    mcpConfigEditorError,
    mcpConfigEditorLastSaved,
    mcpConfigPath,
    privacySettings,
    billingSettings,
    aboutSettings,
    userProfile,
    userNotice,
    mcpServers,
    expandedMcpServerNames,
    activeMcpServerTab,
    mcpToolArgumentDrafts,
    mcpOperationResults,
    settingsSkills,
    skillsUserPath,
    skillModal,
    settingsRules,
    settingsShortcuts,
    shortcutRecording,
    trustedDevices,
    trustedDeviceModal,
    settingsNotice,
    todoItems,
    chatMessages,
    aiContextUsage,
    terminalSecurityPrompt,
    terminalCommandGenerationRecords,
    currentLocale,
    i18nText,
    createRendererLocalId,
    setSettingsNotice,
    setTopNotice,
    activePanel,
    isLeftVisible,
    isRightVisible,
    onboardingCompletedCount,
    onboardingActiveSteps,
    onboardingActiveStep,
    userAccountCenterOpen,
    userContactCodeCountdown,
    userContactCodeSending,
    userLoginTab,
    userLoginLoading,
    userLoginCodeCountdown,
    userLoginCodeSending
  }
}

export type WorkspaceStoreState = ReturnType<typeof createWorkspaceStoreState>
