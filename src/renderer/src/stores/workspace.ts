import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { type KbClipboard, type KnowledgeImportJob } from '@/services/knowledgeRuntime'
import {
  type K8sBastionGroup,
  type K8sCluster,
  type K8sContextInfo,
  type K8sImportContextInfo,
  type K8sNamespaceInfo,
  type K8sProxyConfig,
  type K8sResource,
  type K8sResourceKind
} from '@/services/kubernetesBackendGuards'
import {
  cloneK8sProxyConfig,
  defaultK8sProxyConfig,
  filteredK8sBastions as filteredK8sBastionsRuntime,
  filteredK8sClusters as filteredK8sClustersRuntime,
  filteredK8sResources as filteredK8sResourcesRuntime,
  k8sActiveNamespaces as k8sActiveNamespacesRuntime,
  k8sResourceCluster as k8sResourceClusterRuntime,
  k8sResourceSummary as k8sResourceSummaryRuntime,
  type K8sAgentRunRecord,
  type K8sTerminalTab
} from '@/services/kubernetesRuntime'
import { createWorkspaceFilesController, type FilesUiMode } from '@/services/workspaceFilesController'
import {
  createWorkspaceAiChatController,
  type ChatMessage,
  type ConversationItem,
  type TodoItem
} from '@/services/workspaceAiChatController'
import {
  createWorkspaceExtensionsController,
  type WorkspaceAliasCommand,
  type WorkspaceExtensionInstallProgress,
  type WorkspaceExtensionPlugin
} from '@/services/workspaceExtensionsController'
import {
  createDefaultWorkspaceAboutSettings,
  createWorkspaceAppSettingsController,
  type WorkspaceAboutSettings,
  type WorkspaceGeneralBaseSettingsPatch,
  type WorkspaceOnboardingAiRequest,
  type WorkspaceOnboardingAssetRequest,
  type WorkspaceTopUpdateState
} from '@/services/workspaceAppSettingsController'
import { createWorkspaceKnowledgeController } from '@/services/workspaceKnowledgeController'
import { createWorkspaceKubernetesController } from '@/services/workspaceKubernetesController'
import {
  createWorkspaceManagedAiController,
  defaultAgentHibernationConfig,
  type AiAttentionFocusRequest,
  type AiAttentionItem,
  type ManagedAiSession
} from '@/services/workspaceManagedAiController'
import {
  createInitialWorkspaceTerminalPanels,
  createWorkspaceTerminalPanelsController
} from '@/services/workspaceTerminalPanelsController'
import {
  createWorkspaceTerminalExecutionController,
  type TerminalCommandSource,
  type TerminalSecurityDecision,
  type TerminalSecurityExecution,
  type TerminalSecurityPrompt
} from '@/services/workspaceTerminalExecutionController'
import {
  createWorkspaceMcpController,
  type WorkspaceMcpOperationRecord,
  type WorkspaceMcpServer
} from '@/services/workspaceMcpController'
import { createWorkspaceQuickCommandsController } from '@/services/workspaceQuickCommandsController'
import {
  createWorkspaceSettingsController,
  type WorkspaceSettingsRule,
  type WorkspaceSettingsShortcut,
  type WorkspaceSettingsSkill,
  type WorkspaceSkillModalState
} from '@/services/workspaceSettingsController'
import {
  createWorkspaceShellController,
  type AssetManagementOpenRequest
} from '@/services/workspaceShellController'
import { type ShortcutActionHandler } from '@/services/shortcutRuntime'
import {
  createEmptyMacroRecordingState,
  type MacroRecordingState,
  type QuickCommandSnippet,
  type SnippetGroup
} from '@/services/quickCommandsRuntime'
import { MACRO_DEFAULT_SLEEP_THRESHOLD_MS } from '@/services/terminalMacroRuntime'
import {
  type PanelDirection,
  type TerminalOutputScope,
  type TerminalPanel,
  type TerminalSshSession
} from '@/services/terminalPanelRuntime'
import {
  createDefaultWorkspaceBillingSettings,
  createEmptyWorkspaceUserProfile,
  createWorkspaceUserController,
  type WorkspaceBillingSettings,
  type WorkspaceTrustedDevice,
  type WorkspaceTrustedDeviceModal,
  type WorkspaceUserLoginTab
} from '@/services/workspaceUserController'
import { createDefaultOnboardingCompleted, onboardingTourSteps } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type { OnboardingModuleId } from '@/config/onboarding'
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
  knowledgeTreeSize,
  layoutWidthLimits,
  mergeUserConfig,
  normalizeKeywordHighlightConfig,
  normalizeModelSettingsConfig,
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
} from '@/services/workspaceConfigRuntime'
import { resolveLocale, translateWithLocale } from '@/i18n/runtime'
import type { I18nKey } from '@/i18n/messages'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'
import type {
  AiChatContextUsageSnapshot,
  AiCommandCatalogOption,
  AiCommandChipRef,
  AiContentPart,
  AiContextCatalog,
  AiContextOption
} from '@shared/contracts/aiChat'
import type {
  AiModelCatalog,
  AiModelCatalogOption,
  ModelOptionUserConfig,
  NotificationUserConfig,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  WorkspaceUserConfig
} from '@shared/contracts/appRuntime'
import type { FileSessionCatalog, FileSessionFolderRecord, FileSessionFolderSaveInput, FileSessionInfo, FileSessionPatch, FileTransferTask } from '@shared/contracts/files'
import type { AiopsUserProfile } from '@shared/contracts/userAccount'
import type {
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  KnowledgeNode,
  KnowledgeNodeType
} from '@shared/contracts/knowledgeBase'
import type { AgentHibernationConfig } from '@shared/contracts/managedAiSessions'
import type { ControlNotificationRecord } from '@shared/contracts/control'
import type { AgentHookInstallerStatus, AgentHookInstallerSource } from '@shared/contracts/agentHooks'

