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
import { agentHookClient } from '@/services/agentHookClient'
import { assetsClient } from '@/services/assetsClient'
import { chatHistoryClient } from '@/services/chatHistoryClient'
import { controlClient } from '@/services/controlClient'
import { applyEditorSettingsToDocument } from '@/services/editorRuntime'
import { applyKeywordHighlight } from '@/services/keywordHighlightRuntime'
import { localFilesClient } from '@/services/localFilesClient'
import { managedAiClient } from '@/services/managedAiClient'
import {
  isAgentHibernationConfigData,
  isAgentHookInstallOperationData,
  isAgentHookInstallerSnapshot,
  isManagedAiSessionBulkData,
  isManagedAiSessionHibernateData,
  isManagedAiSessionMutationData,
  isManagedAiSessionSnapshot
} from '@/services/managedAiBackendGuards'
import { mcpClient } from '@/services/mcpClient'
import {
  createMcpOperationKey,
  formatMcpResourceReadContent,
  formatMcpToolCallContent,
  isMcpResourceReadResultData,
  isMcpToolCallResultData,
  malformedMcpResourceResultMessage,
  malformedMcpToolResultMessage
} from '@/services/mcpBackendGuards'
import {
  isKnowledgeRelPathInParentWithRequestedName,
  isKnowledgeWriteResultData,
  malformedKnowledgeBackendResultMessage
} from '@/services/knowledgeBackendGuards'
import { knowledgeClient } from '@/services/knowledgeClient'
import {
  cloneKnowledgeNodes,
  getKnowledgeParent,
  isKnowledgeImagePath,
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
import { createWorkspaceKnowledgeController } from '@/services/workspaceKnowledgeController'
import { createWorkspaceKubernetesController } from '@/services/workspaceKubernetesController'
import { createWorkspaceQuickCommandsController } from '@/services/workspaceQuickCommandsController'
import {
  isQuickCommandsSnapshotData,
  malformedQuickCommandsBackendResultMessage
} from '@/services/quickCommandsBackendGuards'
import { quickCommandsClient } from '@/services/quickCommandsClient'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import {
  createWorkspaceSettingsController,
  type WorkspaceSettingsRule,
  type WorkspaceSettingsShortcut,
  type WorkspaceSettingsSkill,
  type WorkspaceSkillModalState
} from '@/services/workspaceSettingsController'
import { type ShortcutActionHandler } from '@/services/shortcutRuntime'
import { settingsConfigClient } from '@/services/settingsConfigClient'
import { addSystemThemeListener, applyThemeToDocument, isThemeId, type ThemeId } from '@/services/themeRuntime'
import { terminalClient } from '@/services/terminalClient'
import {
  isLocalTerminalSessionInfo,
  isSshTerminalSessionInfo,
  isTerminalCommandGenerationRecord,
  isTerminalLifecycleEvent,
  isTerminalExitEvent,
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
  applyLocalTerminalSessionToPanel,
  applySshTerminalSessionToPanel,
  applyTerminalExitToPanel,
  applyTerminalInputExecutionToPanels,
  applyTerminalLifecycleToPanel,
  appendGeneratedTerminalCommandToPanel,
  appendTerminalInputToPanelInCollection,
  appendTerminalOutputToPanelInCollection,
  attachTerminalPanelToSplit,
  canForkSshTerminalPanel,
  canWriteTerminalPanels,
  closeOtherTerminalPanelsInCollection,
  closeTerminalPanelInCollection,
  collectTerminalInputExecutionRecords,
  createEmptyTerminalPanel,
  createForkSshTerminalPanelInCollection,
  createTerminalPanelInCollection,
  defaultTerminalPanelTitle,
  detachTerminalPanelFromSplit,
  discardPendingTerminalPanelInCollection,
  ensureTerminalPanelOutputSegments,
  findTerminalPanelByIdOrSession,
  findTerminalPanelBySessionOrId,
  hasTerminalPanelSplitState,
  liveTerminalPanelIds,
  renameTerminalPanelInCollection,
  registerTerminalSshSession,
  replaceTerminalOutputInPanelCollection,
  resolveActiveWritableTerminalPanel as resolveActiveWritableTerminalPanelFromCollection,
  resolveTerminalPanelSessionWrite,
  resolveTerminalPanelSessionWrites,
  resetTerminalPanelCollectionToDefault,
  setTerminalPanelAutoTitleInCollection,
  terminalPanelIds,
  type PanelDirection,
  type TerminalOutputScope,
  type TerminalPanel,
  type TerminalSessionAsset,
  type TerminalLaunchAsset,
  type TerminalSshSession
} from '@/services/terminalPanelRuntime'
import { userAccountClient } from '@/services/userAccountClient'
import {
  createEmptyUserProfile,
  isTrustedDeviceRevokeData,
  isUserAccountSnapshot,
  isUserAvatarPrepareData,
  isUserCodeDataForRequest,
  isUserExternalActionData,
  isUserMutationData,
  type UserCodeData
} from '@/services/userAccountBackendGuards'
import { isAiopstermDeepLinkPayload } from '@shared/deepLink'
import { createDefaultOnboardingCompleted, onboardingTourSteps } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type { OnboardingModuleId } from '@/config/onboarding'
import { type SettingSectionKey } from '@/config/settings'
import { readStoredAiPanelMode } from '@/services/aiPanelModeRuntime'
import {
  backgroundSnapshotsMatch,
  cloneBackgroundSnapshot,
  cloneWorkspacePreferencesSnapshot,
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
  knowledgeTreeSize,
  layoutWidthLimits,
  layoutPreferencesPatchMatches,
  layoutWidthFromConfig,
  mcpConfigFilesMatch,
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
  normalizeMcpConfigFile,
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
import { applyDocumentLocale, resolveLocale, translateWithLocale } from '@/i18n/runtime'
import type { I18nKey } from '@/i18n/messages'
import type { AiopsPreloadApi } from '@shared/contracts/preloadApi'
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
  AiPreferencesUserConfig,
  AppUpdateProgressEvent,
  EditorUserConfig,
  KnowledgeSearchRuntimeSnapshot,
  ModelOptionUserConfig,
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
import type { FileSessionCatalog, FileSessionFolderRecord, FileSessionFolderSaveInput, FileSessionInfo, FileSessionPatch, FileTransferTask } from '@shared/contracts/files'
import type { AiopsTrustedDevice, AiopsUserAccountSnapshot, AiopsUserExternalAction, AiopsUserExternalActionResult, AiopsUserMutationResult, AiopsUserProfile } from '@shared/contracts/userAccount'
import type { QuickCommandScriptPlan } from '@shared/contracts/quickCommands'
import type { McpConfigFile, McpServerUserConfig, McpToolStatesUserConfig } from '@shared/contracts/mcp'
import type {
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  KnowledgeNode,
  KnowledgeNodeType
} from '@shared/contracts/knowledgeBase'
import type {
  AiAgentSessionEvent,
  AiAgentSessionSource,
  AgentHibernationConfig,
  AgentHibernationConfigResult,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionDecision,
  ManagedAiSessionFocusRequest,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRecord,
  ManagedAiSessionSnapshot,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'
import type { ControlNotificationFocusRequest, ControlNotificationRecord } from '@shared/contracts/control'
import type { AgentHookInstallerSnapshot, AgentHookInstallerStatus, AgentHookInstallerSource } from '@shared/contracts/agentHooks'
import type { TerminalExitEvent, TerminalLifecycleEvent, TerminalSessionInfo } from '@shared/contracts/terminalSessions'

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

type CloseMode = 'current' | 'others' | 'all'
type TopUpdateState = 'idle' | 'checking' | 'local' | 'available' | 'install-requested'
export type AiAttentionKind = 'approval' | 'question' | 'plan' | 'error' | 'done'
export type AiAttentionSource = AiAgentSessionSource | 'classic-chat' | 'control-notification'
export type AiAttentionItem = {
  id: string
  source: AiAttentionSource
  kind: AiAttentionKind
  title: string
  summary: string
  priority: number
  createdAt: number
  conversationId?: string
  sessionId?: string
  surfaceId?: string
  notificationId?: string
  handledAt?: number
}
export type AiAttentionInput = Omit<AiAttentionItem, 'createdAt' | 'priority'> & {
  createdAt?: number
  priority?: number
}
export type AiAttentionFocusRequest = {
  sequence: number
  item: AiAttentionItem | null
}
export type ManagedAiSessionState = ManagedAiSessionRecord['state']
export type ManagedAiSession = ManagedAiSessionRecord

const defaultAgentHibernationConfig: AgentHibernationConfig = {
  enabled: false,
  idleSeconds: 300,
  maxLiveTerminals: 12,
  confirmationSeconds: 60
}
type AiChatHistoryHost = NonNullable<AiChatHistoryMessage['hosts']>[number]
type OnboardingAiRequest =
  | 'none'
  | 'open-mode'
  | 'open-model'
  | 'open-context-main'
  | 'open-context-hosts'
  | 'prepare-send'
type OnboardingAssetRequest = 'none' | 'open-host-management' | 'open-create-form'
type AssetManagementViewRequest = 'assetConfig' | 'assetManagement' | 'keyManagement' | 'proxyManagement'
type AssetManagementOpenAction = 'none' | 'create-key' | 'create-proxy'
type PrivacyRuntimeApplyData = PrivacyRuntimeSnapshot
type KnowledgeSearchRuntimeApplyData = KnowledgeSearchRuntimeSnapshot

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

type SshProxyForm = SshProxyConfig

type AiPreferencePatch = Partial<Omit<AiPreferenceSettings, 'proxy'>> & {
  proxy?: Partial<AiPreferenceSettings['proxy']>
}

type SettingsMcpServer = McpServerUserConfig
type McpConfigMutationResult = Awaited<ReturnType<NonNullable<AiopsPreloadApi['writeMcpConfig']>>>
type McpOperationStatus = 'idle' | 'running' | 'success' | 'error'
type McpOperationRecord = {
  status: McpOperationStatus
  output: string
  error: string
  durationMs?: number
  isError?: boolean
}

const cloneMcpServerConfig = (servers: SettingsMcpServer[]): McpServerUserConfig[] =>
  servers.map((server) => ({
    name: server.name,
    status: server.status,
    disabled: server.disabled,
    ...(server.error ? { error: server.error } : {}),
    tools: server.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
      ...(tool.autoApprove ? { autoApprove: true } : {}),
      parameters: tool.parameters.map((parameter) => ({ ...parameter }))
    })),
    resources: server.resources.map((resource) => ({ ...resource }))
  }))

export type BillingSettings = {
  skippedLogin: boolean
  email: string
  subscription: string
  subscriptionExpiresAt: string
  budgetResetAt: string
  ratio: number
}

export type UserLoginTab = 'account' | 'email' | 'mobile'

export type AboutSettings = {
  version: string
  updateStatus: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'install-requested' | 'error'
  newVersion: string
  progress: number
}

