import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  isAiCommandCatalogData,
  isAiContextCatalogData,
  isAiTodoSnapshotData,
  malformedAiBackendResultMessage
} from '@/services/aiBackendGuards'
import { aiCatalogClient } from '@/services/aiCatalogClient'
import {
  aiBridgeErrorMessage,
  aiChatRequestIdFromAssistantMessageId,
  isAiChatCancelDataForRequest,
  isAiChatConversationDeleteData,
  isAiChatConversationMutationData,
  isAiChatConversationRestoreData,
  isAiChatExchangeRequestDataForRequest,
  isAiChatHistoryMessage,
  isAiChatHistorySnapshotData,
  isAiChatMessageMetadataData,
  isAiChatResponseDataForRequest,
  isAiContextUsageForRequest,
  isAiMcpResourceAccessActionData,
  isAiMcpToolCallActionData,
  type AiChatHistorySnapshotData,
  type AiMcpResourceAccessActionData,
  type AiMcpToolCallActionData
} from '@/services/aiChatBackendGuards'
import { aiChatClient } from '@/services/aiChatClient'
import {
  hasStructuredAiContentParts,
  plainTextFromAiContentParts,
  sendableAiContentParts
} from '@/services/aiPanelInputRuntime'
import { chatHistoryClient } from '@/services/chatHistoryClient'
import {
  isKnowledgeRelPathInParentWithRequestedName,
  isKnowledgeWriteResultData,
  malformedKnowledgeBackendResultMessage
} from '@/services/knowledgeBackendGuards'
import { knowledgeClient } from '@/services/knowledgeClient'
import {
  cloneKnowledgeNodes,
  type KbClipboard,
  type KnowledgeImportJob
} from '@/services/knowledgeRuntime'
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
  createWorkspaceMcpController,
  type WorkspaceMcpOperationRecord,
  type WorkspaceMcpServer
} from '@/services/workspaceMcpController'
import { createWorkspaceQuickCommandsController } from '@/services/workspaceQuickCommandsController'
import {
  isQuickCommandsSnapshotData,
  malformedQuickCommandsBackendResultMessage
} from '@/services/quickCommandsBackendGuards'
import { quickCommandsClient } from '@/services/quickCommandsClient'
import {
  createWorkspaceSettingsController,
  type WorkspaceSettingsRule,
  type WorkspaceSettingsShortcut,
  type WorkspaceSettingsSkill,
  type WorkspaceSkillModalState
} from '@/services/workspaceSettingsController'
import { type ShortcutActionHandler } from '@/services/shortcutRuntime'
import { terminalClient } from '@/services/terminalClient'
import {
  isTerminalCommandGenerationRecord,
  terminalWriteExceptionReason,
  validateTerminalWriteResult
} from '@/services/terminalBackendGuards'
import {
  buildAgentCommandOutputMessagesForRequest,
  buildAgentCommandOutputPrompt,
  createAgentCommandOutputMessages,
  waitForTerminalOutputAfter as waitForTerminalOutputAfterRuntime
} from '@/services/terminalAgentLoopRuntime'
import {
  commandSecurityNotice,
  createGlobalTerminalSecurityExecution,
  createTerminalSecurityExecution,
  prepareTerminalSecurityExecution as prepareTerminalSecurityExecutionRuntime,
  quickCommandPlanUnavailable,
  resolveQuickCommandPanelIds,
  terminalExecutionUnavailable,
  terminalSecurityExecutionShouldWrite,
  terminalSecurityPromptCancellationNotice,
  type TerminalCommandExecutionOptions,
  type TerminalCommandSource,
  type TerminalSecurityDecision,
  type TerminalSecurityExecution,
  type TerminalSecurityPrompt
} from '@/services/terminalExecutionRuntime'
import {
  addTerminalCommandGenerationRecord,
  prepareTerminalCommandGeneration,
  terminalCommandGenerationRecordMatchesRequest,
  terminalCommandModelOptions as terminalCommandModelOptionsRuntime
} from '@/services/terminalCommandRuntime'
import {
  cloneQuickCommandsSnapshot,
  createEmptyMacroRecordingState,
  type MacroRecordingState,
  type QuickCommandSnippet,
  type SnippetGroup
} from '@/services/quickCommandsRuntime'
import { MACRO_DEFAULT_SLEEP_THRESHOLD_MS } from '@/services/terminalMacroRuntime'
import {
  applyTerminalInputExecutionToPanels,
  appendGeneratedTerminalCommandToPanel,
  canWriteTerminalPanels,
  collectTerminalInputExecutionRecords,
  ensureTerminalPanelOutputSegments,
  findTerminalPanelByIdOrSession,
  liveTerminalPanelIds,
  resolveActiveWritableTerminalPanel as resolveActiveWritableTerminalPanelFromCollection,
  resolveTerminalPanelSessionWrite,
  resolveTerminalPanelSessionWrites,
  terminalPanelIds,
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
import { isAiopstermDeepLinkPayload } from '@shared/deepLink'
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
  normalizeMcpServersConfig,
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
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
import { resolveLocale, translateWithLocale } from '@/i18n/runtime'
import type { I18nKey } from '@/i18n/messages'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'
import type {
  AiChatContextUsageSnapshot,
  AiChatConversationRecord,
  AiChatExchangeRequestInput,
  AiChatHistoryMessage,
  AiChatMessageInput,
  AiChatMessageState,
  AiChatResponseInput,
  AiCommandCatalogOption,
  AiCommandChipRef,
  AiContentPart,
  AiContextCatalog,
  AiContextOption,
  AiTodoItem
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
import type { QuickCommandScriptPlan } from '@shared/contracts/quickCommands'
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

type AiChatHistoryHost = NonNullable<AiChatHistoryMessage['hosts']>[number]
type AssetManagementViewRequest = 'assetConfig' | 'assetManagement' | 'keyManagement' | 'proxyManagement'
type AssetManagementOpenAction = 'none' | 'create-key' | 'create-proxy'

type SendChatOptions = {
  mode?: NonNullable<AiChatResponseInput['mode']>
  skipKnowledgeSearch?: boolean
}

type AiContextUsage = AiChatContextUsageSnapshot

export type { TerminalCommandSource, TerminalSecurityDecision, TerminalSecurityExecution, TerminalSecurityPrompt }

type QuickCommandScriptPlanResolution =
  | { ok: true; plan: QuickCommandScriptPlan }
  | { ok: false; reason: string }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  contentParts?: AiContentPart[]
  hosts?: AiContextOption[]
  state?: AiChatMessageState
  favorite?: boolean
  feedback?: 'up' | 'down'
  executedCommand?: string
  commandExecutionStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
  commandExecutionMessage?: string
  ask?: 'command' | 'mcp_tool_call' | 'mcp_resource_access' | 'followup'
  say?: 'command' | 'command_output' | 'search_result' | 'context_truncated'
  action?: 'approved' | 'rejected'
  commandExecution?: {
    ip: string
    command: string
    requiresApproval: boolean
    interactive: boolean
  }
  mcpToolCall?: {
    serverName: string
    toolName: string
    arguments?: Record<string, unknown>
  }
  mcpResourceAccess?: {
    serverName: string
    uri: string
  }
  followupOptions?: string[]
  selectedOption?: string
  partial?: boolean
}

export type TodoItem = AiTodoItem

export type ConversationItem = {
  id: string
  title: string
  summary: string
  updatedAt: string
  ts: number
  ipAddress?: string
  favorite?: boolean
}

type RendererLocalIdPrefix = 'panel' | 'terminal-security' | 'aichat-agent-loop'
const createRendererLocalId = (prefix: RendererLocalIdPrefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`
const autoNamedConversationTitles = new Set([
  '新会话',
  '新建会话',
  '未命名会话',
  '新建對話',
  '未命名對話',
  'New chat',
  'Untitled chat',
  'New Chat',
  'Untitled Chat',
  '新しいチャット',
  '無題のチャット',
  '새 채팅',
  '제목 없는 채팅',
  'Neuer Chat',
  'Unbenannter Chat',
  'Nouveau chat',
  'Chat sans titre',
  'Nuova chat',
  'Chat senza titolo',
  'Nova conversa',
  'Conversa sem título',
  'Новый чат',
  'Чат без названия',
  'محادثة جديدة',
  'محادثة بلا عنوان'
])
const isAutoNamedConversationTitle = (title: string) => autoNamedConversationTitles.has(title.trim())
const conversationTitleFromPrompt = (prompt: string) => {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 28 ? `${normalized.slice(0, 28)}...` : normalized
}
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback

const integerInRange = (value: unknown, fallback: number, min: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback

const cloneStructuredValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

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

  const shortcutHandlers: Record<string, ShortcutActionHandler> = {
    newTerminal: () => triggerShortcutAction('newTerminal'),
    toggleAi: () => triggerShortcutAction('toggleAi'),
    switchToSpecificTab: (payload) => triggerShortcutAction('switchToSpecificTab', payload?.digit),
    quickCommand: () => triggerShortcutAction('quickCommand')
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
  const assetManagementOpenRequest = ref<{
    sequence: number
    organizationId?: string
    view?: AssetManagementViewRequest
    action?: AssetManagementOpenAction
  }>({ sequence: 0, action: 'none' })
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
  const sortedConversations = computed(() => [...conversations.value].sort((a, b) => b.ts - a.ts))
  const todoProgress = computed(() => {
    const total = todoItems.value.length
    const completed = todoItems.value.filter((todo) => todo.status === 'completed').length
    const inProgress = todoItems.value.filter((todo) => todo.status === 'in_progress').length
    return {
      total,
      completed,
      inProgress,
      pending: total - completed - inProgress,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100)
    }
  })

  const clearAiContextUsage = () => {
    aiContextUsage.value = null
  }

  const applyAiContextUsage = (usage: AiContextUsage) => {
    aiContextUsage.value = cloneStructuredValue(usage)
  }

  const cloneConversationRecord = (conversation: AiChatConversationRecord): ConversationItem => ({
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    updatedAt: conversation.updatedAt,
    ts: conversation.ts,
    ipAddress: conversation.ipAddress,
    favorite: conversation.favorite
  })

  const applyChatHistorySnapshot = (snapshot: { conversations: AiChatConversationRecord[]; selectedConversationId: string }) => {
    conversations.value = snapshot.conversations.map(cloneConversationRecord)
    selectedConversationId.value = conversations.value.some((conversation) => conversation.id === snapshot.selectedConversationId)
      ? snapshot.selectedConversationId
      : conversations.value[0]?.id || ''
  }

  const historyHostToContext = (host: AiChatHistoryHost): AiContextOption => ({
    id: host.id,
    kind: 'hosts',
    label: host.label,
    detail: host.detail
  })

  const chatHistoryMessageToChatMessage = (message: AiChatHistoryMessage): ChatMessage => ({
    id: message.id,
    role: message.role,
    text: message.text,
    contentParts: message.contentParts ? cloneStructuredValue(message.contentParts) : undefined,
    hosts: message.hosts?.map(historyHostToContext),
    state: message.state,
    favorite: message.favorite,
    feedback: message.feedback,
    executedCommand: message.executedCommand,
    commandExecutionStatus: message.commandExecutionStatus,
    commandExecutionMessage: message.commandExecutionMessage,
    ask: message.ask,
    say: message.say,
    action: message.action,
    commandExecution: message.commandExecution ? cloneStructuredValue(message.commandExecution) : undefined,
    mcpToolCall: message.mcpToolCall ? cloneStructuredValue(message.mcpToolCall) : undefined,
    mcpResourceAccess: message.mcpResourceAccess ? cloneStructuredValue(message.mcpResourceAccess) : undefined,
    followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
    selectedOption: message.selectedOption,
    partial: message.partial
  })

  const chatMessageToHistoryMessage = (message: ChatMessage): AiChatHistoryMessage | null => {
    const text = message.text.trim()
    if (!text) return null
    const hosts = message.hosts
      ?.filter((host) => host.kind === 'hosts' && host.label.trim())
      .map((host): AiChatHistoryHost => ({
        id: host.id,
        kind: 'hosts',
        label: host.label,
        detail: host.detail
      }))
    return {
      id: message.id,
      role: message.role,
      text,
      hosts: hosts?.length ? hosts : undefined,
      state: message.state,
      favorite: message.favorite,
      feedback: message.feedback,
      contentParts: message.contentParts ? cloneStructuredValue(message.contentParts) : undefined,
      executedCommand: message.executedCommand,
      commandExecutionStatus: message.commandExecutionStatus,
      commandExecutionMessage: message.commandExecutionMessage,
      ask: message.ask,
      say: message.say,
      action: message.action,
      commandExecution: message.commandExecution ? cloneStructuredValue(message.commandExecution) : undefined,
      mcpToolCall: message.mcpToolCall ? cloneStructuredValue(message.mcpToolCall) : undefined,
      mcpResourceAccess: message.mcpResourceAccess ? cloneStructuredValue(message.mcpResourceAccess) : undefined,
      followupOptions: message.followupOptions ? [...message.followupOptions] : undefined,
      selectedOption: message.selectedOption,
      partial: message.partial
    }
  }

  const currentChatHistoryMessages = () => chatMessages.value.map(chatMessageToHistoryMessage).filter(Boolean) as AiChatHistoryMessage[]

  const restoreChatMessagesFromBackend = async (id: string) => {
    const restoreChatConversation = chatHistoryClient.restoreChatConversation()
    if (!restoreChatConversation) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await restoreChatConversation(id)
    } catch {
      setTopNotice('会话历史加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || '会话历史加载失败')
      return false
    }
    if (!isAiChatConversationRestoreData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    const data = result.data
    const existing = conversations.value.find((conversation) => conversation.id === data.conversation.id)
    const nextConversation = cloneConversationRecord(data.conversation)
    conversations.value = existing
      ? conversations.value.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    chatMessages.value = data.messages.map(chatHistoryMessageToChatMessage)
    if (data.truncated) {
      setTopNotice(i18nText('ai.historyRestoreTruncated', { count: data.returnedMessages ?? data.messages.length }))
    }
    clearAiContextUsage()
    return true
  }

  const loadChatConversationsFromBackend = async (options: { restoreIfEmpty?: boolean } = {}) => {
    const listChatConversations = chatHistoryClient.listChatConversations()
    if (!listChatConversations) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await listChatConversations()
    } catch {
      setTopNotice('会话历史加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || '会话历史加载失败')
      return false
    }
    if (!isAiChatHistorySnapshotData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    applyChatHistorySnapshot(result.data)
    if (options.restoreIfEmpty !== false && chatMessages.value.length === 0 && selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    }
    return true
  }

  const refreshAiContextCatalog = async (options: { hydrateSelection?: boolean } = { hydrateSelection: false }) => {
    const listAiContextCatalog = aiCatalogClient.listAiContextCatalog()
    if (!listAiContextCatalog) {
      setTopNotice('AI 上下文加载服务不可用')
      return false
    }
    let result
    try {
      result = await listAiContextCatalog()
    } catch {
      setTopNotice('AI 上下文加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || 'AI 上下文加载失败')
      return false
    }
    if (!isAiContextCatalogData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    aiContextCatalog.value = {
      categories: result.data.categories.map((category) => ({
        ...category,
        options: category.options.map((option) => ({ ...option }))
      })),
      openedHosts: result.data.openedHosts.map((host) => ({ ...host })),
      selectedDefaults: result.data.selectedDefaults.map((context) => ({ ...context }))
    }
    if (options.hydrateSelection === true && selectedContexts.value.length === 0) {
      selectedContexts.value = aiContextCatalog.value.selectedDefaults.map((context) => ({ ...context }))
    }
    return true
  }

  const refreshAiCommandCatalog = async () => {
    const listAiCommandCatalog = aiCatalogClient.listAiCommandCatalog()
    if (!listAiCommandCatalog) {
      setTopNotice('AI 命令加载服务不可用')
      return false
    }
    let result
    try {
      result = await listAiCommandCatalog()
    } catch {
      setTopNotice('AI 命令加载失败')
      return false
    }
    if (!result?.ok) {
      setTopNotice(result?.errorMessage || 'AI 命令加载失败')
      return false
    }
    if (!isAiCommandCatalogData(result.data)) {
      setTopNotice(malformedAiBackendResultMessage)
      return false
    }
    aiCommandOptions.value = result.data.commands.map((command) => ({ ...command }))
    return true
  }

  const aiSkillContextOptions = computed<AiContextOption[]>(
    () => aiContextCatalog.value.categories.find((category) => category.id === 'skills')?.options.map((option) => ({ ...option })) || []
  )

  const refreshAiTodoSnapshot = async () => {
    const listAiTodoSnapshot = aiCatalogClient.listAiTodoSnapshot()
    if (!listAiTodoSnapshot) return false
    let result
    try {
      result = await listAiTodoSnapshot()
    } catch {
      return false
    }
    if (!result?.ok) return false
    if (!isAiTodoSnapshotData(result.data)) return false
    todoItems.value = result.data.todos.map((todo) => ({
      ...todo,
      subtasks: todo.subtasks?.map((subtask) => ({ ...subtask }))
    }))
    return true
  }

  let classicChatHydrationPromise: Promise<boolean> | null = null
  const hydrateClassicChatData = async (options: { restoreIfEmpty?: boolean } = {}) => {
    if (classicChatHydrationPromise) return classicChatHydrationPromise
    classicChatHydrationPromise = Promise.all([
      loadChatConversationsFromBackend({ restoreIfEmpty: options.restoreIfEmpty !== false }),
      refreshAiTodoSnapshot(),
      refreshAiContextCatalog({ hydrateSelection: false }),
      refreshAiCommandCatalog()
    ])
      .then((results) => results.every(Boolean))
      .finally(() => {
        classicChatHydrationPromise = null
      })
    return classicChatHydrationPromise
  }

  const updateCurrentConversationSnapshot = async (summary?: string, options: { notifyUnavailable?: boolean; notifyFailure?: boolean } = {}) => {
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
      return false
    }
    let id = selectedConversationId.value
    if (!id || !conversations.value.some((conversation) => conversation.id === id)) {
      const createChatConversation = chatHistoryClient.createChatConversation()
      if (!createChatConversation) {
        if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
        return false
      }
      const created = await createChatConversation()
      if (!created?.ok || !isAiChatConversationMutationData(created.data)) {
        if (options.notifyFailure) setTopNotice(created?.errorMessage || '会话历史写入失败')
        return false
      }
      applyChatHistorySnapshot({
        conversations: created.data.conversations,
        selectedConversationId: created.data.selectedConversationId
      })
      id = created.data.conversation.id
    }
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const nextTitle = summary && isAutoNamedConversationTitle(conversation.title) ? conversationTitleFromPrompt(summary) || conversation.title : conversation.title
    const result = await updateChatConversation({
      id,
      title: nextTitle,
      summary: summary || conversation.summary,
      favorite: conversation.favorite,
      messages: currentChatHistoryMessages()
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) {
      if (options.notifyFailure) setTopNotice(result?.errorMessage || '会话历史写入失败')
      return false
    }
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const syncCurrentConversationSnapshot = (options: { notifyUnavailable?: boolean; notifyFailure?: boolean } = {}) =>
    updateCurrentConversationSnapshot(undefined, options)

  const terminalCommandModelOptions = computed(() => terminalCommandModelOptionsRuntime(settingModelOptions.value))
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

  const switchToTerminalPanelIndex = (digit: number) => {
    const index = Math.max(1, Math.min(9, Math.floor(digit))) - 1
    const terminalPanels = panels.value.filter((panel) => panel.kind !== 'knowledge')
    const target = terminalPanels[index]
    if (!target) return false
    mode.value = 'terminal'
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    return true
  }

  const triggerShortcutAction = (actionId: string, digit?: number) => {
    if (actionId === 'newTerminal') {
      mode.value = 'terminal'
      activeModule.value = 'workspace'
      createPanel()
      setTopNotice('已通过快捷键新建终端')
      return true
    }
    if (actionId === 'toggleAi') {
      mode.value = 'terminal'
      if (activeModule.value === 'database' || activeModule.value === 'user') activeModule.value = 'workspace'
      void toggleRight()
      return true
    }
    if (actionId === 'switchToSpecificTab' && digit) {
      return switchToTerminalPanelIndex(digit)
    }
    if (actionId === 'quickCommand') {
      mode.value = 'terminal'
      activeModule.value = 'snippets'
      leftPanelOpen.value = true
      setTopNotice('已打开快捷命令')
      return true
    }
    return false
  }

  const setActiveModule = (key: ModuleKey) => {
    activeModule.value = key
    if (key !== 'settings') onboardingGuideOpen.value = false
    if (key === 'database') {
      rightPanelOpen.value = false
    }
  }

  const openAssetManagement = (
    organizationId?: string,
    view: AssetManagementViewRequest = organizationId ? 'assetManagement' : 'assetConfig',
    action: AssetManagementOpenAction = 'none'
  ) => {
    mode.value = 'terminal'
    activeModule.value = 'assets'
    leftPanelOpen.value = true
    rightPanelOpen.value = config.value.rightPanelOpen
    onboardingGuideOpen.value = false
    assetManagementOpenRequest.value = {
      sequence: assetManagementOpenRequest.value.sequence + 1,
      view,
      action,
      ...(organizationId ? { organizationId } : {})
    }
    setTopNotice(organizationId ? '已打开组织资产管理' : '已打开资产管理')
  }

  const handleDeepLink = (payload: unknown) => {
    if (!isAiopstermDeepLinkPayload(payload)) {
      setTopNotice('aiopsterm deep link 后端返回数据异常')
      return false
    }

    if (payload.target === 'agents') {
      mode.value = 'agents'
      agentsLeftOpen.value = true
      setTopNotice('已通过 aiopsterm:// 打开 Agents')
      return true
    }

    const targetModule = payload.module || payload.target
    mode.value = 'terminal'
    activeModule.value = targetModule
    if (targetModule === 'settings') {
      rightPanelOpen.value = false
      setActiveSettingsSection(payload.settingsSection || 'general')
    } else if (targetModule === 'database' || targetModule === 'user') {
      rightPanelOpen.value = false
      onboardingGuideOpen.value = false
    } else {
      leftPanelOpen.value = true
      rightPanelOpen.value = config.value.rightPanelOpen
      onboardingGuideOpen.value = false
    }
    setTopNotice(`已通过 aiopsterm:// 打开${targetModule === 'workspace' ? '工作区' : targetModule}`)
    return true
  }

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

  const applyTerminalExecution = (execution: TerminalSecurityExecution) => {
    applyTerminalInputExecutionToPanels(panels.value, execution).forEach(({ panel, text }) => recordMacroTerminalInput(panel.id, text))
  }

  const recordTerminalExecutionInput = (execution: TerminalSecurityExecution) => {
    collectTerminalInputExecutionRecords(panels.value, execution).forEach(({ panel, text }) => recordMacroTerminalInput(panel.id, text))
  }

  const reportTerminalExecutionUnavailable = (command: string, panelIds: string[] = [], reason = '终端会话不可用，请先打开本地 shell 或连接 SSH') => {
    setTopNotice(reason)
    terminalSecurityPrompt.value = null
    return terminalExecutionUnavailable(command, panelIds, reason)
  }

  const writeTerminalSegment = async (sessionId: string, data: string) => {
    const writeTerminal = terminalClient.writeTerminal()
    if (!writeTerminal) return { ok: false, reason: '终端写入服务不可用' }
    try {
      const result = await writeTerminal(sessionId, data)
      return validateTerminalWriteResult(result, sessionId, data)
    } catch (error) {
      return { ok: false, reason: terminalWriteExceptionReason(error) }
    }
  }

  const waitForSnippetDelay = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, delayMs)))

  const canWriteTerminalExecution = (execution: Pick<TerminalSecurityExecution, 'panelIds' | 'writeToShell'>) => {
    if (!execution.writeToShell) return true
    if (!terminalClient.writeTerminal()) return false
    return canWriteTerminalPanels(panels.value, execution)
  }

  const prepareTerminalSecurityExecution = (execution: TerminalSecurityExecution): TerminalSecurityDecision => {
    const decision = prepareTerminalSecurityExecutionRuntime(execution, {
      securitySettings: securitySettings.value,
      promptId: createRendererLocalId('terminal-security')
    })
    if (decision.status === 'needs-approval') {
      terminalSecurityPrompt.value = decision.prompt
      return decision
    }
    if (decision.status === 'blocked') {
      setTopNotice(commandSecurityNotice(decision.result, decision.command))
      terminalSecurityPrompt.value = null
      return decision
    }
    terminalSecurityPrompt.value = null
    if (!execution.writeToShell) applyTerminalExecution(execution)
    return decision
  }

  const writeTerminalExecution = async (execution: TerminalSecurityExecution): Promise<TerminalSecurityDecision> => {
    if (!execution.writeToShell) {
      applyTerminalExecution(execution)
      return { status: 'allow', execution }
    }
    if (!canWriteTerminalExecution(execution)) {
      return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
    }
    if (execution.source === 'snippet' && execution.snippetSegments?.length) {
      for (const segment of execution.snippetSegments) {
        if (segment.delayBeforeMs > 0) await waitForSnippetDelay(segment.delayBeforeMs)
        for (const panelId of execution.panelIds) {
          const write = resolveTerminalPanelSessionWrite(panels.value, panelId)
          if (!write) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
          const writeResult = await writeTerminalSegment(write.sessionId, segment.text)
          if (!writeResult.ok) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds, writeResult.reason)
        }
      }
      return { status: 'allow', execution }
    }
    for (const panelId of execution.panelIds) {
      const write = resolveTerminalPanelSessionWrite(panels.value, panelId)
      if (!write) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
      const writeData = execution.shellText || execution.inputText
      const writeResult = await writeTerminalSegment(write.sessionId, writeData)
      if (!writeResult.ok) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds, writeResult.reason)
    }
    recordTerminalExecutionInput(execution)
    return { status: 'allow', execution }
  }

  const executeTerminalCommand = (panelId: string, command: string, options: TerminalCommandExecutionOptions = {}) => {
    const decision = createTerminalSecurityExecution(panelId, command, options)
    if (decision.status !== 'allow' || !decision.execution) return decision
    return prepareTerminalSecurityExecution(decision.execution)
  }

  const runTerminalCommand = async (
    panelId: string,
    command: string,
    options: TerminalCommandExecutionOptions = {}
  ) => {
    const decision = executeTerminalCommand(panelId, command, options)
    if (!terminalSecurityExecutionShouldWrite(decision)) return decision
    return writeTerminalExecution(decision.execution)
  }

  const executeGlobalTerminalCommand = (command: string) => {
    const decision = createGlobalTerminalSecurityExecution(command, liveTerminalPanelIds(panels.value), terminalPanelIds(panels.value), Boolean(terminalClient.writeTerminal()))
    if (decision.status === 'unavailable') {
      setTopNotice(decision.reason)
      terminalSecurityPrompt.value = null
      return decision
    }
    if (decision.status !== 'allow' || !decision.execution) return decision
    return prepareTerminalSecurityExecution(decision.execution)
  }

  const runGlobalTerminalCommand = async (command: string) => {
    const decision = executeGlobalTerminalCommand(command)
    if (!terminalSecurityExecutionShouldWrite(decision)) return decision
    return writeTerminalExecution(decision.execution)
  }

  const approveTerminalSecurityPrompt = () => {
    const prompt = terminalSecurityPrompt.value
    if (!prompt) return null
    if (!canWriteTerminalExecution(prompt.execution)) {
      reportTerminalExecutionUnavailable(prompt.command, prompt.panelIds)
      return null
    }
    terminalSecurityPrompt.value = null
    if (!prompt.execution.writeToShell) applyTerminalExecution(prompt.execution)
    return prompt.execution
  }

  const cancelTerminalSecurityPrompt = () => {
    const prompt = terminalSecurityPrompt.value
    if (!prompt) return null
    setTopNotice(terminalSecurityPromptCancellationNotice(prompt.command))
    terminalSecurityPrompt.value = null
    return prompt.execution
  }

  const resolveActiveWritableTerminalPanel = () =>
    resolveActiveWritableTerminalPanelFromCollection(panels.value, activePanel.value)

  const waitForTerminalOutputAfter = (panelId: string, startLength: number, timeoutMs = 2_500) =>
    waitForTerminalOutputAfterRuntime(() => panels.value.find((item) => item.id === panelId || item.sessionId === panelId), startLength, timeoutMs)

  const stageActiveTerminalCommand = (command: string) => {
    const panel = resolveActiveWritableTerminalPanel()
    const text = command.trim()
    if (!panel || !text) return null
    return executeTerminalCommand(panel.id, text, { source: 'agent', writeToShell: true })
  }

  const runActiveTerminalCommand = async (command: string, source: TerminalCommandSource = 'agent') => {
    const panel = resolveActiveWritableTerminalPanel()
    const text = command.trim()
    if (!panel || !text) return null
    return runTerminalCommand(panel.id, text, { source, writeToShell: true })
  }

  const continueAgentCommandLoop = async (input: {
    commandMessageId: string
    command: string
    commandExecution?: ChatMessage['commandExecution']
    terminalPanelId: string
    outputStartLength: number
    outputTimeoutMs?: number
    output?: string
  }) => {
    const command = input.command.trim()
    const commandMessage = chatMessages.value.find((message) => message.id === input.commandMessageId)
    if (!command || !commandMessage) return { status: 'unavailable' as const, reason: '命令卡片不可用，无法继续 Agent 循环。' }
    const outputTimeoutMs = input.outputTimeoutMs ?? Math.max(1000, Math.round(aiPreferences.value.shellIntegrationTimeout * 1000))
    const output = (input.output ?? (await waitForTerminalOutputAfter(input.terminalPanelId, input.outputStartLength, outputTimeoutMs))).trimEnd()
    if (!output.trim()) {
      commandMessage.commandExecutionStatus = 'failed'
      commandMessage.commandExecutionMessage = '命令已发送，但未捕获到终端输出，未继续 Agent 循环。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return { status: 'no-output' as const, reason: commandMessage.commandExecutionMessage }
    }
    const requestId = createRendererLocalId('aichat-agent-loop')
    const { commandOutputMessage, assistantMessage } = createAgentCommandOutputMessages({
      requestId,
      command,
      output,
      commandExecution: input.commandExecution
    })
    chatMessages.value.push(commandOutputMessage, assistantMessage)
    const filterOptions = { enabled: aiPreferences.value.commandOutputFilteringEnabled }
    const prompt = buildAgentCommandOutputPrompt(command, output, filterOptions)
    const messages: AiChatMessageInput[] = buildAgentCommandOutputMessagesForRequest(chatMessages.value.slice(-16), commandOutputMessage.id, filterOptions)
    void refreshAiTodoSnapshot()
    void generateAiResponseForMessage(assistantMessage.id, {
      requestId,
      assistantMessageId: assistantMessage.id,
      prompt,
      messages,
      model: config.value.modelName,
      mode: 'agent'
    })
    await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
    return { status: 'continued' as const, output, assistantMessageId: assistantMessage.id, requestId }
  }

  const appendActiveTerminalInput = (command: string) => {
    const panel = resolveActiveWritableTerminalPanel()
    if (!panel) return null
    return executeTerminalCommand(panel.id, command, { writeToShell: false, source: 'agent' })
  }

  const generateTerminalCommand = async (panelId: string, instruction: string, modelName?: string) => {
    const plan = prepareTerminalCommandGeneration(panels.value, {
      panelId,
      instruction,
      modelName,
      modelOptions: terminalCommandModelOptions.value
    })
    if (!plan.ok) {
      if (plan.reason === 'missing-model') {
        setTopNotice('请先配置可用模型')
      }
      return null
    }
    const { request } = plan
    if (!request.modelName) {
      setTopNotice('请先配置可用模型')
      return null
    }
    const generateTerminalCommandBridge = terminalClient.generateTerminalCommand()
    if (!generateTerminalCommandBridge) {
      setTopNotice('终端命令生成服务不可用')
      return null
    }

    let result: Awaited<ReturnType<AiopsPreloadApi['generateTerminalCommand']>>
    try {
      result = await generateTerminalCommandBridge(request)
    } catch (error) {
      setTopNotice(aiBridgeErrorMessage(error, '终端命令生成失败'))
      return null
    }
    if (!result.ok) {
      setTopNotice(result.errorMessage || '终端命令生成失败')
      return null
    }
    if (!isTerminalCommandGenerationRecord(result.data) || !terminalCommandGenerationRecordMatchesRequest(result.data, request)) {
      setTopNotice('终端命令生成结果无效')
      return null
    }
    const record = result.data
    terminalCommandGenerationRecords.value = addTerminalCommandGenerationRecord(terminalCommandGenerationRecords.value, record)
    return record
  }

  const injectGeneratedTerminalCommand = (panelId: string, command: string) => {
    const applied = appendGeneratedTerminalCommandToPanel(panels.value, panelId, command)
    if (!applied) return null
    recordMacroTerminalInput(applied.panel.id, applied.text)
    return { status: 'allow' } as TerminalSecurityDecision
  }

  const buildPlainTextFromAiParts = (parts: AiContentPart[]) => plainTextFromAiContentParts(parts, { mode: 'exchange' })

  const agentAutoRunCommandMessageIds = new Set<string>()
  const agentReadOnlyAutoRunConversationIds = new Set<string>()
  let agentReadOnlyAutoRunPendingWithoutConversation = false

  const isAgentReadOnlyCommandMessage = (message: ChatMessage) =>
    message.role === 'assistant' &&
    message.ask === 'command' &&
    message.state === 'done' &&
    message.action !== 'rejected' &&
    !message.commandExecutionStatus &&
    Boolean(message.commandExecution?.command.trim()) &&
    message.commandExecution?.requiresApproval === false &&
    message.commandExecution.interactive !== true

  const autoRunAgentReadOnlyCommand = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message || !isAgentReadOnlyCommandMessage(message)) return
    if (agentAutoRunCommandMessageIds.has(message.id)) return
    agentAutoRunCommandMessageIds.add(message.id)
    const command = message.commandExecution!.command.trim()
    const terminalPanel = resolveActiveWritableTerminalPanel()
    const outputStartLength = terminalPanel?.output.length ?? 0
    const terminalPanelId = terminalPanel?.id || ''
    message.commandExecutionStatus = 'running'
    message.commandExecutionMessage = '查询类命令自动执行中...'
    void updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
    const decision = await runActiveTerminalCommand(command, 'agent')
    if (!decision) {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = '终端会话不可用，请先打开本地 shell 或连接 SSH。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (decision.status === 'needs-approval') {
      message.commandExecutionStatus = 'pending'
      message.commandExecutionMessage = '命令已送入终端安全确认。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (decision.status === 'blocked') {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = '命令被安全策略拦截。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (decision.status === 'unavailable') {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = decision.reason
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    if (!terminalPanelId) {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = '终端会话不可用，请先打开本地 shell 或连接 SSH。'
      await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
      return
    }
    message.executedCommand = command
    message.commandExecutionStatus = 'running'
    message.commandExecutionMessage = '查询类命令已发送，正在等待终端输出...'
    await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
    const loopResult = await continueAgentCommandLoop({
      commandMessageId: message.id,
      command,
      commandExecution: {
        ...message.commandExecution!,
        command
      },
      terminalPanelId,
      outputStartLength
    })
    if (loopResult.status === 'continued') {
      message.commandExecutionStatus = 'succeeded'
      message.commandExecutionMessage = `命令输出已回传 Agent：${command}`
      message.executedCommand = command
    } else {
      message.commandExecutionStatus = 'failed'
      message.commandExecutionMessage = loopResult.reason
    }
    await updateCurrentConversationSnapshot(undefined, { notifyFailure: true, notifyUnavailable: true })
  }

  const scheduleAgentReadOnlyAutoRun = (message: ChatMessage, input: AiChatResponseInput) => {
    const conversationId = selectedConversationId.value.trim()
    if (conversationId && agentReadOnlyAutoRunPendingWithoutConversation) {
      agentReadOnlyAutoRunConversationIds.add(conversationId)
      agentReadOnlyAutoRunPendingWithoutConversation = false
    }
    const sessionAutoRunEnabled = conversationId ? agentReadOnlyAutoRunConversationIds.has(conversationId) : agentReadOnlyAutoRunPendingWithoutConversation
    if (input.mode !== 'agent' || (!aiPreferences.value.autoExecuteReadOnlyCommands && !sessionAutoRunEnabled) || !isAgentReadOnlyCommandMessage(message)) return
    void autoRunAgentReadOnlyCommand(message.id)
  }

  const enableAgentReadOnlyAutoRunForCurrentConversation = () => {
    const conversationId = selectedConversationId.value.trim()
    if (!conversationId) {
      agentReadOnlyAutoRunPendingWithoutConversation = true
      return true
    }
    agentReadOnlyAutoRunConversationIds.add(conversationId)
    agentReadOnlyAutoRunPendingWithoutConversation = false
    return true
  }

  const generateAiResponseForMessage = async (assistantId: string, input: AiChatResponseInput) => {
    const responseBridge = aiChatClient.generateAiChatResponse()
    const failGeneration = (messageText: string) => {
      const message = chatMessages.value.find((item) => item.id === assistantId)
      if (message && message.state === 'streaming') {
        message.state = 'error'
        message.text = messageText
        void updateCurrentConversationSnapshot()
      }
      void refreshAiTodoSnapshot()
    }
    if (typeof responseBridge !== 'function') {
      failGeneration('AI 响应生成服务不可用')
      return
    }
    let result: Awaited<ReturnType<AiopsPreloadApi['generateAiChatResponse']>> | undefined
    try {
      result = await responseBridge(input)
    } catch (error) {
      failGeneration(aiBridgeErrorMessage(error, 'AI 响应生成失败'))
      return
    }
    const message = chatMessages.value.find((item) => item.id === assistantId)
    if (!message || message.state !== 'streaming') {
      void refreshAiTodoSnapshot()
      return
    }
    const requestId = input.requestId?.trim() || aiChatRequestIdFromAssistantMessageId(assistantId)
    const assistantMessageId = input.assistantMessageId?.trim() || assistantId
    const data = result?.data
    if (!result?.ok) {
      message.state = 'error'
      message.text = result?.errorMessage || 'AI 响应生成失败'
    } else if (!requestId || !isAiChatResponseDataForRequest(data, requestId, assistantMessageId)) {
      message.state = 'error'
      message.text = 'AI 响应生成结果无效'
    } else if (data.status === 'cancelled') {
      message.state = 'cancelled'
      message.text = data.text
    } else if (data.message) {
      Object.assign(message, chatHistoryMessageToChatMessage(data.message))
    } else {
      message.state = 'done'
      message.text = data.text
    }
    if (requestId && isAiContextUsageForRequest(data?.contextUsage, requestId, assistantMessageId)) {
      applyAiContextUsage(data.contextUsage)
    }
    scheduleAgentReadOnlyAutoRun(message, input)
    void refreshAiTodoSnapshot()
    void updateCurrentConversationSnapshot()
  }

  const cancelStreamingAiChatResponse = async () => {
    const message = [...chatMessages.value].reverse().find((item) => item.role === 'assistant' && item.state === 'streaming')
    if (!message) return false
    const cancelBridge = aiChatClient.cancelAiChatResponse()
    if (typeof cancelBridge !== 'function') {
      setTopNotice('AI 生成取消服务不可用')
      return false
    }
    const requestId = aiChatRequestIdFromAssistantMessageId(message.id)
    if (!requestId) {
      setTopNotice('AI 生成取消失败')
      return false
    }
    const result = await cancelBridge({
      assistantMessageId: message.id,
      requestId
    }).catch((error) => {
      setTopNotice(aiBridgeErrorMessage(error, 'AI 生成取消失败'))
      return null
    })
    if (!result) return false
    if (!result?.ok || !isAiChatCancelDataForRequest(result.data, requestId, message.id)) {
      setTopNotice(result?.errorMessage || 'AI 生成取消失败')
      return false
    }
    if (message.state !== 'streaming') return true
    message.state = 'cancelled'
    message.text = result.data.text
    if (isAiContextUsageForRequest(result.data.contextUsage, requestId, message.id)) {
      applyAiContextUsage(result.data.contextUsage)
    }
    void refreshAiTodoSnapshot()
    void updateCurrentConversationSnapshot()
    return true
  }

  const hostContextForExchangeRequest = (context: AiContextOption): NonNullable<AiChatExchangeRequestInput['hosts']>[number] | null => {
    if (context.kind !== 'hosts' || !context.label.trim()) return null
    return {
      id: context.id,
      kind: 'hosts',
      label: context.label,
      detail: context.detail
    }
  }

  const appendChatExchange = async (
    text: string,
    contentParts?: AiContentPart[],
    overrideHosts?: AiContextOption[],
    options: SendChatOptions = {}
  ) => {
    const safeContentParts = sendableAiContentParts(contentParts)
    const hasStructuredParts = hasStructuredAiContentParts(safeContentParts)
    const prompt = text.trim() || buildPlainTextFromAiParts(safeContentParts).trim()
    if (!prompt && !hasStructuredParts) return false
    const baseMessageContexts = overrideHosts ? [...overrideHosts, ...selectedContexts.value.filter((item) => item.kind !== 'hosts')] : [...selectedContexts.value]
    const autoKnowledgeContexts = options.skipKnowledgeSearch ? [] : await resolveAiKnowledgeSearchContexts(prompt, baseMessageContexts)
    const messageContexts = [...baseMessageContexts, ...autoKnowledgeContexts]
    const commandDisplay = selectedCommandRef.value?.label || selectedCommandRef.value?.command || selectedCommandId.value
    const historyForBackend: AiChatMessageInput[] = chatMessages.value.slice(-12).map((message) => ({ role: message.role, text: message.text }))
    const hostContexts = overrideHosts ?? selectedContexts.value.filter((item) => item.kind === 'hosts')
    const responseMode = options.mode || (mode.value === 'agents' ? 'agent' : 'command')
    const exchangeBridge = aiChatClient.createAiChatExchangeRequest()
    if (typeof exchangeBridge !== 'function') {
      setTopNotice('AI 请求创建服务不可用')
      return false
    }
    let request: Awaited<ReturnType<AiopsPreloadApi['createAiChatExchangeRequest']>> | undefined
    try {
      request = await exchangeBridge({
        text: prompt,
        hosts: hostContexts.map(hostContextForExchangeRequest).filter(Boolean) as AiChatExchangeRequestInput['hosts'],
        messages: historyForBackend,
        contexts: messageContexts.map((item) => ({
          id: item.id,
          kind: item.kind,
          label: item.label,
          detail: item.detail,
          relPath: item.relPath,
          mediaType: item.mediaType
        })),
        command: selectedCommandRef.value
          ? {
              id: selectedCommandId.value || undefined,
              label: selectedCommandRef.value.label,
              command: selectedCommandRef.value.command,
              path: selectedCommandRef.value.path
            }
          : commandDisplay
            ? { id: selectedCommandId.value || undefined, label: commandDisplay }
            : null,
        model: config.value.modelName,
        mode: responseMode
      })
    } catch (error) {
      setTopNotice(aiBridgeErrorMessage(error, 'AI 请求创建失败'))
      return false
    }
    if (!request?.ok || !isAiChatExchangeRequestDataForRequest(request.data)) {
      setTopNotice(request?.errorMessage || 'AI 请求创建失败')
      return false
    }
    if (isAiContextUsageForRequest(request.data.contextUsage, request.data.requestId, request.data.assistantMessage.id)) {
      applyAiContextUsage(request.data.contextUsage)
    }
    const userMessage = chatHistoryMessageToChatMessage(request.data.userMessage)
    userMessage.contentParts = safeContentParts.length || hasStructuredParts ? safeContentParts : undefined
    userMessage.hosts = hostContexts
    const assistantMessage = chatHistoryMessageToChatMessage(request.data.assistantMessage)
    chatMessages.value.push(userMessage)
    chatMessages.value.push(assistantMessage)
    void refreshAiTodoSnapshot()
    void generateAiResponseForMessage(assistantMessage.id, {
      ...request.data.responseInput,
      requestId: request.data.responseInput.requestId || request.data.requestId,
      assistantMessageId: request.data.responseInput.assistantMessageId || assistantMessage.id
    })
    await updateCurrentConversationSnapshot(prompt, { notifyFailure: true, notifyUnavailable: true })
    return true
  }

  const sendChat = (text: string, contentParts?: AiContentPart[], overrideHosts?: AiContextOption[], options?: SendChatOptions) => {
    return appendChatExchange(text, contentParts, overrideHosts, options)
  }

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
    { sendChat }
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

  const resendUserMessageFromParts = async (messageId: string, contentParts: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    const index = chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'user')
    if (index === -1) return false
    const originalHosts = chatMessages.value[index].hosts
    const prompt = buildPlainTextFromAiParts(contentParts).trim()
    const hasStructuredParts = hasStructuredAiContentParts(contentParts)
    if (!prompt && !hasStructuredParts) return false
    chatMessages.value.splice(index)
    clearAiContextUsage()
    return appendChatExchange(prompt, contentParts, overrideHosts ?? originalHosts)
  }

  const createConversation = async () => {
    const createChatConversation = chatHistoryClient.createChatConversation()
    if (!createChatConversation) return null
    const result = await createChatConversation()
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return null
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    await restoreChatMessagesFromBackend(result.data.conversation.id)
    return conversations.value.find((conversation) => conversation.id === result.data!.conversation.id) || cloneConversationRecord(result.data.conversation)
  }

  const deleteConversation = async (id: string) => {
    const deleteChatConversation = chatHistoryClient.deleteChatConversation()
    if (!deleteChatConversation) return false
    const result = await deleteChatConversation(id)
    if (!result?.ok || !isAiChatConversationDeleteData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    if (selectedConversationId.value) {
      await restoreChatMessagesFromBackend(selectedConversationId.value)
    } else {
      chatMessages.value = []
      clearAiContextUsage()
    }
    return true
  }

  const selectConversation = (id: string) => {
    selectedConversationId.value = id
    clearAiContextUsage()
  }

  const renameConversation = async (id: string, title: string) => {
    const nextTitle = title.trim()
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation || !nextTitle) return false
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await updateChatConversation({
      id,
      title: nextTitle,
      summary: conversation.summary,
      favorite: conversation.favorite,
      messages: id === selectedConversationId.value ? currentChatHistoryMessages() : undefined
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const toggleConversationFavorite = async (id: string) => {
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return false
    const nextFavorite = !conversation.favorite
    const updateChatConversation = chatHistoryClient.updateChatConversation()
    if (!updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await updateChatConversation({
      id,
      title: conversation.title,
      summary: conversation.summary,
      favorite: nextFavorite,
      messages: id === selectedConversationId.value ? currentChatHistoryMessages() : undefined
    })
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return false
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    return true
  }

  const restoreConversation = async (id: string) => {
    const restored = await restoreChatMessagesFromBackend(id)
    if (restored) return true
    if (await loadChatConversationsFromBackend({ restoreIfEmpty: false })) {
      return restoreChatMessagesFromBackend(id)
    }
    return false
  }

  const toggleContext = (context: AiContextOption) => {
    selectedContexts.value = selectedContexts.value.some((item) => item.id === context.id)
      ? selectedContexts.value.filter((item) => item.id !== context.id)
      : [...selectedContexts.value, context]
  }

  const removeContext = (id: string) => {
    selectedContexts.value = selectedContexts.value.filter((item) => item.id !== id)
  }

  const applyCommandPreset = (id: string, prompt: string) => {
    selectedCommandId.value = id
    selectedCommandRef.value = null
    void sendChat(prompt)
  }

  const selectCommandPreset = (id: string | null, commandRef?: AiCommandChipRef | null) => {
    selectedCommandId.value = id
    selectedCommandRef.value = id && commandRef ? { ...commandRef } : null
  }

  const applyMessageMetadataSnapshot = (messageId: string, messages: AiChatHistoryMessage[]) => {
    const snapshot = messages.find((message) => message.id === messageId)
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!snapshot || !message) return false
    message.favorite = snapshot.favorite
    message.feedback = snapshot.feedback
    return true
  }

  const applyChatMessageSnapshot = (messages: AiChatHistoryMessage[]) => {
    chatMessages.value = messages.map(chatHistoryMessageToChatMessage)
    clearAiContextUsage()
  }

  const applyAiMcpToolCallResult = (data: AiMcpToolCallActionData) => {
    const existing = conversations.value.find((conversation) => conversation.id === data.conversation.id)
    const nextConversation = cloneConversationRecord(data.conversation)
    conversations.value = existing
      ? conversations.value.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    applyChatMessageSnapshot(data.messages)
    if (data.mcpConfig) {
      applyMcpServersSnapshot(normalizeMcpServersConfig(data.mcpConfig.mcpServers, data.mcpConfig.mcpToolStates))
      mcpConfigEditorContent.value = JSON.stringify(data.mcpConfig.mcpConfig, null, 2)
    }
  }

  const applyAiMcpResourceAccessResult = (data: AiMcpResourceAccessActionData) => {
    const existing = conversations.value.find((conversation) => conversation.id === data.conversation.id)
    const nextConversation = cloneConversationRecord(data.conversation)
    conversations.value = existing
      ? conversations.value.map((conversation) => (conversation.id === nextConversation.id ? nextConversation : conversation))
      : [nextConversation, ...conversations.value]
    selectedConversationId.value = nextConversation.id
    applyChatMessageSnapshot(data.messages)
  }

  const runAiMcpToolCallAction = async (messageId: string, action: 'approve' | 'reject', options: { autoApprove?: boolean } = {}) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message?.mcpToolCall || message.ask !== 'mcp_tool_call') return false
    if (!selectedConversationId.value) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const bridge = action === 'approve' ? aiChatClient.approveAiMcpToolCall() : aiChatClient.rejectAiMcpToolCall()
    if (typeof bridge !== 'function') {
      setTopNotice('AI MCP 工具审批服务不可用')
      return false
    }
    const synced = await updateCurrentConversationSnapshot(undefined, { notifyUnavailable: true, notifyFailure: true })
    if (!synced) return false
    const result = await bridge({
      conversationId: selectedConversationId.value,
      messageId,
      autoApprove: options.autoApprove
    })
    if (!result?.ok || !isAiMcpToolCallActionData(result.data)) {
      setTopNotice(result?.errorMessage || 'AI MCP 工具审批失败')
      return false
    }
    applyAiMcpToolCallResult(result.data)
    return result.data.status
  }

  const approveAiMcpToolCall = (messageId: string, options: { autoApprove?: boolean } = {}) => runAiMcpToolCallAction(messageId, 'approve', options)

  const rejectAiMcpToolCall = (messageId: string) => runAiMcpToolCallAction(messageId, 'reject')

  const runAiMcpResourceAccessAction = async (messageId: string, action: 'approve' | 'reject') => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message?.mcpResourceAccess || message.ask !== 'mcp_resource_access') return false
    if (!selectedConversationId.value) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const bridge = action === 'approve' ? aiChatClient.approveAiMcpResourceAccess() : aiChatClient.rejectAiMcpResourceAccess()
    if (typeof bridge !== 'function') {
      setTopNotice('AI MCP 资源审批服务不可用')
      return false
    }
    const synced = await updateCurrentConversationSnapshot(undefined, { notifyUnavailable: true, notifyFailure: true })
    if (!synced) return false
    const result = await bridge({
      conversationId: selectedConversationId.value,
      messageId
    })
    if (!result?.ok || !isAiMcpResourceAccessActionData(result.data)) {
      setTopNotice(result?.errorMessage || 'AI MCP 资源审批失败')
      return false
    }
    applyAiMcpResourceAccessResult(result.data)
    return result.data.status
  }

  const approveAiMcpResourceAccess = (messageId: string) => runAiMcpResourceAccessAction(messageId, 'approve')

  const rejectAiMcpResourceAccess = (messageId: string) => runAiMcpResourceAccessAction(messageId, 'reject')

  const setMessageFeedback = async (id: string, feedback: 'up' | 'down') => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message || !selectedConversationId.value) return false
    const saveChatMessageMetadata = chatHistoryClient.saveChatMessageMetadata()
    if (!saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const nextFeedback = message.feedback === feedback ? null : feedback
    const result = await saveChatMessageMetadata({
      conversationId: selectedConversationId.value,
      messageId: id,
      feedback: nextFeedback
    })
    if (!result?.ok || !isAiChatMessageMetadataData(result.data)) return false
    return applyMessageMetadataSnapshot(id, result.data.messages)
  }

  const toggleMessageFavorite = async (id: string) => {
    const message = chatMessages.value.find((item) => item.id === id)
    if (!message || !selectedConversationId.value) return false
    const saveChatMessageMetadata = chatHistoryClient.saveChatMessageMetadata()
    if (!saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const result = await saveChatMessageMetadata({
      conversationId: selectedConversationId.value,
      messageId: id,
      favorite: !message.favorite
    })
    if (!result?.ok || !isAiChatMessageMetadataData(result.data)) return false
    return applyMessageMetadataSnapshot(id, result.data.messages)
  }

  const retryAssistantMessage = (messageId?: string) => {
    const assistantIndex = messageId
      ? chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'assistant')
      : -1
    const history = assistantIndex >= 0 ? chatMessages.value.slice(0, assistantIndex) : chatMessages.value
    const lastUserMessage = [...history].reverse().find((message) => message.role === 'user')
    if (lastUserMessage) {
      void sendChat(lastUserMessage.text, lastUserMessage.contentParts, lastUserMessage.hosts)
      return true
    }
    return false
  }

  const retryLastAssistantMessage = () => {
    return retryAssistantMessage()
  }

  const messagePlainText = (message: ChatMessage) =>
    message.contentParts?.length ? buildPlainTextFromAiParts(message.contentParts).trim() : message.text.trim()

  const messageSummaryContent = (message: ChatMessage) => {
    const body = messagePlainText(message)
    const hosts = message.hosts?.length ? `\n\nHosts: ${message.hosts.map((host) => host.label).join(', ')}` : ''
    return `# AI Message Summary\n\nRole: ${message.role}\nMessage ID: ${message.id}\n\n${body}${hosts}\n`
  }

  const knowledgeFileNameForMessage = (message: ChatMessage) => {
    const safeId = message.id.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'message'
    return `ai-message-${safeId}.md`
  }

  const ensureLocalKnowledgeDir = async (title: string) => {
    const relPath = title
    const existing = findKnowledgeNode(relPath)
    if (existing?.type === 'dir') return existing
    const kbMkdir = knowledgeClient.kbMkdir()
    if (!kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await kbMkdir('', title)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const createdRelPath = entry.relPath.trim()
    if (createdRelPath !== relPath) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    if (entry.type !== 'dir') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    return created?.type === 'dir' ? created : null
  }

  const summarizeMessageToKnowledge = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const content = messageSummaryContent(message)
    const summaryDir = await ensureLocalKnowledgeDir('summary')
    if (!summaryDir) return null
    const fileName = uniqueKnowledgeFileName('summary', knowledgeFileNameForMessage(message))
    const kbCreateFile = knowledgeClient.kbCreateFile()
    const kbWriteFile = knowledgeClient.kbWriteFile()
    if (!kbCreateFile || !kbWriteFile) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await kbCreateFile('summary', fileName, content)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const relPath = entry.relPath.trim()
    if (!isKnowledgeRelPathInParentWithRequestedName(relPath, 'summary', fileName) || entry.type !== 'file') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const writeResult = await kbWriteFile(relPath, content)
    if (!isKnowledgeWriteResultData(writeResult) || writeResult.relPath.trim() !== relPath) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    if (!created || created.type !== 'file') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }

    kbSelectedKeys.value = [relPath]
    openKnowledgeFile(relPath)
    return { relPath, content }
  }

  const alphaSuffix = (index: number) => {
    let value = index
    let suffix = ''
    do {
      suffix = String.fromCharCode(97 + (value % 26)) + suffix
      value = Math.floor(value / 26) - 1
    } while (value >= 0)
    return suffix
  }

  const skillNameForMessage = (message: ChatMessage) => {
    const words = messagePlainText(message)
      .toLowerCase()
      .match(/[a-z]+/g)
      ?.filter((word) => word.length > 2)
      .slice(0, 3)
    const rawBase = words?.length ? `${words.join('-')}-skill` : 'ai-message-skill'
    let candidate = rawBase.replace(/[^a-z-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'ai-message-skill'
    let index = 0
    while (settingsSkills.value.some((skill) => skill.name === candidate)) {
      candidate = `${rawBase}-${alphaSuffix(index)}`
      index += 1
    }
    return candidate
  }

  const summarizeMessageToSkill = async (messageId: string) => {
    const message = chatMessages.value.find((item) => item.id === messageId)
    if (!message) return null
    const name = skillNameForMessage(message)
    const plainText = messagePlainText(message)
    const skill = {
      name,
      description: `Summarized from AI message ${message.id}`,
      content: `Use this runbook when a similar operations context appears.\n\nSource message:\n${plainText}`,
      enabled: true,
      editable: true
    }
    return createSkill(skill, { successNotice: false })
  }

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
      setActiveModule
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