export type {
  AiAttentionFocusRequest,
  AiAttentionInput,
  AiAttentionItem,
  AiAttentionKind,
  AiAttentionSource,
  ManagedAiSession,
  ManagedAiSessionState
} from '@/services/workspaceManagedAiController'
export type {
  PanelDirection,
  TerminalOutputScope,
  TerminalOutputSegment,
  TerminalPanel,
  TerminalSshSession
} from '@/services/terminalPanelRuntime'
export type {
  ChatMessage,
  ConversationItem,
  TodoItem
} from '@/services/workspaceAiChatController'
export type {
  TerminalCommandSource,
  TerminalSecurityDecision,
  TerminalSecurityExecution,
  TerminalSecurityPrompt
} from '@/services/workspaceTerminalExecutionController'
export type {
  AiChatChipContentPart,
  AiChatChipRef,
  AiChatContextUsageSnapshot,
  AiChipContentPart,
  AiCommandChipContentPart,
  AiCommandChipRef,
  AiContentPart,
  AiDocChipContentPart,
  AiDocChipRef,
  AiImageContentPart,
  AiSkillChipContentPart,
  AiSkillChipRef,
  AiSupportedImageType,
  AiTextContentPart
} from '@shared/contracts/aiChat'

export { layoutWidthLimits } from '@/services/workspaceConfigRuntime'
export type {
  AiPreferenceSettings,
  EditorSettings,
  ExtensionSettings,
  KeywordHighlightSettings,
  ModelProviderSettings,
  PrivacySettings,
  SecuritySettings,
  TerminalSettings
} from '@/services/workspaceConfigRuntime'
export type {
  WorkspaceBillingSettings as BillingSettings,
  WorkspaceUserLoginTab as UserLoginTab
} from '@/services/workspaceUserController'

type AiContextUsage = AiChatContextUsageSnapshot