const ONBOARDING_VERSION = defaultConfig.onboarding!.version
type RendererLocalIdPrefix = 'panel' | 'terminal-security' | 'aichat-agent-loop'
const createRendererLocalId = (prefix: RendererLocalIdPrefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`
const normalizeThemeId = (theme: string): ThemeId => (isThemeId(theme) ? theme : 'dark')
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

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) => (typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback)

const parseMcpEditorContent = (content: string) => JSON.parse(content)

const isThemeSnapshot = (value: unknown): value is ThemeId => typeof value === 'string' && isThemeId(value)

const defaultBillingSettings: BillingSettings = {
  skippedLogin: true,
  email: '',
  subscription: 'free',
  subscriptionExpiresAt: '',
  budgetResetAt: '',
  ratio: 0
}

const defaultAboutSettings: AboutSettings = {
  version: '0.1.0',
  updateStatus: 'idle',
  newVersion: '',
  progress: 0
}

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
  const topUpdateState = ref<TopUpdateState>('idle')
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
  const onboardingAiRequest = ref<{ action: OnboardingAiRequest; stepId: string; sequence: number }>({
    action: 'none',
    stepId: '',
    sequence: 0
  })
  const onboardingAssetRequest = ref<{ action: OnboardingAssetRequest; stepId: string; sequence: number }>({
    action: 'none',
    stepId: '',
    sequence: 0
  })
  const onboardingAutoApprovalEvent = ref(0)
  const config = ref<UserConfig>(defaultConfig)
  const savedGeneralBaseSettingsSnapshot = ref<GeneralBaseSettingsPatch>({})
  const themeListenerCleanup = ref<(() => void) | null>(null)
  const workspacePreferences = ref<WorkspaceUserConfig>({
    ...defaultWorkspacePreferences,
    expandedGroups: [...defaultWorkspacePreferences.expandedGroups]
  })
  const activePanelId = ref('panel-main')
  const panels = ref<TerminalPanel[]>([
    createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle)
  ])

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

  const shortcutHandlers: Record<string, ShortcutActionHandler> = {
    newTerminal: () => triggerShortcutAction('newTerminal'),
    toggleAi: () => triggerShortcutAction('toggleAi'),
    switchToSpecificTab: (payload) => triggerShortcutAction('switchToSpecificTab', payload?.digit),
    quickCommand: () => triggerShortcutAction('quickCommand')
  }

  const setupThemeBridge = () => {
    if (themeListenerCleanup.value) return
    themeListenerCleanup.value = addSystemThemeListener(() => {
      if (config.value.theme === 'auto') applyCurrentTheme()
    })
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

  const registerSshSession = (panelId: string, asset: TerminalLaunchAsset) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, panelId)
    if (!panel) return null
    return registerTerminalSshSession(panel, asset)
  }

  const applySshTerminalSession = (
    panelId: string,
    terminalSession?: TerminalSessionInfo | null,
    asset?: TerminalSessionAsset
  ) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, panelId)
    if (!panel || !isSshTerminalSessionInfo(terminalSession)) return null
    const session = applySshTerminalSessionToPanel(panel, terminalSession, asset)
    if (terminalSession.lifecycle) applyTerminalLifecycle(terminalSession.lifecycle)
    return session
  }

  const applyLocalTerminalSession = (panelId: string, terminalSession?: TerminalSessionInfo | null) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, panelId)
    if (!panel || !isLocalTerminalSessionInfo(terminalSession)) return null
    applyLocalTerminalSessionToPanel(panel, terminalSession)
    if (terminalSession.lifecycle) applyTerminalLifecycle(terminalSession.lifecycle)
    return panel
  }

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
  const sshProxyForm = ref<SshProxyForm>({
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
  const billingSettings = ref<BillingSettings>({ ...defaultBillingSettings })
  const aboutSettings = ref<AboutSettings>({ ...defaultAboutSettings })
  const userProfile = ref<AiopsUserProfile>(createEmptyUserProfile())
  const userNotice = ref('')
  const mcpServers = ref<SettingsMcpServer[]>([])
  const expandedMcpServerNames = ref<string[]>([])
  const activeMcpServerTab = ref<Record<string, 'tools' | 'resources'>>({})
  const mcpToolArgumentDrafts = ref<Record<string, string>>({})
  const mcpOperationResults = ref<Record<string, McpOperationRecord>>({})
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
  const trustedDevices = ref<AiopsTrustedDevice[]>([])
  const trustedDeviceModal = ref<{ open: boolean; id: number | null }>({ open: false, id: null })
  const settingsNotice = ref('')
  const currentLocale = () => resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language])
  const i18nText = (key: I18nKey, params: Record<string, string | number> = {}) =>
    Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), translateWithLocale(currentLocale(), key))
  const setSettingsNoticeText = (text: string) => {
    settingsNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (settingsNotice.value === text) settingsNotice.value = ''
    }, 2400)
  }
  const todoItems = ref<TodoItem[]>([])
  const chatMessages = ref<ChatMessage[]>([])
  const aiContextUsage = ref<AiContextUsage | null>(null)
  const terminalSecurityPrompt = ref<TerminalSecurityPrompt>(null)
  const terminalCommandGenerationRecords = ref<TerminalCommandGenerationRecord[]>([])
  let keywordHighlightSaveTimer: number | null = null
  let removeKeywordHighlightConfigFileListener: (() => void) | null = null
  let keywordHighlightLoadRequest = 0
  let securityConfigSaveTimer: number | null = null
  let removeSecurityConfigFileListener: (() => void) | null = null
  let securityConfigLoadRequest = 0
  let mcpConfigSaveTimer: number | null = null
  let removeMcpConfigFileListener: (() => void) | null = null
  let mcpConfigLoadRequest = 0
  let aiModelCatalogLoadPromise: Promise<AiModelCatalog> | null = null

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

  const applyAgentHookInstallerSnapshot = (snapshot: AgentHookInstallerSnapshot) => {
    agentHookInstallers.value = snapshot.installers.map((installer) => ({
      ...installer,
      warnings: [...installer.warnings]
    }))
    agentHookInstallerError.value = ''
  }

  const refreshAgentHookInstallers = async (options: { silent?: boolean } = {}) => {
    const listAgentHookInstallers = agentHookClient.listAgentHookInstallers()
    if (!listAgentHookInstallers) {
      agentHookInstallerError.value = i18nText('settings.ai.agentHook.serviceUnavailable')
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    }
    agentHookInstallersLoading.value = true
    try {
      const result = await listAgentHookInstallers()
      if (!result?.ok) {
        agentHookInstallerError.value = result?.errorMessage || i18nText('settings.ai.agentHook.statusLoadFailed')
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      if (!isAgentHookInstallerSnapshot(result.data)) {
        agentHookInstallerError.value = i18nText('settings.ai.agentHook.statusLoadFailed')
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data)
      if (!options.silent) setTopNotice(i18nText('settings.ai.agentHook.statusRefreshed'))
      return true
    } catch (error) {
      agentHookInstallerError.value = error instanceof Error ? error.message : i18nText('settings.ai.agentHook.statusLoadFailed')
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    } finally {
      agentHookInstallersLoading.value = false
    }
  }

  const runAgentHookInstallerOperation = async (source: AgentHookInstallerSource, operation: 'install' | 'uninstall') => {
    const runOperation = operation === 'install' ? agentHookClient.installAgentHook() : agentHookClient.uninstallAgentHook()
    if (!runOperation) {
      setTopNotice(i18nText('settings.ai.agentHook.serviceUnavailable'))
      return false
    }
    agentHookInstallerBusySource.value = source
    agentHookInstallerError.value = ''
    try {
      const result = await runOperation({ source })
      if (!result?.ok) {
        const message = result?.errorMessage || (operation === 'install' ? i18nText('settings.ai.agentHook.installFailed') : i18nText('settings.ai.agentHook.uninstallFailed'))
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      if (!isAgentHookInstallOperationData(result.data)) {
        const message = operation === 'install' ? i18nText('settings.ai.agentHook.installMalformed') : i18nText('settings.ai.agentHook.uninstallMalformed')
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data.snapshot)
      setTopNotice(
        i18nText(operation === 'install' ? 'settings.ai.agentHook.installedNotice' : 'settings.ai.agentHook.uninstalledNotice', {
          label: result.data.status.label
        })
      )
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : operation === 'install' ? i18nText('settings.ai.agentHook.installFailed') : i18nText('settings.ai.agentHook.uninstallFailed')
      agentHookInstallerError.value = message
      setTopNotice(message)
      return false
    } finally {
      agentHookInstallerBusySource.value = ''
    }
  }

  const installAgentHookInstaller = (source: AgentHookInstallerSource) => runAgentHookInstallerOperation(source, 'install')

  const uninstallAgentHookInstaller = (source: AgentHookInstallerSource) => runAgentHookInstallerOperation(source, 'uninstall')

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
      setSettingsNoticeText('模型列表加载服务不可用')
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
      setSettingsNoticeText(`模型列表加载失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
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
      knowledgeBase: normalizedKnowledgeBase,
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
    applyDocumentLocale(resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]))
    applyCurrentTheme()
    applyCurrentEditorSettings()
    refreshShortcutRuntime()
    setupThemeBridge()
    await refreshUserAccount()
    setupKnowledgeBridgeListeners()
    void refreshAgentHookInstallers({ silent: true })
    await aiStartupRefresh
    restoreSavedGeneralBaseSettings()
    applyDocumentLocale(resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]))
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
    refreshShortcutRuntime()
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
      ensureSelectedExtensionVisible()
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

  const getMcpSnapshot = () => {
    const servers = cloneMcpServerConfig(mcpServers.value)
    const toolStates: McpToolStatesUserConfig = {}
    servers.forEach((server) => {
      server.tools.forEach((tool) => {
        toolStates[`${server.name}:${tool.name}`] = tool.enabled
      })
    })
    return { servers, toolStates }
  }

  const restoreMcpServersSnapshot = (snapshot: ReturnType<typeof getMcpSnapshot>) => {
    applyMcpServersSnapshot(normalizeMcpServersConfig(snapshot.servers, snapshot.toolStates))
  }

  const mcpServerDisabledMatches = (serverName: string, disabled: boolean) =>
    mcpServers.value.some((server) => server.name === serverName && server.disabled === disabled)

  const mcpServerDeletedMatches = (serverName: string) => !mcpServers.value.some((server) => server.name === serverName)

  const mcpToolEnabledMatches = (serverName: string, toolName: string, enabled: boolean) =>
    mcpServers.value.some((server) => server.name === serverName && server.tools.some((tool) => tool.name === toolName && tool.enabled === enabled))

  const mcpToolAutoApproveMatches = (serverName: string, toolName: string, autoApprove: boolean) =>
    mcpServers.value.some((server) => server.name === serverName && server.tools.some((tool) => tool.name === toolName && Boolean(tool.autoApprove) === autoApprove))

  const failMcpMutationRefresh = (snapshot: ReturnType<typeof getMcpSnapshot>, message: string) => {
    restoreMcpServersSnapshot(snapshot)
    if (mcpConfigEditorOpen.value) mcpConfigEditorLastSaved.value = false
    setSettingsNotice(message)
    return false
  }

  const readMcpServersSnapshotFromBridge = async () => {
    const getMcpServers = mcpClient.getMcpServers()
    if (!getMcpServers) {
      setSettingsNotice('MCP 列表加载服务不可用')
      return null
    }
    try {
      const servers = await getMcpServers()
      if (!Array.isArray(servers)) {
        setSettingsNotice('MCP 配置服务返回数据无效')
        return null
      }
      return normalizeMcpServersConfig(servers)
    } catch {
      setSettingsNotice('MCP 配置加载失败')
      return null
    }
  }

  const applyMcpServersSnapshot = (snapshot: ReturnType<typeof normalizeMcpServersConfig>) => {
    mcpServers.value = snapshot.normalized.map((server) => ({
      ...server,
      tools: server.tools.map((tool) => ({ ...tool, parameters: tool.parameters.map((parameter) => ({ ...parameter })) })),
      resources: server.resources.map((resource) => ({ ...resource }))
    }))
    const expandedNames = expandedMcpServerNames.value.filter((name) => mcpServers.value.some((server) => server.name === name))
    expandedMcpServerNames.value = expandedNames.length || !mcpServers.value[0] ? expandedNames : [mcpServers.value[0].name]
    config.value = mergeUserConfig(config.value, {
      mcpServers: snapshot.normalized,
      mcpToolStates: snapshot.toolStates
    })
  }

  const readMcpConfigMutationSnapshot = (result: McpConfigMutationResult, errorPrefix: string, invalidMessage = 'MCP 配置服务返回数据无效') => {
    if (!result?.ok || !result.data || !isRecord(result.data.mcpConfig) || !Array.isArray(result.data.mcpServers) || !isRecord(result.data.mcpToolStates)) {
      const message = result?.errorMessage || invalidMessage
      mcpConfigEditorError.value = `${errorPrefix}: ${message}`
      if (mcpConfigEditorOpen.value) mcpConfigEditorLastSaved.value = false
      setSettingsNotice(message)
      return null
    }
    const savedConfig = normalizeMcpConfigFile(result.data.mcpConfig)
    const snapshot = normalizeMcpServersConfig(result.data.mcpServers, result.data.mcpToolStates)
    return { savedConfig, snapshot }
  }

  const applySavedMcpConfig = (result: McpConfigMutationResult, expected: McpConfigFile) => {
    const saved = readMcpConfigMutationSnapshot(result, 'Save failed', 'MCP config write did not return saved settings')
    if (!saved) {
      return false
    }
    if (!mcpConfigFilesMatch(saved.savedConfig, expected)) {
      mcpConfigEditorError.value = 'Save failed: MCP config write returned different settings'
      mcpConfigEditorLastSaved.value = false
      return false
    }
    applyMcpServersSnapshot(saved.snapshot)
    mcpConfigEditorContent.value = JSON.stringify(saved.savedConfig, null, 2)
    mcpConfigEditorError.value = ''
    mcpConfigEditorLastSaved.value = true
    return true
  }

  const applyMcpConfigMutationResult = (result: McpConfigMutationResult, errorPrefix: string) => {
    const saved = readMcpConfigMutationSnapshot(result, errorPrefix)
    if (!saved) return false
    applyMcpServersSnapshot(saved.snapshot)
    mcpConfigEditorContent.value = JSON.stringify(saved.savedConfig, null, 2)
    mcpConfigEditorError.value = ''
    if (mcpConfigEditorOpen.value) mcpConfigEditorLastSaved.value = true
    return true
  }

  const applyMcpMutationSnapshotForRequest = (
    result: McpConfigMutationResult,
    previousSnapshot: ReturnType<typeof getMcpSnapshot>,
    errorPrefix: string,
    mismatchMessage: string,
    matches: () => boolean
  ) => {
    if (!applyMcpConfigMutationResult(result, errorPrefix)) {
      restoreMcpServersSnapshot(previousSnapshot)
      return false
    }
    if (!matches()) {
      mcpConfigEditorError.value = `${errorPrefix}: ${mismatchMessage}`
      return failMcpMutationRefresh(previousSnapshot, mismatchMessage)
    }
    return true
  }

  const refreshMcpServersFromBridge = async () => {
    const snapshot = await readMcpServersSnapshotFromBridge()
    if (!snapshot) return false
    applyMcpServersSnapshot(snapshot)
    return true
  }

  const applyMcpConfigFileContent = (content: string, markSaved = true, snapshot?: ReturnType<typeof normalizeMcpServersConfig> | null) => {
    const editorContent = content.trim() ? content : JSON.stringify({ mcpServers: {} }, null, 2)
    mcpConfigEditorContent.value = editorContent
    try {
      normalizeMcpConfigFile(parseMcpEditorContent(editorContent))
      if (snapshot) applyMcpServersSnapshot(snapshot)
      mcpConfigEditorError.value = ''
      mcpConfigEditorLastSaved.value = markSaved
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
      mcpConfigEditorLastSaved.value = false
      return false
    }
  }

  const installMcpConfigFileListener = () => {
    const onMcpConfigFileChanged = mcpClient.onMcpConfigFileChanged()
    if (removeMcpConfigFileListener || !onMcpConfigFileChanged) return
    removeMcpConfigFileListener = onMcpConfigFileChanged((content) => {
      void (async () => {
        const snapshot = await readMcpServersSnapshotFromBridge()
        if (!snapshot) {
          mcpConfigEditorContent.value = content.trim() ? content : JSON.stringify({ mcpServers: {} }, null, 2)
          mcpConfigEditorLastSaved.value = false
          return
        }
        applyMcpConfigFileContent(content, true, snapshot)
      })()
    })
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

  const setSettingsNotice = (text: string) => {
    setSettingsNoticeText(text)
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
      closeMcpConfigEditor()
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
    if (mcpConfigEditorOpen.value) closeMcpConfigEditor()
    onboardingGuideOpen.value = false
    if (!page) activeSettingsSection.value = 'general'
    try {
      return await readSettingsDocumentation(page ? { page, locale: resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]) } : undefined)
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
      void loadSkillsFromBridge()
    } else if (key === 'mcp') {
      void refreshMcpServersFromBridge()
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
      const assetRequestMap: Record<string, OnboardingAssetRequest> = {
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
      const requestMap: Record<string, OnboardingAiRequest> = {
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
    if (nextIndex >= onboardingActiveSteps.value.length) {
      onboardingCompleted.value = { ...onboardingCompleted.value, [moduleId]: true }
      persistOnboardingState()
      stopOnboardingTour()
      setSettingsNotice(`${moduleId === 'interfaceGuide' ? '界面导览' : moduleId === 'systemSettings' ? '系统设置' : moduleId === 'addAndConnectHost' ? '添加并连接主机' : 'AI 会话'} 引导已完成`)
      return
    }
    onboardingActiveStepIndex.value = nextIndex
    prepareOnboardingStep(moduleId, onboardingActiveSteps.value[nextIndex]?.id || '')
  }

  const previousOnboardingStep = () => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    onboardingActiveStepIndex.value = Math.max(0, onboardingActiveStepIndex.value - 1)
    prepareOnboardingStep(moduleId, onboardingActiveStep.value?.id || '')
  }

  const jumpOnboardingStep = (stepId: string) => {
    const moduleId = onboardingActiveTour.value
    if (!moduleId) return
    const nextIndex = onboardingActiveSteps.value.findIndex((step) => step.id === stepId)
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
        applyDocumentLocale(resolveLocale(config.value.language, typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language]))
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
      setSettingsNotice(i18nText('settings.terminal.saveUnavailable'))
      return false
    }
    const normalizedSettings = normalizeTerminalConfig(nextSettings).normalized
    try {
      const savedConfig = await saveConfigBridge({
        terminal: cloneTerminalSettingsSnapshot(normalizedSettings)
      })
      if (!isRecord(savedConfig) || !isTerminalSettingsSnapshot(savedConfig.terminal)) {
        setSettingsNotice(i18nText('settings.terminal.saveFailed'))
        return false
      }
      const savedSettings = normalizeTerminalConfig(savedConfig.terminal).normalized
      if (!terminalSettingsSnapshotsMatch(savedSettings, normalizedSettings)) {
        setSettingsNotice(i18nText('settings.terminal.saveFailed'))
        return false
      }
      config.value = mergeGenericSavedConfig(config.value, savedConfig, {
        terminal: cloneTerminalSettingsSnapshot(savedSettings)
      })
      terminalSettings.value = cloneTerminalSettingsSnapshot(savedSettings)
      return true
    } catch (error) {
      setSettingsNotice(error instanceof Error ? error.message : i18nText('settings.terminal.saveFailed'))
      return false
    }
  }

  const updateTerminalSettings = async (patch: Partial<TerminalSettings>) => {
    const nextSettings = normalizeTerminalConfig({ ...getTerminalSettingsSnapshot(), ...patch }).normalized
    const saved = await persistTerminalSettings(nextSettings)
    if (saved) {
      setSettingsNotice(i18nText('settings.terminal.saved'))
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

  const updateSshProxyForm = (patch: Partial<SshProxyForm>) => {
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
    const config = { ...modelProviders.value[provider] }
    const checkProviderBridge = modelProviderClient.checkModelProvider()
    if (typeof checkProviderBridge !== 'function') {
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      modelCheckState.value = { ...modelCheckState.value, [provider]: 'error' }
      setSettingsNotice('模型 Provider 检查服务不可用')
      return
    }
    try {
      const result = await checkProviderBridge({ provider, config })
      if (modelCheckRequestSeq.value[provider] !== requestSeq) return
      if (result.ok) {
        if (!isModelProviderCheckDataForRequest(result.data, provider, config)) {
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

  const updateAiPreferences = async (patch: AiPreferencePatch) => {
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
      refreshControlNotificationAttentionItems()
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

  const setUserNotice = (message: string) => {
    userNotice.value = message
  }

  const userAccountCenterOpen = ref(false)
  const userContactCodeCountdown = ref<Record<'email' | 'mobile', number>>({
    email: 0,
    mobile: 0
  })
  const userContactCodeSending = ref<Record<'email' | 'mobile', boolean>>({
    email: false,
    mobile: false
  })
  const userContactCodeTimers: Partial<Record<'email' | 'mobile', number>> = {}
  const userLoginTab = ref<UserLoginTab>('account')
  const userLoginLoading = ref(false)
  const userLoginCodeCountdown = ref<Record<'email' | 'mobile', number>>({
    email: 0,
    mobile: 0
  })
  const userLoginCodeSending = ref<Record<'email' | 'mobile', boolean>>({
    email: false,
    mobile: false
  })
  const userLoginCodeTimers: Partial<Record<'email' | 'mobile', number>> = {}

  const clearUserCodeTimer = (timers: Partial<Record<'email' | 'mobile', number>>, kind: 'email' | 'mobile') => {
    if (!timers[kind]) return
    window.clearInterval(timers[kind])
    delete timers[kind]
  }

  const resetUserCodeState = (target: 'login' | 'contact', kind?: 'email' | 'mobile') => {
    const kinds: Array<'email' | 'mobile'> = kind ? [kind] : ['email', 'mobile']
    kinds.forEach((item) => {
      if (target === 'login') {
        userLoginCodeCountdown.value = { ...userLoginCodeCountdown.value, [item]: 0 }
        userLoginCodeSending.value = { ...userLoginCodeSending.value, [item]: false }
        clearUserCodeTimer(userLoginCodeTimers, item)
      } else {
        userContactCodeCountdown.value = { ...userContactCodeCountdown.value, [item]: 0 }
        userContactCodeSending.value = { ...userContactCodeSending.value, [item]: false }
        clearUserCodeTimer(userContactCodeTimers, item)
      }
    })
  }

  const isUserSubscriptionActive = computed(() => {
    const profile = userProfile.value
    if (profile.subscription !== 'pro' && profile.subscription !== 'ultra') return false
    return new Date(profile.subscriptionExpiresAt) > new Date()
  })

  const canEditUserMobile = computed(() => userProfile.value.registrationCode !== 7)
  const canEditUserEmail = computed(() => ![2, 3, 4, 6].includes(userProfile.value.registrationCode))
  const canResetUserPassword = computed(() => userProfile.value.registrationCode !== 1 && userProfile.value.authProvider !== 'sso')

  const applyUserAccountSnapshot = (snapshot: AiopsUserAccountSnapshot) => {
    userProfile.value = { ...snapshot.profile }
    trustedDevices.value = snapshot.trustedDevices.map((device) => ({ ...device }))
    billingSettings.value = {
      ...billingSettings.value,
      skippedLogin: snapshot.profile.skippedLogin || snapshot.profile.lastLoginMethod === 'skip',
      email: snapshot.profile.email,
      subscription: snapshot.profile.subscription,
      subscriptionExpiresAt: snapshot.profile.subscriptionExpiresAt
    }
  }

  const applyUserMutationResult = (result: AiopsUserMutationResult | undefined) => {
    if (!result) {
      setUserNotice('用户操作失败')
      userLoginLoading.value = false
      return false
    }
    if (result.ok) {
      if (!isUserMutationData(result.data)) {
        setUserNotice('用户后端返回了无效结果')
        userLoginLoading.value = false
        return false
      }
      applyUserAccountSnapshot(result.data)
      setUserNotice(result.data.message || '用户操作已完成')
      userLoginLoading.value = false
      return true
    }
    if (result.data !== undefined) {
      if (!isUserAccountSnapshot(result.data)) {
        setUserNotice('用户后端返回了无效结果')
        userLoginLoading.value = false
        return false
      }
      if (result.errorCode === 'USER_DEVICE_VERIFICATION_REQUIRED') {
        applyUserAccountSnapshot(result.data)
      }
    }
    setUserNotice(result.errorMessage || '用户操作失败')
    userLoginLoading.value = false
    return false
  }

  const applyUserExternalActionResult = (
    result: AiopsUserExternalActionResult | undefined,
    action: AiopsUserExternalAction,
    fallbackNotice: string,
    invalidNotice = '用户后端返回了无效结果'
  ) => {
    if (!result) {
      setUserNotice(fallbackNotice)
      userLoginLoading.value = false
      return false
    }
    if (!result.ok) {
      setUserNotice(result.errorMessage || fallbackNotice)
      userLoginLoading.value = false
      return false
    }
    if (!isUserExternalActionData(result.data, action)) {
      setUserNotice(invalidNotice)
      userLoginLoading.value = false
      return false
    }
    setUserNotice(result.data.message)
    userLoginLoading.value = false
    return true
  }

  const refreshUserAccount = async () => {
    const getUserAccount = userAccountClient.getUserAccount()
    if (!getUserAccount) return false
    try {
      const result = await getUserAccount()
      if (!result?.ok || !result.data) {
        setUserNotice(result?.errorMessage || '用户信息加载失败')
        return false
      }
      if (!isUserAccountSnapshot(result.data)) {
        setUserNotice('用户后端返回了无效账号快照')
        return false
      }
      applyUserAccountSnapshot(result.data)
      return true
    } catch (error) {
      setUserNotice(error instanceof Error ? error.message : '用户信息加载失败')
      return false
    }
  }

  const userCooldownRemainingSeconds = (expiresAt: number) => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))

  const isValidUserCodeCooldown = (cooldown: UserCodeData | undefined): cooldown is UserCodeData =>
    Boolean(cooldown && typeof cooldown.expiresAt === 'number' && Number.isFinite(cooldown.expiresAt) && typeof cooldown.message === 'string')

  const startUserCountdown = (target: 'login' | 'contact', kind: 'email' | 'mobile', cooldown: UserCodeData) => {
    const sendingRef = target === 'login' ? userLoginCodeSending : userContactCodeSending
    const countdownRef = target === 'login' ? userLoginCodeCountdown : userContactCodeCountdown
    const timers = target === 'login' ? userLoginCodeTimers : userContactCodeTimers
    const expiresAt = cooldown.expiresAt
    const applyCountdown = () => {
      const next = userCooldownRemainingSeconds(expiresAt)
      countdownRef.value = { ...countdownRef.value, [kind]: next }
      if (next === 0) clearUserCodeTimer(timers, kind)
    }

    sendingRef.value = { ...sendingRef.value, [kind]: false }
    clearUserCodeTimer(timers, kind)
    applyCountdown()
    if (countdownRef.value[kind] > 0) {
      timers[kind] = window.setInterval(applyCountdown, 1000)
    }
    setUserNotice(cooldown.message)
  }

  const rejectInvalidUserCodeCooldown = (target: 'login' | 'contact', kind: 'email' | 'mobile') => {
    const sendingRef = target === 'login' ? userLoginCodeSending : userContactCodeSending
    const countdownRef = target === 'login' ? userLoginCodeCountdown : userContactCodeCountdown
    const timers = target === 'login' ? userLoginCodeTimers : userContactCodeTimers
    sendingRef.value = { ...sendingRef.value, [kind]: false }
    countdownRef.value = { ...countdownRef.value, [kind]: 0 }
    clearUserCodeTimer(timers, kind)
    setUserNotice('验证码冷却状态无效')
  }

  const openAccountCenter = async (options: { activateUserModule?: boolean; notifySettings?: boolean } = {}) => {
    if (!userAccountClient.getUserAccount()) {
      setUserNotice('账号中心服务不可用')
      if (options.notifySettings) setSettingsNotice('账户中心服务不可用')
      return false
    }
    const openUserAccountCenterBridge = userAccountClient.openUserAccountCenter()
    if (!openUserAccountCenterBridge) {
      setUserNotice('账号中心服务不可用')
      if (options.notifySettings) setSettingsNotice('账户中心服务不可用')
      return false
    }
    const refreshed = await refreshUserAccount()
    if (!refreshed) {
      if (options.notifySettings) setSettingsNotice('账户中心打开失败')
      return false
    }
    let opened = false
    try {
      opened = applyUserExternalActionResult(await openUserAccountCenterBridge(), 'account-center', '账号中心打开失败')
    } catch {
      setUserNotice('账号中心打开失败')
      userLoginLoading.value = false
      opened = false
    }
    if (!opened) {
      if (options.notifySettings) setSettingsNotice(userNotice.value || '账户中心打开失败')
      return false
    }
    userAccountCenterOpen.value = true
    if (options.activateUserModule) activeModule.value = 'user'
    if (options.notifySettings) setSettingsNotice(userNotice.value || '账号中心已打开')
    return true
  }

  const closeAccountCenter = () => {
    userAccountCenterOpen.value = false
  }

  const openUserLogin = async () => {
    const openUserLoginBridge = userAccountClient.openUserLogin()
    if (!openUserLoginBridge) {
      setUserNotice('登录服务不可用')
      return false
    }
    try {
      const opened = applyUserExternalActionResult(await openUserLoginBridge(), 'login', '登录服务打开失败')
      if (!opened) return false
      activeModule.value = 'user'
      userLoginTab.value = 'account'
      resetUserCodeState('login')
      return true
    } catch {
      setUserNotice('登录服务打开失败')
      userLoginLoading.value = false
      return false
    }
  }

  const setUserLoginTab = (tab: UserLoginTab) => {
    userLoginTab.value = tab
  }

  const loginUser = async (username = '', password = '') => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      setUserNotice('账号登录服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await loginUserAccountBridge({ method: 'account', username, password }))
    } catch {
      setUserNotice('账号登录失败')
      return false
    }
  }

  const logoutUser = async () => {
    userAccountCenterOpen.value = false
    resetUserCodeState('login')
    resetUserCodeState('contact')
    const logoutUserAccountBridge = userAccountClient.logoutUserAccount()
    if (!logoutUserAccountBridge) {
      setUserNotice('登出服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await logoutUserAccountBridge())
    } catch {
      setUserNotice('登出失败')
      return false
    }
  }

  const deactivateUserAccount = async () => {
    const confirmation = privacySettings.value.deactivateConfirmationInput.trim()
    if (confirmation !== 'DEACTIVATE') {
      setSettingsNotice('请输入 DEACTIVATE 以确认停用账户')
      return false
    }
    const deactivateUserAccountBridge = userAccountClient.deactivateUserAccount()
    if (!deactivateUserAccountBridge) {
      setSettingsNotice('账户停用服务不可用')
      setUserNotice('账户停用服务不可用')
      return false
    }
    const uid = Number(userProfile.value.uid)
    if (!Number.isFinite(uid) || uid <= 0) {
      setSettingsNotice('无法确定当前用户账号')
      setUserNotice('无法确定当前用户账号')
      return false
    }
    privacySettings.value = {
      ...privacySettings.value,
      deactivateLoading: true
    }
    try {
      const ok = applyUserMutationResult(await deactivateUserAccountBridge({ uid }))
      if (!ok) {
        setSettingsNotice(userNotice.value || '账户停用失败')
        return false
      }
      resetUserCodeState('login')
      resetUserCodeState('contact')
      userAccountCenterOpen.value = false
      privacySettings.value = {
        ...privacySettings.value,
        deactivateModalOpen: false,
        deactivateConfirmationInput: '',
        deactivateLoading: false
      }
      setSettingsNotice('账号已停用')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : '账户停用失败'
      setSettingsNotice(message)
      setUserNotice(message)
      return false
    } finally {
      privacySettings.value = {
        ...privacySettings.value,
        deactivateLoading: false
      }
    }
  }

  const skipUserLogin = async () => {
    const skipUserLoginBridge = userAccountClient.skipUserLogin()
    if (!skipUserLoginBridge) {
      setUserNotice('跳过登录服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await skipUserLoginBridge())
    } catch {
      setUserNotice('跳过登录失败')
      return false
    }
  }

  const sendUserLoginCode = async (kind: 'email' | 'mobile', value: string) => {
    if (userLoginCodeCountdown.value[kind] > 0 || userLoginCodeSending.value[kind]) return false
    const sendUserLoginCodeBridge = userAccountClient.sendUserLoginCode()
    if (!sendUserLoginCodeBridge) {
      setUserNotice('登录验证码发送服务不可用')
      return false
    }
    userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: true }
    try {
      const result = await sendUserLoginCodeBridge({ kind, value })
      if (!result?.ok || !result.data) {
        userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: false }
        setUserNotice(result?.errorMessage || '验证码发送失败')
        return false
      }
      if (!isUserCodeDataForRequest(result.data, kind, value) || !isValidUserCodeCooldown(result.data)) {
        rejectInvalidUserCodeCooldown('login', kind)
        return false
      }
      startUserCountdown('login', kind, result.data)
      return true
    } catch {
      userLoginCodeSending.value = { ...userLoginCodeSending.value, [kind]: false }
      setUserNotice('登录验证码发送失败')
      return false
    }
  }

  const loginWithAccount = async (username: string, password: string) => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      userLoginLoading.value = false
      setUserNotice('账号登录服务不可用')
      return false
    }
    userLoginLoading.value = true
    try {
      return applyUserMutationResult(await loginUserAccountBridge({ method: 'account', username, password }))
    } catch {
      userLoginLoading.value = false
      setUserNotice('账号登录失败')
      return false
    }
  }

  const loginWithEmail = async (email: string, code: string) => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      userLoginLoading.value = false
      setUserNotice('邮箱登录服务不可用')
      return false
    }
    userLoginLoading.value = true
    try {
      const ok = applyUserMutationResult(await loginUserAccountBridge({ method: 'email', email, code }))
      if (ok) resetUserCodeState('login', 'email')
      return ok
    } catch {
      userLoginLoading.value = false
      setUserNotice('邮箱登录失败')
      return false
    }
  }

  const loginWithMobile = async (mobile: string, code: string) => {
    const loginUserAccountBridge = userAccountClient.loginUserAccount()
    if (!loginUserAccountBridge) {
      userLoginLoading.value = false
      setUserNotice('手机号登录服务不可用')
      return false
    }
    userLoginLoading.value = true
    try {
      const ok = applyUserMutationResult(await loginUserAccountBridge({ method: 'mobile', mobile, code }))
      if (ok) resetUserCodeState('login', 'mobile')
      return ok
    } catch {
      userLoginLoading.value = false
      setUserNotice('手机号登录失败')
      return false
    }
  }

  const updateUserProfile = async (
    patch: Partial<Pick<AiopsUserProfile, 'name' | 'username' | 'avatarInitials' | 'avatarImageUrl'>>
  ) => {
    const updateUserProfileBridge = userAccountClient.updateUserProfile()
    if (!updateUserProfileBridge) {
      setUserNotice('用户资料保存服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await updateUserProfileBridge(patch))
    } catch {
      setUserNotice('用户资料保存失败')
      return false
    }
  }

  const resetUserPassword = async (password = '') => {
    const resetUserPasswordBridge = userAccountClient.resetUserPassword()
    if (!resetUserPasswordBridge) {
      setUserNotice('密码重置服务不可用')
      return false
    }
    try {
      return applyUserMutationResult(await resetUserPasswordBridge({ password }))
    } catch {
      setUserNotice('密码重置失败')
      return false
    }
  }

  const sendUserContactCode = async (kind: 'email' | 'mobile', value: string) => {
    if (userContactCodeCountdown.value[kind] > 0 || userContactCodeSending.value[kind]) return false
    const sendUserContactCodeBridge = userAccountClient.sendUserContactCode()
    if (!sendUserContactCodeBridge) {
      setUserNotice('联系方式验证码发送服务不可用')
      return false
    }
    userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: true }
    try {
      const result = await sendUserContactCodeBridge({ kind, value })
      if (!result?.ok || !result.data) {
        userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: false }
        setUserNotice(result?.errorMessage || '验证码发送失败')
        return false
      }
      if (!isUserCodeDataForRequest(result.data, kind, value) || !isValidUserCodeCooldown(result.data)) {
        rejectInvalidUserCodeCooldown('contact', kind)
        return false
      }
      startUserCountdown('contact', kind, result.data)
      return true
    } catch {
      userContactCodeSending.value = { ...userContactCodeSending.value, [kind]: false }
      setUserNotice('联系方式验证码发送失败')
      return false
    }
  }

  const bindUserContact = async (kind: 'email' | 'mobile', value: string, code = '') => {
    const bindUserContactBridge = userAccountClient.bindUserContact()
    if (!bindUserContactBridge) {
      setUserNotice('联系方式绑定服务不可用')
      return false
    }
    try {
      const ok = applyUserMutationResult(await bindUserContactBridge({ kind, value, code }))
      if (ok) resetUserCodeState('contact', kind)
      return ok
    } catch {
      setUserNotice('联系方式绑定失败')
      return false
    }
  }

  const prepareUserAvatarImage = async (filePath: string) => {
    const prepareUserAvatarImageBridge = userAccountClient.prepareUserAvatarImage()
    if (!prepareUserAvatarImageBridge) {
      setUserNotice('头像读取服务不可用')
      return null
    }
    try {
      const result = await prepareUserAvatarImageBridge({ filePath })
      if (!result?.ok || !result.data) {
        setUserNotice(result?.errorMessage || '头像图片读取失败')
        return null
      }
      if (!isUserAvatarPrepareData(result.data)) {
        setUserNotice('头像后端返回了无效结果')
        return null
      }
      setUserNotice(result.data.message || '头像图片已读取')
      return result.data
    } catch (error) {
      setUserNotice(`头像图片读取失败：${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  let removeAppUpdateProgressListener: (() => void) | null = null

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

  const setTopNotice = (message: string) => {
    topNotice.value = message
    if (!message) return
    window.setTimeout(() => {
      if (topNotice.value === message) topNotice.value = ''
    }, 2400)
  }

  const attentionPriority = (kind: AiAttentionKind) => {
    if (kind === 'approval') return 100
    if (kind === 'question') return 90
    if (kind === 'plan') return 80
    if (kind === 'error') return 70
    return 40
  }

  const pendingAiAttentionItems = computed(() =>
    [...aiAttentionItems.value]
      .filter((item) => !item.handledAt)
      .sort((first, second) => {
        if (second.priority !== first.priority) return second.priority - first.priority
        return first.createdAt - second.createdAt
      })
  )
  const aiAttentionUnreadCount = computed(() => pendingAiAttentionItems.value.length)
  const currentAiAttentionItem = computed(() => pendingAiAttentionItems.value[0] || null)

  const upsertAiAttentionItem = (input: AiAttentionInput) => {
    const title = input.title.trim()
    const summary = input.summary.trim()
    const existing = aiAttentionItems.value.find((item) => item.id === input.id)
    const handledAt = 'handledAt' in input ? input.handledAt : undefined
    const next: AiAttentionItem = {
      id: input.id,
      source: input.source,
      kind: input.kind,
      title: title || input.source,
      summary,
      priority: input.priority ?? attentionPriority(input.kind),
      createdAt: input.createdAt ?? existing?.createdAt ?? Date.now(),
      ...(handledAt ? { handledAt } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
      ...(input.notificationId ? { notificationId: input.notificationId } : {})
    }
    aiAttentionItems.value = existing ? aiAttentionItems.value.map((item) => (item.id === input.id ? next : item)) : [next, ...aiAttentionItems.value]
    return next
  }

  const removeAiAttentionItem = (id: string) => {
    const before = aiAttentionItems.value.length
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => item.id !== id)
    return aiAttentionItems.value.length !== before
  }

  const markAiAttentionHandled = (id: string) => {
    let changed = false
    aiAttentionItems.value = aiAttentionItems.value.map((item) => {
      if (item.id !== id || item.handledAt) return item
      changed = true
      return { ...item, handledAt: Date.now() }
    })
    return changed
  }

  const clearAiAttentionForConversation = (conversationId: string) => {
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => item.conversationId !== conversationId)
  }

  const controlNotificationAttentionId = (notification: Pick<ControlNotificationRecord, 'id'>) => `notification:${notification.id}`

  const refreshControlNotificationAttentionItems = () => {
    const notificationIds = new Set(controlNotifications.value.map(controlNotificationAttentionId))
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => !item.id.startsWith('notification:') || notificationIds.has(item.id))
    if (!notificationSettings.value.controlNotificationBell) {
      controlNotifications.value.forEach((notification) => removeAiAttentionItem(controlNotificationAttentionId(notification)))
      return
    }
    controlNotifications.value.forEach((notification) => {
      const id = controlNotificationAttentionId(notification)
      if (!notification.read) {
        upsertAiAttentionItem({
          id,
          source: 'control-notification',
          kind: notification.level === 'approval' ? 'approval' : notification.level === 'error' || notification.level === 'warning' ? 'error' : 'done',
          title: notification.source ? `${notification.source}: ${notification.title}` : notification.title,
          summary: [notification.group, notification.level && notification.level !== 'info' ? notification.level : '', notification.subtitle, notification.body].filter(Boolean).join(' · '),
          sessionId: notification.sessionId || notification.terminalSessionId,
          surfaceId: notification.panelId || notification.sessionId || notification.terminalSessionId,
          notificationId: notification.id,
          createdAt: notification.createdAt,
          priority: notification.level === 'approval' || notification.level === 'error' ? 60 : notification.level === 'warning' ? 45 : 30
        })
      } else {
        removeAiAttentionItem(id)
      }
    })
  }

  const applyControlNotificationSnapshot = (notifications: ControlNotificationRecord[] = []) => {
    controlNotifications.value = notifications.map((notification) => ({ ...notification }))
    refreshControlNotificationAttentionItems()
  }

  const focusControlNotification = (request: ControlNotificationFocusRequest | ControlNotificationRecord) => {
    const notification = 'notification' in request ? request.notification : request
    const panelId = 'panelId' in request && request.panelId ? request.panelId : notification.panelId
    const sessionId = 'sessionId' in request && request.sessionId ? request.sessionId : notification.sessionId || notification.terminalSessionId
    const target = panels.value.find((panel) => panel.kind !== 'knowledge' && (panel.id === panelId || panel.sessionId === sessionId))
    if (!target) {
      setTopNotice(`通知已打开：${notification.title}`)
      return false
    }
    mode.value = 'terminal'
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    markAiAttentionHandled(controlNotificationAttentionId(notification))
    setTopNotice(`已定位通知：${notification.title}`)
    return true
  }

  const openControlNotification = async (notificationId: string) => {
    const bridge = controlClient.invokeControlRequest()
    if (!bridge) {
      const notification = controlNotifications.value.find((item) => item.id === notificationId)
      if (notification) return focusControlNotification(notification)
      return false
    }
    try {
      const result = await bridge('notification.open', { id: notificationId })
      if (!result?.ok) {
        setTopNotice(result?.errorMessage || '通知打开失败')
        return false
      }
      const data = result.data || {}
      if (Array.isArray(data.notifications)) applyControlNotificationSnapshot(data.notifications as ControlNotificationRecord[])
      const focusRequest = data.focusRequest as ControlNotificationFocusRequest | undefined
      if (focusRequest?.notification) focusControlNotification(focusRequest)
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : '通知打开失败')
      return false
    }
  }

  const aiSessionAttentionId = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `managed-ai:${session.source}:${session.id}`

  const managedAiSessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

  const managedAiSessionNeedsInputForEvent = (event: AiAgentSessionEvent) => {
    const requestKind = managedAiRequestKindForEvent(event)
    const decisionMode = managedAiDecisionModeForEvent(event)
    if (event.source === 'codex' && event.event === 'permission_request') return false
    if (requestKind === 'telemetry') return false
    if (decisionMode === 'blocking') return true
    if (requestKind === 'notification') return true
    return event.actionable === true
  }

  const managedAiSessionStateForEvent = (event: AiAgentSessionEvent, previous: ManagedAiSessionState = 'unknown'): ManagedAiSessionState => {
    const lifecycle = event.agentLifecycle
    if (lifecycle === 'running') return 'working'
    if (lifecycle === 'idle') return 'idle'
    if (lifecycle === 'needsInput') return 'needsInput'
    if (lifecycle === 'ended') return 'ended'
    if (lifecycle === 'unknown') return 'unknown'
    if (event.event === 'session_start') return 'idle'
    if (event.event === 'prompt_submit' || event.event === 'pre_tool_use') return 'working'
    if (event.event === 'permission_request' || event.event === 'question' || event.event === 'notification') return managedAiSessionNeedsInputForEvent(event) ? 'needsInput' : 'working'
    if (event.event === 'stop') return 'idle'
    if (event.event === 'session_end') return 'ended'
    return previous
  }

  const managedAiRequestKindForEvent = (event: AiAgentSessionEvent): ManagedAiSession['requestKind'] => {
    if (event.requestKind) return event.requestKind
    if (event.event === 'permission_request') return 'permission'
    if (event.event === 'question') return 'question'
    if (event.event === 'notification') return 'notification'
    return 'telemetry'
  }

  const managedAiDecisionModeForEvent = (event: AiAgentSessionEvent): ManagedAiSession['decisionMode'] => {
    if (event.decisionMode) return event.decisionMode
    if (event.actionable === true) return 'local'
    return managedAiRequestKindForEvent(event) === 'telemetry' ? 'telemetry' : 'local'
  }

  const managedAiAttentionKindForSession = (session: Pick<ManagedAiSession, 'requestKind' | 'lastEvent'>): AiAttentionKind => {
    if (session.requestKind === 'plan') return 'plan'
    if (session.requestKind === 'permission' || session.lastEvent === 'permission_request') return 'approval'
    if (session.requestKind === 'notification') return 'done'
    return 'question'
  }

  const sortedManagedAiSessions = computed(() => [...managedAiSessions.value].sort((first, second) => second.lastActivityAt - first.lastActivityAt))
  const managedAiNeedsInputSessions = computed(() => sortedManagedAiSessions.value.filter((session) => session.state === 'needsInput'))
  const selectedManagedAiSession = computed(() => sortedManagedAiSessions.value.find((session) => managedAiSessionKey(session) === selectedManagedAiSessionKey.value) || null)
  const managedAiAttentionPanelIds = computed(() => {
    const ids = new Set<string>()
    managedAiNeedsInputSessions.value.forEach((session) => {
      if (session.panelId) ids.add(session.panelId)
      if (session.terminalSessionId) ids.add(session.terminalSessionId)
    })
    return ids
  })

  const refreshManagedAiAttentionItems = () => {
    const managedIds = new Set(managedAiSessions.value.map(aiSessionAttentionId))
    aiAttentionItems.value = aiAttentionItems.value.filter((item) => !item.id.startsWith('managed-ai:') || managedIds.has(item.id))
    managedAiSessions.value.forEach((session) => {
      const id = aiSessionAttentionId(session)
      if (session.state === 'needsInput') {
        upsertAiAttentionItem({
          id,
          source: session.source,
          kind: managedAiAttentionKindForSession(session),
          title: session.title,
          summary: session.summary,
          sessionId: session.id,
          surfaceId: session.panelId || session.terminalSessionId,
          createdAt: session.lastActivityAt,
          ...(session.handledAt ? { handledAt: session.handledAt } : {})
        })
      } else {
        removeAiAttentionItem(id)
      }
    })
  }

  const applyManagedAiSessionSnapshot = (snapshot: ManagedAiSessionSnapshot) => {
    managedAiSessions.value = snapshot.sessions.map((session) => ({
      ...session,
      requestKind: session.requestKind || (session.lastEvent === 'permission_request' ? 'permission' : session.lastEvent === 'question' ? 'question' : session.lastEvent === 'notification' ? 'notification' : 'telemetry'),
      decisionMode: session.decisionMode || (session.actionable === true ? 'local' : 'telemetry'),
      events: session.events.map((event) => {
        const requestKind = event.requestKind || (event.event === 'permission_request' ? 'permission' : event.event === 'question' ? 'question' : event.event === 'notification' ? 'notification' : 'telemetry')
        return {
          ...event,
          requestKind,
          decisionMode: event.decisionMode || (event.actionable === true ? 'local' : requestKind === 'telemetry' ? 'telemetry' : 'local'),
          raw: event.raw ? { ...event.raw } : undefined
        }
      }),
      decisions: session.decisions.map((decision) => ({ ...decision }))
    }))
    managedAiSessionsError.value = ''
    if (selectedManagedAiSessionKey.value && !managedAiSessions.value.some((session) => managedAiSessionKey(session) === selectedManagedAiSessionKey.value)) {
      selectedManagedAiSessionKey.value = ''
    }
    refreshManagedAiAttentionItems()
  }

  const refreshManagedAiSessions = async (options: { silent?: boolean } = {}) => {
    const listManagedAiSessions = managedAiClient.listManagedAiSessions()
    if (!listManagedAiSessions) {
      managedAiSessionsError.value = i18nText('aiSessions.notice.serviceUnavailable')
      if (!options.silent) setTopNotice(managedAiSessionsError.value)
      return false
    }
    managedAiSessionsLoading.value = true
    try {
      const result = (await listManagedAiSessions()) as ManagedAiSessionListResult
      if (!result?.ok || !isManagedAiSessionSnapshot(result.data)) {
        managedAiSessionsError.value = result?.errorMessage || i18nText('aiSessions.notice.listFailed')
        if (!options.silent) setTopNotice(managedAiSessionsError.value)
        return false
      }
      applyManagedAiSessionSnapshot(result.data)
      if (!options.silent) setTopNotice(i18nText('aiSessions.notice.refreshed'))
      return true
    } catch (error) {
      managedAiSessionsError.value = error instanceof Error ? error.message : i18nText('aiSessions.notice.listFailed')
      if (!options.silent) setTopNotice(managedAiSessionsError.value)
      return false
    } finally {
      managedAiSessionsLoading.value = false
    }
  }

  let managedAiSessionRefreshQueued = false
  const refreshManagedAiSessionsDebounced = () => {
    if (managedAiSessionRefreshQueued) return
    managedAiSessionRefreshQueued = true
    queueMicrotask(() => {
      managedAiSessionRefreshQueued = false
      void refreshManagedAiSessions({ silent: true })
    })
  }

  const upsertManagedAiSession = (event: AiAgentSessionEvent) => {
    const existing = managedAiSessions.value.find((session) => session.source === event.source && session.id === event.sessionId)
    const now = Date.now()
    const requestKind = managedAiRequestKindForEvent(event)
    const decisionMode = event.decisionMode || (event.actionable === true ? 'local' : requestKind === 'telemetry' ? 'telemetry' : 'local')
    const timelineEvent: ManagedAiSessionTimelineEvent = {
      ...event,
      requestKind,
      decisionMode,
      id: `${event.receivedAt}-${event.event}`
    }
    const next: ManagedAiSession = {
      id: event.sessionId,
      source: event.source,
      title: existing?.userTitle || existing?.title || event.title || event.source,
      summary: event.summary || existing?.summary || '',
      state: managedAiSessionStateForEvent(event, existing?.state),
      lastEvent: event.event,
      lastActivityAt: event.receivedAt,
      createdAt: existing?.createdAt || event.receivedAt,
      updatedAt: now,
      ...(existing?.autoTitle ? { autoTitle: existing.autoTitle } : {}),
      ...(existing?.userTitle ? { userTitle: existing.userTitle } : {}),
      events: [...(existing?.events || []), timelineEvent].slice(-200),
      decisions: [...(existing?.decisions || [])],
      ...(event.panelId || existing?.panelId ? { panelId: event.panelId || existing?.panelId } : {}),
      ...(event.terminalSessionId || existing?.terminalSessionId ? { terminalSessionId: event.terminalSessionId || existing?.terminalSessionId } : {}),
      ...(event.workspaceId || existing?.workspaceId ? { workspaceId: event.workspaceId || existing?.workspaceId } : {}),
      ...(event.cwd || existing?.cwd ? { cwd: event.cwd || existing?.cwd } : {}),
      ...(event.transcriptPath || existing?.transcriptPath ? { transcriptPath: event.transcriptPath || existing?.transcriptPath } : {}),
      ...(event.requestId && event.actionable ? { pendingRequestId: event.requestId } : {}),
      requestKind,
      decisionMode,
      ...(event.waitTimeoutMs || existing?.waitTimeoutMs ? { waitTimeoutMs: event.waitTimeoutMs || existing?.waitTimeoutMs } : {}),
      ...(event.toolName || existing?.toolName ? { toolName: event.toolName || existing?.toolName } : {}),
      ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {}),
      ...(event.launchCommand || existing?.launchCommand ? { launchCommand: event.launchCommand || existing?.launchCommand } : {}),
      ...(event.resumeCommand || existing?.resumeCommand ? { resumeCommand: event.resumeCommand || existing?.resumeCommand } : {}),
      ...(event.processId || existing?.processId ? { processId: event.processId || existing?.processId } : {}),
      ...(event.parentProcessId || existing?.parentProcessId ? { parentProcessId: event.parentProcessId || existing?.parentProcessId } : {}),
      ...(event.processGroupId || existing?.processGroupId ? { processGroupId: event.processGroupId || existing?.processGroupId } : {}),
      ...(event.agentLifecycle || existing?.agentLifecycle ? { agentLifecycle: event.agentLifecycle || existing?.agentLifecycle } : {}),
      ...(typeof event.terminalProcessId === 'number'
        ? { terminalProcessId: event.terminalProcessId }
        : typeof existing?.terminalProcessId === 'number'
          ? { terminalProcessId: existing.terminalProcessId }
          : {}),
      ...(typeof event.terminalActivityAt === 'number'
        ? { terminalActivityAt: event.terminalActivityAt }
        : typeof existing?.terminalActivityAt === 'number'
          ? { terminalActivityAt: existing.terminalActivityAt }
          : {})
    }
    managedAiSessions.value = existing
      ? managedAiSessions.value.map((session) => (session.source === next.source && session.id === next.id ? next : session))
      : [next, ...managedAiSessions.value]

    refreshManagedAiAttentionItems()
    return next
  }

  const markManagedAiSessionHandled = (source: AiAgentSessionSource, sessionId: string) => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) return false
    const changed = markAiAttentionHandled(aiSessionAttentionId(session))
    const now = Date.now()
    if (session.state === 'needsInput') session.state = 'idle'
    session.handledAt = now
    session.updatedAt = now
    session.decisions = [...session.decisions, { id: `${now}-handled`, kind: 'handled', createdAt: now }]
    if (selectedManagedAiSessionKey.value === managedAiSessionKey(session)) selectedManagedAiSessionKey.value = ''
    const replyManagedAiSessionBridge = managedAiClient.replyManagedAiSession()
    if (replyManagedAiSessionBridge) {
      void replyManagedAiSessionBridge({ source, sessionId, kind: 'handled' }).then((result: ManagedAiSessionMutationResult) => {
        if (result?.ok && isManagedAiSessionMutationData(result.data)) applyManagedAiSessionSnapshot(result.data.snapshot)
      })
    }
    return changed
  }

  const replyManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, kind: ManagedAiSessionDecision['kind'], message?: string) => {
    const replyManagedAiSessionBridge = managedAiClient.replyManagedAiSession()
    if (!replyManagedAiSessionBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await replyManagedAiSessionBridge({ source, sessionId, kind, message })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.processFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(
        kind === 'allow'
          ? i18nText('aiSessions.notice.allowed')
          : kind === 'always'
            ? i18nText('aiSessions.notice.alwaysAllowed')
            : kind === 'bypass'
              ? i18nText('aiSessions.notice.bypassAllowed')
              : kind === 'deny'
                ? i18nText('aiSessions.notice.denied')
                : kind === 'reply'
                  ? i18nText('aiSessions.notice.replied')
                  : i18nText('aiSessions.notice.handled')
      )
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.processFailed'))
      return false
    }
  }

  const renameManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, title: string) => {
    const renameManagedAiSessionBridge = managedAiClient.renameManagedAiSession()
    if (!renameManagedAiSessionBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await renameManagedAiSessionBridge({ source, sessionId, title })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.renameFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(i18nText('aiSessions.notice.renamed'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.renameFailed'))
      return false
    }
  }

  const clearManagedAiSession = async (source: AiAgentSessionSource, sessionId: string) => {
    const clearManagedAiSessionBridge = managedAiClient.clearManagedAiSession()
    if (!clearManagedAiSessionBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await clearManagedAiSessionBridge({ source, sessionId })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.clearFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(i18nText('aiSessions.notice.cleared'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.clearFailed'))
      return false
    }
  }

  const bulkManagedAiSessions = async (input: ManagedAiSessionBulkInput) => {
    const bulkManagedAiSessionsBridge = managedAiClient.bulkManagedAiSessions()
    if (!bulkManagedAiSessionsBridge) {
      setTopNotice(i18nText('aiSessions.notice.serviceUnavailable'))
      return false
    }
    try {
      const result = (await bulkManagedAiSessionsBridge(input)) as ManagedAiSessionBulkResult
      if (!result?.ok || !isManagedAiSessionBulkData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.bulkFailed'))
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(i18nText('aiSessions.visibleHandled', { count: result.data.changed }))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('aiSessions.notice.bulkFailed'))
      return false
    }
  }

  const refreshAgentHibernationConfig = async () => {
    const getAgentHibernationConfig = managedAiClient.getAgentHibernationConfig()
    if (!getAgentHibernationConfig) return false
    try {
      const result = (await getAgentHibernationConfig()) as AgentHibernationConfigResult
      if (!result?.ok || !isAgentHibernationConfigData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('settings.ai.hibernation.loadFailed'))
        return false
      }
      agentHibernationConfig.value = { ...result.data.config }
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('settings.ai.hibernation.loadFailed'))
      return false
    }
  }

  const updateAgentHibernationConfig = async (patch: Partial<AgentHibernationConfig>) => {
    const setAgentHibernationConfig = managedAiClient.setAgentHibernationConfig()
    if (!setAgentHibernationConfig) {
      setTopNotice(i18nText('settings.ai.hibernation.serviceUnavailable'))
      return false
    }
    const nextConfig = { ...agentHibernationConfig.value, ...patch }
    try {
      const result = (await setAgentHibernationConfig(nextConfig)) as AgentHibernationConfigResult
      if (!result?.ok || !isAgentHibernationConfigData(result.data)) {
        setTopNotice(result?.errorMessage || i18nText('settings.ai.hibernation.saveFailed'))
        return false
      }
      agentHibernationConfig.value = { ...result.data.config }
      setTopNotice(i18nText('settings.ai.hibernation.saved'))
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : i18nText('settings.ai.hibernation.saveFailed'))
      return false
    }
  }

  const setAgentHibernationEnabled = async (enabled: boolean) => {
    const saved = await updateAgentHibernationConfig({ enabled })
    if (saved) setTopNotice(enabled ? i18nText('settings.ai.hibernation.enabledNotice') : i18nText('settings.ai.hibernation.disabledNotice'))
    return saved
  }

  const hibernateManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, reason = 'manual') => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) {
      setTopNotice(i18nText('aiSessions.notice.missing'))
      return false
    }
    if (!agentHibernationConfig.value.enabled) {
      setTopNotice(i18nText('aiSessions.notice.hibernationDisabled'))
      return false
    }
    if (session.state === 'needsInput' || session.agentLifecycle === 'needsInput') {
      setTopNotice(i18nText('aiSessions.notice.cannotHibernateNeedsInput'))
      return false
    }
    if (!session.resumeCommand?.trim()) {
      setTopNotice(i18nText('aiSessions.notice.noResumeCommand'))
      return false
    }
    const targetId = session.panelId || session.terminalSessionId
    const panel = targetId ? panels.value.find((item) => item.id === targetId || item.sessionId === targetId) : null
    const terminalSessionId = panel?.sessionId || session.terminalSessionId
    const killTerminal = terminalClient.killTerminal()
    if (terminalSessionId && killTerminal) {
      const killResult = await killTerminal(terminalSessionId)
      if (!killResult?.ok) {
        setTopNotice(killResult?.errorMessage || i18nText('aiSessions.notice.hibernateFailed'))
        return false
      }
      if (panel?.sessionId === terminalSessionId) {
        panel.sessionId = undefined
        panel.status = 'closed'
      }
    }
    const hibernateManagedAiSessionBridge = managedAiClient.hibernateManagedAiSession()
    if (!hibernateManagedAiSessionBridge) {
      setTopNotice(i18nText('settings.ai.hibernation.serviceUnavailable'))
      return false
    }
    const result = (await hibernateManagedAiSessionBridge({ source, sessionId, reason, terminalSessionId })) as ManagedAiSessionHibernateResult
    if (!result?.ok || !isManagedAiSessionHibernateData(result.data)) {
      setTopNotice(result?.errorMessage || i18nText('aiSessions.notice.hibernateFailed'))
      return false
    }
    agentHibernationConfig.value = { ...result.data.config }
    applyManagedAiSessionSnapshot(result.data.snapshot)
    setTopNotice(i18nText('aiSessions.notice.hibernated'))
    return true
  }

  const managedAiSessionNeedsAttentionForPanel = (panelIdOrSessionId: string) => managedAiAttentionPanelIds.value.has(panelIdOrSessionId)

  const focusManagedAiSession = (sessionIdOrPanelId: string) => {
    const session = managedAiSessions.value.find(
      (item) => item.id === sessionIdOrPanelId || item.panelId === sessionIdOrPanelId || item.terminalSessionId === sessionIdOrPanelId
    )
    if (!session) return null
    mode.value = 'terminal'
    selectedManagedAiSessionKey.value = managedAiSessionKey(session)
    const targetId = session.panelId || session.terminalSessionId
    if (targetId) activateTerminalPanelForManagedAiSession(targetId)
    managedAiSessionFocusRequest.value = {
      sequence: managedAiSessionFocusRequest.value.sequence + 1,
      session
    }
    return session
  }

  const findManagedAiSessionForFocusRequest = (request: ManagedAiSessionFocusRequest) =>
    managedAiSessions.value.find((item) => {
      if (request.source && item.source !== request.source) return false
      if (request.sessionId && item.id === request.sessionId) return true
      if (request.panelId && item.panelId === request.panelId) return true
      if (request.terminalSessionId && item.terminalSessionId === request.terminalSessionId) return true
      return false
    })

  const focusManagedAiSessionRequest = async (request: ManagedAiSessionFocusRequest) => {
    let session = findManagedAiSessionForFocusRequest(request)
    if (!session) {
      await refreshManagedAiSessions({ silent: true })
      session = findManagedAiSessionForFocusRequest(request)
    }
    if (!session) return null
    const focused = focusManagedAiSession(session.id)
    activeModule.value = 'aiSessions'
    leftPanelOpen.value = true
    return focused
  }

  const resumeManagedAiSession = async (source: AiAgentSessionSource, sessionId: string) => {
    const session = managedAiSessions.value.find((item) => item.source === source && item.id === sessionId)
    if (!session) {
      setTopNotice(i18nText('aiSessions.notice.missing'))
      return false
    }
    const command = session.resumeCommand?.trim()
    if (!command) {
      setTopNotice(i18nText('aiSessions.notice.noResumeCommand'))
      return false
    }
    const focused = focusManagedAiSession(session.id)
    const targetId = focused?.panelId || focused?.terminalSessionId || session.panelId || session.terminalSessionId
    const panel = targetId ? panels.value.find((item) => item.id === targetId || item.sessionId === targetId) : null
    if (!panel?.sessionId) {
      setTopNotice(i18nText('aiSessions.notice.resumeNeedsTerminal'))
      return false
    }
    const decision = await runTerminalCommand(panel.id, command, { source: 'agent', writeToShell: true })
    if (decision.status === 'allow') {
      const wakeManagedAiSession = managedAiClient.wakeManagedAiSession()
      if (session.hibernated && wakeManagedAiSession) {
        const result = (await wakeManagedAiSession({ source, sessionId, reason: 'resume' })) as ManagedAiSessionHibernateResult
        if (result?.ok && isManagedAiSessionHibernateData(result.data)) {
          agentHibernationConfig.value = { ...result.data.config }
          applyManagedAiSessionSnapshot(result.data.snapshot)
        }
      }
      setTopNotice(i18nText('aiSessions.notice.resumeCommandWritten'))
      return true
    }
    if (decision.status === 'needs-approval') {
      setTopNotice(i18nText('aiSessions.notice.resumeCommandNeedsApproval'))
      return false
    }
    return false
  }

  const jumpToNextAiAttention = () => {
    const item = currentAiAttentionItem.value
    if (!item) {
      mode.value = 'terminal'
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
      setTopNotice(i18nText('aiSessions.notice.noPendingMessages'))
      return null
    }
    const managedSession = item.id.startsWith('managed-ai:') && item.sessionId ? focusManagedAiSession(item.sessionId) : null
    if (managedSession) {
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
    } else if (item.notificationId) {
      void openControlNotification(item.notificationId)
    } else if (item.surfaceId === 'terminal-ai-panel') {
      mode.value = 'terminal'
      activeModule.value = 'workspace'
      rightPanelOpen.value = true
    } else {
      mode.value = 'agents'
      agentsLeftOpen.value = true
    }
    aiAttentionFocusRequest.value = {
      sequence: aiAttentionFocusRequest.value.sequence + 1,
      item
    }
    return item
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
        return openAccountCenter({ activateUserModule: true, notifySettings: true })
      }
      setSettingsNotice(`${label}服务不可用`)
      return false
    } catch {
      setSettingsNotice(`${label} 打开失败`)
      return false
    }
  }

  const openMcpConfigEditor = async () => {
    if (keywordHighlightEditorOpen.value) {
      closeKeywordHighlightEditor()
    }
    if (securityConfigEditorOpen.value) {
      closeSecurityConfigEditor()
    }
    const requestId = ++mcpConfigLoadRequest
    mcpConfigEditorOpen.value = true
    mcpConfigEditorContent.value = ''
    mcpConfigEditorError.value = ''
    mcpConfigEditorLastSaved.value = false
    installMcpConfigFileListener()
    const getMcpConfigPath = mcpClient.getMcpConfigPath()
    const readMcpConfig = mcpClient.readMcpConfig()
    if (!getMcpConfigPath || !readMcpConfig) {
      mcpConfigEditorError.value = 'Failed to read MCP config: MCP 配置读取服务不可用'
      setSettingsNotice('MCP 配置读取服务不可用')
      return
    }
    try {
      const [bridgeSnapshot, path, content] = await Promise.all([readMcpServersSnapshotFromBridge(), getMcpConfigPath(), readMcpConfig()])
      if (requestId !== mcpConfigLoadRequest) return
      mcpConfigPath.value = path
      applyMcpConfigFileContent(content, false, bridgeSnapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Failed to read MCP config: ${message}`
    }
  }

  const closeMcpConfigEditor = () => {
    mcpConfigLoadRequest += 1
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    if (removeMcpConfigFileListener) {
      removeMcpConfigFileListener()
      removeMcpConfigFileListener = null
    }
    mcpConfigEditorOpen.value = false
  }

  const updateMcpConfigEditorContent = (content: string) => {
    mcpConfigEditorContent.value = content
    mcpConfigEditorLastSaved.value = false
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    try {
      parseMcpEditorContent(content)
      mcpConfigEditorError.value = ''
      mcpConfigSaveTimer = window.setTimeout(() => {
        void saveMcpConfigEditor()
        mcpConfigSaveTimer = null
      }, 2000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
    }
  }

  const saveMcpConfigEditor = async (format = false) => {
    if (mcpConfigSaveTimer) {
      window.clearTimeout(mcpConfigSaveTimer)
      mcpConfigSaveTimer = null
    }
    let normalized: McpConfigFile
    try {
      normalized = normalizeMcpConfigFile(parseMcpEditorContent(mcpConfigEditorContent.value))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Invalid JSON: ${message}`
      return false
    }
    const content = format ? JSON.stringify(normalized, null, 2) : mcpConfigEditorContent.value
    const writeMcpConfig = mcpClient.writeMcpConfig()
    if (!writeMcpConfig) {
      mcpConfigEditorError.value = 'Save failed: MCP 配置保存服务不可用'
      mcpConfigEditorLastSaved.value = false
      setSettingsNotice('MCP 配置保存服务不可用')
      return false
    }
    try {
      const result = await writeMcpConfig(content)
      if (!applySavedMcpConfig(result, normalized)) return false
      setSettingsNotice('MCP 配置已保存')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mcpConfigEditorError.value = `Save failed: ${message}`
      mcpConfigEditorLastSaved.value = false
      return false
    }
  }

  const toggleMcpServerExpanded = (name: string) => {
    expandedMcpServerNames.value = expandedMcpServerNames.value.includes(name)
      ? expandedMcpServerNames.value.filter((item) => item !== name)
      : [...expandedMcpServerNames.value, name]
  }

  const setMcpServerTab = (name: string, tab: 'tools' | 'resources') => {
    activeMcpServerTab.value = { ...activeMcpServerTab.value, [name]: tab }
  }

  const toggleMcpServerDisabled = async (name: string) => {
    const server = mcpServers.value.find((item) => item.name === name)
    if (!server) return false
    const toggleMcpServer = mcpClient.toggleMcpServer()
    if (!toggleMcpServer) {
      setSettingsNotice('MCP 状态服务不可用')
      return false
    }
    const nextDisabled = !server.disabled
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await toggleMcpServer(name, nextDisabled)
      if (
        !applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'MCP 状态更新失败', `MCP ${name} 状态更新结果不匹配`, () =>
          mcpServerDisabledMatches(name, nextDisabled)
        )
      ) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, `MCP ${name} 状态更新后刷新失败`)
      }
      if (!mcpServerDisabledMatches(name, nextDisabled)) {
        return failMcpMutationRefresh(previousSnapshot, `MCP ${name} 状态更新后刷新结果不匹配`)
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`MCP ${name} 状态更新失败`)
      return false
    }
    setSettingsNotice(`${name} ${nextDisabled ? '已禁用' : '已启用'}`)
    return true
  }

  const deleteMcpServer = async (name: string) => {
    const deleteMcpServerBridge = mcpClient.deleteMcpServer()
    if (!deleteMcpServerBridge) {
      setSettingsNotice('MCP 删除服务不可用')
      return false
    }
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await deleteMcpServerBridge(name)
      if (
        !applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'MCP 删除失败', `${name} 删除结果不匹配`, () => mcpServerDeletedMatches(name))
      ) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, `${name} 删除后刷新失败`)
      }
      if (!mcpServerDeletedMatches(name)) {
        return failMcpMutationRefresh(previousSnapshot, `${name} 删除后刷新结果不匹配`)
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`${name} 删除失败`)
      return false
    }
    setSettingsNotice(`${name} 已删除`)
    return true
  }

  const toggleMcpTool = async (serverName: string, toolName: string) => {
    const tool = mcpServers.value.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
    if (!tool) return false
    const setMcpToolState = mcpClient.setMcpToolState()
    if (!setMcpToolState) {
      setSettingsNotice('MCP Tool 状态服务不可用')
      return false
    }
    const nextEnabled = !tool.enabled
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await setMcpToolState(serverName, toolName, nextEnabled)
      if (
        !applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'MCP Tool 状态更新失败', `${toolName} 状态更新结果不匹配`, () =>
          mcpToolEnabledMatches(serverName, toolName, nextEnabled)
        )
      ) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, `${toolName} 状态更新后刷新失败`)
      }
      if (!mcpToolEnabledMatches(serverName, toolName, nextEnabled)) {
        return failMcpMutationRefresh(previousSnapshot, `${toolName} 状态更新后刷新结果不匹配`)
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`${toolName} 状态更新失败`)
      return false
    }
    setSettingsNotice(`${toolName} ${nextEnabled ? '已启用' : '已禁用'}`)
    return true
  }

  const toggleMcpToolAutoApprove = async (serverName: string, toolName: string) => {
    const tool = mcpServers.value.find((server) => server.name === serverName)?.tools.find((item) => item.name === toolName)
    if (!tool) return false
    const setMcpToolAutoApprove = mcpClient.setMcpToolAutoApprove()
    if (!setMcpToolAutoApprove) {
      setSettingsNotice('MCP Auto Approve 服务不可用')
      return false
    }
    const nextAutoApprove = !tool.autoApprove
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await setMcpToolAutoApprove(serverName, toolName, nextAutoApprove)
      if (
        !applyMcpMutationSnapshotForRequest(result, previousSnapshot, 'Auto Approve failed', 'MCP Auto Approve 更新结果不匹配', () =>
          mcpToolAutoApproveMatches(serverName, toolName, nextAutoApprove)
        )
      ) {
        return false
      }
      const refreshed = await refreshMcpServersFromBridge()
      if (!refreshed) {
        return failMcpMutationRefresh(previousSnapshot, 'MCP Auto Approve 更新后刷新失败')
      }
      if (!mcpToolAutoApproveMatches(serverName, toolName, nextAutoApprove)) {
        mcpConfigEditorError.value = 'Auto Approve failed: MCP Auto Approve 更新后刷新结果不匹配'
        return failMcpMutationRefresh(previousSnapshot, 'MCP Auto Approve 更新后刷新结果不匹配')
      }
    } catch {
      restoreMcpServersSnapshot(previousSnapshot)
      setSettingsNotice(`${toolName} Auto Approve 更新失败`)
      return false
    }
    setSettingsNotice(`${toolName} Auto Approve ${nextAutoApprove ? '已启用' : '已关闭'}`)
    return true
  }

  const getMcpToolOperationKey = (serverName: string, toolName: string) => createMcpOperationKey('tool', serverName, toolName)

  const getMcpResourceOperationKey = (serverName: string, uri: string) => createMcpOperationKey('resource', serverName, uri)

  const getMcpToolArgumentDraft = (serverName: string, toolName: string) => mcpToolArgumentDrafts.value[getMcpToolOperationKey(serverName, toolName)] || ''

  const updateMcpToolArgumentDraft = (serverName: string, toolName: string, content: string) => {
    mcpToolArgumentDrafts.value = {
      ...mcpToolArgumentDrafts.value,
      [getMcpToolOperationKey(serverName, toolName)]: content
    }
  }

  const setMcpOperationResult = (key: string, record: McpOperationRecord) => {
    mcpOperationResults.value = {
      ...mcpOperationResults.value,
      [key]: record
    }
  }

  const restoreMcpOperationResult = (key: string, record: McpOperationRecord | undefined) => {
    const next = { ...mcpOperationResults.value }
    if (record) next[key] = record
    else delete next[key]
    mcpOperationResults.value = next
  }

  const parseMcpToolArguments = (serverName: string, toolName: string) => {
    const draft = getMcpToolArgumentDraft(serverName, toolName).trim()
    if (!draft) return { ok: true as const, arguments: {} as Record<string, unknown> }
    try {
      const parsed = JSON.parse(draft)
      if (!isRecord(parsed)) {
        return { ok: false as const, message: 'MCP Tool 参数必须是 JSON object' }
      }
      return { ok: true as const, arguments: parsed }
    } catch (error) {
      return {
        ok: false as const,
        message: `MCP Tool 参数 JSON 无效：${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  const runMcpTool = async (serverName: string, toolName: string) => {
    const key = getMcpToolOperationKey(serverName, toolName)
    const server = mcpServers.value.find((item) => item.name === serverName)
    const tool = server?.tools.find((item) => item.name === toolName)
    if (!server || !tool) return false
    if (server.disabled || server.status !== 'connected') {
      const message = server.disabled ? `MCP ${serverName} 已禁用` : `MCP ${serverName} 未连接`
      setSettingsNotice(message)
      return false
    }
    if (!tool.enabled) {
      const message = `MCP Tool ${toolName} 已禁用`
      setSettingsNotice(message)
      return false
    }
    const callMcpTool = mcpClient.callMcpTool()
    if (!callMcpTool) {
      const message = 'MCP Tool 调用服务不可用'
      setSettingsNotice(message)
      return false
    }
    const parsed = parseMcpToolArguments(serverName, toolName)
    if (!parsed.ok) {
      setSettingsNotice(parsed.message)
      return false
    }
    const previousRecord = mcpOperationResults.value[key] ? { ...mcpOperationResults.value[key] } : undefined
    setMcpOperationResult(key, { status: 'running', output: '', error: '' })
    try {
      const result = await callMcpTool(serverName, toolName, parsed.arguments)
      if (!result?.ok) {
        const message = result?.errorMessage || `${toolName} 调用失败`
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(message)
        return false
      }
      if (!isMcpToolCallResultData(result.data, serverName, toolName)) {
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(malformedMcpToolResultMessage)
        return false
      }
      setMcpOperationResult(key, {
        status: result.data.isError ? 'error' : 'success',
        output: formatMcpToolCallContent(result.data.content),
        error: result.data.isError ? formatMcpToolCallContent(result.data.content) : '',
        durationMs: result.data.durationMs,
        isError: result.data.isError
      })
      setSettingsNotice(result.data.isError ? `${toolName} 返回错误` : `${toolName} 调用完成`)
      return !result.data.isError
    } catch (error) {
      const message = error instanceof Error ? error.message : `${toolName} 调用失败`
      restoreMcpOperationResult(key, previousRecord)
      setSettingsNotice(message)
      return false
    }
  }

  const readMcpResource = async (serverName: string, uri: string) => {
    const key = getMcpResourceOperationKey(serverName, uri)
    const server = mcpServers.value.find((item) => item.name === serverName)
    const resource = server?.resources.find((item) => item.uri === uri)
    if (!server || !resource) return false
    if (server.disabled || server.status !== 'connected') {
      const message = server.disabled ? `MCP ${serverName} 已禁用` : `MCP ${serverName} 未连接`
      setSettingsNotice(message)
      return false
    }
    const readMcpResourceBridge = mcpClient.readMcpResource()
    if (!readMcpResourceBridge) {
      const message = 'MCP Resource 读取服务不可用'
      setSettingsNotice(message)
      return false
    }
    const previousRecord = mcpOperationResults.value[key] ? { ...mcpOperationResults.value[key] } : undefined
    setMcpOperationResult(key, { status: 'running', output: '', error: '' })
    try {
      const result = await readMcpResourceBridge(serverName, uri)
      if (!result?.ok) {
        const message = result?.errorMessage || `${resource.name} 读取失败`
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(message)
        return false
      }
      if (!isMcpResourceReadResultData(result.data, serverName, uri)) {
        restoreMcpOperationResult(key, previousRecord)
        setSettingsNotice(malformedMcpResourceResultMessage)
        return false
      }
      setMcpOperationResult(key, {
        status: 'success',
        output: formatMcpResourceReadContent(result.data.contents),
        error: '',
        durationMs: result.data.durationMs
      })
      setSettingsNotice(`${resource.name} 读取完成`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : `${resource.name} 读取失败`
      restoreMcpOperationResult(key, previousRecord)
      setSettingsNotice(message)
      return false
    }
  }

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

  const openTrustedDeviceRevoke = (id: number) => {
    const device = trustedDevices.value.find((item) => item.id === id)
    if (!device || device.current) return
    trustedDeviceModal.value = { open: true, id }
  }

  const confirmTrustedDeviceRevoke = async () => {
    const id = trustedDeviceModal.value.id
    if (id === null) return false
    const revokeTrustedDeviceBridge = userAccountClient.revokeTrustedDevice()
    if (!revokeTrustedDeviceBridge) {
      setSettingsNotice('可信设备移除服务不可用')
      setUserNotice('可信设备移除服务不可用')
      return false
    }
    try {
      const result = await revokeTrustedDeviceBridge(id)
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '可信设备移除失败')
        setUserNotice(result?.errorMessage || '可信设备移除失败')
        return false
      }
      if (!isTrustedDeviceRevokeData(result.data)) {
        setSettingsNotice('可信设备后端返回了无效结果')
        setUserNotice('可信设备后端返回了无效结果')
        return false
      }
      trustedDevices.value = result.data.trustedDevices.map((device) => ({ ...device }))
      trustedDeviceModal.value = { open: false, id: null }
      setSettingsNotice(result.data.message)
      setUserNotice(result.data.message)
      return true
    } catch {
      setSettingsNotice('可信设备移除失败')
      setUserNotice('可信设备移除失败')
      return false
    }
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

  const openAiSessionSettings = () => {
    mode.value = 'terminal'
    activeModule.value = 'settings'
    leftPanelOpen.value = true
    rightPanelOpen.value = false
    onboardingGuideOpen.value = false
    setActiveSettingsSection('ai')
    void refreshAgentHookInstallers({ silent: true })
    setTopNotice(i18nText('aiSessions.notice.openedSettings'))
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

  const createPanel = (split?: PanelDirection) => {
    const panel = createTerminalPanelInCollection(panels.value, {
      id: createRendererLocalId('panel'),
      activePanelId: activePanelId.value,
      split,
      splitOrder: split ? Date.now() + panels.value.length : undefined
    })
    activePanelId.value = panel.id
    return panel
  }

  const activateTerminalPanel = (panelIdOrSessionId: string) => {
    const target = panels.value.find((panel) => panel.id === panelIdOrSessionId || panel.sessionId === panelIdOrSessionId)
    if (!target || target.kind !== 'terminal') return null
    activeModule.value = 'workspace'
    activePanelId.value = target.id
    return target
  }

  const activateTerminalPanelForManagedAiSession = (panelIdOrSessionId: string) => {
    const target = panels.value.find((panel) => panel.id === panelIdOrSessionId || panel.sessionId === panelIdOrSessionId)
    if (!target || target.kind !== 'terminal') return null
    activePanelId.value = target.id
    return target
  }

  const openTerminalForAiHostContext = async (host: AiContextOption) => {
    const previousActivePanelId = activePanelId.value
    const panel = createPanel()
    const panelId = panel.id
    const label = host.assetName || host.detail || host.label || 'Terminal'
    renamePanel(panelId, label)
    replaceTerminalOutput(panelId, '')
    const discardPendingPanel = () => discardPendingTerminalPanel(panelId, previousActivePanelId)
    const createTerminal = terminalClient.createTerminal()
    if (!createTerminal) {
      discardPendingPanel()
      setTopNotice('终端启动服务不可用')
      return null
    }
    if (host.isLocalShell || host.id === 'opened-local') {
      try {
        const session = await createTerminal({
          kind: 'local',
          panelId,
          workspaceId: 'workspace',
          title: label,
          cols: 100,
          rows: 30,
          terminalType: terminalSettings.value.terminalType
        })
        const connected = applyLocalTerminalSession(panelId, session)
        if (!connected) {
          discardPendingPanel()
          setTopNotice('本地终端启动失败')
          return null
        }
        renamePanel(panelId, label)
        activeModule.value = 'workspace'
        activePanelId.value = panelId
        return connected
      } catch (error) {
        discardPendingPanel()
        setTopNotice(error instanceof Error ? error.message : '本地终端启动失败')
        return null
      }
    }
    const asset = {
      id: host.id,
      name: host.assetName || host.detail || host.label,
      title: host.assetName || host.detail || host.label,
      host: host.host || host.label,
      port: host.port,
      username: host.username
    }
    registerSshSession(panelId, asset)
    try {
      const session = await createTerminal({
        kind: 'ssh',
        assetId: host.id,
        title: label,
        cols: 100,
        rows: 30,
        terminalType: terminalSettings.value.terminalType
      })
      const connected = applySshTerminalSession(panelId, session, asset)
      if (!connected) {
        discardPendingPanel()
        setTopNotice('SSH 终端启动失败')
        return null
      }
      activeModule.value = 'workspace'
      activePanelId.value = panelId
      return panels.value.find((item) => item.id === panelId) || null
    } catch (error) {
      discardPendingPanel()
      setTopNotice(error instanceof Error ? error.message : 'SSH 终端启动失败')
      return null
    }
  }

  const hasSplitState = (panelId: string) => {
    return hasTerminalPanelSplitState(panels.value, panelId)
  }

  const unsplitPanel = (panelId = activePanelId.value) => {
    const changed = detachTerminalPanelFromSplit(panels.value, panelId)
    if (!changed) return false
    activePanelId.value = panelId
    return true
  }

  const attachPanelToSplit = (panelId: string, targetPanelId: string, direction: PanelDirection = 'right') => {
    const changed = attachTerminalPanelToSplit(panels.value, panelId, targetPanelId, direction, Date.now() + panels.value.length)
    if (!changed) return false
    activePanelId.value = panelId
    return true
  }

  const closePanel = (id = activePanelId.value) => {
    activePanelId.value = closeTerminalPanelInCollection(panels.value, id, activePanelId.value)
  }

  const discardPendingTerminalPanel = (id: string, preferredActiveId?: string) => {
    const result = discardPendingTerminalPanelInCollection(panels.value, id, activePanelId.value, preferredActiveId)
    activePanelId.value = result.activePanelId
    return result.discarded
  }

  const closeOthers = () => {
    closeOtherTerminalPanelsInCollection(panels.value, activePanelId.value)
  }

  const closeAllPanels = () => {
    activePanelId.value = resetTerminalPanelCollectionToDefault(panels.value)
  }

  const closePanels = (mode: CloseMode, id = activePanelId.value) => {
    if (mode === 'all') {
      closeAllPanels()
    } else if (mode === 'others') {
      activePanelId.value = id
      closeOthers()
    } else {
      closePanel(id)
    }
  }

  const renamePanel = (id: string, title: string, source: TerminalPanel['titleSource'] = 'user') => {
    renameTerminalPanelInCollection(panels.value, id, title, source)
  }

  const setPanelAutoTitle = (id: string, title: string, options: { panelOnlyIfMultiple?: boolean } = {}) => {
    return setTerminalPanelAutoTitleInCollection(panels.value, id, title, options)
  }

  const canForkSshPanel = (panelId: string) => {
    return canForkSshTerminalPanel(panels.value.find((item) => item.id === panelId))
  }

  const forkSshPanel = (panelId: string) => {
    const forkPanel = createForkSshTerminalPanelInCollection(panels.value, panelId, createRendererLocalId('panel'))
    if (!forkPanel) return null
    activePanelId.value = forkPanel.id
    return forkPanel
  }

  const knowledgePanelId = (relPath: string) => `kb:${relPath}`

  let knowledgeJumpTokenSeed = 0

  const createKnowledgeJumpState = (range?: { startLine?: number; endLine?: number }) => {
    if (!range?.startLine) return {}
    knowledgeJumpTokenSeed += 1
    return {
      startLine: range.startLine,
      ...(range.endLine ? { endLine: range.endLine } : {}),
      jumpToken: knowledgeJumpTokenSeed
    }
  }

  const openKnowledgeFile = (relPath: string, range?: { startLine?: number; endLine?: number }) => {
    const node = findKnowledgeNode(relPath)
    if (!node || node.type !== 'file') return null
    const existing = panels.value.find((panel) => panel.kind === 'knowledge' && panel.knowledge?.relPath === relPath)
    if (existing) {
      existing.knowledge = {
        relPath,
        isImage: isKnowledgeImagePath(relPath),
        ...createKnowledgeJumpState(range)
      }
      activePanelId.value = existing.id
      kbSelectedKeys.value = [relPath]
      return existing
    }
    const panel: TerminalPanel = {
      id: knowledgePanelId(relPath),
      title: node.title || relPath.split('/').pop() || 'KnowledgeCenter',
      cwd: getKnowledgeParent(relPath) || '@knowledgebase',
      kind: 'knowledge',
      status: 'ready',
      output: '',
      outputSegments: [],
      knowledge: {
        relPath,
        isImage: isKnowledgeImagePath(relPath),
        ...createKnowledgeJumpState(range)
      }
    }
    panels.value.push(panel)
    activePanelId.value = panel.id
    kbSelectedKeys.value = [relPath]
    return panel
  }

  const syncKnowledgePanelsAfterRename = (oldRelPath: string, newRelPath: string) => {
    panels.value.forEach((panel) => {
      if (panel.kind !== 'knowledge' || !panel.knowledge?.relPath) return
      const relPath = panel.knowledge.relPath
      if (relPath !== oldRelPath && !relPath.startsWith(`${oldRelPath}/`)) return
      const nextRelPath = relPath === oldRelPath ? newRelPath : `${newRelPath}${relPath.slice(oldRelPath.length)}`
      const oldPanelId = panel.id
      panel.id = knowledgePanelId(nextRelPath)
      panel.title = nextRelPath.split('/').pop() || nextRelPath
      panel.cwd = getKnowledgeParent(nextRelPath) || '@knowledgebase'
      panel.knowledge = {
        relPath: nextRelPath,
        isImage: isKnowledgeImagePath(nextRelPath)
      }
      if (activePanelId.value === oldPanelId) {
        activePanelId.value = panel.id
      }
    })
  }

  const closeKnowledgePanelsForRemoved = (relPaths: string[]) => {
    const shouldClose = (panel: TerminalPanel) =>
      panel.kind === 'knowledge' &&
      Boolean(panel.knowledge?.relPath) &&
      relPaths.some((relPath) => panel.knowledge!.relPath === relPath || panel.knowledge!.relPath.startsWith(`${relPath}/`))
    if (!panels.value.some(shouldClose)) return
    panels.value = panels.value.filter((panel) => !shouldClose(panel))
    if (!panels.value.length) {
      closeAllPanels()
      return
    }
    if (!panels.value.some((panel) => panel.id === activePanelId.value)) {
      activePanelId.value = panels.value[0].id
    }
  }

  const appendTerminalOutput = (id: string, data: string) => {
    const panel = appendTerminalOutputToPanelInCollection(panels.value, id, data)
    if (!panel) return
    const now = Date.now()
    managedAiSessions.value = managedAiSessions.value.map((session) =>
      session.terminalSessionId === panel.sessionId || session.panelId === panel.id ? { ...session, terminalActivityAt: now, updatedAt: now } : session
    )
  }

  const applyTerminalLifecycle = (event: TerminalLifecycleEvent) => {
    if (!isTerminalLifecycleEvent(event)) return null
    const panel = findTerminalPanelBySessionOrId(panels.value, event.id)
    if (!panel) return null
    const applied = applyTerminalLifecycleToPanel(panel, event)
    if (!applied) return null
    if (event.processId) {
      managedAiSessions.value = managedAiSessions.value.map((session) =>
        session.terminalSessionId === event.id || session.panelId === panel.id
          ? { ...session, terminalProcessId: event.processId, terminalActivityAt: event.at, updatedAt: Date.now() }
          : session
      )
    }
    if (event.stage === 'closed' || event.stage === 'error') {
      managedAiSessions.value
        .filter((session) => session.terminalSessionId === event.id || session.panelId === panel.id)
        .forEach((session) =>
          upsertManagedAiSession({
            source: session.source,
            event: 'session_end',
            sessionId: session.id,
            title: session.title,
            summary: event.errorMessage || 'Terminal closed',
            receivedAt: event.at || Date.now(),
            ...(session.panelId ? { panelId: session.panelId } : {}),
            terminalSessionId: event.id
          })
        )
    }
    return panel
  }

  const applyTerminalExit = (event: TerminalExitEvent) => {
    if (!isTerminalExitEvent(event)) return null
    const panel = findTerminalPanelBySessionOrId(panels.value, event.id)
    if (!panel) return null
    const applied = applyTerminalExitToPanel(panel, event)
    if (!applied) return null
    managedAiSessions.value
      .filter((session) => session.terminalSessionId === event.id || session.panelId === panel.id)
      .forEach((session) =>
        upsertManagedAiSession({
          source: session.source,
          event: 'session_end',
          sessionId: session.id,
          title: session.title,
          summary: event.errorMessage || 'Terminal closed',
          receivedAt: Date.now(),
          ...(session.panelId ? { panelId: session.panelId } : {}),
          terminalSessionId: event.id
        })
      )
    return panel
  }

  const appendTerminalInput = (id: string, data: string) => {
    const panel = appendTerminalInputToPanelInCollection(panels.value, id, data)
    if (!panel) return
    recordMacroTerminalInput(panel.id, data)
  }

  const replaceTerminalOutput = (id: string, data: string, scope: TerminalOutputScope = 'output') => {
    replaceTerminalOutputInPanelCollection(panels.value, id, data, scope)
  }

  const getHighlightedTerminalOutput = (id: string) => {
    const panel = findTerminalPanelByIdOrSession(panels.value, id)
    if (!panel) return ''
    if (!extensionSettings.value.highlightStatus) return panel.output
    return ensureTerminalPanelOutputSegments(panel)
      .map((segment) => applyKeywordHighlight(keywordHighlightSettings.value, segment.text, segment.scope))
      .join('')
  }

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