type RendererLocalIdPrefix = 'panel' | 'terminal-security' | 'aichat-agent-loop'
const createRendererLocalId = (prefix: RendererLocalIdPrefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`

export const useWorkspaceStore = defineStore('workspace', () => {
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

  let shellShortcutAction: ((actionId: string, digit?: number) => boolean) | null = null
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
  const selectedExtensionId = ref<string>('jumpserverSupport')
  const extensionDetailTab = ref<'details' | 'features'>('details')
  const extensionNotice = ref('')
  const extensionInstallLoadingMap = ref<Record<string, boolean>>({})
  const extensionUpdateLoadingMap = ref<Record<string, boolean>>({})
  const extensionInstallProgressMap = ref<Record<string, WorkspaceExtensionInstallProgress>>({})
  const extensionDragActive = ref(false)
  const extensionInstallingPackageName = ref('')
  const assetManagementOpenRequest = ref<AssetManagementOpenRequest>({ sequence: 0, action: 'none' })
  const aliasCommands = ref<WorkspaceAliasCommand[]>([])
  const aliasSearchQuery = ref('')
  const k8sContexts = ref<K8sContextInfo[]>([])
  const k8sClusters = ref<K8sCluster[]>([])
  const k8sBastions = ref<K8sBastionGroup[]>([])
  const k8sNamespaces = ref<K8sNamespaceInfo[]>([])
  const k8sResources = ref<K8sResource[]>([])
  const k8sConnectingClusterIds = ref<string[]>([])
  const k8sSyncingBastionIds = ref<string[]>([])
  const k8sDeleteConfirmClusterId = ref<string | null>(null)
  const k8sClusterActionMenuId = ref<string | null>(null)
  const k8sImportContexts = ref<K8sImportContextInfo[]>([])
  const k8sActiveClusterId = ref<string | null>(null)
  const k8sSearchQuery = ref('')
  const k8sConfigTab = ref<'local' | 'jumpserver'>('local')
  const k8sSelectedClusterId = ref<string | null>(null)
  const k8sClusterNotice = ref('')
  const k8sTerminalTabs = ref<K8sTerminalTab[]>([])
  const k8sActiveTerminalId = ref<string | null>(null)
  const k8sAddModalOpen = ref(false)
  const k8sEditModalOpen = ref(false)
  const k8sEditingClusterId = ref<string | null>(null)
  const k8sAddMode = ref<'import' | 'manual'>('import')
  const k8sTestResult = ref<boolean | null>(null)
  const k8sCollapsedBastionIds = ref<string[]>([])
  const k8sResourceKind = ref<K8sResourceKind>('pods')
  const k8sResourceNamespace = ref('all')
  const k8sResourceQuery = ref('')
  const k8sResourceOutput = ref('选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。')
  const k8sResourceOutputTitle = ref('资源输出')
  const k8sResourceLoading = ref(false)
  const k8sCopiedCommand = ref('')
  const k8sAgentClusterId = ref<string | null>(null)
  const k8sAgentContextName = ref('')
  const k8sAgentStatus = ref<'idle' | 'ready' | 'running' | 'error'>('idle')
  const k8sAgentCommandDraft = ref('kubectl get pods -A')
  const k8sAgentCommandHistory = ref<string[]>(['kubectl get pods -A', 'kubectl get namespaces', 'kubectl version --request-timeout=10s'])
  const k8sAgentRuns = ref<K8sAgentRunRecord[]>([])
  const k8sAgentLastResult = ref<K8sAgentRunRecord | null>(null)
  const k8sAgentTesting = ref(false)
  const savedK8sProxyConfig = ref<K8sProxyConfig>(cloneK8sProxyConfig(defaultK8sProxyConfig))
  const k8sProxyConfig = ref<K8sProxyConfig>(cloneK8sProxyConfig(defaultK8sProxyConfig))
  const k8sProxyConfigOpen = ref(false)
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
  const currentLocale = () => resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language])
  const i18nText = (key: I18nKey, params: Record<string, string | number> = {}) =>
    Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), translateWithLocale(currentLocale(), key))
  const todoItems = ref<TodoItem[]>([])
  const chatMessages = ref<ChatMessage[]>([])
  const aiContextUsage = ref<AiContextUsage | null>(null)
  const terminalSecurityPrompt = ref<TerminalSecurityPrompt>(null)
  const terminalCommandGenerationRecords = ref<TerminalCommandGenerationRecord[]>([])
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
  const k8sHasContexts = computed(() => k8sContexts.value.length > 0)
  const k8sActiveContext = computed(() => k8sContexts.value.find((context) => context.isActive) || null)
  const k8sSelectedCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sSelectedClusterId.value) || null)
  const k8sActiveCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sActiveClusterId.value) || null)
  const k8sDeleteConfirmCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sDeleteConfirmClusterId.value) || null)
  const filteredK8sClusters = computed(() => filteredK8sClustersRuntime(k8sClusters.value, k8sSearchQuery.value))
  const localK8sClusters = computed(() => filteredK8sClusters.value.filter((cluster) => cluster.source_type === 'local'))
  const filteredK8sBastions = computed(() => filteredK8sBastionsRuntime(k8sBastions.value, k8sClusters.value, k8sSearchQuery.value))
  const k8sActiveTerminal = computed(() => k8sTerminalTabs.value.find((tab) => tab.id === k8sActiveTerminalId.value) || null)
  const k8sAgentCluster = computed(() => (k8sAgentClusterId.value ? k8sClusters.value.find((cluster) => cluster.id === k8sAgentClusterId.value) || null : null))
  const k8sAgentCurrentCluster = computed(() => ({
    clusterId: k8sAgentCluster.value?.id || null,
    contextName: k8sAgentCluster.value?.context_name || k8sAgentContextName.value || null
  }))
  const k8sResourceCluster = computed(() => k8sResourceClusterRuntime(k8sClusters.value, k8sActiveClusterId.value, k8sSelectedClusterId.value))
  const k8sActiveNamespaces = computed(() => k8sActiveNamespacesRuntime(k8sNamespaces.value, k8sResources.value, k8sResourceCluster.value?.id || null))
  const filteredK8sResources = computed(() =>
    filteredK8sResourcesRuntime(k8sResources.value, {
      clusterId: k8sResourceCluster.value?.id || null,
      kind: k8sResourceKind.value,
      namespace: k8sResourceNamespace.value,
      query: k8sResourceQuery.value
    })
  )
  const k8sResourceSummary = computed<Record<K8sResourceKind, number>>(() =>
    k8sResourceSummaryRuntime(k8sResources.value, k8sResourceCluster.value?.id || null, k8sResourceNamespace.value)
  )
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

  const {
    isUserSubscriptionActive,
    canEditUserMobile,
    canEditUserEmail,
    canResetUserPassword,
    setUserNotice,
    refreshUserAccount,
    openAccountCenter,
    closeAccountCenter,
    openUserLogin,
    setUserLoginTab,
    loginUser,
    logoutUser,
    deactivateUserAccount,
    skipUserLogin,
    sendUserLoginCode,
    loginWithAccount,
    loginWithEmail,
    loginWithMobile,
    updateUserProfile,
    resetUserPassword,
    sendUserContactCode,
    bindUserContact,
    prepareUserAvatarImage,
    openTrustedDeviceRevoke,
    confirmTrustedDeviceRevoke
  } = createWorkspaceUserController(
    {
      activeModule,
      privacySettings,
      billingSettings,
      userProfile,
      userNotice,
      userAccountCenterOpen,
      userContactCodeCountdown,
      userContactCodeSending,
      userLoginTab,
      userLoginLoading,
      userLoginCodeCountdown,
      userLoginCodeSending,
      trustedDevices,
      trustedDeviceModal
    },
    {
      setSettingsNotice
    }
  )

  const {
    pendingAiAttentionItems,
    aiAttentionUnreadCount,
    currentAiAttentionItem,
    sortedManagedAiSessions,
    managedAiNeedsInputSessions,
    selectedManagedAiSession,
    upsertAiAttentionItem,
    removeAiAttentionItem,
    markAiAttentionHandled,
    clearAiAttentionForConversation,
    refreshControlNotificationAttentionItems,
    applyControlNotificationSnapshot,
    focusControlNotification,
    openControlNotification,
    jumpToNextAiAttention,
    refreshAgentHookInstallers,
    installAgentHookInstaller,
    uninstallAgentHookInstaller,
    refreshManagedAiSessions,
    refreshManagedAiSessionsDebounced,
    applyManagedAiSessionSnapshot,
    upsertManagedAiSession,
    markManagedAiSessionHandled,
    replyManagedAiSession,
    renameManagedAiSession,
    clearManagedAiSession,
    bulkManagedAiSessions,
    refreshAgentHibernationConfig,
    updateAgentHibernationConfig,
    setAgentHibernationEnabled,
    hibernateManagedAiSession,
    managedAiSessionNeedsAttentionForPanel,
    focusManagedAiSession,
    focusManagedAiSessionRequest,
    resumeManagedAiSession,
    touchManagedAiTerminalActivity,
    applyManagedAiTerminalLifecycle,
    applyManagedAiTerminalExit
  } = createWorkspaceManagedAiController(
    {
      mode,
      activeModule,
      leftPanelOpen,
      rightPanelOpen,
      agentsLeftOpen,
      activePanelId,
      panels,
      notificationSettings,
      aiAttentionItems,
      controlNotifications,
      aiAttentionFocusRequest,
      managedAiSessions,
      agentHibernationConfig,
      managedAiSessionsLoading,
      managedAiSessionsError,
      managedAiSessionFocusRequest,
      selectedManagedAiSessionKey,
      agentHookInstallers,
      agentHookInstallersLoading,
      agentHookInstallerBusySource,
      agentHookInstallerError
    },
    {
      setTopNotice,
      i18nText,
      runTerminalCommand: (...args) => runTerminalCommand(...args)
    }
  )

  const {
    createPanel,
    activateTerminalPanel,
    openTerminalForAiHostContext,
    hasSplitState,
    unsplitPanel,
    attachPanelToSplit,
    closePanel,
    discardPendingTerminalPanel,
    closeOthers,
    closeAllPanels,
    closePanels,
    renamePanel,
    setPanelAutoTitle,
    canForkSshPanel,
    forkSshPanel,
    registerSshSession,
    applySshTerminalSession,
    applyLocalTerminalSession,
    openKnowledgeFile,
    syncKnowledgePanelsAfterRename,
    closeKnowledgePanelsForRemoved,
    appendTerminalOutput,
    applyTerminalLifecycle,
    applyTerminalExit,
    appendTerminalInput,
    replaceTerminalOutput,
    getHighlightedTerminalOutput
  } = createWorkspaceTerminalPanelsController(
    {
      mode,
      activeModule,
      activePanelId,
      panels,
      terminalSettings,
      extensionSettings,
      keywordHighlightSettings,
      kbSelectedKeys
    },
    {
      setTopNotice,
      createRendererLocalId,
      findKnowledgeNode: (relPath) => findKnowledgeNode(relPath),
      recordMacroTerminalInput: (...args) => recordMacroTerminalInput(...args),
      touchManagedAiTerminalActivity,
      applyManagedAiTerminalLifecycle,
      applyManagedAiTerminalExit
    }
  )

  const {
    terminalCommandModelOptions,
    prepareTerminalSecurityExecution,
    writeTerminalExecution,
    executeTerminalCommand,
    runTerminalCommand,
    executeGlobalTerminalCommand,
    runGlobalTerminalCommand,
    approveTerminalSecurityPrompt,
    cancelTerminalSecurityPrompt,
    resolveActiveWritableTerminalPanel,
    waitForTerminalOutputAfter,
    stageActiveTerminalCommand,
    runActiveTerminalCommand,
    appendActiveTerminalInput,
    generateTerminalCommand,
    injectGeneratedTerminalCommand
  } = createWorkspaceTerminalExecutionController(
    {
      panels,
      activePanel,
      securitySettings,
      settingModelOptions,
      terminalSecurityPrompt,
      terminalCommandGenerationRecords
    },
    {
      setTopNotice,
      createRendererLocalId,
      recordMacroTerminalInput: (...args) => recordMacroTerminalInput(...args)
    }
  )

  const k8sController = createWorkspaceKubernetesController(
    {
      k8sContexts,
      k8sClusters,
      k8sBastions,
      k8sNamespaces,
      k8sResources,
      k8sConnectingClusterIds,
      k8sSyncingBastionIds,
      k8sDeleteConfirmClusterId,
      k8sClusterActionMenuId,
      k8sImportContexts,
      k8sActiveClusterId,
      k8sSearchQuery,
      k8sConfigTab,
      k8sSelectedClusterId,
      k8sClusterNotice,
      k8sTerminalTabs,
      k8sActiveTerminalId,
      k8sAddModalOpen,
      k8sEditModalOpen,
      k8sEditingClusterId,
      k8sTestResult,
      k8sCollapsedBastionIds,
      k8sResourceKind,
      k8sResourceNamespace,
      k8sResourceOutput,
      k8sResourceOutputTitle,
      k8sResourceLoading,
      k8sCopiedCommand,
      k8sAgentClusterId,
      k8sAgentContextName,
      k8sAgentStatus,
      k8sAgentCommandDraft,
      k8sAgentCommandHistory,
      k8sAgentRuns,
      k8sAgentLastResult,
      k8sAgentTesting,
      savedK8sProxyConfig,
      k8sProxyConfig,
      k8sProxyConfigOpen,
      k8sActiveCluster,
      k8sSelectedCluster,
      k8sActiveTerminal,
      k8sAgentCluster,
      k8sResourceCluster
    },
    { sendChat: (...args) => sendChat(...args) }
  )

  const {
    refreshKubernetesCatalog,
    switchK8sContext,
    reloadK8sConfig,
    clearK8sSearch,
    selectK8sCluster,
    setK8sActionMenu,
    openK8sProxyConfig,
    closeK8sProxyConfig,
    updateK8sProxyConfig,
    saveK8sProxyConfig,
    setK8sAgentCluster,
    connectK8sCluster,
    disconnectK8sCluster,
    openK8sTerminal,
    createNewK8sTerminalTab,
    closeK8sTerminalTab,
    setActiveK8sTerminal,
    resizeK8sTerminal,
    endK8sTerminalSession,
    sendK8sTerminalCommand,
    executeK8sTerminalAiCommand,
    runK8sAgentKubectl,
    testK8sAgentConnection,
    refreshK8sAgentNamespaces,
    cleanupK8sAgent,
    setK8sResourceKind,
    setK8sResourceNamespace,
    refreshK8sResources,
    describeK8sResource,
    showK8sPodLogs,
    copyK8sResourceCommand,
    copyK8sResourceOutput,
    clearK8sResourceOutput,
    sendK8sCurrentOutputToTerminal,
    sendK8sCurrentOutputToAi,
    sendK8sResourceCommand,
    testK8sClusterConnection,
    selectK8sImportContext,
    importK8sKubeconfigContent,
    importK8sKubeconfigFile,
    addK8sCluster,
    updateK8sCluster,
    requestDeleteK8sCluster,
    cancelDeleteK8sCluster,
    confirmDeleteK8sCluster,
    deleteK8sCluster,
    syncK8sBastion,
    toggleK8sBastionCollapsed
  } = k8sController

  const {
    readMcpServersSnapshotFromBridge,
    applyMcpServersSnapshot,
    refreshMcpServersFromBridge,
    openMcpConfigEditor,
    closeMcpConfigEditor,
    updateMcpConfigEditorContent,
    saveMcpConfigEditor,
    toggleMcpServerExpanded,
    setMcpServerTab,
    toggleMcpServerDisabled,
    deleteMcpServer,
    toggleMcpTool,
    toggleMcpToolAutoApprove,
    getMcpToolOperationKey,
    getMcpResourceOperationKey,
    getMcpToolArgumentDraft,
    updateMcpToolArgumentDraft,
    runMcpTool,
    readMcpResource
  } = createWorkspaceMcpController(
    {
      config,
      mcpServers,
      expandedMcpServerNames,
      activeMcpServerTab,
      mcpToolArgumentDrafts,
      mcpOperationResults,
      mcpConfigEditorOpen,
      mcpConfigEditorContent,
      mcpConfigEditorError,
      mcpConfigEditorLastSaved,
      mcpConfigPath
    },
    {
      setSettingsNotice,
      closeKeywordHighlightEditor: () => closeKeywordHighlightEditor(),
      closeSecurityConfigEditor: () => closeSecurityConfigEditor()
    }
  )

  const {
    refreshShortcutRuntime,
    hydrateSettingsPreferences,
    hydrateSkills,
    loadSkillsFromBridge,
    refreshSkillsFromBridge,
    reloadSkills,
    openSkillsFolder,
    openSkillModal,
    closeSkillModal,
    saveSkillModal,
    createSkill,
    toggleSkillEnabled,
    deleteSkill,
    importSkillZip,
    exportSkillZip,
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
  } = createWorkspaceSettingsController(
    {
      config,
      settingsSkills,
      skillsUserPath,
      skillModal,
      settingsRules,
      settingsShortcuts,
      shortcutRecording
    },
    {
      setSettingsNotice,
      shortcutHandlers
    }
  )

  const {
    selectedLeftFileSession,
    selectedRightFileSession,
    transferTaskGroups,
    transferTaskCount,
    transferOverallPercent,
    hasRunningFileTransferTasks,
    refreshFileSessionCatalog,
    refreshFileTransferTasks,
    setFilesUiMode,
    selectFileSession,
    openFileSession,
    ensureFileSessionForTerminalPanel,
    closeFileSession,
    addRemoteFileSession,
    addRemoteFileSessionFromSftpPayload,
    persistFileSession,
    updateFileSession,
    saveFileSessionFolder,
    deleteFileSessionFolder,
    pushFileTransferTask,
    observeFileTransferTasks,
    cancelFileTransferTask
  } = createWorkspaceFilesController(
    {
      filesUiMode,
      fileSessions,
      fileSessionFolders,
      selectedLeftFileSessionId,
      selectedRightFileSessionId,
      fileTransferTasks,
      activePanelId,
      panels
    },
    {
      setTopNotice,
      setActiveModule: (...args) => setActiveModule(...args)
    }
  )

  const {
    filteredQuickCommands,
    currentSnippetGroupName,
    isMacroRecording: quickCommandsIsMacroRecording,
    recordedCommands: quickCommandsRecordedCommands,
    macroCurrentLineBuffer: quickCommandsMacroCurrentLineBuffer,
    macroTerminalId: quickCommandsMacroTerminalId,
    macroLimitReason: quickCommandsMacroLimitReason,
    applyQuickCommandsSnapshot,
    refreshQuickCommands,
    createSnippetGroup,
    renameSnippetGroup,
    deleteSnippetGroup,
    createQuickCommand,
    updateQuickCommand,
    deleteQuickCommand,
    reorderQuickCommand,
    runQuickCommand,
    startMacroRecording,
    recordMacroCommand,
    recordMacroTerminalInput,
    setMacroRecordControlKeys,
    setMacroSleepThreshold,
    stopMacroRecording,
    cancelMacroRecording
  } = createWorkspaceQuickCommandsController(
    {
      config,
      snippetGroups,
      quickCommands,
      selectedSnippetGroupUuid,
      snippetSearchQuery,
      macroRecording,
      macroRecordControlKeys,
      macroSleepThresholdMs,
      panels,
      activePanel
    },
    {
      setTopNotice,
      clearTerminalSecurityPrompt: () => {
        terminalSecurityPrompt.value = null
      },
      prepareTerminalSecurityExecution,
      writeTerminalExecution
    }
  )

  const {
    filteredKnowledgeTree,
    kbContentSearchVisible,
    kbCapacityPercent,
    setupKnowledgeBridgeListeners,
    refreshKnowledgeTree,
    searchKnowledgeContent,
    reindexKnowledgeContent,
    refreshKnowledgeSearchStatus,
    resolveAiKnowledgeSearchContexts,
    findKnowledgeNode,
    selectKnowledgeNode,
    createKnowledgeNode,
    renameKnowledgeNode,
    deleteKnowledgeNodes,
    copyKnowledgeNodes,
    pasteKnowledgeNodes,
    addKnowledgeImportJob,
    addKnowledgeFilesToChat,
    backendKnowledgeEntryOrNotice,
    uniqueKnowledgeFileName
  } = createWorkspaceKnowledgeController(
    {
      config,
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
      selectedContexts,
      rightPanelOpen,
      aiPreferences
    },
    {
      setTopNotice,
      openKnowledgeFile,
      syncKnowledgePanelsAfterRename,
      closeKnowledgePanelsForRemoved
    }
  )

  const {
    sortedConversations,
    todoProgress,
    aiSkillContextOptions,
    hydrateClassicChatData,
    loadChatConversationsFromBackend,
    syncCurrentConversationSnapshot,
    refreshAiTodoSnapshot,
    refreshAiContextCatalog,
    refreshAiCommandCatalog,
    continueAgentCommandLoop,
    enableAgentReadOnlyAutoRunForCurrentConversation,
    sendChat,
    cancelStreamingAiChatResponse,
    resendUserMessageFromParts,
    createConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    toggleConversationFavorite,
    restoreConversation,
    toggleContext,
    removeContext,
    applyCommandPreset,
    selectCommandPreset,
    approveAiMcpToolCall,
    rejectAiMcpToolCall,
    approveAiMcpResourceAccess,
    rejectAiMcpResourceAccess,
    setMessageFeedback,
    toggleMessageFavorite,
    retryAssistantMessage,
    retryLastAssistantMessage,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill
  } = createWorkspaceAiChatController(
    {
      mode,
      config,
      aiPreferences,
      conversations,
      selectedConversationId,
      aiContextCatalog,
      aiCommandOptions,
      selectedContexts,
      selectedCommandId,
      selectedCommandRef,
      todoItems,
      chatMessages,
      aiContextUsage,
      mcpConfigEditorContent,
      kbSelectedKeys,
      settingsSkills
    },
    {
      setTopNotice,
      i18nText,
      createRendererLocalId,
      resolveAiKnowledgeSearchContexts: (...args) => resolveAiKnowledgeSearchContexts(...args),
      applyMcpServersSnapshot: (...args) => applyMcpServersSnapshot(...args),
      resolveActiveWritableTerminalPanel,
      runActiveTerminalCommand,
      waitForTerminalOutputAfter,
      findKnowledgeNode: (relPath) => findKnowledgeNode(relPath),
      backendKnowledgeEntryOrNotice: (...args) => backendKnowledgeEntryOrNotice(...args),
      uniqueKnowledgeFileName: (...args) => uniqueKnowledgeFileName(...args),
      refreshKnowledgeTree: () => refreshKnowledgeTree(),
      openKnowledgeFile,
      createSkill: (...args) => createSkill(...args)
    }
  )

  const {
    filteredExtensionPlugins,
    selectedExtension,
    selectedExtensionInstallProgress,
    filteredAliasCommands,
    ensureSelectedExtensionVisible,
    selectExtension,
    setExtensionNotice,
    setExtensionDragActive,
    refreshExtensionPlugins,
    installExtensionPlugin,
    updateExtensionPlugin,
    uninstallExtensionPlugin,
    subscribeExtensionPlugin,
    cancelExtensionInstall,
    dropExtensionPackage,
    getAliasCommandsSnapshot,
    refreshAliasCommands,
    hydrateAliasCommands,
    createAliasCommand,
    startAliasEdit,
    updateAliasDraft,
    saveAliasCommand,
    cancelAliasEdit,
    deleteAliasCommand
  } = createWorkspaceExtensionsController({
    config,
    extensionSettings,
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
    aliasCommands,
    aliasSearchQuery
  })

  const {
    applyCurrentTheme,
    applyCurrentEditorSettings,
    restoreSavedGeneralBaseSettings,
    setupThemeBridge,
    refreshSshAgentKeychainOptions,
    hydrateConfig,
    saveConfig,
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
    quickCloseRightPanel
  } = createWorkspaceAppSettingsController(
    {
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
    },
    {
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
      loadSkillsFromBridge,
      refreshMcpServersFromBridge,
      closeMcpConfigEditor,
      refreshControlNotificationAttentionItems,
      ensureSelectedExtensionVisible,
      openAccountCenter
    }
  )

  const {
    switchToTerminalPanelIndex,
    triggerShortcutAction,
    setActiveModule,
    openAssetManagement,
    handleDeepLink
  } = createWorkspaceShellController(
    {
      mode,
      activeModule,
      leftPanelOpen,
      rightPanelOpen,
      agentsLeftOpen,
      activePanelId,
      panels,
      config,
      onboardingGuideOpen,
      assetManagementOpenRequest
    },
    {
      setTopNotice,
      createPanel,
      toggleRight,
      setActiveSettingsSection
    }
  )
  shellShortcutAction = triggerShortcutAction

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
    setTopNotice,
    aiAttentionItems,
    controlNotifications,
    pendingAiAttentionItems,
    aiAttentionUnreadCount,
    currentAiAttentionItem,
    aiAttentionFocusRequest,
    managedAiSessions,
    agentHibernationConfig,
    notificationSettings,
    managedAiSessionsLoading,
    managedAiSessionsError,
    sortedManagedAiSessions,
    managedAiNeedsInputSessions,
    selectedManagedAiSession,
    managedAiSessionFocusRequest,
    selectedManagedAiSessionKey,
    upsertAiAttentionItem,
    refreshManagedAiSessions,
    refreshManagedAiSessionsDebounced,
    applyManagedAiSessionSnapshot,
    upsertManagedAiSession,
    markManagedAiSessionHandled,
    replyManagedAiSession,
    renameManagedAiSession,
    clearManagedAiSession,
    bulkManagedAiSessions,
    refreshAgentHibernationConfig,
    updateAgentHibernationConfig,
    setAgentHibernationEnabled,
    hibernateManagedAiSession,
    managedAiSessionNeedsAttentionForPanel,
    focusManagedAiSession,
    focusManagedAiSessionRequest,
    resumeManagedAiSession,
    removeAiAttentionItem,
    markAiAttentionHandled,
    clearAiAttentionForConversation,
    applyControlNotificationSnapshot,
    focusControlNotification,
    openControlNotification,
    jumpToNextAiAttention,
    onboardingCompleted,
    onboardingActiveTour,
    onboardingActiveStepIndex,
    onboardingGuideOpen,
    onboardingAiRequest,
    onboardingAssetRequest,
    onboardingAutoApprovalEvent,
    config,
    panels,
    activePanelId,
    activePanel,
    isLeftVisible,
    isRightVisible,
    conversations,
    sortedConversations,
    selectedConversationId,
    chatMessages,
    aiContextUsage,
    terminalSecurityPrompt,
    terminalCommandGenerationRecords,
    selectedContexts,
    aiSkillContextOptions,
    aiCommandOptions,
    selectedCommandId,
    selectedCommandRef,
    filesUiMode,
    fileSessions,
    fileSessionFolders,
    selectedLeftFileSessionId,
    selectedRightFileSessionId,
    selectedLeftFileSession,
    selectedRightFileSession,
    fileTransferTasks,
    transferTaskGroups,
    transferTaskCount,
    transferOverallPercent,
    hasRunningFileTransferTasks,
    refreshFileSessionCatalog,
    refreshFileTransferTasks,
    terminalCommandModelOptions,
    snippetGroups,
    quickCommands,
    selectedSnippetGroupUuid,
    snippetSearchQuery,
    filteredQuickCommands,
    currentSnippetGroupName,
    isMacroRecording: quickCommandsIsMacroRecording,
    recordedCommands: quickCommandsRecordedCommands,
    macroCurrentLineBuffer: quickCommandsMacroCurrentLineBuffer,
    macroTerminalId: quickCommandsMacroTerminalId,
    macroRecordControlKeys,
    macroSleepThresholdMs,
    macroLimitReason: quickCommandsMacroLimitReason,
    knowledgeTree,
    kbExpandedKeys,
    kbSelectedKeys,
    kbSearchQuery,
    kbContentSearchResults,
    kbSearchStatus,
    kbSearchLoading,
    kbSearchError,
    kbContentSearchVisible,
    kbClipboard,
    kbImportJobs,
    kbUsedBytes,
    kbTotalBytes,
    filteredKnowledgeTree,
    kbCapacityPercent,
    extensionSearchQuery,
    extensionPlugins,
    filteredExtensionPlugins,
    selectedExtensionId,
    selectedExtension,
    selectedExtensionInstallProgress,
    extensionDetailTab,
    extensionNotice,
    extensionInstallLoadingMap,
    extensionUpdateLoadingMap,
    extensionInstallProgressMap,
    extensionDragActive,
    extensionInstallingPackageName,
    assetManagementOpenRequest,
    aliasCommands,
    refreshAliasCommands,
    aliasSearchQuery,
    filteredAliasCommands,
    k8sContexts,
    k8sClusters,
    k8sBastions,
    k8sNamespaces,
    k8sResources,
    k8sConnectingClusterIds,
    k8sSyncingBastionIds,
    k8sDeleteConfirmClusterId,
    k8sDeleteConfirmCluster,
    k8sClusterActionMenuId,
    k8sImportContexts,
    k8sActiveClusterId,
    k8sSearchQuery,
    k8sConfigTab,
    k8sSelectedClusterId,
    k8sClusterNotice,
    k8sTerminalTabs,
    k8sActiveTerminalId,
    k8sAddModalOpen,
    k8sEditModalOpen,
    k8sEditingClusterId,
    k8sAddMode,
    k8sTestResult,
    k8sCollapsedBastionIds,
    k8sResourceKind,
    k8sResourceNamespace,
    k8sResourceQuery,
    k8sResourceOutput,
    k8sResourceOutputTitle,
    k8sResourceLoading,
    k8sCopiedCommand,
    k8sAgentClusterId,
    k8sAgentContextName,
    k8sAgentStatus,
    k8sAgentCommandDraft,
    k8sAgentCommandHistory,
    k8sAgentRuns,
    k8sAgentLastResult,
    k8sAgentTesting,
    k8sProxyConfig,
    k8sProxyConfigOpen,
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
    aiPreferences,
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
    userAccountCenterOpen,
    userContactCodeCountdown,
    userContactCodeSending,
    userLoginTab,
    userLoginLoading,
    userLoginCodeCountdown,
    userLoginCodeSending,
    isUserSubscriptionActive,
    canEditUserMobile,
    canEditUserEmail,
    canResetUserPassword,
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
    workspacePreferences,
    k8sHasContexts,
    k8sActiveContext,
    k8sSelectedCluster,
    k8sActiveCluster,
    filteredK8sClusters,
    localK8sClusters,
    filteredK8sBastions,
    k8sActiveTerminal,
    k8sAgentCluster,
    k8sAgentCurrentCluster,
    k8sResourceCluster,
    k8sActiveNamespaces,
    filteredK8sResources,
    k8sResourceSummary,
    onboardingCompletedCount,
    onboardingActiveSteps,
    onboardingActiveStep,
    todoItems,
    todoProgress,
    aiContextCatalog,
    hydrateConfig,
    hydrateClassicChatData,
    loadChatConversationsFromBackend,
    syncCurrentConversationSnapshot,
    refreshAiTodoSnapshot,
    refreshAiContextCatalog,
    refreshAiCommandCatalog,
    refreshAgentHookInstallers,
    installAgentHookInstaller,
    uninstallAgentHookInstaller,
    saveConfig,
    setSettingsNotice,
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
    updateEditorSettings,
    updateTerminalSettings,
    openSshProxyConfig,
    closeSshProxyConfig,
    openAddSshProxyConfig,
    closeAddSshProxyConfig,
    updateSshProxyForm,
    saveSshProxyForm,
    removeSshProxyConfig,
    refreshSshAgentKeychainOptions,
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
    openMcpConfigEditor,
    closeMcpConfigEditor,
    updateMcpConfigEditorContent,
    saveMcpConfigEditor,
    refreshMcpServersFromBridge,
    updatePrivacySettings,
    deactivateUserAccount,
    setUserNotice,
    openAccountCenter,
    closeAccountCenter,
    refreshUserAccount,
    openUserLogin,
    setUserLoginTab,
    loginUser,
    logoutUser,
    skipUserLogin,
    sendUserLoginCode,
    loginWithAccount,
    loginWithEmail,
    loginWithMobile,
    updateUserProfile,
    resetUserPassword,
    sendUserContactCode,
    bindUserContact,
    prepareUserAvatarImage,
    checkAboutUpdate,
    checkTopUpdate,
    handleTopUpdateClick,
    openSettingsExternalAction,
    openSkillsFolder,
    refreshSkillsFromBridge,
    reloadSkills,
    toggleMcpServerExpanded,
    setMcpServerTab,
    toggleMcpServerDisabled,
    deleteMcpServer,
    toggleMcpTool,
    toggleMcpToolAutoApprove,
    getMcpToolOperationKey,
    getMcpResourceOperationKey,
    getMcpToolArgumentDraft,
    updateMcpToolArgumentDraft,
    runMcpTool,
    readMcpResource,
    openSkillModal,
    closeSkillModal,
    saveSkillModal,
    toggleSkillEnabled,
    deleteSkill,
    importSkillZip,
    exportSkillZip,
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
    uninstallShortcutRuntime,
    triggerShortcutAction,
    handleDeepLink,
    openTrustedDeviceRevoke,
    confirmTrustedDeviceRevoke,
    toggleMode,
    setActiveModule,
    openAssetManagement,
    openAiSessionSettings,
    setFilesUiMode,
    selectFileSession,
    openFileSession,
    ensureFileSessionForTerminalPanel,
    closeFileSession,
    addRemoteFileSession,
    addRemoteFileSessionFromSftpPayload,
    persistFileSession,
    updateFileSession,
    saveFileSessionFolder,
    deleteFileSessionFolder,
    pushFileTransferTask,
    observeFileTransferTasks,
    cancelFileTransferTask,
    createSnippetGroup,
    renameSnippetGroup,
    deleteSnippetGroup,
    refreshQuickCommands,
    createQuickCommand,
    updateQuickCommand,
    deleteQuickCommand,
    reorderQuickCommand,
    runQuickCommand,
    startMacroRecording,
    recordMacroCommand,
    recordMacroTerminalInput,
    setMacroRecordControlKeys,
    setMacroSleepThreshold,
    stopMacroRecording,
    cancelMacroRecording,
    refreshKnowledgeTree,
    searchKnowledgeContent,
    reindexKnowledgeContent,
    refreshKnowledgeSearchStatus,
    findKnowledgeNode,
    selectKnowledgeNode,
    openKnowledgeFile,
    createKnowledgeNode,
    renameKnowledgeNode,
    deleteKnowledgeNodes,
    copyKnowledgeNodes,
    pasteKnowledgeNodes,
    addKnowledgeImportJob,
    addKnowledgeFilesToChat,
    refreshExtensionPlugins,
    selectExtension,
    setExtensionDragActive,
    installExtensionPlugin,
    updateExtensionPlugin,
    uninstallExtensionPlugin,
    subscribeExtensionPlugin,
    cancelExtensionInstall,
    dropExtensionPackage,
    createAliasCommand,
    startAliasEdit,
    updateAliasDraft,
    saveAliasCommand,
    cancelAliasEdit,
    deleteAliasCommand,
    refreshKubernetesCatalog,
    switchK8sContext,
    reloadK8sConfig,
    clearK8sSearch,
    selectK8sCluster,
    setK8sActionMenu,
    openK8sProxyConfig,
    closeK8sProxyConfig,
    updateK8sProxyConfig,
    saveK8sProxyConfig,
    setK8sAgentCluster,
    connectK8sCluster,
    disconnectK8sCluster,
    openK8sTerminal,
    createNewK8sTerminalTab,
    closeK8sTerminalTab,
    setActiveK8sTerminal,
    resizeK8sTerminal,
    endK8sTerminalSession,
    sendK8sTerminalCommand,
    executeK8sTerminalAiCommand,
    runK8sAgentKubectl,
    testK8sAgentConnection,
    refreshK8sAgentNamespaces,
    cleanupK8sAgent,
    setK8sResourceKind,
    setK8sResourceNamespace,
    refreshK8sResources,
    describeK8sResource,
    showK8sPodLogs,
    copyK8sResourceCommand,
    copyK8sResourceOutput,
    clearK8sResourceOutput,
    sendK8sCurrentOutputToTerminal,
    sendK8sCurrentOutputToAi,
    sendK8sResourceCommand,
    testK8sClusterConnection,
    selectK8sImportContext,
    importK8sKubeconfigContent,
    importK8sKubeconfigFile,
    addK8sCluster,
    updateK8sCluster,
    requestDeleteK8sCluster,
    cancelDeleteK8sCluster,
    confirmDeleteK8sCluster,
    deleteK8sCluster,
    syncK8sBastion,
    toggleK8sBastionCollapsed,
    toggleLeft,
    toggleRight,
    resizeLeftPanel,
    resizeRightPanel,
    quickCloseLeftPanel,
    quickCloseRightPanel,
    createPanel,
    hasSplitState,
    unsplitPanel,
    attachPanelToSplit,
    activateTerminalPanel,
    openTerminalForAiHostContext,
    registerSshSession,
    applySshTerminalSession,
    applyLocalTerminalSession,
    canForkSshPanel,
    forkSshPanel,
    discardPendingTerminalPanel,
    closePanel,
    closeOthers,
    closeAllPanels,
    closePanels,
    renamePanel,
    setPanelAutoTitle,
    appendTerminalOutput,
    applyTerminalLifecycle,
    applyTerminalExit,
    appendTerminalInput,
    replaceTerminalOutput,
    getHighlightedTerminalOutput,
    executeTerminalCommand,
    runTerminalCommand,
    writeTerminalExecution,
    executeGlobalTerminalCommand,
    runGlobalTerminalCommand,
    approveTerminalSecurityPrompt,
    cancelTerminalSecurityPrompt,
    stageActiveTerminalCommand,
    runActiveTerminalCommand,
    continueAgentCommandLoop,
    enableAgentReadOnlyAutoRunForCurrentConversation,
    appendActiveTerminalInput,
    generateTerminalCommand,
    injectGeneratedTerminalCommand,
    sendChat,
    cancelStreamingAiChatResponse,
    resendUserMessageFromParts,
    createConversation,
    deleteConversation,
    selectConversation,
    renameConversation,
    toggleConversationFavorite,
    restoreConversation,
    toggleContext,
    removeContext,
    applyCommandPreset,
    selectCommandPreset,
    approveAiMcpToolCall,
    rejectAiMcpToolCall,
    approveAiMcpResourceAccess,
    rejectAiMcpResourceAccess,
    setMessageFeedback,
    toggleMessageFavorite,
    retryAssistantMessage,
    retryLastAssistantMessage,
    summarizeMessageToKnowledge,
    summarizeMessageToSkill
  }
})
