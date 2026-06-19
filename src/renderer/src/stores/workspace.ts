import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  isAiCommandCatalogData,
  isAiContextCatalogData,
  isAiTodoSnapshotData,
  malformedAiBackendResultMessage
} from '@/services/aiBackendGuards'
import { validateCommandSecurity, type CommandSecurityResult } from '@/services/commandSecurityRuntime'
import { applyEditorSettingsToDocument } from '@/services/editorRuntime'
import {
  isAliasCommandDeleteData,
  isAliasCommandListData,
  isAliasCommandMutationData,
  isExtensionInstallProgressData,
  isExtensionPluginCancelData,
  isExtensionPluginListData,
  isExtensionPluginOperationData,
  isExtensionSubscriptionData,
  malformedAliasBackendResultMessage,
  malformedExtensionBackendResultMessage
} from '@/services/extensionBackendGuards'
import { applyKeywordHighlight } from '@/services/keywordHighlightRuntime'
import {
  isFileSessionCatalogData,
  isFileSessionFolderDeleteData,
  isFileSessionFolderMutationData,
  isFileSessionInfoData,
  isFileSessionMutationData,
  isFileTransferTaskCancelData,
  isFileTransferTaskData,
  malformedFilesBackendResultMessage
} from '@/services/filesBackendGuards'
import {
  expectedKnowledgeRelPath,
  isKnowledgeDeleteResultData,
  isKnowledgeEnsureRootResultData,
  isKnowledgeEntryListData,
  isKnowledgeImportResultForRequest,
  isKnowledgeMutationEntryData,
  isKnowledgeReadResultData,
  isKnowledgeReindexResultData,
  isKnowledgeRelPathInParentWithRequestedName,
  isKnowledgeRelPathResultData,
  isKnowledgeSearchResultListData,
  isKnowledgeSearchStatusData,
  isKnowledgeTransferProgressData,
  isKnowledgeWriteResultData,
  malformedKnowledgeBackendResultMessage
} from '@/services/knowledgeBackendGuards'
import {
  isQuickCommandGroupDeleteData,
  isQuickCommandGroupSaveData,
  isQuickCommandMacroSaveData,
  isQuickCommandReorderData,
  isQuickCommandsSnapshotData,
  isQuickCommandScriptPlanData,
  isQuickCommandScriptPlanForRequest,
  isQuickCommandSnippetDeleteData,
  isQuickCommandSnippetSaveData,
  malformedQuickCommandsBackendResultMessage
} from '@/services/quickCommandsBackendGuards'
import {
  isSettingsPreferencesMutationData,
  isSettingsPreferencesSnapshot,
  isSettingsRuleDeleteData,
  malformedSettingsBackendResultMessage
} from '@/services/settingsBackendGuards'
import { copyTextToClipboard } from '@/services/clipboardRuntime'
import {
  isSkillContentResultData,
  isSkillDeleteResultForRequest,
  isSkillEnabledResultForRequest,
  isSkillExportResultData,
  isSkillImportResultData,
  isSkillsSnapshotData,
  isSkillWriteResultForRequest,
  malformedSkillsBackendResultMessage,
  snapshotContainsSkill
} from '@/services/skillsBackendGuards'
import { shortcutRuntime, type ShortcutActionHandler } from '@/services/shortcutRuntime'
import { addSystemThemeListener, applyThemeToDocument, isThemeId, type ThemeId } from '@/services/themeRuntime'
import { isAiopstermDeepLinkPayload } from '@shared/deepLink'
import { isLegacyLocalModelName, isLegacyLocalModelProvider } from '@shared/modelConfigBoundary'
import { createDefaultOnboardingCompleted, onboardingTourSteps } from '@/config/onboarding'
import type { ModuleKey } from '@/config/navigation'
import type { OnboardingModuleId } from '@/config/onboarding'
import { type SettingSectionKey } from '@/config/settings'
import { readStoredAiPanelMode } from '@/services/aiPanelModeRuntime'
import { applyDocumentLocale, isLocaleSetting, resolveLocale, translateWithLocale } from '@/i18n/runtime'
import type { I18nKey } from '@/i18n/messages'
import type {
  AppUpdateCheckResult,
  AppUpdateDownloadResult,
  AppUpdateInstallResult,
  AppUpdateProgressEvent,
  AiAgentSessionEvent,
  AiAgentSessionEventName,
  AiAgentSessionSource,
  AgentHookInstallerOperationResult,
  AgentHookInstallerSnapshot,
  AgentHookInstallerStatus,
  AgentHookInstallerSource,
  ManagedAiSessionBulkInput,
  ManagedAiSessionBulkResult,
  ManagedAiSessionDecision,
  ManagedAiSessionListResult,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRecord,
  ManagedAiSessionSnapshot,
  ManagedAiSessionTimelineEvent,
  AiChatChipContentPart,
  AiChatChipRef,
  AiCommandCatalogOption,
  AiCommandChipContentPart,
  AiCommandChipRef,
  AiContextCatalog,
  AiContextOption,
  AiChatContextUsageSnapshot,
  AiPreferencesUserConfig,
  AiChatConversationRecord,
  AiChatExchangeRequestInput,
  AiChatHistoryMessage,
  AiChatMessageState,
  AiChatMessageInput,
  AiChatResponseInput,
  AiChipContentPart,
  AiContentPart,
  AiDocChipContentPart,
  AiDocChipRef,
  AiImageContentPart,
  AiSkillChipContentPart,
  AiSkillChipRef,
  AiSupportedImageType,
  AiTextContentPart,
  AiTodoItem,
  AiModelCatalog,
  AiModelCatalogOption,
  AiopsPreloadApi,
  AliasCommandConfig,
  AliasCommandSaveInput,
  AiopsTrustedDevice,
  AiopsTrustedDeviceRevokeResult,
  AiopsUserAccountSnapshot,
  AiopsUserAvatarPrepareResult,
  AiopsUserCodeResult,
  AiopsUserExternalAction,
  AiopsUserExternalActionResult,
  AiopsUserMutationResult,
  AiopsUserProfile,
  EditorUserConfig,
  ExtensionInstallProgress as BackendExtensionInstallProgress,
  ExtensionInstallStage,
  ExtensionPluginOperation,
  ExtensionPluginRuntimeConfig,
  ExtensionUserConfig,
  FileSessionCatalog,
  FileSessionFolderRecord,
  FileSessionFolderSaveInput,
  FileSessionInfo,
  FileSessionPatch,
  FileSessionTerminalContext,
  FileTransferTask,
  KeywordHighlightRuleConfig,
  KeywordHighlightUserConfig,
  KnowledgeBaseEntry,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchStatus,
  KnowledgeBaseTransferProgress,
  KnowledgeBaseUserConfig,
  KnowledgeSearchRuntimeSnapshot,
  KnowledgeNode,
  KnowledgeNodeType,
  KubernetesAgentProxyConfig,
  KubernetesBastionGroup,
  KubernetesCatalog,
  KubernetesClusterRecord,
  KubernetesClusterTestInput,
  KubernetesConnectionStatus,
  KubernetesContextInfo,
  KubernetesTerminalDataEvent,
  KubernetesTerminalExitEvent,
  KubernetesImportContextInfo,
  KubernetesNamespaceInfo,
  KubernetesResource,
  KubernetesResourceKind,
  KubernetesTerminalRecord,
  KubernetesTerminalStatus,
  McpResourceReadContent,
  McpResourceReadResult,
  McpServerUserConfig,
  McpToolCallContent,
  McpToolCallResult,
  McpToolStatesUserConfig,
  McpConfigFile,
  ModelProviderCheckKey,
  ModelOptionUserConfig,
  ModelSettingsUserConfig,
  OpenSettingsDocumentationInput,
  PrivacyUserConfig,
  PrivacyRuntimeSnapshot,
  QuickCommandGroupConfig,
  QuickCommandScriptPlan,
  QuickCommandScriptSegment,
  QuickCommandSnippetConfig,
  QuickCommandsUserConfig,
  SecurityUserConfig,
  SettingsDocumentationPage,
  SettingsPreferencesSnapshot,
  ShortcutUserConfig,
  SkillUserConfig,
  SshAgentKeyConfig,
  SshAgentKeychainOption,
  SshProxyConfig,
  SshProxyType,
  TerminalCommandGenerationContext,
  TerminalCommandGenerationRecord,
  TerminalDisconnectReason,
  TerminalExitEvent,
  TerminalLifecycleEvent,
  TerminalLifecycleStage,
  TerminalSessionInfo,
  TerminalMouseEventAction,
  TerminalSshConnectionInfo,
  TerminalUserConfig,
  UserConfig,
  UserRuleConfig,
  WorkspaceUserConfig
} from '@shared/preload'

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
} from '@shared/preload'
import { defaultModelSettingsData } from '@shared/modelSettingsDefaults'
import { defaultWorkspacePreferencesData } from '@shared/workspacePreferencesDefaults'

type PanelDirection = 'right' | 'below'
type CloseMode = 'current' | 'others' | 'all'
type FilesUiMode = 'transfer' | 'default'
type KbClipboard = { mode: 'copy' | 'cut'; sources: string[] } | null
type SnippetGroup = QuickCommandGroupConfig
type QuickCommandSnippet = QuickCommandSnippetConfig
type AliasCommand = AliasCommandConfig & { edit?: boolean }
type KnowledgeBridgeApi = Pick<AiopsPreloadApi, 'kbEnsureRoot' | 'kbListDir'>
type ModelProviderKey = ModelProviderCheckKey
type AppUpdateDownloadData = NonNullable<AppUpdateDownloadResult['data']>
type AppUpdateInstallData = NonNullable<AppUpdateInstallResult['data']>
type UserCodeResultData = NonNullable<AiopsUserCodeResult['data']>
type AgentHookInstallOperationData = NonNullable<AgentHookInstallerOperationResult['data']>
type ManagedAiSessionMutationData = NonNullable<ManagedAiSessionMutationResult['data']>
type ManagedAiSessionBulkData = NonNullable<ManagedAiSessionBulkResult['data']>
type TopUpdateState = 'idle' | 'checking' | 'local' | 'available' | 'install-requested'
export type AiAttentionKind = 'approval' | 'question' | 'plan' | 'error' | 'done'
export type AiAttentionSource = AiAgentSessionSource | 'classic-chat'
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

export const layoutWidthLimits: {
  min: number
  max: number
  quickCloseThreshold: number
  defaults: {
    leftPanelWidth: number
    rightPanelWidth: number
    agentsLeftWidth: number
  }
} = {
  min: 220,
  max: 640,
  quickCloseThreshold: 50,
  defaults: {
    leftPanelWidth: 286,
    rightPanelWidth: 360,
    agentsLeftWidth: 286
  }
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
type UserExternalActionData = NonNullable<AiopsUserExternalActionResult['data']>
type UserMutationData = NonNullable<AiopsUserMutationResult['data']>
type UserCodeData = NonNullable<AiopsUserCodeResult['data']>
type UserAvatarPrepareData = NonNullable<AiopsUserAvatarPrepareResult['data']>
type UserTrustedDeviceRevokeData = NonNullable<AiopsTrustedDeviceRevokeResult['data']>
type PrivacyRuntimeApplyData = PrivacyRuntimeSnapshot
type KnowledgeSearchRuntimeApplyData = KnowledgeSearchRuntimeSnapshot

type TerminalOutputScope = 'output' | 'input'
type SendChatOptions = {
  mode?: NonNullable<AiChatResponseInput['mode']>
  skipKnowledgeSearch?: boolean
}

const agentCommandOutputFilterLimit = 12000
const agentCommandOutputFilterHead = 4000
const agentCommandOutputFilterTail = 6000
type TerminalCommandSource = 'direct' | 'global' | 'snippet' | 'agent'
type ExtensionInstallProgress = {
  pluginId: string
  stage: ExtensionInstallStage
  percent: number
}

type K8sContextInfo = KubernetesContextInfo
type K8sCluster = KubernetesClusterRecord
type K8sBastionGroup = KubernetesBastionGroup
type K8sImportContextInfo = KubernetesImportContextInfo
type K8sNamespaceInfo = KubernetesNamespaceInfo
type K8sResource = KubernetesResource
type K8sResourceKind = KubernetesResourceKind
type K8sResourceAction = 'get' | 'describe' | 'logs'
type K8sConnectionStatus = KubernetesConnectionStatus
type K8sProxyConfig = KubernetesAgentProxyConfig
type K8sBackendCommandData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['executeKubernetesCommand']>>['data']>
type K8sBackendResourceRefreshData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['refreshKubernetesResources']>>['data']>
type K8sBackendResourceActionPlanData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['planKubernetesResourceAction']>>['data']>
type K8sBackendResourceActionData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['executeKubernetesResourceAction']>>['data']>
type K8sKubeconfigImportData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['importKubernetesKubeconfig']>>['data']>
type K8sClusterTestData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['testKubernetesClusterConnection']>>['data']>
type K8sProxyConfigData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['saveKubernetesAgentProxyConfig']>>['data']>
type K8sTerminalCloseData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['closeKubernetesTerminal']>>['data']>
type K8sTerminalWriteData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['writeKubernetesTerminal']>>['data']>
type ModelProviderCheckData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['checkModelProvider']>>['data']>
type AiChatHistorySnapshotData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['listChatConversations']>>['data']>
type AiChatConversationMutationData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['createChatConversation']>>['data']>
type AiChatConversationDeleteData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['deleteChatConversation']>>['data']>
type AiChatConversationRestoreData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['restoreChatConversation']>>['data']>
type AiChatMessageMetadataData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['saveChatMessageMetadata']>>['data']>
type AiMcpToolCallActionData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['approveAiMcpToolCall']>>['data']>
type AiMcpResourceAccessActionData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['approveAiMcpResourceAccess']>>['data']>
type AiChatExchangeRequestData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['createAiChatExchangeRequest']>>['data']>
type AiChatResponseData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['generateAiChatResponse']>>['data']>
type AiChatCancelData = NonNullable<Awaited<ReturnType<AiopsPreloadApi['cancelAiChatResponse']>>['data']>
type AiContextUsage = AiChatContextUsageSnapshot
const defaultK8sProxyConfig: K8sProxyConfig = {
  enabled: false,
  type: 'SOCKS5',
  host: '127.0.0.1',
  port: 1080,
  enableProxyIdentity: false,
  username: '',
  password: '',
  updatedAt: ''
}

const cloneK8sProxyConfig = (config: K8sProxyConfig): K8sProxyConfig => ({ ...config })

type K8sTerminalStatus = KubernetesTerminalStatus
type K8sTerminalTab = {
  id: string
  sessionId: string
  clusterId: string
  name: string
  namespace: string
  isActive: boolean
  output: string
  status: K8sTerminalStatus
  cols: number
  rows: number
  createdAt: string
  updatedAt: string
  exitCode: number | null
  commandHistory: string[]
  lastCommand: string
  lastCommandOutput: string
  collectingAiOutput: boolean
  aiCommandTabId: string | null
}
type K8sAgentRunRecord = {
  id: string
  command: string
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled'
  output: string
  error?: string
  clusterId: string | null
  contextName: string | null
  namespace: string
  startedAt: string
  durationMs: number
}
type ExtensionPlugin = ExtensionPluginRuntimeConfig

type MacroCommandEntry = {
  command: string
  timestamp: number
}

const getKnowledgeBridge = (): KnowledgeBridgeApi | null => {
  const api = window.aiops as unknown as Partial<Record<keyof KnowledgeBridgeApi, unknown>> | undefined
  if (typeof api?.kbEnsureRoot !== 'function' || typeof api?.kbListDir !== 'function') return null
  return api as KnowledgeBridgeApi
}

export type TerminalSecurityExecution = {
  command: string
  securityCommands?: string[]
  panelIds: string[]
  inputText: string
  shellText?: string
  writeToShell: boolean
  source: TerminalCommandSource
  snippetSegments?: QuickCommandScriptSegment[]
}

export type TerminalSecurityPrompt = {
  id: string
  command: string
  panelIds: string[]
  source: TerminalCommandSource
  result: CommandSecurityResult
  execution: TerminalSecurityExecution
} | null

export type TerminalSecurityDecision =
  | { status: 'allow'; execution?: TerminalSecurityExecution }
  | { status: 'blocked'; result: CommandSecurityResult }
  | { status: 'needs-approval'; prompt: NonNullable<TerminalSecurityPrompt> }
  | { status: 'unavailable'; command: string; panelIds: string[]; reason: string }

type QuickCommandScriptPlanResolution =
  | { ok: true; plan: QuickCommandScriptPlan }
  | { ok: false; reason: string }

type TerminalWriteBridgeResult = Awaited<ReturnType<AiopsPreloadApi['writeTerminal']>>
type TerminalWriteValidation = { ok: true } | { ok: false; reason: string }
const terminalLifecycleStages: TerminalLifecycleStage[] = ['starting', 'connecting', 'proxy-opening', 'connected', 'shell-ready', 'error', 'closed']
const terminalDisconnectReasons: TerminalDisconnectReason[] = ['manual', 'network', 'process', 'error', 'unknown']

export type TerminalOutputSegment = {
  text: string
  scope: TerminalOutputScope
}

export type TerminalPanel = {
  id: string
  title: string
  cwd: string
  output: string
  outputSegments: TerminalOutputSegment[]
  status: 'ready' | 'connecting' | 'running' | 'closed' | 'error'
  kind?: 'terminal' | 'knowledge'
  split?: PanelDirection
  splitSourceId?: string
  splitGroupId?: string
  splitOrder?: number
  sessionId?: string
  knowledge?: {
    relPath: string
    isImage: boolean
    startLine?: number
    endLine?: number
    jumpToken?: number
  }
  sshSession?: TerminalSshSession
  terminalLifecycle?: TerminalLifecycleEvent
  terminalExit?: TerminalExitEvent
}

export type TerminalSshSession = {
  connectionId?: string
  sourcePanelId?: string
  forkFromConnectionId?: string
  host: string
  port: number
  username: string
  assetId?: string
  assetName: string
  assetType?: string
  organizationId?: string
  jumpHostId?: string
  authType?: string
  needProxy?: boolean
  proxyName?: string
  createdAt?: number
}

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

type K8sKubeconfigImportResult = {
  success: boolean
  contexts: K8sImportContextInfo[]
  kubeconfigPath: string
  kubeconfigContent: string
  currentContext: string
  stale?: boolean
  error?: string
}

type K8sKubeconfigImportRequest = {
  requestId: string
  kubeconfigPath?: string
  kubeconfigContent?: string
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

export type EditorSettings = EditorUserConfig

export type TerminalSettings = TerminalUserConfig

export type ModelProviderSettings = {
  baseUrl: string
  apiKey: string
  modelId: string
  apiFormat?: 'chat-completions' | 'responses'
  awsAccessKey?: string
  awsSecretKey?: string
  awsSessionToken?: string
  awsRegion?: string
  awsUseCrossRegionInference?: boolean
  awsEndpointSelected?: boolean
  awsBedrockEndpoint?: string
}

type SettingsModelOption = {
  name: string
  displayName?: string
  locked: boolean
  checked: boolean
  type?: 'standard' | 'custom'
  apiProvider?: string
}

type AiModelOption = AiModelCatalogOption

const defaultAiModelCatalog: AiModelCatalog = {
  chatModels: [],
  lockedChatModels: [],
  settingsModels: []
}

type SshProxyForm = SshProxyConfig

export type KeywordHighlightSettings = KeywordHighlightUserConfig
export type SecuritySettings = SecurityUserConfig

export type AiPreferenceSettings = AiPreferencesUserConfig

type AiPreferencePatch = Partial<Omit<AiPreferenceSettings, 'proxy'>> & {
  proxy?: Partial<AiPreferenceSettings['proxy']>
}

function cloneKnowledgeNodes(nodes: KnowledgeNode[]): KnowledgeNode[] {
  return nodes.map((node) => ({ ...node, children: node.children ? cloneKnowledgeNodes(node.children) : undefined }))
}

const cloneShortcutConfig = (shortcuts: SettingsShortcut[]): ShortcutUserConfig[] =>
  shortcuts.map((shortcut) => ({
    id: shortcut.id,
    action: shortcut.action,
    shortcut: shortcut.shortcut,
    ...(shortcut.suffix ? { suffix: shortcut.suffix } : {})
  }))

const cloneRuleConfig = (rules: SettingsRule[]): UserRuleConfig[] =>
  rules
    .filter((rule) => !rule.isDraft && rule.content.trim())
    .map((rule) => ({
      id: rule.id,
      content: rule.content.trim(),
      enabled: rule.enabled !== undefined ? rule.enabled : true
    }))

type SettingsShortcut = ShortcutUserConfig
type SettingsRule = UserRuleConfig & { isEditing?: boolean; isDraft?: boolean }
type SettingsSkill = SkillUserConfig
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

const cloneSkillConfig = (skills: SettingsSkill[]): SkillUserConfig[] =>
  skills
    .filter((skill) => skill.name.trim() && skill.description.trim() && skill.content.trim())
    .map((skill) => ({
      name: skill.name.trim(),
      description: skill.description.trim(),
      enabled: skill.enabled !== undefined ? skill.enabled : true,
      editable: skill.editable !== undefined ? skill.editable : true,
      content: skill.content.trim(),
      ...(skill.path ? { path: skill.path } : {})
    }))

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

export type ExtensionSettings = ExtensionUserConfig

export type PrivacySettings = PrivacyUserConfig & {
  dataSyncRuntime: PrivacyRuntimeSnapshot['dataSyncRuntime']
  dataSyncStatus: NonNullable<PrivacyRuntimeSnapshot['syncStatus']>
  dataSyncRunId: string
  dataSyncStateFilePath: string
  dataSyncLastSyncAt: string
  dataSyncSyncedScopes: NonNullable<PrivacyRuntimeSnapshot['syncedScopes']>
  dataSyncErrorMessage: string
  deactivateModalOpen: boolean
  deactivateConfirmationInput: string
  deactivateLoading: boolean
}

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

const createEmptyUserProfile = (): AiopsUserProfile => ({
  uid: 0,
  name: '',
  username: '',
  avatarInitials: 'AI',
  avatarImageUrl: '',
  registrationType: 'personal',
  registrationCode: 9,
  authProvider: 'local',
  subscription: 'free',
  subscriptionExpiresAt: '',
  email: '',
  mobile: '',
  localIp: '',
  macAddress: '',
  isOfficeDevice: false,
  needDeviceVerification: false,
  skippedLogin: true,
  localDatabaseReady: false,
  lastLoginMethod: 'skip',
  lastLoginAt: '',
  passwordUpdatedAt: '',
  avatarUpdatedAt: ''
})

const defaultWorkspacePreferencesUserConfig: WorkspaceUserConfig = defaultWorkspacePreferencesData()
const defaultModelSettingsUserConfig: ModelSettingsUserConfig = defaultModelSettingsData()

const defaultConfig: UserConfig = {
  language: 'zh-CN',
  theme: 'dark',
  defaultMode: 'terminal',
  leftPanelOpen: true,
  rightPanelOpen: true,
  agentsLeftOpen: true,
  leftPanelWidth: layoutWidthLimits.defaults.leftPanelWidth,
  rightPanelWidth: layoutWidthLimits.defaults.rightPanelWidth,
  agentsLeftWidth: layoutWidthLimits.defaults.agentsLeftWidth,
  modelProvider: 'local',
  modelEndpoint: '',
  modelName: 'aiopsterm-local-agent',
  watermark: 'open',
  background: {
    mode: 'none',
    image: '',
    opacity: 0.68,
    brightness: 0.92,
    lastCustomImage: ''
  },
  terminal: {
    terminalType: 'xterm-256color',
    fontFamily: '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace',
    fontSize: 12,
    scrollBack: 1000,
    cursorStyle: 'block',
    cursorBlink: true,
    lineHeight: 1,
    pinchZoomStatus: true,
    showCloseButton: true,
    sshAgentsStatus: false,
    middleMouseEvent: 'paste',
    rightMouseEvent: 'contextMenu'
  },
  workspacePreferences: defaultWorkspacePreferencesUserConfig,
  editorSettings: {
    fontSize: 14,
    lineHeight: 0,
    fontFamily: 'cascadia-mono',
    tabSize: 4,
    wordWrap: 'off',
    minimap: true,
    mouseWheelZoom: true
  },
  sshProxyConfigs: [],
  sshAgentKeys: [],
  extensionSettings: {
    autoCompleteStatus: true,
    quickVimStatus: true,
    aliasStatus: true,
    highlightStatus: true
  },
  keywordHighlight: {
    'keyword-highlight': {
      enabled: true,
      applyTo: {
        output: true,
        input: false
      },
      rules: []
    }
  },
  securityConfig: {
    security: {
      enableCommandSecurity: true,
      enableStrictMode: false,
      blacklistPatterns: [],
      whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
      dangerousCommands: ['rm', 'format', 'shutdown'],
      maxCommandLength: 10000,
      securityPolicy: {
        blockCritical: true,
        askForMedium: true,
        askForHigh: true,
        askForBlacklist: false
      }
    }
  },
  privacy: {
    telemetry: 'enabled',
    secretRedaction: 'disabled',
    dataSync: 'disabled'
  },
  aiPreferences: {
    enableExtendedThinking: true,
    thinkingBudgetTokens: 4096,
    autoExecuteReadOnlyCommands: false,
    commandOutputFilteringEnabled: true,
    kbSearchEnabled: true,
    experienceExtractionEnabled: true,
    autoApproval: false,
    reasoningEffort: 'medium',
    needProxy: false,
    proxy: {
      type: 'HTTP',
      host: '127.0.0.1',
      port: 7890,
      enableProxyIdentity: false,
      username: '',
      password: ''
    },
    shellIntegrationTimeout: 4
  },
  modelSettings: defaultModelSettingsUserConfig,
  shortcuts: [],
  rules: [],
  skills: [],
  mcpServers: [],
  mcpToolStates: {},
  quickCommands: { groups: [], snippets: [] },
  knowledgeBase: {
    tree: [],
    usedBytes: 0,
    totalBytes: 1024 * 1024 * 1024
  },
  aliasCommands: [],
  onboarding: {
    version: 2,
    guideTabAutoOpened: false,
    completedModules: {
      interfaceGuide: false,
      systemSettings: false,
      addAndConnectHost: false,
      aiChat: false
    }
  }
}

const ONBOARDING_VERSION = 2
const onboardingModuleIds: OnboardingModuleId[] = ['interfaceGuide', 'systemSettings', 'addAndConnectHost', 'aiChat']
type RendererLocalIdPrefix = 'panel' | 'terminal-security' | 'aichat-agent-loop'
const createRendererLocalId = (prefix: RendererLocalIdPrefix) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`
const normalizeThemeId = (theme: string): ThemeId => (isThemeId(theme) ? theme : 'dark')
const MACRO_MAX_RECORDING_DURATION_MS = 5 * 60 * 1000
const MACRO_MAX_COMMAND_COUNT = 50
const MACRO_DEFAULT_SLEEP_THRESHOLD_MS = 500
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
const k8sKindLabels: Record<K8sResourceKind, string> = {
  pods: 'Pods',
  deployments: 'Deployments',
  services: 'Services',
  nodes: 'Nodes'
}
const k8sTerminalTabFromRecord = (record: KubernetesTerminalRecord): K8sTerminalTab => ({
  id: record.id,
  sessionId: record.sessionId,
  clusterId: record.clusterId,
  name: record.name,
  namespace: record.namespace,
  isActive: false,
  output: record.output,
  status: record.status,
  cols: record.cols,
  rows: record.rows,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  exitCode: null,
  commandHistory: [],
  lastCommand: '',
  lastCommandOutput: '',
  collectingAiOutput: false,
  aiCommandTabId: null
})
const ctrlKeyMap: Record<string, string> = {
  'ctrl+a': '\x01',
  'ctrl+b': '\x02',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+e': '\x05',
  'ctrl+f': '\x06',
  'ctrl+g': '\x07',
  'ctrl+h': '\x08',
  'ctrl+k': '\x0b',
  'ctrl+l': '\x0c',
  'ctrl+n': '\x0e',
  'ctrl+p': '\x10',
  'ctrl+r': '\x12',
  'ctrl+t': '\x14',
  'ctrl+u': '\x15',
  'ctrl+w': '\x17',
  'ctrl+z': '\x1a'
}
const keyMap: Record<string, string> = {
  esc: '\x1b',
  tab: '\t',
  return: '\r',
  backspace: '\b',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}
const keySequences = Object.entries(keyMap).sort(([, first], [, second]) => second.length - first.length)
const ctrlSequences = Object.entries(ctrlKeyMap).sort(([, first], [, second]) => second.length - first.length)

const defaultTerminalSettings: TerminalSettings = {
  ...defaultConfig.terminal!
}
const defaultTerminalPanelTitle = '欢迎'

const defaultEditorSettings: EditorSettings = {
  ...defaultConfig.editorSettings!
}

const defaultWorkspacePreferences: WorkspaceUserConfig = {
  ...defaultConfig.workspacePreferences!,
  expandedGroups: [...defaultConfig.workspacePreferences!.expandedGroups]
}

const defaultQuickCommands: QuickCommandsUserConfig = {
  groups: [],
  snippets: []
}

const defaultKnowledgeBase: KnowledgeBaseUserConfig = {
  tree: [],
  usedBytes: defaultConfig.knowledgeBase!.usedBytes,
  totalBytes: defaultConfig.knowledgeBase!.totalBytes
}

const defaultAliasCommands: AliasCommandConfig[] = []

const defaultShortcuts: ShortcutUserConfig[] = []
const shortcutDefaultsById = new Map(defaultShortcuts.map((shortcut) => [shortcut.id, shortcut]))
const shortcutModifierTokens = new Set(['ctrl', 'control', 'shift', 'alt', 'option', 'cmd', 'command', 'meta'])
const defaultRules: UserRuleConfig[] = []
const defaultSkills: SkillUserConfig[] = []
const defaultMcpServers: McpServerUserConfig[] = []
const defaultMcpToolStates: McpToolStatesUserConfig = {}
const mcpStatusValues: McpServerUserConfig['status'][] = ['connected', 'connecting', 'disconnected', 'disabled', 'error']

const defaultMcpConfigFile = (): McpConfigFile => ({
  mcpServers: Object.fromEntries(
    defaultMcpServers.map((server) => {
      const autoApprove = server.tools.filter((tool) => tool.autoApprove).map((tool) => tool.name)
      return [
        server.name,
        {
          type: 'stdio' as const,
          disabled: server.disabled,
          ...(autoApprove.length ? { autoApprove } : {}),
          command: server.name === 'filesystem' ? 'npx' : server.name,
          args: server.name === 'filesystem' ? ['-y', '@modelcontextprotocol/server-filesystem', '~'] : [],
          timeout: 60
        }
      ]
    })
  )
})
const terminalTypes = ['xterm', 'xterm-256color', 'vt100', 'vt102', 'vt220', 'vt320', 'linux', 'scoansi', 'ansi'] as const
const terminalCursorStyles = ['block', 'bar', 'underline'] as const
const middleMouseEventActions: TerminalMouseEventAction[] = ['none', 'paste', 'contextMenu', 'closeTab']
const rightMouseEventActions: TerminalSettings['rightMouseEvent'][] = ['none', 'paste', 'contextMenu']
const linuxReadableTerminalFontFamily = '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace'
const legacyTerminalFontFamilies = new Set([
  'Menlo, Monaco, "Courier New", Consolas, Courier, monospace',
  'Monaco, "Courier New", Consolas, Courier, monospace',
  '"MesloLGS NF", "Courier New", Courier, monospace',
  'Consolas, "Courier New", Courier, monospace',
  '"JetBrains Mono", "Courier New", Courier, monospace',
  '"Source Code Pro", "Courier New", Courier, monospace'
])
const modelApiFormats: NonNullable<ModelProviderSettings['apiFormat']>[] = ['chat-completions', 'responses']
const modelOptionTypes: NonNullable<ModelOptionUserConfig['type']>[] = ['standard', 'custom']
const sshProxyTypes: SshProxyType[] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5', 'TCP']
const standardProxyTypes: Array<Exclude<SshProxyType, 'TCP'>> = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const malformedModelProviderResultMessage = '模型 Provider 检查服务返回数据无效'
const malformedTerminalWriteResultMessage = '终端写入服务返回数据无效'
const malformedMcpToolResultMessage = 'MCP Tool 服务返回数据无效'
const malformedMcpResourceResultMessage = 'MCP Resource 服务返回数据无效'

const createMcpOperationKey = (kind: 'tool' | 'resource', serverName: string, operationName: string) => JSON.stringify([kind, serverName, operationName])

const isMcpToolCallContentList = (value: unknown): value is McpToolCallContent[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.type === 'string' &&
      (item.text === undefined || typeof item.text === 'string') &&
      (item.data === undefined || typeof item.data === 'string') &&
      (item.mimeType === undefined || typeof item.mimeType === 'string')
  )

const isMcpResourceReadContentList = (value: unknown): value is McpResourceReadContent[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item.uri === 'string' &&
      (item.text === undefined || typeof item.text === 'string') &&
      (item.blob === undefined || typeof item.blob === 'string') &&
      (item.mimeType === undefined || typeof item.mimeType === 'string')
  )

const isMcpToolCallResultData = (value: unknown, serverName: string, toolName: string): value is NonNullable<McpToolCallResult['data']> =>
  isRecord(value) &&
  value.serverName === serverName &&
  value.toolName === toolName &&
  isMcpToolCallContentList(value.content) &&
  typeof value.isError === 'boolean' &&
  typeof value.durationMs === 'number' &&
  Number.isFinite(value.durationMs)

const isMcpResourceReadResultData = (value: unknown, serverName: string, uri: string): value is NonNullable<McpResourceReadResult['data']> =>
  isRecord(value) &&
  value.serverName === serverName &&
  value.uri === uri &&
  isMcpResourceReadContentList(value.contents) &&
  typeof value.durationMs === 'number' &&
  Number.isFinite(value.durationMs)

const stringifyMcpPayload = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const formatMcpToolCallContent = (content: McpToolCallContent[]) => {
  if (!content.length) return '[]'
  return content
    .map((item) => {
      if (typeof item.text === 'string') return item.text
      if (typeof item.data === 'string') return item.data
      return stringifyMcpPayload(item)
    })
    .join('\n\n')
}

const formatMcpResourceReadContent = (contents: McpResourceReadContent[]) => {
  if (!contents.length) return '[]'
  return contents
    .map((item) => {
      if (typeof item.text === 'string') return item.text
      if (typeof item.blob === 'string') return item.blob
      return stringifyMcpPayload(item)
    })
    .join('\n\n')
}

const numberInRange = (value: unknown, fallback: number, min: number, max?: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && (max === undefined || value <= max) ? value : fallback

const terminalWriteByteLength = (data: string) => new TextEncoder().encode(data).length

const isTerminalWriteResultData = (value: unknown, sessionId: string, data: string) =>
  isRecord(value) &&
  value.id === sessionId &&
  typeof value.bytes === 'number' &&
  Number.isInteger(value.bytes) &&
  value.bytes >= 0 &&
  value.bytes === terminalWriteByteLength(data)

const integerInRange = (value: unknown, fallback: number, min: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min ? value : fallback

const stringFromOptions = <T extends string>(value: unknown, options: readonly T[], fallback: T) => (typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback)

const userRegistrationCodes: AiopsUserProfile['registrationCode'][] = [1, 2, 3, 4, 6, 7, 9]
const userRegistrationTypes: AiopsUserProfile['registrationType'][] = ['enterprise', 'personal']
const userAuthProviders: AiopsUserProfile['authProvider'][] = ['local', 'sso', 'oauth']
const userSubscriptions: AiopsUserProfile['subscription'][] = ['free', 'pro', 'ultra']
const userLastLoginMethods: AiopsUserProfile['lastLoginMethod'][] = ['account', 'email', 'mobile', 'skip', 'external']
const userExternalActions: AiopsUserExternalAction[] = ['login', 'account-center']
const userCodeKinds: UserCodeData['kind'][] = ['email', 'mobile']
const userAvatarMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']
const userAvatarAssetUrlPattern = /^aiopsterm-user-avatar:\/\/[a-f0-9]{64}\.(png|jpg|gif|webp|bmp|svg)$/i

const isUserProfileSnapshot = (source: unknown): source is AiopsUserProfile =>
  isRecord(source) &&
  typeof source.uid === 'number' &&
  Number.isInteger(source.uid) &&
  source.uid >= 0 &&
  typeof source.name === 'string' &&
  typeof source.username === 'string' &&
  typeof source.avatarInitials === 'string' &&
  typeof source.avatarImageUrl === 'string' &&
  userRegistrationTypes.includes(source.registrationType as AiopsUserProfile['registrationType']) &&
  userRegistrationCodes.includes(source.registrationCode as AiopsUserProfile['registrationCode']) &&
  userAuthProviders.includes(source.authProvider as AiopsUserProfile['authProvider']) &&
  userSubscriptions.includes(source.subscription as AiopsUserProfile['subscription']) &&
  typeof source.subscriptionExpiresAt === 'string' &&
  typeof source.email === 'string' &&
  typeof source.mobile === 'string' &&
  typeof source.localIp === 'string' &&
  typeof source.macAddress === 'string' &&
  typeof source.isOfficeDevice === 'boolean' &&
  typeof source.needDeviceVerification === 'boolean' &&
  typeof source.skippedLogin === 'boolean' &&
  typeof source.localDatabaseReady === 'boolean' &&
  userLastLoginMethods.includes(source.lastLoginMethod as AiopsUserProfile['lastLoginMethod']) &&
  typeof source.lastLoginAt === 'string' &&
  typeof source.passwordUpdatedAt === 'string' &&
  typeof source.avatarUpdatedAt === 'string'

const isTrustedDeviceSnapshot = (source: unknown): source is AiopsTrustedDevice =>
  isRecord(source) &&
  typeof source.id === 'number' &&
  Number.isInteger(source.id) &&
  source.id > 0 &&
  typeof source.deviceName === 'string' &&
  source.deviceName.trim() !== '' &&
  typeof source.macAddress === 'string' &&
  typeof source.lastLoginIp === 'string' &&
  typeof source.location === 'string' &&
  typeof source.lastLoginUserAgent === 'string' &&
  typeof source.current === 'boolean'

const isUserAccountSnapshot = (source: unknown): source is AiopsUserAccountSnapshot =>
  isRecord(source) && isUserProfileSnapshot(source.profile) && Array.isArray(source.trustedDevices) && source.trustedDevices.every(isTrustedDeviceSnapshot)

const isUserMutationData = (source: unknown): source is UserMutationData => {
  if (!isRecord(source) || !isUserAccountSnapshot(source)) return false
  return typeof (source as Record<string, unknown>).message === 'string'
}

const isHttpUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().startsWith('//')) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname.trim()) && !url.username && !url.password
  } catch {
    return false
  }
}

const isUserExternalActionData = (source: unknown, action: AiopsUserExternalAction): source is UserExternalActionData =>
  isRecord(source) &&
  source.action === action &&
  userExternalActions.includes(source.action as AiopsUserExternalAction) &&
  isHttpUrl(source.url) &&
  source.opened === true &&
  typeof source.openedAt === 'string' &&
  source.openedAt.trim() !== '' &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const isUserCodeData = (source: unknown): source is UserCodeData =>
  isRecord(source) &&
  typeof source.challengeId === 'string' &&
  /^[a-f0-9]{16,64}$/i.test(source.challengeId) &&
  userCodeKinds.includes(source.kind as UserCodeData['kind']) &&
  typeof source.target === 'string' &&
  source.target.trim() !== '' &&
  typeof source.countdownSeconds === 'number' &&
  Number.isFinite(source.countdownSeconds) &&
  source.countdownSeconds >= 0 &&
  typeof source.remainingSeconds === 'number' &&
  Number.isFinite(source.remainingSeconds) &&
  source.remainingSeconds >= 0 &&
  typeof source.expiresAt === 'number' &&
  Number.isFinite(source.expiresAt) &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const normalizeUserCodeTarget = (kind: UserCodeData['kind'], value: string) => {
  const normalized = value.trim()
  return kind === 'email' ? normalized.toLowerCase() : normalized
}

const isUserCodeDataForRequest = (source: unknown, kind: UserCodeData['kind'], value: string): source is UserCodeData =>
  isUserCodeData(source) && source.kind === kind && normalizeUserCodeTarget(source.kind, source.target) === normalizeUserCodeTarget(kind, value)

const isUserAvatarPrepareData = (source: unknown): source is UserAvatarPrepareData =>
  isRecord(source) &&
  typeof source.filePath === 'string' &&
  source.filePath.trim() !== '' &&
  typeof source.name === 'string' &&
  source.name.trim() !== '' &&
  typeof source.mimeType === 'string' &&
  userAvatarMimeTypes.includes(source.mimeType) &&
  typeof source.size === 'number' &&
  Number.isFinite(source.size) &&
  source.size > 0 &&
  typeof source.dataUrl === 'string' &&
  /^data:image\/[a-z0-9.+-]+;base64,/i.test(source.dataUrl) &&
  typeof source.avatarImageUrl === 'string' &&
  userAvatarAssetUrlPattern.test(source.avatarImageUrl) &&
  typeof source.assetFileName === 'string' &&
  /^[a-f0-9]{64}\.(png|jpg|gif|webp|bmp|svg)$/i.test(source.assetFileName) &&
  source.avatarImageUrl === `aiopsterm-user-avatar://${source.assetFileName}` &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const isTrustedDeviceRevokeData = (source: unknown): source is UserTrustedDeviceRevokeData =>
  isRecord(source) &&
  typeof source.deviceId === 'number' &&
  Number.isInteger(source.deviceId) &&
  source.deviceId > 0 &&
  Array.isArray(source.trustedDevices) &&
  source.trustedDevices.every(isTrustedDeviceSnapshot) &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const normalizeModelSettingsOptions = (source: unknown, fallback: ModelOptionUserConfig[] = []) => {
  const rawOptions = Array.isArray(source) ? source : fallback
  const seenNames = new Set<string>()
  const options: ModelOptionUserConfig[] = []
  let changed = !Array.isArray(source)
  rawOptions.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || isLegacyLocalModelName(name) || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const displayName = typeof item.displayName === 'string' ? item.displayName.trim() : ''
    const locked = Boolean(item.locked)
    const type = stringFromOptions(item.type, modelOptionTypes, locked ? 'standard' : 'custom')
    const option: ModelOptionUserConfig = {
      name,
      displayName: displayName && displayName !== name ? displayName : undefined,
      locked,
      checked: item.checked !== undefined ? Boolean(item.checked) : true,
      type,
      apiProvider: typeof item.apiProvider === 'string' && item.apiProvider.trim() ? item.apiProvider.trim() : 'default'
    }
    options.push(option)
    const allowedKeys = new Set(['name', 'displayName', 'locked', 'checked', 'type', 'apiProvider'])
    if (
      item.name !== option.name ||
      item.displayName !== option.displayName ||
      item.locked !== option.locked ||
      item.checked !== option.checked ||
      item.type !== option.type ||
      item.apiProvider !== option.apiProvider ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized: options,
    changed
  }
}

const isVisibleModelSettingsOption = (model: ModelOptionUserConfig | SettingsModelOption) => model.name !== 'aiopsterm-local-agent'

const normalizeAiModelOption = (source: unknown): AiModelOption | null => {
  if (!isRecord(source)) return null
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const displayName = typeof source.displayName === 'string' ? source.displayName.trim() : ''
  const label = typeof source.label === 'string' && source.label.trim() ? source.label.trim() : displayName || id
  if (!id || !label || isLegacyLocalModelName(id)) return null
  if (typeof source.apiProvider === 'string' && isLegacyLocalModelProvider(source.apiProvider)) return null
  const locked = Boolean(source.locked)
  return {
    id,
    label,
    detail: typeof source.detail === 'string' ? source.detail.trim() : '',
    displayName: displayName && displayName !== id ? displayName : undefined,
    checked: source.checked !== undefined ? Boolean(source.checked) : true,
    locked,
    tier: typeof source.tier === 'string' ? source.tier.trim() : undefined,
    type: stringFromOptions(source.type, modelOptionTypes, locked ? 'standard' : 'standard'),
    apiProvider: typeof source.apiProvider === 'string' && source.apiProvider.trim() ? source.apiProvider.trim() : 'default'
  }
}

const normalizeAiModelCatalog = (source?: Partial<AiModelCatalog> | null): AiModelCatalog => {
  const incoming = isRecord(source) ? source : {}
  const chatModels = (Array.isArray(incoming.chatModels) ? incoming.chatModels : defaultAiModelCatalog.chatModels)
    .map(normalizeAiModelOption)
    .filter((model): model is AiModelOption => Boolean(model))
  const lockedChatModels = (Array.isArray(incoming.lockedChatModels) ? incoming.lockedChatModels : defaultAiModelCatalog.lockedChatModels)
    .map(normalizeAiModelOption)
    .filter((model): model is AiModelOption => Boolean(model))
    .map((model) => ({ ...model, locked: true }))
  const settingsModels = normalizeModelSettingsOptions(
    Array.isArray(incoming.settingsModels) ? incoming.settingsModels : defaultAiModelCatalog.settingsModels,
    defaultAiModelCatalog.settingsModels
  ).normalized
  return { chatModels, lockedChatModels, settingsModels }
}

const isModelProviderCheckDataForRequest = (source: unknown, provider: ModelProviderKey, expectedConfig: ModelProviderSettings): source is ModelProviderCheckData =>
  isRecord(source) &&
  source.provider === provider &&
  typeof source.label === 'string' &&
  source.label.trim() !== '' &&
  typeof source.modelId === 'string' &&
  source.modelId.trim() === expectedConfig.modelId.trim() &&
  typeof source.endpoint === 'string' &&
  source.endpoint.trim() !== '' &&
  typeof source.message === 'string' &&
  source.message.trim() !== '' &&
  typeof source.durationMs === 'number' &&
  Number.isFinite(source.durationMs) &&
  source.durationMs >= 0

const createMacroSnippetName = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return `macro-${year}${month}${day}-${hour}${minute}${second}`
}

const knowledgeNodeSize = (node: KnowledgeNode): number => (node.size || 0) + (node.children?.reduce((total, child) => total + knowledgeNodeSize(child), 0) || 0)

const knowledgeTreeSize = (nodes: KnowledgeNode[]) => nodes.reduce((total, node) => total + knowledgeNodeSize(node), 0)

const knowledgeEntryToNode = (entry: KnowledgeBaseEntry): KnowledgeNode => ({
  id: `kb-${entry.relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`,
  key: entry.relPath,
  relPath: entry.relPath,
  title: entry.name,
  type: entry.type,
  ...(entry.type === 'file' ? { size: entry.size || 0 } : { children: [] })
})

const normalizeTerminalConfig = (source?: Partial<TerminalUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingFontFamily = typeof incoming.fontFamily === 'string' ? incoming.fontFamily.trim() : ''
  const normalized: TerminalSettings = {
    terminalType: stringFromOptions(incoming.terminalType, terminalTypes, defaultTerminalSettings.terminalType),
    fontFamily: incomingFontFamily ? (legacyTerminalFontFamilies.has(incomingFontFamily) ? linuxReadableTerminalFontFamily : incomingFontFamily) : defaultTerminalSettings.fontFamily,
    fontSize: numberInRange(incoming.fontSize, defaultTerminalSettings.fontSize, 8, 64),
    scrollBack: numberInRange(incoming.scrollBack, defaultTerminalSettings.scrollBack, 1, 100000),
    cursorStyle: stringFromOptions(incoming.cursorStyle, terminalCursorStyles, defaultTerminalSettings.cursorStyle),
    cursorBlink: typeof incoming.cursorBlink === 'boolean' ? incoming.cursorBlink : defaultTerminalSettings.cursorBlink,
    lineHeight: numberInRange(incoming.lineHeight, defaultTerminalSettings.lineHeight, 1, 3),
    pinchZoomStatus: typeof incoming.pinchZoomStatus === 'boolean' ? incoming.pinchZoomStatus : defaultTerminalSettings.pinchZoomStatus,
    showCloseButton: typeof incoming.showCloseButton === 'boolean' ? incoming.showCloseButton : defaultTerminalSettings.showCloseButton,
    sshAgentsStatus: typeof incoming.sshAgentsStatus === 'boolean' ? incoming.sshAgentsStatus : defaultTerminalSettings.sshAgentsStatus,
    middleMouseEvent: stringFromOptions(incoming.middleMouseEvent, middleMouseEventActions, defaultTerminalSettings.middleMouseEvent),
    rightMouseEvent: stringFromOptions(incoming.rightMouseEvent, rightMouseEventActions, defaultTerminalSettings.rightMouseEvent)
  }

  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof TerminalSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

const isTerminalSettingsSnapshot = (source: unknown): source is TerminalUserConfig => {
  if (!isRecord(source)) return false
  return (
    (terminalTypes as readonly string[]).includes(source.terminalType as string) &&
    typeof source.fontFamily === 'string' &&
    source.fontFamily.trim().length > 0 &&
    typeof source.fontSize === 'number' &&
    Number.isFinite(source.fontSize) &&
    typeof source.scrollBack === 'number' &&
    Number.isFinite(source.scrollBack) &&
    (terminalCursorStyles as readonly string[]).includes(source.cursorStyle as string) &&
    typeof source.cursorBlink === 'boolean' &&
    typeof source.lineHeight === 'number' &&
    Number.isFinite(source.lineHeight) &&
    typeof source.pinchZoomStatus === 'boolean' &&
    typeof source.showCloseButton === 'boolean' &&
    typeof source.sshAgentsStatus === 'boolean' &&
    middleMouseEventActions.includes(source.middleMouseEvent as TerminalMouseEventAction) &&
    rightMouseEventActions.includes(source.rightMouseEvent as TerminalSettings['rightMouseEvent'])
  )
}

const normalizeWorkspacePreferences = (source?: Partial<WorkspaceUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingExpandedGroups = Array.isArray(incoming.expandedGroups)
    ? incoming.expandedGroups.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : defaultWorkspacePreferences.expandedGroups
  const incomingRecentAssetIds = Array.isArray(incoming.recentAssetIds)
    ? incoming.recentAssetIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : defaultWorkspacePreferences.recentAssetIds || []
  const normalized: WorkspaceUserConfig = {
    expandedGroups: Array.from(new Set(incomingExpandedGroups)),
    showIpMode: typeof incoming.showIpMode === 'boolean' ? incoming.showIpMode : defaultWorkspacePreferences.showIpMode,
    recentAssetIds: Array.from(new Set(incomingRecentAssetIds)).slice(0, 10)
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.expandedGroups) ||
    !Array.isArray(incoming.recentAssetIds) ||
    incoming.expandedGroups.length !== normalized.expandedGroups.length ||
    incoming.expandedGroups.some((item, index) => item !== normalized.expandedGroups[index]) ||
    incoming.showIpMode !== normalized.showIpMode ||
    incoming.recentAssetIds.length !== (normalized.recentAssetIds || []).length ||
    incoming.recentAssetIds.some((item, index) => item !== (normalized.recentAssetIds || [])[index])

  return {
    normalized,
    changed
  }
}

const isWorkspacePreferencesSnapshot = (source: unknown): source is WorkspaceUserConfig => {
  if (!isRecord(source) || !Array.isArray(source.expandedGroups) || typeof source.showIpMode !== 'boolean' || !Array.isArray(source.recentAssetIds)) return false
  const { changed } = normalizeWorkspacePreferences(source)
  return !changed
}

const cloneWorkspacePreferencesSnapshot = (preferences: WorkspaceUserConfig): WorkspaceUserConfig => ({
  showIpMode: preferences.showIpMode,
  expandedGroups: [...preferences.expandedGroups],
  recentAssetIds: [...(preferences.recentAssetIds || [])]
})

const workspacePreferenceSnapshotsMatch = (left: WorkspaceUserConfig, right: WorkspaceUserConfig) =>
  JSON.stringify(cloneWorkspacePreferencesSnapshot(left)) === JSON.stringify(cloneWorkspacePreferencesSnapshot(right))

const editorWordWrapValues: EditorSettings['wordWrap'][] = ['on', 'off']

const normalizeEditorSettingsConfig = (source?: Partial<EditorUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: EditorSettings = {
    fontSize: numberInRange(incoming.fontSize, defaultEditorSettings.fontSize, 8, 32),
    lineHeight: numberInRange(incoming.lineHeight, defaultEditorSettings.lineHeight, 0, 48),
    fontFamily: typeof incoming.fontFamily === 'string' && incoming.fontFamily.trim() ? incoming.fontFamily.trim() : defaultEditorSettings.fontFamily,
    tabSize: numberInRange(incoming.tabSize, defaultEditorSettings.tabSize, 1, 8),
    wordWrap: stringFromOptions(incoming.wordWrap, editorWordWrapValues, defaultEditorSettings.wordWrap),
    minimap: typeof incoming.minimap === 'boolean' ? incoming.minimap : defaultEditorSettings.minimap,
    mouseWheelZoom: typeof incoming.mouseWheelZoom === 'boolean' ? incoming.mouseWheelZoom : defaultEditorSettings.mouseWheelZoom
  }

  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof EditorSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

const isEditorSettingsSnapshot = (source: unknown): source is EditorUserConfig => {
  if (!isRecord(source)) return false
  return (
    typeof source.fontSize === 'number' &&
    Number.isFinite(source.fontSize) &&
    typeof source.lineHeight === 'number' &&
    Number.isFinite(source.lineHeight) &&
    typeof source.fontFamily === 'string' &&
    source.fontFamily.trim().length > 0 &&
    typeof source.tabSize === 'number' &&
    Number.isFinite(source.tabSize) &&
    editorWordWrapValues.includes(source.wordWrap as EditorSettings['wordWrap']) &&
    typeof source.minimap === 'boolean' &&
    typeof source.mouseWheelZoom === 'boolean'
  )
}

const normalizeSshProxyConfigs = (source?: unknown) => {
  const rawConfigs = Array.isArray(source) ? source : []
  const seenNames = new Set<string>()
  let changed = !Array.isArray(source)
  const normalized: SshProxyConfig[] = []

  rawConfigs.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const host = typeof item.host === 'string' ? item.host.trim() : ''
    if (!name || !host || seenNames.has(name)) {
      changed = true
      return
    }
    const proxyConfig: SshProxyConfig = {
      name,
      type: stringFromOptions(item.type, sshProxyTypes, 'SOCKS5'),
      host,
      port: numberInRange(item.port, 22, 1, 65535),
      enableProxyIdentity: typeof item.enableProxyIdentity === 'boolean' ? item.enableProxyIdentity : false,
      username: typeof item.username === 'string' ? item.username : '',
      password: typeof item.password === 'string' ? item.password : ''
    }
    seenNames.add(name)
    normalized.push(proxyConfig)
    const allowedKeys = new Set(['name', 'type', 'host', 'port', 'enableProxyIdentity', 'username', 'password'])
    if (
      item.name !== proxyConfig.name ||
      item.type !== proxyConfig.type ||
      item.host !== proxyConfig.host ||
      item.port !== proxyConfig.port ||
      item.enableProxyIdentity !== proxyConfig.enableProxyIdentity ||
      item.username !== proxyConfig.username ||
      item.password !== proxyConfig.password ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

const normalizeSshAgentKeys = (source?: unknown) => {
  const rawKeys = Array.isArray(source) ? source : []
  const seenIds = new Set<string>()
  const seenKeyChainIds = new Set<string>()
  let changed = !Array.isArray(source)
  const normalized: SshAgentKeyConfig[] = []

  rawKeys.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint.trim() : ''
    const comment = typeof item.comment === 'string' ? item.comment.trim() : ''
    const keyChainIdSource = typeof item.keyChainId === 'string' ? item.keyChainId.trim() : typeof item.key === 'string' ? item.key.trim() : ''
    const keyChainId = keyChainIdSource || id
    if (!id || !fingerprint || !comment || seenIds.has(id) || seenKeyChainIds.has(keyChainId)) {
      changed = true
      return
    }
    const key: SshAgentKeyConfig = {
      id,
      fingerprint,
      comment,
      keyType: typeof item.keyType === 'string' && item.keyType.trim() ? item.keyType.trim().toUpperCase() : 'UNKNOWN',
      keyChainId
    }
    seenIds.add(id)
    seenKeyChainIds.add(keyChainId)
    normalized.push(key)
    const allowedKeys = new Set(['id', 'fingerprint', 'comment', 'keyType', 'keyChainId'])
    if (
      item.id !== key.id ||
      item.fingerprint !== key.fingerprint ||
      item.comment !== key.comment ||
      item.keyType !== key.keyType ||
      item.keyChainId !== key.keyChainId ||
      Object.keys(item).some((itemKey) => !allowedKeys.has(itemKey))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

const sshProxyConfigSnapshotsMatch = (left: SshProxyConfig[], right: SshProxyConfig[]) =>
  JSON.stringify(normalizeSshProxyConfigs(left).normalized) === JSON.stringify(normalizeSshProxyConfigs(right).normalized)

const sshAgentKeySnapshotsMatch = (left: SshAgentKeyConfig[], right: SshAgentKeyConfig[]) =>
  JSON.stringify(normalizeSshAgentKeys(left).normalized) === JSON.stringify(normalizeSshAgentKeys(right).normalized)

const normalizeSshAgentKeychainOptions = (source?: unknown): SshAgentKeychainOption[] => {
  const rawOptions = Array.isArray(source) ? source : []
  const seenKeys = new Set<string>()
  const normalized: SshAgentKeychainOption[] = []

  rawOptions.forEach((item) => {
    if (!isRecord(item)) return
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const fingerprint = typeof item.fingerprint === 'string' ? item.fingerprint.trim() : ''
    const keyType = typeof item.keyType === 'string' ? item.keyType.trim().toUpperCase() : ''
    if (!key || !label || !fingerprint || !keyType || seenKeys.has(key)) return
    seenKeys.add(key)
    normalized.push({ key, label, fingerprint, keyType })
  })

  return normalized
}

const readSshAgentKeychainOptionsSnapshot = (source: unknown): SshAgentKeychainOption[] | null => {
  if (!Array.isArray(source)) return null
  const normalized = normalizeSshAgentKeychainOptions(source)
  return normalized.length === source.length ? normalized : null
}

const booleanFromExtensionStatus = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 2) return false
  return fallback
}

const normalizeExtensionSettingsConfig = (source?: Partial<ExtensionUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: ExtensionSettings = {
    autoCompleteStatus: booleanFromExtensionStatus(incoming.autoCompleteStatus, defaultExtensionSettings.autoCompleteStatus),
    quickVimStatus: booleanFromExtensionStatus(incoming.quickVimStatus, defaultExtensionSettings.quickVimStatus),
    aliasStatus: booleanFromExtensionStatus(incoming.aliasStatus, defaultExtensionSettings.aliasStatus),
    highlightStatus: booleanFromExtensionStatus(incoming.highlightStatus, defaultExtensionSettings.highlightStatus)
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof ExtensionSettings>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

const normalizeKeywordHighlightConfig = (source?: unknown) => {
  const incomingRoot = isRecord(source) ? source : {}
  const incoming = isRecord(incomingRoot['keyword-highlight']) ? incomingRoot['keyword-highlight'] : {}
  const incomingApplyTo = isRecord(incoming.applyTo) ? incoming.applyTo : {}
  const rawRules = Array.isArray(incoming.rules) ? incoming.rules : defaultKeywordHighlightSettings['keyword-highlight'].rules
  const seenNames = new Set<string>()
  let changed = !isRecord(source) || !isRecord(incomingRoot['keyword-highlight']) || !isRecord(incoming.applyTo) || !Array.isArray(incoming.rules)

  const rules: KeywordHighlightRuleConfig[] = []
  rawRules.forEach((item, index) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : `Rule ${index + 1}`
    if (seenNames.has(name)) {
      changed = true
      return
    }
    const rawPattern = item.pattern
    const pattern = Array.isArray(rawPattern)
      ? rawPattern.filter((patternItem): patternItem is string => typeof patternItem === 'string' && patternItem.trim().length > 0).map((patternItem) => patternItem.trim())
      : typeof rawPattern === 'string' && rawPattern.trim()
        ? rawPattern.trim()
        : ''
    if ((Array.isArray(pattern) && pattern.length === 0) || (!Array.isArray(pattern) && !pattern)) {
      changed = true
      return
    }
    const incomingStyle = isRecord(item.style) ? item.style : {}
    const rule: KeywordHighlightRuleConfig = {
      name,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      scope: stringFromOptions(item.scope, keywordHighlightScopes, 'output'),
      matchType: stringFromOptions(item.matchType, keywordHighlightMatchTypes, 'regex'),
      pattern,
      style: {
        foreground:
          typeof incomingStyle.foreground === 'string' && keywordHighlightHexColorPattern.test(incomingStyle.foreground)
            ? incomingStyle.foreground.toUpperCase()
            : '#FF4D4F',
        fontStyle: stringFromOptions(incomingStyle.fontStyle, keywordHighlightFontStyles, 'bold')
      }
    }
    seenNames.add(name)
    rules.push(rule)
    const allowedKeys = new Set(['name', 'enabled', 'scope', 'matchType', 'pattern', 'style'])
    const allowedStyleKeys = new Set(['foreground', 'fontStyle'])
    if (
      item.name !== rule.name ||
      item.enabled !== rule.enabled ||
      item.scope !== rule.scope ||
      item.matchType !== rule.matchType ||
      JSON.stringify(item.pattern) !== JSON.stringify(rule.pattern) ||
      !isRecord(item.style) ||
      incomingStyle.foreground !== rule.style.foreground ||
      incomingStyle.fontStyle !== rule.style.fontStyle ||
      Object.keys(item).some((key) => !allowedKeys.has(key)) ||
      Object.keys(incomingStyle).some((key) => !allowedStyleKeys.has(key))
    ) {
      changed = true
    }
  })

  const normalized: KeywordHighlightSettings = {
    'keyword-highlight': {
      enabled: incoming.enabled !== undefined ? Boolean(incoming.enabled) : defaultKeywordHighlightSettings['keyword-highlight'].enabled,
      applyTo: {
        output: incomingApplyTo.output !== undefined ? Boolean(incomingApplyTo.output) : defaultKeywordHighlightSettings['keyword-highlight'].applyTo.output,
        input: incomingApplyTo.input !== undefined ? Boolean(incomingApplyTo.input) : defaultKeywordHighlightSettings['keyword-highlight'].applyTo.input
      },
      rules
    }
  }

  if (
    incoming.enabled !== normalized['keyword-highlight'].enabled ||
    incomingApplyTo.output !== normalized['keyword-highlight'].applyTo.output ||
    incomingApplyTo.input !== normalized['keyword-highlight'].applyTo.input
  ) {
    changed = true
  }

  return {
    normalized,
    changed
  }
}

const keywordHighlightEditorContentFromFile = (content: string) => (content.trim() ? content : JSON.stringify(defaultKeywordHighlightSettings, null, 2))

const parseKeywordHighlightEditorContent = (content: string) => JSON.parse(content)

const parseMcpEditorContent = (content: string) => JSON.parse(content)

const normalizeMcpConfigFile = (source?: unknown): McpConfigFile => {
  const root = isRecord(source) ? source : {}
  const serverRoot = isRecord(root.mcpServers) ? root.mcpServers : {}
  const mcpServers: McpConfigFile['mcpServers'] = {}
  Object.entries(serverRoot).forEach(([name, value]) => {
    if (!name.trim() || !isRecord(value)) return
    const type = value.type === 'sse' || value.type === 'streamableHttp' ? value.type : 'stdio'
    const autoApprove = Array.isArray(value.autoApprove)
      ? value.autoApprove.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : undefined
    const args = Array.isArray(value.args) ? value.args.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : undefined
    const stringRecord = (record: unknown) =>
      isRecord(record) ? Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined
    mcpServers[name.trim()] = {
      type,
      ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
      ...(autoApprove?.length ? { autoApprove } : {}),
      ...(typeof value.timeout === 'number' && value.timeout > 0 ? { timeout: value.timeout } : {}),
      ...(typeof value.command === 'string' && value.command.trim() ? { command: value.command.trim() } : {}),
      ...(args?.length ? { args } : {}),
      ...(typeof value.cwd === 'string' && value.cwd.trim() ? { cwd: value.cwd.trim() } : {}),
      ...(stringRecord(value.env) ? { env: stringRecord(value.env) } : {}),
      ...(typeof value.url === 'string' && value.url.trim() ? { url: value.url.trim() } : {}),
      ...(stringRecord(value.headers) ? { headers: stringRecord(value.headers) } : {})
    }
  })
  return { mcpServers }
}

const mcpConfigFilesMatch = (left: McpConfigFile, right: McpConfigFile) =>
  JSON.stringify(normalizeMcpConfigFile(left)) === JSON.stringify(normalizeMcpConfigFile(right))

const normalizeStringArray = (source: unknown, fallback: string[]) => {
  if (!Array.isArray(source)) return { normalized: [...fallback], changed: true }
  const normalized = source.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  return {
    normalized,
    changed: normalized.length !== source.length || normalized.some((item, index) => item !== source[index])
  }
}

const normalizeSecurityConfig = (source?: unknown) => {
  const incomingRoot = isRecord(source) ? source : {}
  const incoming = isRecord(incomingRoot.security) ? incomingRoot.security : {}
  const incomingPolicy = isRecord(incoming.securityPolicy) ? incoming.securityPolicy : {}
  const defaults = defaultSecuritySettings.security
  const blacklist = normalizeStringArray(incoming.blacklistPatterns, defaults.blacklistPatterns)
  const whitelist = normalizeStringArray(incoming.whitelistPatterns, defaults.whitelistPatterns)
  const dangerous = normalizeStringArray(incoming.dangerousCommands, defaults.dangerousCommands)
  const normalized: SecuritySettings = {
    security: {
      enableCommandSecurity: incoming.enableCommandSecurity !== undefined ? Boolean(incoming.enableCommandSecurity) : defaults.enableCommandSecurity,
      enableStrictMode: incoming.enableStrictMode !== undefined ? Boolean(incoming.enableStrictMode) : defaults.enableStrictMode,
      blacklistPatterns: blacklist.normalized,
      whitelistPatterns: whitelist.normalized,
      dangerousCommands: dangerous.normalized,
      maxCommandLength: numberInRange(incoming.maxCommandLength, defaults.maxCommandLength, 1, 100000),
      securityPolicy: {
        blockCritical: incomingPolicy.blockCritical !== undefined ? Boolean(incomingPolicy.blockCritical) : defaults.securityPolicy.blockCritical,
        askForMedium: incomingPolicy.askForMedium !== undefined ? Boolean(incomingPolicy.askForMedium) : defaults.securityPolicy.askForMedium,
        askForHigh: incomingPolicy.askForHigh !== undefined ? Boolean(incomingPolicy.askForHigh) : defaults.securityPolicy.askForHigh,
        askForBlacklist: incomingPolicy.askForBlacklist !== undefined ? Boolean(incomingPolicy.askForBlacklist) : defaults.securityPolicy.askForBlacklist
      }
    }
  }

  const allowedRootKeys = new Set(['security'])
  const allowedSecurityKeys = new Set([
    'enableCommandSecurity',
    'enableStrictMode',
    'blacklistPatterns',
    'whitelistPatterns',
    'dangerousCommands',
    'maxCommandLength',
    'securityPolicy'
  ])
  const allowedPolicyKeys = new Set(['blockCritical', 'askForMedium', 'askForHigh', 'askForBlacklist'])
  const changed =
    !isRecord(source) ||
    !isRecord(incomingRoot.security) ||
    !isRecord(incoming.securityPolicy) ||
    blacklist.changed ||
    whitelist.changed ||
    dangerous.changed ||
    incoming.enableCommandSecurity !== normalized.security.enableCommandSecurity ||
    incoming.enableStrictMode !== normalized.security.enableStrictMode ||
    incoming.maxCommandLength !== normalized.security.maxCommandLength ||
    incomingPolicy.blockCritical !== normalized.security.securityPolicy.blockCritical ||
    incomingPolicy.askForMedium !== normalized.security.securityPolicy.askForMedium ||
    incomingPolicy.askForHigh !== normalized.security.securityPolicy.askForHigh ||
    incomingPolicy.askForBlacklist !== normalized.security.securityPolicy.askForBlacklist ||
    Object.keys(incomingRoot).some((key) => !allowedRootKeys.has(key)) ||
    Object.keys(incoming).some((key) => !allowedSecurityKeys.has(key)) ||
    Object.keys(incomingPolicy).some((key) => !allowedPolicyKeys.has(key))

  return {
    normalized,
    changed
  }
}

const removeJsonComments = (content: string) =>
  content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*[\r\n]/gm, '')
    .trim()

const securityEditorContentFromFile = (content: string) => {
  if (!content.trim()) {
    return JSON.stringify(defaultSecuritySettings, null, 2)
  }
  const cleaned = removeJsonComments(content)
  if (!cleaned) {
    return content
  }
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    return content
  }
}

const parseSecurityEditorContent = (content: string) => JSON.parse(removeJsonComments(content))

const keywordHighlightSettingsSnapshotsMatch = (left: KeywordHighlightSettings, right: KeywordHighlightSettings) =>
  JSON.stringify(normalizeKeywordHighlightConfig(left).normalized) === JSON.stringify(normalizeKeywordHighlightConfig(right).normalized)

const securitySettingsSnapshotsMatch = (left: SecuritySettings, right: SecuritySettings) =>
  JSON.stringify(normalizeSecurityConfig(left).normalized) === JSON.stringify(normalizeSecurityConfig(right).normalized)

const privacyStatusValues = ['enabled', 'disabled'] as const
const privacyStatusFromOptions = (value: unknown, fallback: PrivacyUserConfig['telemetry']) =>
  stringFromOptions(value, privacyStatusValues, fallback)

const normalizePrivacyConfig = (source?: Partial<PrivacyUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalized: PrivacyUserConfig = {
    telemetry: privacyStatusFromOptions(incoming.telemetry, defaultPrivacySettings.telemetry),
    secretRedaction: privacyStatusFromOptions(incoming.secretRedaction, defaultPrivacySettings.secretRedaction),
    dataSync: privacyStatusFromOptions(incoming.dataSync, defaultPrivacySettings.dataSync)
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof PrivacyUserConfig>).some((key) => incoming[key] !== normalized[key])

  return {
    normalized,
    changed
  }
}

const privacyRuntimeValues = ['disabled', 'service', 'backend-double', 'local-file'] as const
const privacySyncStatusValues = ['disabled', 'idle', 'syncing', 'synced', 'error'] as const
const privacySyncedScopeValues = ['config', 'knowledge', 'chat', 'assets', 'skills'] as const

const isPrivacyRuntimeSnapshotForRequest = (source: unknown, expectedPrivacy: PrivacyUserConfig): source is PrivacyRuntimeApplyData =>
  isRecord(source) &&
  source.telemetry === expectedPrivacy.telemetry &&
  source.dataSync === expectedPrivacy.dataSync &&
  typeof source.appliedAt === 'string' &&
  source.appliedAt.trim() !== '' &&
  privacyRuntimeValues.includes(source.dataSyncRuntime as (typeof privacyRuntimeValues)[number]) &&
  (expectedPrivacy.dataSync === 'enabled' || source.dataSyncRuntime === 'disabled') &&
  (source.syncStatus === undefined || privacySyncStatusValues.includes(source.syncStatus as (typeof privacySyncStatusValues)[number])) &&
  (expectedPrivacy.dataSync === 'enabled' || source.syncStatus === undefined || source.syncStatus === 'disabled') &&
  (source.syncRunId === undefined || typeof source.syncRunId === 'string') &&
  (source.stateFilePath === undefined || typeof source.stateFilePath === 'string') &&
  (source.lastSyncAt === undefined || typeof source.lastSyncAt === 'string') &&
  (source.errorMessage === undefined || typeof source.errorMessage === 'string') &&
  (source.syncedScopes === undefined ||
    (Array.isArray(source.syncedScopes) && source.syncedScopes.every((scope) => privacySyncedScopeValues.includes(scope as (typeof privacySyncedScopeValues)[number])))) &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const privacyRuntimeSettingsFromSnapshot = (snapshot?: PrivacyRuntimeApplyData | null) => ({
  dataSyncRuntime: snapshot?.dataSyncRuntime || 'disabled',
  dataSyncStatus: snapshot?.syncStatus || (snapshot?.dataSync === 'enabled' ? 'idle' : 'disabled'),
  dataSyncRunId: snapshot?.syncRunId || '',
  dataSyncStateFilePath: snapshot?.stateFilePath || '',
  dataSyncLastSyncAt: snapshot?.lastSyncAt || '',
  dataSyncSyncedScopes: snapshot?.syncedScopes ? [...snapshot.syncedScopes] : [],
  dataSyncErrorMessage: snapshot?.errorMessage || ''
})

const reasoningEffortValues = ['low', 'medium', 'high'] as const
const proxyTypeValues: AiPreferenceSettings['proxy']['type'][] = ['HTTP', 'HTTPS', 'SOCKS4', 'SOCKS5']
const defaultAiPreferencesConfig = defaultConfig.aiPreferences!

const isAiPreferencesSnapshot = (source: unknown): source is AiPreferencesUserConfig => {
  if (!isRecord(source) || !isRecord(source.proxy)) return false
  return (
    typeof source.enableExtendedThinking === 'boolean' &&
    typeof source.thinkingBudgetTokens === 'number' &&
    Number.isFinite(source.thinkingBudgetTokens) &&
    typeof source.autoExecuteReadOnlyCommands === 'boolean' &&
    typeof source.commandOutputFilteringEnabled === 'boolean' &&
    typeof source.kbSearchEnabled === 'boolean' &&
    typeof source.experienceExtractionEnabled === 'boolean' &&
    typeof source.autoApproval === 'boolean' &&
    reasoningEffortValues.includes(source.reasoningEffort as AiPreferenceSettings['reasoningEffort']) &&
    typeof source.needProxy === 'boolean' &&
    proxyTypeValues.includes(source.proxy.type as AiPreferenceSettings['proxy']['type']) &&
    typeof source.proxy.host === 'string' &&
    typeof source.proxy.port === 'number' &&
    Number.isFinite(source.proxy.port) &&
    typeof source.proxy.enableProxyIdentity === 'boolean' &&
    typeof source.proxy.username === 'string' &&
    typeof source.proxy.password === 'string' &&
    typeof source.shellIntegrationTimeout === 'number' &&
    Number.isFinite(source.shellIntegrationTimeout)
  )
}

const isKnowledgeSearchRuntimeSnapshotForRequest = (source: unknown, expectedEnabled: boolean): source is KnowledgeSearchRuntimeApplyData =>
  isRecord(source) &&
  source.enabled === expectedEnabled &&
  source.source === 'settings' &&
  typeof source.appliedAt === 'string' &&
  source.appliedAt.trim() !== '' &&
  typeof source.message === 'string' &&
  source.message.trim() !== ''

const normalizeThinkingBudget = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value === 0) return 0
  return Math.min(6553, Math.max(1024, Math.round(value)))
}

const normalizeAiPreferencesConfig = (source?: Partial<AiPreferencesUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const incomingProxy: Record<string, unknown> = isRecord(incoming.proxy) ? incoming.proxy : {}
  const normalized: AiPreferenceSettings = {
    enableExtendedThinking: typeof incoming.enableExtendedThinking === 'boolean' ? incoming.enableExtendedThinking : defaultAiPreferencesConfig.enableExtendedThinking,
    thinkingBudgetTokens: normalizeThinkingBudget(incoming.thinkingBudgetTokens, defaultAiPreferencesConfig.thinkingBudgetTokens),
    autoExecuteReadOnlyCommands:
      typeof incoming.autoExecuteReadOnlyCommands === 'boolean' ? incoming.autoExecuteReadOnlyCommands : defaultAiPreferencesConfig.autoExecuteReadOnlyCommands,
    commandOutputFilteringEnabled:
      typeof incoming.commandOutputFilteringEnabled === 'boolean' ? incoming.commandOutputFilteringEnabled : defaultAiPreferencesConfig.commandOutputFilteringEnabled,
    kbSearchEnabled: typeof incoming.kbSearchEnabled === 'boolean' ? incoming.kbSearchEnabled : defaultAiPreferencesConfig.kbSearchEnabled,
    experienceExtractionEnabled:
      typeof incoming.experienceExtractionEnabled === 'boolean' ? incoming.experienceExtractionEnabled : defaultAiPreferencesConfig.experienceExtractionEnabled,
    autoApproval: typeof incoming.autoApproval === 'boolean' ? incoming.autoApproval : defaultAiPreferencesConfig.autoApproval,
    reasoningEffort: stringFromOptions(incoming.reasoningEffort, reasoningEffortValues, defaultAiPreferencesConfig.reasoningEffort),
    needProxy: typeof incoming.needProxy === 'boolean' ? incoming.needProxy : defaultAiPreferencesConfig.needProxy,
    proxy: {
      type: stringFromOptions(incomingProxy.type, proxyTypeValues, defaultAiPreferencesConfig.proxy.type),
      host: typeof incomingProxy.host === 'string' ? incomingProxy.host : defaultAiPreferencesConfig.proxy.host,
      port: numberInRange(incomingProxy.port, defaultAiPreferencesConfig.proxy.port, 1, 65535),
      enableProxyIdentity:
        typeof incomingProxy.enableProxyIdentity === 'boolean' ? incomingProxy.enableProxyIdentity : defaultAiPreferencesConfig.proxy.enableProxyIdentity,
      username: typeof incomingProxy.username === 'string' ? incomingProxy.username : defaultAiPreferencesConfig.proxy.username,
      password: typeof incomingProxy.password === 'string' ? incomingProxy.password : defaultAiPreferencesConfig.proxy.password
    },
    shellIntegrationTimeout: numberInRange(incoming.shellIntegrationTimeout, defaultAiPreferencesConfig.shellIntegrationTimeout, 1, 300)
  }

  if (!normalized.enableExtendedThinking) {
    normalized.thinkingBudgetTokens = 0
  } else if (normalized.thinkingBudgetTokens === 0) {
    normalized.thinkingBudgetTokens = 1024
  }

  const comparable = {
    ...incoming,
    proxy: incomingProxy
  }
  const changed = !isRecord(source) || JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const defaultModelSettingsConfig = defaultConfig.modelSettings!

const normalizeModelProviderConfig = (source: unknown, fallback: ModelProviderSettings): ModelProviderSettings => {
  const incoming = isRecord(source) ? source : {}
  return {
    baseUrl: typeof incoming.baseUrl === 'string' ? incoming.baseUrl.trim() : fallback.baseUrl,
    apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey : fallback.apiKey,
    modelId: typeof incoming.modelId === 'string' && incoming.modelId.trim() ? incoming.modelId.trim() : fallback.modelId,
    ...(fallback.apiFormat || incoming.apiFormat
      ? {
          apiFormat: stringFromOptions(incoming.apiFormat, modelApiFormats, fallback.apiFormat || 'chat-completions')
        }
      : {}),
    ...(fallback.awsAccessKey !== undefined || incoming.awsAccessKey !== undefined
      ? {
          awsAccessKey: typeof incoming.awsAccessKey === 'string' ? incoming.awsAccessKey : fallback.awsAccessKey || ''
        }
      : {}),
    ...(fallback.awsSecretKey !== undefined || incoming.awsSecretKey !== undefined
      ? {
          awsSecretKey: typeof incoming.awsSecretKey === 'string' ? incoming.awsSecretKey : fallback.awsSecretKey || ''
        }
      : {}),
    ...(fallback.awsSessionToken !== undefined || incoming.awsSessionToken !== undefined
      ? {
          awsSessionToken: typeof incoming.awsSessionToken === 'string' ? incoming.awsSessionToken : fallback.awsSessionToken || ''
        }
      : {}),
    ...(fallback.awsRegion !== undefined || incoming.awsRegion !== undefined
      ? {
          awsRegion: typeof incoming.awsRegion === 'string' && incoming.awsRegion.trim() ? incoming.awsRegion.trim() : fallback.awsRegion || 'us-east-1'
        }
      : {}),
    ...(fallback.awsUseCrossRegionInference !== undefined || incoming.awsUseCrossRegionInference !== undefined
      ? {
          awsUseCrossRegionInference:
            typeof incoming.awsUseCrossRegionInference === 'boolean'
              ? incoming.awsUseCrossRegionInference
              : Boolean(fallback.awsUseCrossRegionInference)
        }
      : {}),
    ...(fallback.awsEndpointSelected !== undefined || incoming.awsEndpointSelected !== undefined
      ? {
          awsEndpointSelected: typeof incoming.awsEndpointSelected === 'boolean' ? incoming.awsEndpointSelected : Boolean(fallback.awsEndpointSelected)
        }
      : {}),
    ...(fallback.awsBedrockEndpoint !== undefined || incoming.awsBedrockEndpoint !== undefined
      ? {
          awsBedrockEndpoint: typeof incoming.awsBedrockEndpoint === 'string' ? incoming.awsBedrockEndpoint.trim() : fallback.awsBedrockEndpoint || ''
        }
      : {})
  }
}

const normalizeModelSettingsConfig = (source?: unknown, fallbackOptions: ModelOptionUserConfig[] = defaultModelSettingsConfig.options) => {
  const incoming = isRecord(source) ? source : {}
  const incomingProviders = isRecord(incoming.providers) ? incoming.providers : {}
  const providers: ModelSettingsUserConfig['providers'] = {
    litellm: normalizeModelProviderConfig(incomingProviders.litellm, defaultModelSettingsConfig.providers.litellm),
    openai: normalizeModelProviderConfig(incomingProviders.openai, defaultModelSettingsConfig.providers.openai),
    bedrock: normalizeModelProviderConfig(incomingProviders.bedrock, defaultModelSettingsConfig.providers.bedrock),
    deepseek: normalizeModelProviderConfig(incomingProviders.deepseek, defaultModelSettingsConfig.providers.deepseek),
    anthropic: normalizeModelProviderConfig(incomingProviders.anthropic, defaultModelSettingsConfig.providers.anthropic),
    ollama: normalizeModelProviderConfig(incomingProviders.ollama, defaultModelSettingsConfig.providers.ollama),
    lmstudio: normalizeModelProviderConfig(incomingProviders.lmstudio, defaultModelSettingsConfig.providers.lmstudio)
  }

  const { normalized: options, changed: optionsChanged } = normalizeModelSettingsOptions(incoming.options, fallbackOptions)
  let changed = !isRecord(source) || !isRecord(incoming.providers) || optionsChanged

  const normalized: ModelSettingsUserConfig = {
    addModelSwitch: typeof incoming.addModelSwitch === 'boolean' ? incoming.addModelSwitch : defaultModelSettingsConfig.addModelSwitch,
    providers,
    options
  }
  if (incoming.addModelSwitch !== normalized.addModelSwitch || JSON.stringify(incomingProviders) !== JSON.stringify(providers)) {
    changed = true
  }

  return {
    normalized,
    changed
  }
}

const modelProviderSettingsMatch = (left: ModelProviderSettings, right: ModelProviderSettings) => JSON.stringify(left) === JSON.stringify(right)

const modelOptionsSnapshotsMatch = (left: ModelOptionUserConfig[], right: ModelOptionUserConfig[]) =>
  left.length === right.length &&
  left.every((item, index) => {
    const other = right[index]
    return (
      Boolean(other) &&
      item.name === other.name &&
      item.displayName === other.displayName &&
      item.locked === other.locked &&
      item.checked === other.checked &&
      item.type === other.type &&
      item.apiProvider === other.apiProvider
    )
  })

const modelSettingsSnapshotsMatch = (left: ModelSettingsUserConfig, right: ModelSettingsUserConfig) =>
  left.addModelSwitch === right.addModelSwitch &&
  modelProviderSettingsMatch(left.providers.litellm, right.providers.litellm) &&
  modelProviderSettingsMatch(left.providers.openai, right.providers.openai) &&
  modelProviderSettingsMatch(left.providers.bedrock, right.providers.bedrock) &&
  modelProviderSettingsMatch(left.providers.deepseek, right.providers.deepseek) &&
  modelProviderSettingsMatch(left.providers.anthropic, right.providers.anthropic) &&
  modelProviderSettingsMatch(left.providers.ollama, right.providers.ollama) &&
  modelProviderSettingsMatch(left.providers.lmstudio, right.providers.lmstudio) &&
  modelOptionsSnapshotsMatch(left.options, right.options)

const modelOptionProviderForSavedProvider = (provider: ModelProviderKey): string => (provider === 'openai' ? 'openai' : provider)

const normalizeQuickCommandsConfig = (source?: Partial<QuickCommandsUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const rawGroups = Array.isArray(incoming.groups) ? incoming.groups : defaultQuickCommands.groups
  const rawSnippets = Array.isArray(incoming.snippets) ? incoming.snippets : defaultQuickCommands.snippets
  const groupUuids = new Set<string>()
  const snippetIds = new Set<number>()
  const snippetUuids = new Set<string>()

  const groups = rawGroups
    .map((item, index): SnippetGroup | null => {
      if (!isRecord(item)) return null
      const groupName = typeof item.group_name === 'string' ? item.group_name.trim() : ''
      if (!groupName) return null
      const uuid = typeof item.uuid === 'string' ? item.uuid.trim() : ''
      if (!uuid) return null
      if (groupUuids.has(uuid)) return null
      groupUuids.add(uuid)
      return {
        id: integerInRange(item.id, index + 1, 1),
        uuid,
        group_name: groupName
      }
    })
    .filter(Boolean) as SnippetGroup[]

  const normalizedSnippets: QuickCommandSnippet[] = []
  rawSnippets.forEach((item, index) => {
    if (!isRecord(item)) return
    const snippetName = typeof item.snippet_name === 'string' ? item.snippet_name.trim() : ''
    const snippetContent = typeof item.snippet_content === 'string' ? item.snippet_content : ''
    if (!snippetName || !snippetContent) return

    let id = integerInRange(item.id, index + 1, 1)
    while (snippetIds.has(id)) id += 1
    snippetIds.add(id)

    const uuid = typeof item.uuid === 'string' ? item.uuid.trim() : ''
    if (!uuid) return
    if (snippetUuids.has(uuid)) return
    snippetUuids.add(uuid)

    const groupUuid = typeof item.group_uuid === 'string' && groupUuids.has(item.group_uuid) ? item.group_uuid : null
    const snippet: QuickCommandSnippet = {
      id,
      uuid,
      snippet_name: snippetName,
      snippet_content: snippetContent,
      group_uuid: groupUuid
    }
    if (typeof item.create_at === 'string') snippet.create_at = item.create_at
    if (typeof item.update_at === 'string') snippet.update_at = item.update_at
    normalizedSnippets.push(snippet)
  })

  const normalized: QuickCommandsUserConfig = {
    groups,
    snippets: normalizedSnippets
  }
  const comparable = {
    groups: Array.isArray(incoming.groups) ? incoming.groups : defaultQuickCommands.groups,
    snippets: Array.isArray(incoming.snippets) ? incoming.snippets : defaultQuickCommands.snippets
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.groups) ||
    !Array.isArray(incoming.snippets) ||
    JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const k8sResourceKinds: K8sResourceKind[] = ['pods', 'deployments', 'services', 'nodes']
const k8sResourceActions: K8sResourceAction[] = ['get', 'describe', 'logs']
const k8sRefreshKinds: Array<K8sResourceKind | 'all'> = [...k8sResourceKinds, 'all']
const k8sCommandSources: Array<K8sBackendCommandData['source']> = ['terminal', 'agent', 'resource']
const k8sConnectionStatuses: K8sConnectionStatus[] = ['connected', 'connecting', 'disconnected', 'error']
const k8sClusterSources: Array<K8sCluster['source_type']> = ['local', 'jumpserver']
const k8sTerminalStatuses: K8sTerminalStatus[] = ['connecting', 'connected', 'ended', 'error']

const isNonNegativeFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isPositiveFiniteNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0
const isK8sNumberFlag = (value: unknown) => value === 0 || value === 1
const isK8sOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const isK8sOptionalNonNegativeNumber = (value: unknown) => value === undefined || isNonNegativeFiniteNumber(value)
const isNumberOrNull = (value: unknown): value is number | null => value === null || isFiniteNumber(value)

const isK8sAgentProxyConfig = (source: unknown): source is K8sProxyConfig =>
  isRecord(source) &&
  typeof source.enabled === 'boolean' &&
  standardProxyTypes.includes(source.type as Exclude<SshProxyType, 'TCP'>) &&
  typeof source.host === 'string' &&
  isNonNegativeFiniteNumber(source.port) &&
  typeof source.enableProxyIdentity === 'boolean' &&
  typeof source.username === 'string' &&
  typeof source.password === 'string' &&
  typeof source.updatedAt === 'string'

const isK8sContextInfo = (source: unknown): source is K8sContextInfo =>
  isRecord(source) &&
  typeof source.name === 'string' &&
  typeof source.cluster === 'string' &&
  typeof source.namespace === 'string' &&
  typeof source.server === 'string' &&
  typeof source.isActive === 'boolean'

const isK8sClusterRecord = (source: unknown): source is K8sCluster =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.name === 'string' &&
  source.name.trim() !== '' &&
  isStringOrNull(source.kubeconfig_path) &&
  isStringOrNull(source.kubeconfig_content) &&
  typeof source.context_name === 'string' &&
  source.context_name.trim() !== '' &&
  typeof source.server_url === 'string' &&
  typeof source.auth_type === 'string' &&
  isK8sNumberFlag(source.is_active) &&
  k8sConnectionStatuses.includes(source.connection_status as K8sConnectionStatus) &&
  isK8sNumberFlag(source.auto_connect) &&
  typeof source.default_namespace === 'string' &&
  typeof source.created_at === 'string' &&
  typeof source.updated_at === 'string' &&
  k8sClusterSources.includes(source.source_type as K8sCluster['source_type']) &&
  isStringOrNull(source.bastion_uuid) &&
  isStringOrNull(source.bastion_asset_address) &&
  isStringOrNull(source.bastion_asset_name) &&
  isNumberOrNull(source.bastion_asset_id_last)

const isK8sBastionGroup = (source: unknown): source is K8sBastionGroup =>
  isRecord(source) && typeof source.uuid === 'string' && source.uuid.trim() !== '' && typeof source.label === 'string' && typeof source.ip === 'string'

const isK8sNamespaceInfo = (source: unknown): source is K8sNamespaceInfo =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  typeof source.name === 'string' &&
  typeof source.status === 'string' &&
  typeof source.age === 'string'

const isK8sResource = (source: unknown): source is K8sResource =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  k8sResourceKinds.includes(source.kind as K8sResourceKind) &&
  typeof source.name === 'string' &&
  typeof source.namespace === 'string' &&
  typeof source.status === 'string' &&
  typeof source.ready === 'string' &&
  typeof source.age === 'string' &&
  typeof source.detail === 'string' &&
  isK8sOptionalString(source.node) &&
  isK8sOptionalString(source.image) &&
  isK8sOptionalString(source.ports) &&
  isK8sOptionalNonNegativeNumber(source.restarts) &&
  isK8sOptionalString(source.selector)

const isK8sImportContextInfo = (source: unknown): source is K8sImportContextInfo =>
  isRecord(source) &&
  typeof source.name === 'string' &&
  source.name.trim() !== '' &&
  typeof source.cluster === 'string' &&
  typeof source.server === 'string' &&
  typeof source.namespace === 'string'

const isK8sCatalogSnapshot = (source: unknown): source is KubernetesCatalog => {
  if (
    !isRecord(source) ||
    !Array.isArray(source.contexts) ||
    !Array.isArray(source.clusters) ||
    !Array.isArray(source.bastions) ||
    !Array.isArray(source.namespaces) ||
    !Array.isArray(source.resources) ||
    !Array.isArray(source.importContexts) ||
    typeof source.currentContext !== 'string' ||
    !isStringOrNull(source.activeClusterId) ||
    !isStringOrNull(source.selectedClusterId) ||
    !isK8sAgentProxyConfig(source.agentProxyConfig)
  ) {
    return false
  }
  if (!source.contexts.every(isK8sContextInfo)) return false
  if (!source.clusters.every(isK8sClusterRecord)) return false
  if (!source.bastions.every(isK8sBastionGroup)) return false
  if (!source.namespaces.every(isK8sNamespaceInfo)) return false
  if (!source.resources.every(isK8sResource)) return false
  if (!source.importContexts.every(isK8sImportContextInfo)) return false
  const clusterIds = new Set(source.clusters.map((cluster) => cluster.id))
  if (source.activeClusterId && !clusterIds.has(source.activeClusterId)) return false
  if (source.selectedClusterId && !clusterIds.has(source.selectedClusterId)) return false
  return source.namespaces.every((namespace) => clusterIds.has(namespace.clusterId)) && source.resources.every((resource) => clusterIds.has(resource.clusterId))
}

const isK8sTerminalRecord = (source: unknown): source is KubernetesTerminalRecord =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.sessionId === 'string' &&
  source.sessionId.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  typeof source.name === 'string' &&
  typeof source.namespace === 'string' &&
  typeof source.output === 'string' &&
  k8sTerminalStatuses.includes(source.status as KubernetesTerminalStatus) &&
  isPositiveFiniteNumber(source.cols) &&
  isPositiveFiniteNumber(source.rows) &&
  typeof source.createdAt === 'string' &&
  typeof source.updatedAt === 'string'

const isK8sTerminalCloseData = (source: unknown): source is K8sTerminalCloseData => {
  if (!isK8sTerminalRecord(source) || source.status !== 'ended' || !isRecord(source)) return false
  return isFiniteNumber((source as Record<string, unknown>).exitCode)
}

const isK8sTerminalWriteDataForRequest = (source: unknown, expected: { id: string; data: string; command: string }): source is K8sTerminalWriteData => {
  if (
    !isRecord(source) ||
    typeof source.id !== 'string' ||
    typeof source.sessionId !== 'string' ||
    source.sessionId !== expected.id ||
    typeof source.bytes !== 'number' ||
    source.bytes !== new TextEncoder().encode(expected.data).byteLength ||
    typeof source.command !== 'string' ||
    normalizeK8sCommandText(source.command) !== normalizeK8sCommandText(expected.command) ||
    typeof source.output !== 'string' ||
    typeof source.success !== 'boolean' ||
    typeof source.error !== 'string' ||
    typeof source.terminalOutput !== 'string' ||
    typeof source.updatedAt !== 'string'
  ) {
    return false
  }
  return true
}

const isK8sTerminalDataEvent = (source: unknown): source is KubernetesTerminalDataEvent =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.sessionId === 'string' &&
  source.sessionId.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  typeof source.data === 'string' &&
  typeof source.command === 'string' &&
  typeof source.output === 'string' &&
  typeof source.success === 'boolean' &&
  typeof source.error === 'string' &&
  typeof source.emittedAt === 'string'

const isK8sTerminalExitEvent = (source: unknown): source is KubernetesTerminalExitEvent =>
  isRecord(source) &&
  typeof source.id === 'string' &&
  source.id.trim() !== '' &&
  typeof source.sessionId === 'string' &&
  source.sessionId.trim() !== '' &&
  typeof source.clusterId === 'string' &&
  source.clusterId.trim() !== '' &&
  isFiniteNumber(source.exitCode) &&
  (source.reason === 'closed' || source.reason === 'disconnect' || source.reason === 'error') &&
  (source.error === undefined || typeof source.error === 'string') &&
  typeof source.emittedAt === 'string'

const isK8sProxyConfigData = (source: unknown): source is K8sProxyConfigData =>
  isRecord(source) && isK8sAgentProxyConfig(source.proxyConfig) && typeof source.message === 'string'

const isK8sAgentCleanupData = (source: unknown): source is NonNullable<Awaited<ReturnType<AiopsPreloadApi['cleanupKubernetesAgent']>>['data']> =>
  isRecord(source) && source.cleared === true && typeof source.cleanedAt === 'string'

const isK8sContextSwitchData = (source: unknown, expectedContextName: string): source is KubernetesCatalog =>
  isK8sCatalogSnapshot(source) && isRecord(source) && source.currentContext === expectedContextName && source.contexts.some((context) => context.name === expectedContextName && context.isActive)

const isK8sClusterMutationData = (source: unknown, expectedClusterId?: string, expectedStatus?: K8sConnectionStatus): source is KubernetesCatalog & { cluster: KubernetesClusterRecord } => {
  if (!isRecord(source)) return false
  const record = source as Record<string, unknown>
  if (!isK8sCatalogSnapshot(source) || !isK8sClusterRecord(record.cluster)) return false
  const cluster = record.cluster
  if (expectedClusterId && cluster.id !== expectedClusterId) return false
  if (expectedStatus && cluster.connection_status !== expectedStatus) return false
  return source.clusters.some((item) => item.id === cluster.id)
}

const isK8sClusterDeleteData = (source: unknown, deletedClusterId: string): source is KubernetesCatalog =>
  isK8sCatalogSnapshot(source) && !source.clusters.some((cluster) => cluster.id === deletedClusterId)

const isK8sBastionSyncData = (source: unknown): source is KubernetesCatalog & { syncedCount: number; updatedCount: number } => {
  if (!isRecord(source) || !isK8sCatalogSnapshot(source)) return false
  const record = source as Record<string, unknown>
  return isNonNegativeFiniteNumber(record.syncedCount) && isNonNegativeFiniteNumber(record.updatedCount)
}

const isK8sKubeconfigImportData = (source: unknown): source is K8sKubeconfigImportData =>
  isRecord(source) &&
  typeof source.requestId === 'string' &&
  Array.isArray(source.contexts) &&
  source.contexts.every(isK8sImportContextInfo) &&
  typeof source.kubeconfigPath === 'string' &&
  typeof source.kubeconfigContent === 'string' &&
  typeof source.currentContext === 'string'

const isK8sKubeconfigImportDataForRequest = (source: unknown, expected: K8sKubeconfigImportRequest): source is K8sKubeconfigImportData => {
  if (!isK8sKubeconfigImportData(source)) return false
  if (source.requestId !== expected.requestId) return false
  if (!source.contexts.length) return false
  if (expected.kubeconfigPath !== undefined && source.kubeconfigPath !== expected.kubeconfigPath) return false
  if (expected.kubeconfigContent !== undefined && source.kubeconfigContent !== expected.kubeconfigContent) return false
  if (source.currentContext && !source.contexts.some((context) => context.name === source.currentContext)) return false
  return source.contexts.every((context) => {
    if (!context.name.trim() || !context.cluster.trim()) return false
    if (context.server.trim() === '') return false
    if (source.currentContext && context.name === source.currentContext) return true
    return true
  })
}

const isK8sClusterTestData = (source: unknown): source is K8sClusterTestData =>
  isRecord(source) &&
  typeof source.success === 'boolean' &&
  typeof source.isValid === 'boolean' &&
  typeof source.contextName === 'string' &&
  typeof source.serverUrl === 'string' &&
  typeof source.message === 'string' &&
  isK8sOptionalString(source.command) &&
  isK8sOptionalString(source.output) &&
  isK8sOptionalString(source.error) &&
  isK8sOptionalNonNegativeNumber(source.durationMs)

const isK8sClusterTestDataForRequest = (source: unknown, expected: Partial<KubernetesClusterTestInput>): source is K8sClusterTestData => {
  if (!isK8sClusterTestData(source)) return false
  if (source.success !== source.isValid) return false
  if (expected.contextName !== undefined && source.contextName !== expected.contextName) return false
  if (expected.serverUrl !== undefined && expected.serverUrl !== null && expected.serverUrl.trim() && source.serverUrl !== expected.serverUrl.trim()) return false
  return true
}

const normalizeK8sCommandText = (value: string) => value.trim().replace(/\s+/g, ' ')
const expectedK8sResourceNamespace = (resource: K8sResource) => (resource.kind === 'nodes' ? 'all' : resource.namespace)

const isK8sBackendCommandData = (source: unknown): source is K8sBackendCommandData =>
  isRecord(source) &&
  typeof source.runId === 'string' &&
  source.runId.trim() !== '' &&
  typeof source.command === 'string' &&
  typeof source.output === 'string' &&
  typeof source.terminalOutput === 'string' &&
  typeof source.success === 'boolean' &&
  typeof source.error === 'string' &&
  isNonNegativeFiniteNumber(source.durationMs) &&
  typeof source.startedAt === 'string' &&
  typeof source.clusterId === 'string' &&
  typeof source.contextName === 'string' &&
  typeof source.namespace === 'string' &&
  k8sCommandSources.includes(source.source as K8sBackendCommandData['source'])

const isK8sBackendCommandForRequest = (
  source: unknown,
  expected: { command?: string; clusterId?: string; namespace?: string; source?: K8sBackendCommandData['source'] } = {}
): source is K8sBackendCommandData => {
  if (!isK8sBackendCommandData(source)) return false
  const hasBackendOutput = source.output.trim() !== '' || source.error.trim() !== '' || source.terminalOutput.trim() !== ''
  if (!hasBackendOutput) return false
  if (source.terminalOutput.trim() && !normalizeK8sCommandText(source.terminalOutput).includes(normalizeK8sCommandText(source.command))) return false
  if (expected.command !== undefined) {
    const expectedCommand = normalizeK8sCommandText(expected.command)
    const actualCommand = normalizeK8sCommandText(source.command)
    if (expectedCommand ? actualCommand !== expectedCommand : actualCommand !== '<empty>') return false
  }
  if (expected.clusterId !== undefined && source.clusterId !== expected.clusterId) return false
  if (expected.namespace !== undefined && source.namespace !== expected.namespace) return false
  if (expected.source !== undefined && source.source !== expected.source) return false
  return true
}

const k8sCommandDisplayOutput = (result: { command: string; output?: string; error?: string }) => {
  const body = (result.output || '').trim() || (result.error || '').trim()
  return body ? `${result.command}\n\n${body}` : result.command
}

const isK8sResourceActionPlanData = (
  source: unknown,
  expected: { resourceId?: string; action?: K8sResourceAction; resource?: K8sResource } = {}
): source is K8sBackendResourceActionPlanData => {
  if (
    !isRecord(source) ||
    typeof source.resourceId !== 'string' ||
    source.resourceId.trim() === '' ||
    typeof source.resourceName !== 'string' ||
    source.resourceName.trim() === '' ||
    !k8sResourceKinds.includes(source.resourceKind as K8sResourceKind) ||
    !k8sResourceActions.includes(source.action as K8sResourceAction) ||
    typeof source.title !== 'string' ||
    source.title.trim() === '' ||
    typeof source.command !== 'string' ||
    source.command.trim() === '' ||
    typeof source.clusterId !== 'string' ||
    source.clusterId.trim() === '' ||
    typeof source.clusterName !== 'string' ||
    typeof source.contextName !== 'string' ||
    typeof source.namespace !== 'string'
  ) {
    return false
  }
  if (expected.resourceId !== undefined && source.resourceId !== expected.resourceId) return false
  if (expected.action !== undefined && source.action !== expected.action) return false
  if (expected.resource) {
    if (source.clusterId !== expected.resource.clusterId) return false
    if (source.resourceName !== expected.resource.name) return false
    if (source.resourceKind !== expected.resource.kind) return false
    if (source.namespace !== expectedK8sResourceNamespace(expected.resource)) return false
  }
  return true
}

const isK8sBackendResourceActionData = (
  source: unknown,
  expected: { resourceId?: string; action?: K8sResourceAction; resource?: K8sResource } = {}
): source is K8sBackendResourceActionData => {
  if (!isK8sBackendCommandForRequest(source, { clusterId: expected.resource?.clusterId, namespace: expected.resource ? expectedK8sResourceNamespace(expected.resource) : undefined, source: 'resource' }) || !isRecord(source)) return false
  const record = source as Record<string, unknown>
  const valid =
    typeof record.resourceId === 'string' &&
    record.resourceId.trim() !== '' &&
    typeof record.resourceName === 'string' &&
    record.resourceName.trim() !== '' &&
    k8sResourceKinds.includes(record.resourceKind as K8sResourceKind) &&
    k8sResourceActions.includes(record.action as K8sResourceAction) &&
    typeof record.title === 'string' &&
    record.title.trim() !== ''
  if (!valid) return false
  if (expected.resourceId !== undefined && record.resourceId !== expected.resourceId) return false
  if (expected.action !== undefined && record.action !== expected.action) return false
  if (expected.resource) {
    if (record.resourceName !== expected.resource.name) return false
    if (record.resourceKind !== expected.resource.kind) return false
  }
  return true
}

const isK8sBackendResourceRefreshData = (
  source: unknown,
  expected: { clusterId?: string; kind?: K8sResourceKind | 'all'; namespace?: string } = {}
): source is K8sBackendResourceRefreshData => {
  if (
    !isK8sBackendCommandForRequest(source, { clusterId: expected.clusterId, namespace: expected.namespace, source: 'resource' }) ||
    !isK8sCatalogSnapshot(source) ||
    !isRecord(source)
  ) {
    return false
  }
  const record = source as Record<string, unknown>
  const valid =
    typeof record.refreshedClusterId === 'string' &&
    k8sRefreshKinds.includes(record.refreshedKind as K8sResourceKind | 'all') &&
    isNonNegativeFiniteNumber(record.refreshedResources) &&
    isNonNegativeFiniteNumber(record.refreshedNamespaces) &&
    typeof record.message === 'string'
  if (!valid) return false
  if (expected.clusterId !== undefined && (source.clusterId !== expected.clusterId || record.refreshedClusterId !== expected.clusterId)) return false
  if (expected.kind !== undefined && record.refreshedKind !== expected.kind) return false
  return true
}

const aiChatHistoryMessageRoles: AiChatHistoryMessage['role'][] = ['user', 'assistant', 'system']
const aiChatMessageStates: AiChatMessageState[] = ['streaming', 'done', 'cancelled', 'error']
const aiChatFeedbackValues: NonNullable<AiChatHistoryMessage['feedback']>[] = ['up', 'down']
const aiChatAskValues: NonNullable<AiChatHistoryMessage['ask']>[] = ['command', 'mcp_tool_call', 'mcp_resource_access', 'followup']
const aiChatSayValues: NonNullable<AiChatHistoryMessage['say']>[] = ['command', 'command_output', 'search_result', 'context_truncated']
const aiChatActionValues: NonNullable<AiChatHistoryMessage['action']>[] = ['approved', 'rejected']
const aiChatCommandExecutionStatusValues: NonNullable<AiChatHistoryMessage['commandExecutionStatus']>[] = ['pending', 'running', 'succeeded', 'failed']
const aiChatModes: NonNullable<AiChatResponseInput['mode']>[] = ['agent', 'command', 'chat']
const aiSupportedImageTypes: AiSupportedImageType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml']
const aiProviderKeys = ['aiopsterm-local', 'litellm', 'openai', 'bedrock', 'deepseek', 'anthropic', 'ollama']

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string'
const isOptionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'
const isOptionalFiniteNumber = (value: unknown) => value === undefined || (typeof value === 'number' && Number.isFinite(value))
const isOptionalNonNegativeFiniteNumber = (value: unknown) => value === undefined || isNonNegativeFiniteNumber(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isAiProviderKey = (value: unknown) => typeof value === 'string' && aiProviderKeys.includes(value)

const isAiHistoryHostContext = (source: unknown): source is AiChatHistoryHost =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  source.kind === 'hosts' &&
  isNonEmptyString(source.label) &&
  isOptionalString(source.detail)

const isAiDocChipRef = (source: unknown): source is AiDocChipRef =>
  isRecord(source) &&
  isNonEmptyString(source.absPath) &&
  isOptionalString(source.relPath) &&
  isOptionalString(source.name) &&
  (source.type === undefined || source.type === 'file' || source.type === 'dir') &&
  isOptionalFiniteNumber(source.startLine) &&
  isOptionalFiniteNumber(source.endLine)

const isAiChatChipRef = (source: unknown): source is AiChatChipRef =>
  isRecord(source) && isNonEmptyString(source.taskId) && isOptionalString(source.title)

const isAiCommandChipRef = (source: unknown): source is AiCommandChipRef =>
  isRecord(source) &&
  isNonEmptyString(source.command) &&
  isOptionalString(source.label) &&
  isOptionalFiniteNumber(source.summarizeUpToTs) &&
  isOptionalString(source.path)

const isAiSkillChipRef = (source: unknown): source is AiSkillChipRef =>
  isRecord(source) && isNonEmptyString(source.skillName) && isOptionalString(source.description)

const isAiContentPart = (source: unknown): source is AiContentPart => {
  if (!isRecord(source)) return false
  if (source.type === 'text') return typeof source.text === 'string'
  if (source.type === 'image') {
    return aiSupportedImageTypes.includes(source.mediaType as AiSupportedImageType) && isNonEmptyString(source.data) && isOptionalString(source.name)
  }
  if (source.type !== 'chip') return false
  if (source.chipType === 'doc') return isAiDocChipRef(source.ref)
  if (source.chipType === 'chat') return isAiChatChipRef(source.ref)
  if (source.chipType === 'command') return isAiCommandChipRef(source.ref)
  if (source.chipType === 'skill') return isAiSkillChipRef(source.ref)
  return false
}

const isAiChatCommandExecution = (source: unknown): source is NonNullable<AiChatHistoryMessage['commandExecution']> =>
  isRecord(source) &&
  isNonEmptyString(source.ip) &&
  isNonEmptyString(source.command) &&
  typeof source.requiresApproval === 'boolean' &&
  typeof source.interactive === 'boolean'

const isAiChatHistoryMessage = (source: unknown): source is AiChatHistoryMessage =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  aiChatHistoryMessageRoles.includes(source.role as AiChatHistoryMessage['role']) &&
  typeof source.text === 'string' &&
  (source.contentParts === undefined || (Array.isArray(source.contentParts) && source.contentParts.every(isAiContentPart))) &&
  (source.hosts === undefined || (Array.isArray(source.hosts) && source.hosts.every(isAiHistoryHostContext))) &&
  (source.state === undefined || aiChatMessageStates.includes(source.state as AiChatMessageState)) &&
  isOptionalBoolean(source.favorite) &&
  (source.feedback === undefined || aiChatFeedbackValues.includes(source.feedback as NonNullable<AiChatHistoryMessage['feedback']>)) &&
  isOptionalString(source.executedCommand) &&
  (source.commandExecutionStatus === undefined ||
    aiChatCommandExecutionStatusValues.includes(source.commandExecutionStatus as NonNullable<AiChatHistoryMessage['commandExecutionStatus']>)) &&
  isOptionalString(source.commandExecutionMessage) &&
  (source.ask === undefined || aiChatAskValues.includes(source.ask as NonNullable<AiChatHistoryMessage['ask']>)) &&
  (source.say === undefined || aiChatSayValues.includes(source.say as NonNullable<AiChatHistoryMessage['say']>)) &&
  (source.action === undefined || aiChatActionValues.includes(source.action as NonNullable<AiChatHistoryMessage['action']>)) &&
  (source.commandExecution === undefined || isAiChatCommandExecution(source.commandExecution)) &&
  (source.mcpToolCall === undefined ||
    (isRecord(source.mcpToolCall) &&
      isNonEmptyString(source.mcpToolCall.serverName) &&
      isNonEmptyString(source.mcpToolCall.toolName) &&
      (source.mcpToolCall.arguments === undefined || isRecord(source.mcpToolCall.arguments)))) &&
  (source.mcpResourceAccess === undefined ||
    (isRecord(source.mcpResourceAccess) && isNonEmptyString(source.mcpResourceAccess.serverName) && isNonEmptyString(source.mcpResourceAccess.uri))) &&
  (source.followupOptions === undefined || (Array.isArray(source.followupOptions) && source.followupOptions.every((item) => typeof item === 'string'))) &&
  isOptionalString(source.selectedOption) &&
  isOptionalBoolean(source.partial)

const isAiChatConversationRecord = (source: unknown): source is AiChatConversationRecord =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  typeof source.title === 'string' &&
  typeof source.summary === 'string' &&
  typeof source.updatedAt === 'string' &&
  isNonNegativeFiniteNumber(source.ts) &&
  isOptionalString(source.ipAddress) &&
  isOptionalBoolean(source.favorite)

const isAiChatHistorySnapshotData = (source: unknown): source is AiChatHistorySnapshotData =>
  isRecord(source) &&
  Array.isArray(source.conversations) &&
  source.conversations.every(isAiChatConversationRecord) &&
  typeof source.selectedConversationId === 'string'

const isAiChatConversationMutationData = (source: unknown): source is AiChatConversationMutationData =>
  isRecord(source) &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.conversations) &&
  source.conversations.every(isAiChatConversationRecord) &&
  typeof source.selectedConversationId === 'string' &&
  source.conversations.some((conversation) => conversation.id === (source.conversation as AiChatConversationRecord).id)

const isAiChatConversationDeleteData = (source: unknown): source is AiChatConversationDeleteData =>
  isRecord(source) && isNonEmptyString(source.deletedId) && isAiChatHistorySnapshotData(source)

const isAiChatConversationRestoreData = (source: unknown): source is AiChatConversationRestoreData =>
  isRecord(source) &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage) &&
  isOptionalNonNegativeFiniteNumber(source.totalMessages) &&
  isOptionalNonNegativeFiniteNumber(source.returnedMessages) &&
  isOptionalBoolean(source.truncated)

const isAiChatMessageMetadataData = (source: unknown): source is AiChatMessageMetadataData =>
  isRecord(source) &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage)

const isAiChatMessageInput = (source: unknown): source is AiChatMessageInput =>
  isRecord(source) &&
  aiChatHistoryMessageRoles.includes(source.role as AiChatMessageInput['role']) &&
  typeof source.text === 'string' &&
  (source.ask === undefined || aiChatAskValues.includes(source.ask as NonNullable<AiChatMessageInput['ask']>)) &&
  (source.say === undefined || aiChatSayValues.includes(source.say as NonNullable<AiChatMessageInput['say']>)) &&
  (source.action === undefined || aiChatActionValues.includes(source.action as NonNullable<AiChatMessageInput['action']>)) &&
  (source.commandExecution === undefined || isAiChatCommandExecution(source.commandExecution))

const isAiChatContextInput = (source: unknown): source is NonNullable<AiChatResponseInput['contexts']>[number] =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  isNonEmptyString(source.kind) &&
  isNonEmptyString(source.label) &&
  isOptionalString(source.detail) &&
  isOptionalString(source.relPath) &&
  isOptionalString(source.mediaType)

const isAiChatCommandInput = (source: unknown): source is NonNullable<AiChatResponseInput['command']> => {
  if (!isRecord(source)) return false
  return (
    isOptionalString(source.id) &&
    isOptionalString(source.label) &&
    isOptionalString(source.command) &&
    isOptionalString(source.path) &&
    [source.id, source.label, source.command].some(isNonEmptyString)
  )
}

const isAiChatSkillInput = (source: unknown): source is NonNullable<AiChatResponseInput['skills']>[number] =>
  isRecord(source) && isNonEmptyString(source.name) && isOptionalString(source.description) && isOptionalString(source.content)

const isAiContextUsageSnapshot = (source: unknown): source is AiContextUsage =>
  isRecord(source) &&
  isNonNegativeFiniteNumber(source.used) &&
  isPositiveFiniteNumber(source.contextWindow) &&
  isNonNegativeFiniteNumber(source.percent) &&
  source.percent <= 100 &&
  (source.tokensIn === undefined || isNonNegativeFiniteNumber(source.tokensIn)) &&
  (source.tokensOut === undefined || isNonNegativeFiniteNumber(source.tokensOut)) &&
  (source.cacheWrites === undefined || isNonNegativeFiniteNumber(source.cacheWrites)) &&
  (source.cacheReads === undefined || isNonNegativeFiniteNumber(source.cacheReads)) &&
  source.source === 'backend' &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId)

const isAiContextUsageForRequest = (source: unknown, requestId: string, assistantMessageId: string): source is AiContextUsage =>
  isAiContextUsageSnapshot(source) && source.requestId === requestId && source.assistantMessageId === assistantMessageId

const isAiChatResponseInput = (source: unknown): source is AiChatResponseInput =>
  isRecord(source) &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId) &&
  isNonEmptyString(source.prompt) &&
  (source.messages === undefined || (Array.isArray(source.messages) && source.messages.every(isAiChatMessageInput))) &&
  (source.contexts === undefined || (Array.isArray(source.contexts) && source.contexts.every(isAiChatContextInput))) &&
  (source.skills === undefined || (Array.isArray(source.skills) && source.skills.every(isAiChatSkillInput))) &&
  (source.command === undefined || source.command === null || isAiChatCommandInput(source.command)) &&
  isOptionalString(source.model) &&
  (source.mode === undefined || aiChatModes.includes(source.mode as NonNullable<AiChatResponseInput['mode']>))

const isAiChatExchangeRequestData = (source: unknown): source is AiChatExchangeRequestData =>
  isRecord(source) &&
  isNonEmptyString(source.requestId) &&
  isAiChatHistoryMessage(source.userMessage) &&
  source.userMessage.role === 'user' &&
  isAiChatHistoryMessage(source.assistantMessage) &&
  source.assistantMessage.role === 'assistant' &&
  isAiChatResponseInput(source.responseInput) &&
  (source.contextUsage === undefined || isAiContextUsageSnapshot(source.contextUsage))

const isAiChatResponseData = (source: unknown): source is AiChatResponseData =>
  isRecord(source) &&
  isNonEmptyString(source.text) &&
  isAiProviderKey(source.provider) &&
  isNonEmptyString(source.model) &&
  isNonNegativeFiniteNumber(source.durationMs) &&
  (source.status === undefined || source.status === 'done' || source.status === 'cancelled') &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId) &&
  (source.message === undefined || isAiChatHistoryMessage(source.message)) &&
  (source.contextUsage === undefined || isAiContextUsageSnapshot(source.contextUsage))

const aiChatRequestIdFromAssistantMessageId = (assistantMessageId: string) =>
  assistantMessageId.endsWith('-assistant') ? assistantMessageId.slice(0, -'-assistant'.length) : ''

const aiBridgeErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

const isAiChatExchangeRequestDataForRequest = (source: unknown): source is AiChatExchangeRequestData => {
  if (!isAiChatExchangeRequestData(source)) return false
  const requestId = source.requestId.trim()
  const userMessageId = source.userMessage.id.trim()
  const assistantMessageId = source.assistantMessage.id.trim()
  const responseRequestId = source.responseInput.requestId?.trim()
  const responseAssistantMessageId = source.responseInput.assistantMessageId?.trim()
  return (
    userMessageId === `${requestId}-user` &&
    assistantMessageId === `${requestId}-assistant` &&
    responseRequestId === requestId &&
    responseAssistantMessageId === assistantMessageId
  )
}

const isAiChatResponseDataForRequest = (source: unknown, requestId: string, assistantMessageId: string): source is AiChatResponseData => {
  if (!isAiChatResponseData(source)) return false
  if (source.requestId !== requestId || source.assistantMessageId !== assistantMessageId) return false
  if (source.message && source.message.id !== assistantMessageId) return false
  return true
}

const isAiChatCancelDataForRequest = (source: unknown, requestId: string, assistantMessageId: string): source is AiChatCancelData =>
  isAiChatCancelData(source) && source.requestId === requestId && source.assistantMessageId === assistantMessageId

const isAiMcpToolCallActionData = (source: unknown): source is AiMcpToolCallActionData =>
  isRecord(source) &&
  (source.status === 'approved' || source.status === 'rejected') &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage) &&
  (source.mcpConfig === undefined ||
    (isRecord(source.mcpConfig) &&
      isRecord(source.mcpConfig.mcpConfig) &&
      Array.isArray(source.mcpConfig.mcpServers) &&
      isRecord(source.mcpConfig.mcpToolStates)))

const isAiMcpResourceAccessActionData = (source: unknown): source is AiMcpResourceAccessActionData =>
  isRecord(source) &&
  (source.status === 'approved' || source.status === 'rejected') &&
  isAiChatConversationRecord(source.conversation) &&
  Array.isArray(source.messages) &&
  source.messages.every(isAiChatHistoryMessage)

const isAiChatCancelData = (source: unknown): source is AiChatCancelData =>
  isRecord(source) &&
  source.status === 'cancelled' &&
  isOptionalString(source.requestId) &&
  isOptionalString(source.assistantMessageId) &&
  isNonEmptyString(source.text) &&
  typeof source.active === 'boolean' &&
  (source.contextUsage === undefined || isAiContextUsageSnapshot(source.contextUsage))

const isTerminalCommandGenerationContext = (source: unknown): source is TerminalCommandGenerationContext =>
  isRecord(source) &&
  isNonEmptyString(source.host) &&
  isNonEmptyString(source.username) &&
  typeof source.cwd === 'string' &&
  isNonEmptyString(source.shell) &&
  (source.connectionType === 'local' || source.connectionType === 'ssh')

const isTerminalCommandGenerationRecord = (source: unknown): source is TerminalCommandGenerationRecord =>
  isRecord(source) &&
  isNonEmptyString(source.id) &&
  isNonEmptyString(source.panelId) &&
  isNonEmptyString(source.instruction) &&
  isNonEmptyString(source.command) &&
  isNonEmptyString(source.modelName) &&
  isTerminalCommandGenerationContext(source.context) &&
  source.status === 'done' &&
  isNonNegativeFiniteNumber(source.createdAt) &&
  isAiProviderKey(source.provider)

const normalizeKnowledgeNodes = (source: unknown, parentRelDir = '', seen = new Set<string>()): KnowledgeNode[] => {
  const rawNodes = Array.isArray(source) ? source : []
  const nodes: KnowledgeNode[] = []
  rawNodes.forEach((item, index) => {
    if (!isRecord(item)) return
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : ''
    if (!rawTitle) return
    const type = item.type === 'dir' || item.type === 'file' ? item.type : 'file'
    const fallbackRelPath = createKbRelPath(parentRelDir, rawTitle)
    const relPath = typeof item.relPath === 'string' && item.relPath.trim() ? item.relPath.trim() : fallbackRelPath
    if (!relPath || seen.has(relPath)) return
    seen.add(relPath)
    const node: KnowledgeNode = {
      id: typeof item.id === 'string' && item.id.trim() ? item.id : `kb-${relPath.replace(/[^a-zA-Z0-9_-]/g, '-') || index}`,
      key: relPath,
      relPath,
      title: rawTitle,
      type
    }
    if (type === 'file') {
      node.size = numberInRange(item.size, 0, 0)
    } else {
      node.children = normalizeKnowledgeNodes(item.children, relPath, seen)
    }
    nodes.push(node)
  })
  return nodes
}

const normalizeKnowledgeBaseConfig = (source?: Partial<KnowledgeBaseUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const normalizedTree = normalizeKnowledgeNodes(Array.isArray(incoming.tree) ? incoming.tree : defaultKnowledgeBase.tree)
  const normalized: KnowledgeBaseUserConfig = {
    tree: normalizedTree,
    usedBytes: numberInRange(incoming.usedBytes, defaultKnowledgeBase.usedBytes, 0),
    totalBytes: numberInRange(incoming.totalBytes, defaultKnowledgeBase.totalBytes, 1)
  }
  if (normalized.usedBytes === 0 && normalizedTree.length > 0 && incoming.usedBytes === undefined) {
    normalized.usedBytes = knowledgeTreeSize(normalizedTree)
  }
  const comparable = {
    tree: Array.isArray(incoming.tree) ? incoming.tree : defaultKnowledgeBase.tree,
    usedBytes: typeof incoming.usedBytes === 'number' ? incoming.usedBytes : defaultKnowledgeBase.usedBytes,
    totalBytes: typeof incoming.totalBytes === 'number' ? incoming.totalBytes : defaultKnowledgeBase.totalBytes
  }
  const changed =
    !isRecord(source) ||
    !Array.isArray(incoming.tree) ||
    typeof incoming.usedBytes !== 'number' ||
    typeof incoming.totalBytes !== 'number' ||
    JSON.stringify(comparable) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const normalizeAliasCommandsConfig = (source?: AliasCommandConfig[]) => {
  const rawCommands = Array.isArray(source) ? source : defaultAliasCommands
  const seenAliases = new Set<string>()
  const seenIds = new Set<string>()
  const normalized: AliasCommandConfig[] = []

  rawCommands.forEach((item, index) => {
    if (!isRecord(item)) return
    const alias = typeof item.alias === 'string' ? item.alias.trim() : ''
    const command = typeof item.command === 'string' ? item.command.trim() : ''
    if (!alias || !command || seenAliases.has(alias)) return
    let id = typeof item.id === 'string' && item.id.trim() && item.id !== 'new' ? item.id.trim() : ''
    if (!id) return
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenAliases.add(alias)
    seenIds.add(id)
    const commandConfig: AliasCommandConfig = { id, alias, command }
    if (typeof item.createdAt === 'number' && Number.isFinite(item.createdAt)) {
      commandConfig.createdAt = item.createdAt
    }
    normalized.push(commandConfig)
  })

  const changed = !Array.isArray(source) || JSON.stringify(source) !== JSON.stringify(normalized)

  return {
    normalized,
    changed
  }
}

const getShortcutParts = (shortcut: string) => shortcut.split('+').map((part) => part.trim()).filter(Boolean)

const isValidShortcutForAction = (actionId: string, shortcut: string) => {
  const parts = getShortcutParts(shortcut)
  if (!parts.length) return false
  if (actionId !== 'switchToSpecificTab') return true

  const hasDigit = parts.some((part) => /^\d$/.test(part))
  const hasModifier = parts.some((part) => shortcutModifierTokens.has(part.toLowerCase()))
  return !hasDigit && hasModifier
}

const normalizeShortcutsConfig = (source?: unknown) => {
  const shortcutsById = new Map<string, ShortcutUserConfig>()
  let changed = !Array.isArray(source)

  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (!isRecord(item)) {
        changed = true
        return
      }
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const action = typeof item.action === 'string' && item.action.trim() ? item.action.trim() : id
      const shortcut = typeof item.shortcut === 'string' ? item.shortcut.trim() : ''
      if (!id || !action || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) {
        changed = true
        return
      }
      const normalizedShortcut: ShortcutUserConfig = {
        id,
        action,
        shortcut,
        ...(typeof item.suffix === 'string' && item.suffix.trim() ? { suffix: item.suffix.trim() } : {})
      }
      shortcutsById.set(id, normalizedShortcut)
      const allowedKeys = new Set(['id', 'action', 'shortcut', 'suffix'])
      if (
        item.id !== id ||
        item.shortcut !== shortcut ||
        item.action !== action ||
        item.suffix !== normalizedShortcut.suffix ||
        Object.keys(item).some((key) => !allowedKeys.has(key))
      ) {
        changed = true
      }
    })
  } else if (isRecord(source)) {
    Object.entries(source).forEach(([id, value]) => {
      const defaultShortcut = shortcutDefaultsById.get(id)
      const shortcut = typeof value === 'string' ? value.trim() : ''
      if (!defaultShortcut || !shortcut || shortcutsById.has(id) || !isValidShortcutForAction(id, shortcut)) {
        changed = true
        return
      }
      shortcutsById.set(id, { ...defaultShortcut, shortcut })
      if (value !== shortcut) changed = true
    })
  }

  const normalized = Array.from(shortcutsById.values())

  return {
    normalized,
    changed
  }
}

const normalizeRulesConfig = (source?: unknown, customInstructions?: unknown) => {
  const rawRules = Array.isArray(source) ? source : defaultRules
  const seenIds = new Set<string>()
  const normalized: UserRuleConfig[] = []
  let changed = !Array.isArray(source)

  rawRules.forEach((item, index) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!content) {
      changed = true
      return
    }
    let id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) {
      changed = true
      return
    }
    while (seenIds.has(id)) id = `${id}-${index + 1}`
    seenIds.add(id)
    const rule = {
      id,
      content,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true
    }
    normalized.push(rule)
    const allowedKeys = new Set(['id', 'content', 'enabled'])
    if (
      item.id !== rule.id ||
      item.content !== rule.content ||
      item.enabled !== rule.enabled ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  const migratedInstruction = typeof customInstructions === 'string' ? customInstructions.trim() : ''
  if (migratedInstruction) {
    let id = 'rule-custom-instructions'
    let suffix = 1
    while (seenIds.has(id)) {
      suffix += 1
      id = `rule-custom-instructions-${suffix}`
    }
    normalized.unshift({
      id,
      content: migratedInstruction,
      enabled: true
    })
    changed = true
  }

  return {
    normalized,
    changed
  }
}

const normalizeSkillsConfig = (source?: unknown) => {
  const rawSkills = Array.isArray(source) ? source : defaultSkills
  const seenNames = new Set<string>()
  const normalized: SkillUserConfig[] = []
  let changed = !Array.isArray(source)

  rawSkills.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (!name || !description || !content || seenNames.has(name)) {
      changed = true
      return
    }
    seenNames.add(name)
    const skill: SkillUserConfig = {
      name,
      description,
      enabled: item.enabled !== undefined ? Boolean(item.enabled) : true,
      editable: item.editable !== undefined ? Boolean(item.editable) : true,
      content
    }
    if (typeof item.path === 'string' && item.path.trim()) {
      skill.path = item.path.trim()
    }
    normalized.push(skill)
    const allowedKeys = new Set(['name', 'description', 'enabled', 'editable', 'content', 'path'])
    if (
      item.name !== skill.name ||
      item.description !== skill.description ||
      item.enabled !== skill.enabled ||
      item.editable !== skill.editable ||
      item.content !== skill.content ||
      item.path !== skill.path ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  return {
    normalized,
    changed
  }
}

const normalizeMcpToolStatesConfig = (source?: unknown): McpToolStatesUserConfig => {
  if (!isRecord(source)) return { ...defaultMcpToolStates }
  const normalized: McpToolStatesUserConfig = {}
  Object.entries(source).forEach(([key, value]) => {
    if (typeof key === 'string' && key.includes(':') && typeof value === 'boolean') {
      normalized[key] = value
    }
  })
  return normalized
}

const normalizeMcpServersConfig = (source?: unknown, toolStatesSource?: unknown) => {
  const rawServers = Array.isArray(source) ? source : defaultMcpServers
  const toolStates = normalizeMcpToolStatesConfig(toolStatesSource)
  const seenServers = new Set<string>()
  let changed = !Array.isArray(source)

  const normalized: McpServerUserConfig[] = []
  rawServers.forEach((item) => {
    if (!isRecord(item)) {
      changed = true
      return
    }
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name || seenServers.has(name)) {
      changed = true
      return
    }
    seenServers.add(name)
    const disabled = typeof item.disabled === 'boolean' ? item.disabled : false
    const status = disabled ? 'disabled' : stringFromOptions(item.status, mcpStatusValues, 'disconnected')
    const seenTools = new Set<string>()
    const tools = (Array.isArray(item.tools) ? item.tools : [])
      .map((tool): McpServerUserConfig['tools'][number] | null => {
        if (!isRecord(tool)) {
          changed = true
          return null
        }
        const toolName = typeof tool.name === 'string' ? tool.name.trim() : ''
        if (!toolName || seenTools.has(toolName)) {
          changed = true
          return null
        }
        seenTools.add(toolName)
        const stateKey = `${name}:${toolName}`
        const enabled = typeof toolStates[stateKey] === 'boolean' ? toolStates[stateKey] : typeof tool.enabled === 'boolean' ? tool.enabled : true
        const parameters = (Array.isArray(tool.parameters) ? tool.parameters : [])
          .map((parameter): McpServerUserConfig['tools'][number]['parameters'][number] | null => {
            if (!isRecord(parameter)) {
              changed = true
              return null
            }
            const parameterName = typeof parameter.name === 'string' ? parameter.name.trim() : ''
            if (!parameterName) {
              changed = true
              return null
            }
            return {
              name: parameterName,
              description: typeof parameter.description === 'string' ? parameter.description : '',
              ...(parameter.required !== undefined ? { required: Boolean(parameter.required) } : {})
            }
          })
          .filter(Boolean) as McpServerUserConfig['tools'][number]['parameters']
        const normalizedTool = {
          name: toolName,
          description: typeof tool.description === 'string' ? tool.description : '',
          enabled,
          ...(tool.autoApprove === true ? { autoApprove: true } : {}),
          parameters
        }
        if (
          tool.name !== normalizedTool.name ||
          tool.description !== normalizedTool.description ||
          tool.enabled !== normalizedTool.enabled ||
          Boolean(tool.autoApprove) !== Boolean(normalizedTool.autoApprove)
        ) {
          changed = true
        }
        return normalizedTool
      })
      .filter(Boolean) as McpServerUserConfig['tools']

    const seenResources = new Set<string>()
    const resources = (Array.isArray(item.resources) ? item.resources : [])
      .map((resource): McpServerUserConfig['resources'][number] | null => {
        if (!isRecord(resource)) {
          changed = true
          return null
        }
        const uri = typeof resource.uri === 'string' ? resource.uri.trim() : ''
        const resourceName = typeof resource.name === 'string' && resource.name.trim() ? resource.name.trim() : uri
        if (!uri || !resourceName || seenResources.has(uri)) {
          changed = true
          return null
        }
        seenResources.add(uri)
        return {
          name: resourceName,
          description: typeof resource.description === 'string' ? resource.description : '',
          uri
        }
      })
      .filter(Boolean) as McpServerUserConfig['resources']

    const server: McpServerUserConfig = {
      name,
      status,
      disabled,
      ...(typeof item.error === 'string' && item.error.trim() ? { error: item.error.trim() } : {}),
      tools,
      resources
    }
    normalized.push(server)
    const allowedKeys = new Set(['name', 'status', 'disabled', 'error', 'tools', 'resources'])
    if (
      item.name !== server.name ||
      item.status !== server.status ||
      item.disabled !== server.disabled ||
      item.error !== server.error ||
      Object.keys(item).some((key) => !allowedKeys.has(key))
    ) {
      changed = true
    }
  })

  const normalizedToolStates: McpToolStatesUserConfig = {}
  normalized.forEach((server) => {
    server.tools.forEach((tool) => {
      normalizedToolStates[`${server.name}:${tool.name}`] = tool.enabled
    })
  })

  if (JSON.stringify(toolStates) !== JSON.stringify(normalizedToolStates)) {
    changed = true
  }

  return {
    normalized,
    toolStates: normalizedToolStates,
    changed
  }
}

const normalizeUserModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'local') return 'local'
  if (
    provider === 'litellm' ||
    provider === 'openai-compatible' ||
    provider === 'ollama' ||
    provider === 'lmstudio' ||
    provider === 'bedrock' ||
    provider === 'deepseek' ||
    provider === 'anthropic'
  ) {
    return provider
  }
  return defaultConfig.modelProvider
}

const normalizeUserModelName = (value: unknown) => {
  const modelName = String(value || '').trim()
  if (!modelName) return defaultConfig.modelName
  return modelName
}

const normalizeCatalogModelProvider = (value: unknown): UserConfig['modelProvider'] => {
  const provider = String(value || '').trim()
  if (!provider || provider === 'default' || provider === 'local') return 'local'
  if (provider === 'openai') return 'openai-compatible'
  return normalizeUserModelProvider(provider)
}

type GeneralBaseSettingsPatch = Partial<Pick<UserConfig, 'defaultMode' | 'language' | 'watermark'>>
type LayoutPreferencesPatch = Partial<
  Pick<UserConfig, 'defaultMode' | 'leftPanelOpen' | 'rightPanelOpen' | 'agentsLeftOpen' | 'leftPanelWidth' | 'rightPanelWidth' | 'agentsLeftWidth'>
>
type BackgroundUserConfig = UserConfig['background']
type CustomBackgroundSaveData = Awaited<ReturnType<AiopsPreloadApi['saveCustomBackground']>>

const isThemeSnapshot = (value: unknown): value is ThemeId => typeof value === 'string' && isThemeId(value)

const isDefaultModeValue = (value: unknown): value is UserConfig['defaultMode'] => value === 'terminal' || value === 'agents'

const isBooleanValue = (value: unknown): value is boolean => typeof value === 'boolean'

const isWatermarkValue = (value: unknown): value is UserConfig['watermark'] => value === 'open' || value === 'close'

const isSettingsLanguageValue = (value: unknown): value is string => isLocaleSetting(value)

const normalizeGeneralBaseSettingsPatch = (patch: GeneralBaseSettingsPatch) => {
  const normalized: GeneralBaseSettingsPatch = {}
  if (patch.defaultMode !== undefined) {
    if (!isDefaultModeValue(patch.defaultMode)) return null
    normalized.defaultMode = patch.defaultMode
  }
  if (patch.language !== undefined) {
    if (!isSettingsLanguageValue(patch.language)) return null
    normalized.language = patch.language
  }
  if (patch.watermark !== undefined) {
    if (!isWatermarkValue(patch.watermark)) return null
    normalized.watermark = patch.watermark
  }
  return normalized
}

const generalBaseSettingsPatchMatches = (patch: GeneralBaseSettingsPatch, savedConfig: Record<string, unknown>) => {
  if (patch.defaultMode !== undefined && savedConfig.defaultMode !== patch.defaultMode) return false
  if (patch.language !== undefined && savedConfig.language !== patch.language) return false
  if (patch.watermark !== undefined && savedConfig.watermark !== patch.watermark) return false
  return true
}

const isGeneralBaseSettingsSnapshot = (source: unknown): source is Pick<UserConfig, 'defaultMode' | 'language' | 'watermark'> =>
  isRecord(source) && isDefaultModeValue(source.defaultMode) && isSettingsLanguageValue(source.language) && isWatermarkValue(source.watermark)

const normalizeLayoutPreferencesPatch = (patch: LayoutPreferencesPatch) => {
  const normalized: LayoutPreferencesPatch = {}
  if (patch.defaultMode !== undefined) {
    if (!isDefaultModeValue(patch.defaultMode)) return null
    normalized.defaultMode = patch.defaultMode
  }
  if (patch.leftPanelOpen !== undefined) {
    if (!isBooleanValue(patch.leftPanelOpen)) return null
    normalized.leftPanelOpen = patch.leftPanelOpen
  }
  if (patch.rightPanelOpen !== undefined) {
    if (!isBooleanValue(patch.rightPanelOpen)) return null
    normalized.rightPanelOpen = patch.rightPanelOpen
  }
  if (patch.agentsLeftOpen !== undefined) {
    if (!isBooleanValue(patch.agentsLeftOpen)) return null
    normalized.agentsLeftOpen = patch.agentsLeftOpen
  }
  if (patch.leftPanelWidth !== undefined) {
    const width = numberInRange(patch.leftPanelWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.leftPanelWidth = Math.round(width)
  }
  if (patch.rightPanelWidth !== undefined) {
    const width = numberInRange(patch.rightPanelWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.rightPanelWidth = Math.round(width)
  }
  if (patch.agentsLeftWidth !== undefined) {
    const width = numberInRange(patch.agentsLeftWidth, 0, layoutWidthLimits.min, layoutWidthLimits.max)
    if (!width) return null
    normalized.agentsLeftWidth = Math.round(width)
  }
  return normalized
}

const layoutPreferencesPatchMatches = (patch: LayoutPreferencesPatch, savedConfig: Record<string, unknown>) => {
  if (patch.defaultMode !== undefined && savedConfig.defaultMode !== patch.defaultMode) return false
  if (patch.leftPanelOpen !== undefined && savedConfig.leftPanelOpen !== patch.leftPanelOpen) return false
  if (patch.rightPanelOpen !== undefined && savedConfig.rightPanelOpen !== patch.rightPanelOpen) return false
  if (patch.agentsLeftOpen !== undefined && savedConfig.agentsLeftOpen !== patch.agentsLeftOpen) return false
  if (patch.leftPanelWidth !== undefined && savedConfig.leftPanelWidth !== patch.leftPanelWidth) return false
  if (patch.rightPanelWidth !== undefined && savedConfig.rightPanelWidth !== patch.rightPanelWidth) return false
  if (patch.agentsLeftWidth !== undefined && savedConfig.agentsLeftWidth !== patch.agentsLeftWidth) return false
  return true
}

const isLayoutWidthValue = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= layoutWidthLimits.min && value <= layoutWidthLimits.max

const layoutWidthFromConfig = (value: unknown, fallback: number) => numberInRange(value, fallback, layoutWidthLimits.min, layoutWidthLimits.max)

const isLayoutPreferencesSnapshot = (
  source: unknown
): source is Pick<UserConfig, 'defaultMode' | 'leftPanelOpen' | 'rightPanelOpen' | 'agentsLeftOpen' | 'leftPanelWidth' | 'rightPanelWidth' | 'agentsLeftWidth'> =>
  isRecord(source) &&
  isDefaultModeValue(source.defaultMode) &&
  isBooleanValue(source.leftPanelOpen) &&
  isBooleanValue(source.rightPanelOpen) &&
  isBooleanValue(source.agentsLeftOpen) &&
  isLayoutWidthValue(source.leftPanelWidth) &&
  isLayoutWidthValue(source.rightPanelWidth) &&
  isLayoutWidthValue(source.agentsLeftWidth)

const backgroundModeValues = ['none', 'preset', 'custom'] as const

const normalizeBackgroundConfig = (source?: Partial<BackgroundUserConfig>) => {
  const incoming = isRecord(source) ? source : {}
  const mode = stringFromOptions(incoming.mode, backgroundModeValues, defaultConfig.background.mode)
  const normalized: BackgroundUserConfig = {
    mode,
    image: typeof incoming.image === 'string' ? incoming.image : defaultConfig.background.image,
    opacity: numberInRange(incoming.opacity, defaultConfig.background.opacity, 0, 1),
    brightness: numberInRange(incoming.brightness, defaultConfig.background.brightness, 0, 1),
    lastCustomImage: typeof incoming.lastCustomImage === 'string' ? incoming.lastCustomImage : defaultConfig.background.lastCustomImage
  }
  if (normalized.mode === 'none') {
    normalized.image = ''
  }
  const changed =
    !isRecord(source) ||
    (Object.keys(normalized) as Array<keyof BackgroundUserConfig>).some((key) => incoming[key] !== normalized[key])
  return { normalized, changed }
}

const isBackgroundSnapshot = (source: unknown): source is BackgroundUserConfig => {
  if (!isRecord(source)) return false
  return (
    backgroundModeValues.includes(source.mode as BackgroundUserConfig['mode']) &&
    typeof source.image === 'string' &&
    typeof source.opacity === 'number' &&
    Number.isFinite(source.opacity) &&
    source.opacity >= 0 &&
    source.opacity <= 1 &&
    typeof source.brightness === 'number' &&
    Number.isFinite(source.brightness) &&
    source.brightness >= 0 &&
    source.brightness <= 1 &&
    (source.lastCustomImage === undefined || typeof source.lastCustomImage === 'string')
  )
}

const cloneBackgroundSnapshot = (background: BackgroundUserConfig): BackgroundUserConfig => ({ ...background })

const backgroundSnapshotsMatch = (left: BackgroundUserConfig, right: BackgroundUserConfig) =>
  JSON.stringify(cloneBackgroundSnapshot(left)) === JSON.stringify(cloneBackgroundSnapshot(right))

const visibleBackgroundTuning = (background: BackgroundUserConfig): BackgroundUserConfig => {
  if (background.mode === 'none') return background
  const wasLegacyLowVisibility = background.opacity <= 0.5 && background.brightness <= 0.85
  if (!wasLegacyLowVisibility) return background
  return {
    ...background,
    opacity: defaultConfig.background.opacity,
    brightness: defaultConfig.background.brightness
  }
}

const isCustomBackgroundSaveResult = (source: unknown): source is CustomBackgroundSaveData =>
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

const mergeUserConfig = (base: UserConfig, patch: Partial<UserConfig> = {}): UserConfig => ({
  ...base,
  ...patch,
  defaultMode: isDefaultModeValue(patch.defaultMode) ? patch.defaultMode : isDefaultModeValue(base.defaultMode) ? base.defaultMode : defaultConfig.defaultMode,
  leftPanelOpen: typeof patch.leftPanelOpen === 'boolean' ? patch.leftPanelOpen : typeof base.leftPanelOpen === 'boolean' ? base.leftPanelOpen : defaultConfig.leftPanelOpen,
  rightPanelOpen: typeof patch.rightPanelOpen === 'boolean' ? patch.rightPanelOpen : typeof base.rightPanelOpen === 'boolean' ? base.rightPanelOpen : defaultConfig.rightPanelOpen,
  agentsLeftOpen:
    typeof patch.agentsLeftOpen === 'boolean' ? patch.agentsLeftOpen : typeof base.agentsLeftOpen === 'boolean' ? base.agentsLeftOpen : defaultConfig.agentsLeftOpen,
  leftPanelWidth: layoutWidthFromConfig(patch.leftPanelWidth, layoutWidthFromConfig(base.leftPanelWidth, defaultConfig.leftPanelWidth!)),
  rightPanelWidth: layoutWidthFromConfig(patch.rightPanelWidth, layoutWidthFromConfig(base.rightPanelWidth, defaultConfig.rightPanelWidth!)),
  agentsLeftWidth: layoutWidthFromConfig(patch.agentsLeftWidth, layoutWidthFromConfig(base.agentsLeftWidth, defaultConfig.agentsLeftWidth!)),
  modelProvider: normalizeUserModelProvider(patch.modelProvider || base.modelProvider),
  modelName: normalizeUserModelName(patch.modelName || base.modelName),
  background: normalizeBackgroundConfig({
    ...base.background,
    ...(patch.background || {})
  }).normalized,
  terminal: {
    ...(base.terminal || defaultTerminalSettings),
    ...(patch.terminal || {})
  },
  workspacePreferences: {
    ...(base.workspacePreferences || defaultWorkspacePreferences),
    ...(patch.workspacePreferences || {}),
    expandedGroups: patch.workspacePreferences?.expandedGroups || base.workspacePreferences?.expandedGroups || defaultWorkspacePreferences.expandedGroups,
    recentAssetIds: patch.workspacePreferences?.recentAssetIds || base.workspacePreferences?.recentAssetIds || defaultWorkspacePreferences.recentAssetIds || []
  },
  editorSettings: normalizeEditorSettingsConfig({
    ...(base.editorSettings || defaultEditorSettings),
    ...(patch.editorSettings || {})
  }).normalized,
  sshProxyConfigs: normalizeSshProxyConfigs(patch.sshProxyConfigs || base.sshProxyConfigs).normalized,
  sshAgentKeys: normalizeSshAgentKeys(patch.sshAgentKeys || base.sshAgentKeys).normalized,
  extensionSettings: normalizeExtensionSettingsConfig({
    ...(base.extensionSettings || defaultExtensionSettings),
    ...(patch.extensionSettings || {})
  }).normalized,
  keywordHighlight: normalizeKeywordHighlightConfig(patch.keywordHighlight || base.keywordHighlight).normalized,
  securityConfig: normalizeSecurityConfig(patch.securityConfig || base.securityConfig).normalized,
  privacy: normalizePrivacyConfig({
    ...(base.privacy || defaultConfig.privacy!),
    ...(patch.privacy || {})
  }).normalized,
  aiPreferences: normalizeAiPreferencesConfig({
    ...(base.aiPreferences || defaultAiPreferences),
    ...(patch.aiPreferences || {}),
    proxy: {
      ...(base.aiPreferences?.proxy || defaultAiPreferences.proxy),
      ...(patch.aiPreferences?.proxy || {})
    }
  }).normalized,
  modelSettings: normalizeModelSettingsConfig(patch.modelSettings || base.modelSettings).normalized,
  quickCommands:
    base.quickCommands || patch.quickCommands
      ? {
          groups: [...(patch.quickCommands?.groups || base.quickCommands?.groups || defaultQuickCommands.groups)],
          snippets: [...(patch.quickCommands?.snippets || base.quickCommands?.snippets || defaultQuickCommands.snippets)]
        }
      : undefined,
  knowledgeBase: patch.knowledgeBase || base.knowledgeBase ? normalizeKnowledgeBaseConfig(patch.knowledgeBase || base.knowledgeBase).normalized : undefined,
  aliasCommands: patch.aliasCommands || base.aliasCommands ? normalizeAliasCommandsConfig(patch.aliasCommands || base.aliasCommands).normalized : undefined,
  shortcuts: normalizeShortcutsConfig(patch.shortcuts || base.shortcuts).normalized,
  rules: normalizeRulesConfig(patch.rules || base.rules, patch.customInstructions || base.customInstructions).normalized,
  skills: normalizeSkillsConfig(patch.skills || base.skills).normalized,
  customInstructions: patch.customInstructions !== undefined ? patch.customInstructions : base.customInstructions,
  mcpServers: normalizeMcpServersConfig(patch.mcpServers || base.mcpServers, patch.mcpToolStates || base.mcpToolStates).normalized,
  mcpToolStates: normalizeMcpServersConfig(patch.mcpServers || base.mcpServers, patch.mcpToolStates || base.mcpToolStates).toolStates,
  onboarding:
    base.onboarding || patch.onboarding
      ? {
          ...(base.onboarding || defaultConfig.onboarding!),
          ...(patch.onboarding || {}),
          completedModules: {
            ...(base.onboarding?.completedModules || defaultConfig.onboarding!.completedModules),
            ...(patch.onboarding?.completedModules || {})
          }
        }
      : undefined
})

const stripBusinessDataConfig = (source: Partial<UserConfig>): Partial<UserConfig> => {
  const { quickCommands, knowledgeBase, aliasCommands, ...rest } = source
  void quickCommands
  void knowledgeBase
  void aliasCommands
  return rest
}

const mergeGenericSavedConfig = (base: UserConfig, savedConfig: Partial<UserConfig>, patch: Partial<UserConfig> = {}) =>
  mergeUserConfig(base, {
    ...stripBusinessDataConfig(savedConfig),
    ...patch
  })

const normalizeOnboardingConfig = (source?: UserConfig['onboarding']) => {
  const completed = createDefaultOnboardingCompleted()
  const incomingCompleted = source?.completedModules || {}
  onboardingModuleIds.forEach((moduleId) => {
    completed[moduleId] = Boolean(incomingCompleted[moduleId])
  })

  const normalized = {
    version: ONBOARDING_VERSION,
    guideTabAutoOpened: Boolean(source?.guideTabAutoOpened),
    completedModules: completed
  }

  const isCurrent =
    source?.version === ONBOARDING_VERSION &&
    onboardingModuleIds.every((moduleId) => typeof source.completedModules?.[moduleId] === 'boolean')

  return {
    normalized,
    changed: !isCurrent
  }
}

const defaultModelProviders: Record<ModelProviderKey, ModelProviderSettings> = {
  litellm: {
    baseUrl: 'http://localhost:4000',
    apiKey: '',
    modelId: 'gpt-5'
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    apiKey: '',
    modelId: 'gpt-5',
    apiFormat: 'responses'
  },
  bedrock: {
    baseUrl: '',
    apiKey: '',
    modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    awsAccessKey: '',
    awsSecretKey: '',
    awsSessionToken: '',
    awsRegion: 'us-east-1',
    awsUseCrossRegionInference: false,
    awsEndpointSelected: false,
    awsBedrockEndpoint: ''
  },
  deepseek: {
    baseUrl: '',
    apiKey: '',
    modelId: 'deepseek-chat'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    modelId: 'claude-3-5-sonnet-latest'
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    modelId: 'llama3.1'
  },
  lmstudio: {
    baseUrl: 'http://localhost:1234',
    apiKey: '',
    modelId: 'openai/gpt-oss-20b'
  }
}

const defaultAiPreferences: AiPreferenceSettings = {
  ...defaultConfig.aiPreferences!,
  proxy: { ...defaultConfig.aiPreferences!.proxy }
}

const defaultExtensionSettings: ExtensionSettings = {
  ...defaultConfig.extensionSettings!
}

const defaultKeywordHighlightSettings: KeywordHighlightSettings = {
  'keyword-highlight': {
    enabled: true,
    applyTo: {
      output: true,
      input: false
    },
    rules: []
  }
}

const keywordHighlightScopes: KeywordHighlightRuleConfig['scope'][] = ['output', 'input', 'both']
const keywordHighlightMatchTypes: KeywordHighlightRuleConfig['matchType'][] = ['regex', 'wildcard']
const keywordHighlightFontStyles: KeywordHighlightRuleConfig['style']['fontStyle'][] = ['bold', 'normal']
const keywordHighlightHexColorPattern = /^#(?:[0-9a-fA-F]{6})$/

const defaultSecuritySettings: SecuritySettings = {
  security: {
    enableCommandSecurity: true,
    enableStrictMode: false,
    blacklistPatterns: [],
    whitelistPatterns: ['ls', 'pwd', 'whoami', 'date'],
    dangerousCommands: ['rm', 'format', 'shutdown'],
    maxCommandLength: 10000,
    securityPolicy: {
      blockCritical: true,
      askForMedium: true,
      askForHigh: true,
      askForBlacklist: false
    }
  }
}

const defaultPrivacySettings: PrivacySettings = {
  ...defaultConfig.privacy!,
  dataSyncRuntime: 'disabled',
  dataSyncStatus: 'disabled',
  dataSyncRunId: '',
  dataSyncStateFilePath: '',
  dataSyncLastSyncAt: '',
  dataSyncSyncedScopes: [],
  dataSyncErrorMessage: '',
  deactivateModalOpen: false,
  deactivateConfirmationInput: '',
  deactivateLoading: false
}

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

const hasAiopsBridgeMethod = (name: string) => typeof (window.aiops as Record<string, unknown> | undefined)?.[name] === 'function'
const isOpenPathResult = (result: unknown): result is { path: string } => isRecord(result) && typeof result.path === 'string' && Boolean(result.path.trim())
const isSettingsDocumentationResult = (result: unknown): result is { path: string; title: string; content: string } => {
  if (!isOpenPathResult(result)) return false
  const title = (result as Record<string, unknown>).title
  const content = (result as Record<string, unknown>).content
  return typeof title === 'string' && Boolean(title.trim()) && typeof content === 'string'
}

const appUpdateChannels: AppUpdateCheckResult['channel'][] = ['local', 'manual', 'auto']
const appUpdateStatusMessage = '更新后端返回了无效结果'

const isAppUpdateSignatureInfo = (source: unknown) =>
  isRecord(source) &&
  (source.algorithm === 'ed25519' || source.algorithm === 'rsa-sha256') &&
  source.verified === true &&
  (source.keyId === undefined || typeof source.keyId === 'string')

const isAppUpdateCheckResult = (source: unknown): source is AppUpdateCheckResult => {
  if (!isRecord(source)) return false
  if (typeof source.available !== 'boolean' || !appUpdateChannels.includes(source.channel as AppUpdateCheckResult['channel'])) return false
  if (source.isUpdateAvailable !== undefined && typeof source.isUpdateAvailable !== 'boolean') return false
  if (source.versionInfo !== undefined) {
    if (!isRecord(source.versionInfo) || !isNonEmptyString(source.versionInfo.version)) return false
    if (source.versionInfo.channel !== undefined && typeof source.versionInfo.channel !== 'string') return false
  }
  if (source.updateInfo !== undefined && source.updateInfo !== null) {
    if (!isRecord(source.updateInfo) || !isNonEmptyString(source.updateInfo.version)) return false
    if (source.updateInfo.channel !== undefined && typeof source.updateInfo.channel !== 'string') return false
    if (source.updateInfo.fileName !== undefined && typeof source.updateInfo.fileName !== 'string') return false
    const updateSize = source.updateInfo.size
    if (updateSize !== undefined && (typeof updateSize !== 'number' || !Number.isFinite(updateSize) || updateSize < 0)) return false
    if (source.updateInfo.sha256 !== undefined && typeof source.updateInfo.sha256 !== 'string') return false
    if (source.updateInfo.notes !== undefined && typeof source.updateInfo.notes !== 'string') return false
    if (source.updateInfo.signature !== undefined && !isAppUpdateSignatureInfo(source.updateInfo.signature)) return false
  }
  return true
}

const resolveUpdateVersion = (result?: AppUpdateCheckResult | null) => result?.updateInfo?.version || result?.versionInfo?.version || ''

const hasAvailableAppUpdate = (result: AppUpdateCheckResult) => Boolean(result.available || result.isUpdateAvailable || result.updateInfo)

const isAppUpdateDownloadData = (source: unknown, version: string): source is AppUpdateDownloadData =>
  isRecord(source) &&
  source.version === version &&
  source.status === 'downloaded' &&
  source.percent === 100 &&
  isNonEmptyString(source.filePath) &&
  typeof source.size === 'number' &&
  Number.isFinite(source.size) &&
  source.size >= 0 &&
  (source.sha256 === undefined || typeof source.sha256 === 'string') &&
  (source.signature === undefined || isAppUpdateSignatureInfo(source.signature)) &&
  isNonEmptyString(source.message)

const isAppUpdateInstallData = (source: unknown, version: string): source is AppUpdateInstallData =>
  isRecord(source) &&
  source.version === version &&
  source.status === 'install-requested' &&
  isNonEmptyString(source.filePath) &&
  typeof source.size === 'number' &&
  Number.isFinite(source.size) &&
  source.size >= 0 &&
  (source.sha256 === undefined || typeof source.sha256 === 'string') &&
  (source.signature === undefined || isAppUpdateSignatureInfo(source.signature)) &&
  isRecord(source.handoff) &&
  source.handoff.kind === 'os-open' &&
  source.handoff.accepted === true &&
  isNonEmptyString(source.requestedAt) &&
  isNonEmptyString(source.message)

const isAppUpdateProgressEvent = (source: unknown): source is AppUpdateProgressEvent =>
  isRecord(source) &&
  (source.status === 'downloading' || source.status === 'downloaded' || source.status === 'error') &&
  isNonEmptyString(source.version) &&
  typeof source.percent === 'number' &&
  Number.isFinite(source.percent) &&
  (source.message === undefined || typeof source.message === 'string')

const getKbParent = (relPath: string) => {
  const parts = relPath.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

const createKbRelPath = (parentRelDir: string, name: string) => [parentRelDir, name].filter(Boolean).join('/')

const knowledgePathContains = (relPath: string, candidate: string) => candidate === relPath || candidate.startsWith(`${relPath}/`)

const imageFileExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

const getFileExtension = (relPath: string) => {
  const fileName = relPath.split('/').pop() || relPath
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

const isKnowledgeImagePath = (relPath: string) => imageFileExtensions.has(getFileExtension(relPath))

const mediaTypeFromKnowledgePath = (relPath: string) => {
  const ext = getFileExtension(relPath)
  const mediaTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml'
  }
  return mediaTypes[ext] || 'application/octet-stream'
}

const createTerminalSegments = (text: string, scope: TerminalOutputScope = 'output'): TerminalOutputSegment[] => (text ? [{ text, scope }] : [])

const isNonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const hasOwnField = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key)
const isOptionalField = (record: Record<string, unknown>, key: string, guard: (value: unknown) => boolean) =>
  !hasOwnField(record, key) || record[key] === undefined || guard(record[key])
const isTerminalKind = (value: unknown): value is 'local' | 'ssh' => value === 'local' || value === 'ssh'
const isTerminalExitCode = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))
const isTerminalPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
const isTerminalDisconnectReason = (value: unknown): value is TerminalDisconnectReason =>
  terminalDisconnectReasons.includes(value as TerminalDisconnectReason)
const isOptionalNonEmptyText = (record: Record<string, unknown>, key: string) => isOptionalField(record, key, isNonEmptyText)

const appendTerminalSegment = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  if (!text) return
  panel.output += text
  if (!panel.outputSegments) {
    panel.outputSegments = []
  }
  panel.outputSegments.push({ text, scope })
}

const setTerminalOutput = (panel: TerminalPanel, text: string, scope: TerminalOutputScope = 'output') => {
  panel.output = text
  panel.outputSegments = createTerminalSegments(text, scope)
}

const createEmptyTerminalPanel = (
  id: string,
  title: string,
  split?: PanelDirection,
  splitSourceId?: string,
  splitGroupId?: string,
  splitOrder?: number,
  sourcePanel?: TerminalPanel
): TerminalPanel => ({
  id,
  title,
  cwd: sourcePanel?.cwd || '~',
  kind: 'terminal',
  output: '',
  outputSegments: [],
  status: sourcePanel?.sessionId ? 'connecting' : 'ready',
  ...(split ? { split, splitSourceId, splitGroupId, splitOrder } : {}),
  ...(split && sourcePanel?.sshSession
    ? {
        sshSession: {
          ...sourcePanel.sshSession,
          connectionId: undefined,
          sourcePanelId: sourcePanel.id
        }
      }
    : {})
})

const isTerminalLifecycleEvent = (value: unknown, expectedId?: string, expectedKind?: 'local' | 'ssh'): value is TerminalLifecycleEvent => {
  if (
    !isRecord(value) ||
    !isNonEmptyText(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !isTerminalKind(value.kind) ||
    (expectedKind !== undefined && value.kind !== expectedKind) ||
    !terminalLifecycleStages.includes(value.stage as TerminalLifecycleStage) ||
    typeof value.at !== 'number' ||
    !Number.isFinite(value.at)
  ) {
    return false
  }
  return (
    isOptionalNonEmptyText(value, 'shell') &&
    isOptionalNonEmptyText(value, 'cwd') &&
    isOptionalNonEmptyText(value, 'host') &&
    isOptionalField(value, 'port', isTerminalPort) &&
    isOptionalNonEmptyText(value, 'username') &&
    isOptionalNonEmptyText(value, 'targetHost') &&
    isOptionalField(value, 'targetPort', isTerminalPort) &&
    isOptionalNonEmptyText(value, 'targetUsername') &&
    isOptionalNonEmptyText(value, 'jumpHost') &&
    isOptionalField(value, 'jumpPort', isTerminalPort) &&
    isOptionalNonEmptyText(value, 'jumpUsername') &&
    isOptionalField(value, 'authScope', (field) => field === 'target' || field === 'jump') &&
    isOptionalField(value, 'authPurpose', (field) => field === 'password' || field === 'keyboard-interactive') &&
    isOptionalField(value, 'sshTransport', (field) => field === 'direct' || field === 'proxy' || field === 'jump' || field === 'relay-shell') &&
    isOptionalNonEmptyText(value, 'sshAuthMethods') &&
    isOptionalField(value, 'connectionReuse', (field) => field === 'created' || field === 'reused') &&
    isOptionalField(value, 'remoteHop', (field) => field === 'relay' || field === 'target' || field === 'unknown') &&
    isOptionalNonEmptyText(value, 'expectedHost') &&
    isOptionalNonEmptyText(value, 'actualHost') &&
    isOptionalNonEmptyText(value, 'actualUsername') &&
    isOptionalField(value, 'endpointConfidence', (field) => field === 'confirmed' || field === 'inferred' || field === 'unknown') &&
    isOptionalNonEmptyText(value, 'connectionId') &&
    isOptionalNonEmptyText(value, 'proxyName') &&
    isOptionalNonEmptyText(value, 'message') &&
    isOptionalField(value, 'code', isTerminalExitCode) &&
    isOptionalField(value, 'reason', isTerminalDisconnectReason) &&
    isOptionalField(value, 'isNetworkDisconnect', (field) => typeof field === 'boolean') &&
    isOptionalNonEmptyText(value, 'errorCode') &&
    isOptionalNonEmptyText(value, 'errorMessage')
  )
}

const isTerminalExitEvent = (value: unknown): value is TerminalExitEvent => {
  if (!isRecord(value) || !isNonEmptyText(value.id) || !isTerminalExitCode(value.code)) return false
  return (
    isOptionalField(value, 'kind', isTerminalKind) &&
    isOptionalField(value, 'reason', isTerminalDisconnectReason) &&
    isOptionalField(value, 'isNetworkDisconnect', (field) => typeof field === 'boolean') &&
    isOptionalNonEmptyText(value, 'errorCode') &&
    isOptionalNonEmptyText(value, 'errorMessage')
  )
}

const isLocalTerminalSessionInfo = (value: unknown): value is TerminalSessionInfo =>
  isRecord(value) &&
  isNonEmptyText(value.id) &&
  value.kind === 'local' &&
  isNonEmptyText(value.shell) &&
  isNonEmptyText(value.cwd) &&
  (value.lifecycle === undefined || isTerminalLifecycleEvent(value.lifecycle, value.id, 'local'))

const isSshTerminalSessionInfo = (value: unknown): value is TerminalSessionInfo & { connection: TerminalSshConnectionInfo } => {
  if (!isRecord(value) || !isNonEmptyText(value.id) || value.kind !== 'ssh' || !isNonEmptyText(value.shell) || !isNonEmptyText(value.cwd)) return false
  if (value.lifecycle !== undefined && !isTerminalLifecycleEvent(value.lifecycle, value.id, 'ssh')) return false
  const connection = value.connection
  return (
    isRecord(connection) &&
    isNonEmptyText(connection.connectionId) &&
    isNonEmptyText(connection.host) &&
    typeof connection.port === 'number' &&
    Number.isInteger(connection.port) &&
    connection.port >= 1 &&
    connection.port <= 65535 &&
    isNonEmptyText(connection.username) &&
    isNonEmptyText(connection.assetName) &&
    typeof connection.createdAt === 'number' &&
    Number.isFinite(connection.createdAt)
  )
}

const isAgentHookInstallerSource = (value: unknown): value is AgentHookInstallerSource =>
  value === 'codex' ||
  value === 'claude-code' ||
  value === 'cursor' ||
  value === 'gemini' ||
  value === 'copilot' ||
  value === 'grok' ||
  value === 'codebuddy' ||
  value === 'factory' ||
  value === 'qoder'

const isAiAgentSessionSource = (value: unknown): value is AiAgentSessionSource =>
  value === 'codex' ||
  value === 'claude-code' ||
  value === 'cursor' ||
  value === 'gemini' ||
  value === 'copilot' ||
  value === 'grok' ||
  value === 'opencode' ||
  value === 'codebuddy' ||
  value === 'factory' ||
  value === 'qoder' ||
  value === 'antigravity' ||
  value === 'kiro' ||
  value === 'hermes-agent' ||
  value === 'rovodev' ||
  value === 'amp' ||
  value === 'pi' ||
  value === 'omp'

const isAiAgentSessionEventName = (value: unknown): value is AiAgentSessionEventName =>
  value === 'session_start' ||
  value === 'prompt_submit' ||
  value === 'pre_tool_use' ||
  value === 'permission_request' ||
  value === 'question' ||
  value === 'notification' ||
  value === 'stop' ||
  value === 'session_end'

const isManagedAiSessionState = (value: unknown): value is ManagedAiSessionState =>
  value === 'idle' || value === 'working' || value === 'needsInput' || value === 'ended' || value === 'unknown'

const isManagedAiSessionTimelineEvent = (value: unknown): value is ManagedAiSessionTimelineEvent =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isAiAgentSessionSource(value.source) &&
  isAiAgentSessionEventName(value.event) &&
  isNonEmptyString(value.sessionId) &&
  isNonEmptyString(value.title) &&
  typeof value.summary === 'string' &&
  typeof value.receivedAt === 'number'

const isManagedAiSessionDecision = (value: unknown): value is ManagedAiSessionDecision =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  (value.kind === 'allow' || value.kind === 'always' || value.kind === 'bypass' || value.kind === 'deny' || value.kind === 'reply' || value.kind === 'handled') &&
  typeof value.createdAt === 'number'

const isManagedAiSessionRecord = (value: unknown): value is ManagedAiSessionRecord =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isAiAgentSessionSource(value.source) &&
  isNonEmptyString(value.title) &&
  typeof value.summary === 'string' &&
  isManagedAiSessionState(value.state) &&
  isAiAgentSessionEventName(value.lastEvent) &&
  typeof value.lastActivityAt === 'number' &&
  typeof value.createdAt === 'number' &&
  typeof value.updatedAt === 'number' &&
  Array.isArray(value.events) &&
  value.events.every(isManagedAiSessionTimelineEvent) &&
  Array.isArray(value.decisions) &&
  value.decisions.every(isManagedAiSessionDecision)

const isManagedAiSessionSnapshot = (value: unknown): value is ManagedAiSessionSnapshot =>
  isRecord(value) && Array.isArray(value.sessions) && value.sessions.every(isManagedAiSessionRecord)

const isManagedAiSessionMutationData = (value: unknown): value is ManagedAiSessionMutationData =>
  isRecord(value) && isManagedAiSessionSnapshot(value.snapshot) && (value.session === undefined || isManagedAiSessionRecord(value.session))

const isManagedAiSessionBulkData = (value: unknown): value is ManagedAiSessionBulkData =>
  isRecord(value) && typeof value.changed === 'number' && isManagedAiSessionSnapshot(value.snapshot)

const isAgentHookInstallerStatus = (value: unknown): value is AgentHookInstallerStatus =>
  isRecord(value) &&
  isAgentHookInstallerSource(value.source) &&
  isNonEmptyText(value.label) &&
  isNonEmptyText(value.binaryName) &&
  typeof value.binaryPath === 'string' &&
  isNonEmptyText(value.configPath) &&
  typeof value.configExists === 'boolean' &&
  typeof value.installed === 'boolean' &&
  typeof value.scriptPath === 'string' &&
  Array.isArray(value.warnings) &&
  value.warnings.every((item) => typeof item === 'string') &&
  isOptionalField(value, 'extraConfigPath', isNonEmptyText) &&
  isOptionalField(value, 'error', isNonEmptyText)

const isAgentHookInstallerSnapshot = (value: unknown): value is AgentHookInstallerSnapshot =>
  isRecord(value) && Array.isArray(value.installers) && value.installers.every(isAgentHookInstallerStatus)

const isAgentHookInstallOperationData = (value: unknown): value is AgentHookInstallOperationData =>
  isRecord(value) &&
  (value.operation === 'install' || value.operation === 'uninstall') &&
  isAgentHookInstallerSource(value.source) &&
  isAgentHookInstallerStatus(value.status) &&
  isAgentHookInstallerSnapshot(value.snapshot)

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
  const aiAttentionFocusRequest = ref<AiAttentionFocusRequest>({ sequence: 0, item: null })
  const managedAiSessions = ref<ManagedAiSession[]>([])
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

  const refreshShortcutRuntime = () => {
    shortcutRuntime.update(getShortcutsSnapshot(), shortcutHandlers)
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

  const registerSshSession = (
    panelId: string,
    asset: {
      id?: string
      name?: string
      title?: string
      host: string
      port?: number
      username?: string
      group_name?: string
      asset_type?: string
      auth_type?: string
      needProxy?: boolean
      proxyName?: string
      jumpHostId?: string
    }
  ) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel) return null
    const title = asset.name || asset.title || asset.host
    const session: TerminalSshSession = {
      host: asset.host,
      port: Number(asset.port) || 22,
      username: asset.username || 'root',
      assetId: asset.id,
      assetName: title,
      assetType: asset.asset_type,
      organizationId: asset.group_name,
      authType: asset.auth_type,
      needProxy: Boolean(asset.needProxy),
      proxyName: asset.proxyName || '',
      jumpHostId: asset.jumpHostId
    }
    panel.kind = 'terminal'
    panel.sshSession = session
    return session
  }

  const applySshTerminalSession = (
    panelId: string,
    terminalSession?: TerminalSessionInfo | null,
    asset?: {
      id?: string
      name?: string
      title?: string
      host?: string
      port?: number
      username?: string
      group_name?: string
      asset_type?: string
      auth_type?: string
      needProxy?: boolean
      proxyName?: string
      jumpHostId?: string
    }
  ) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel || !isSshTerminalSessionInfo(terminalSession)) return null
    const connection = terminalSession.connection
    const previous = panel.sshSession
    const session: TerminalSshSession = {
      connectionId: connection.connectionId,
      sourcePanelId: previous?.sourcePanelId,
      forkFromConnectionId: connection.forkFromConnectionId || previous?.forkFromConnectionId,
      host: connection.host || asset?.host || previous?.host || '',
      port: Number(connection.port || asset?.port || previous?.port || 22),
      username: connection.username || asset?.username || previous?.username || 'root',
      assetId: connection.assetId || asset?.id || previous?.assetId,
      assetName: connection.assetName || asset?.name || asset?.title || previous?.assetName || connection.host || 'ssh',
      assetType: connection.assetType || asset?.asset_type || previous?.assetType,
      organizationId: connection.organizationId || asset?.group_name || previous?.organizationId,
      authType: connection.authType || asset?.auth_type || previous?.authType,
      needProxy: Boolean(connection.needProxy || asset?.needProxy || previous?.needProxy),
      proxyName: connection.proxyName || asset?.proxyName || previous?.proxyName || '',
      jumpHostId: asset?.jumpHostId || previous?.jumpHostId,
      createdAt: connection.createdAt
    }
    panel.sessionId = terminalSession.id
    panel.cwd = terminalSession.cwd || panel.cwd
    panel.kind = 'terminal'
    panel.status = 'connecting'
    panel.sshSession = session
    panel.title = session.assetName || session.host || panel.title
    if (terminalSession.lifecycle) applyTerminalLifecycle(terminalSession.lifecycle)
    return session
  }

  const terminalShellTitle = (shell: string) => shell.replace(/\\/g, '/').split('/').filter(Boolean).pop() || shell || 'local shell'

  const applyLocalTerminalSession = (panelId: string, terminalSession?: TerminalSessionInfo | null) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel || !isLocalTerminalSessionInfo(terminalSession)) return null
    panel.sessionId = terminalSession.id
    panel.cwd = terminalSession.cwd || panel.cwd
    panel.title = terminalShellTitle(terminalSession.shell)
    panel.kind = 'terminal'
    panel.status = 'running'
    panel.sshSession = undefined
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
  const fileTransferTaskRemovalTimers = new Map<string, number>()
  let fileTransferTaskObserverCount = 0
  let fileTransferTaskPoller: number | null = null
  const snippetGroups = ref<SnippetGroup[]>([])
  const quickCommands = ref<QuickCommandSnippet[]>([])
  const selectedSnippetGroupUuid = ref<string | null>(null)
  const snippetSearchQuery = ref('')
  const isMacroRecording = ref(false)
  const macroCommandBuffer = ref<MacroCommandEntry[]>([])
  const recordedCommands = computed(() => macroCommandBuffer.value.map((entry) => entry.command))
  const macroCurrentLineBuffer = ref('')
  const macroRecordingStartTime = ref<number | null>(null)
  const macroTerminalId = ref<string | null>(null)
  const macroRecordControlKeys = ref(true)
  const macroSleepThresholdMs = ref(MACRO_DEFAULT_SLEEP_THRESHOLD_MS)
  const macroDefaultName = ref('')
  const macroTargetGroupUuid = ref<string | null>(null)
  const macroLimitReason = ref<'time' | 'count' | null>(null)
  let macroAutoStopTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  const knowledgeTree = ref<KnowledgeNode[]>([])
  const kbExpandedKeys = ref<string[]>(['commands', 'images'])
  const kbSelectedKeys = ref<string[]>([])
  const kbSearchQuery = ref('')
  const kbContentSearchResults = ref<KnowledgeBaseSearchResult[]>([])
  const kbSearchStatus = ref<KnowledgeBaseSearchStatus | null>(null)
  const kbSearchLoading = ref(false)
  const kbSearchError = ref('')
  const kbClipboard = ref<KbClipboard>(null)
  const kbImportJobs = ref<Array<{ id: string; destRelPath: string; percent: number }>>([])
  const kbUsedBytes = ref(0)
  const kbTotalBytes = ref(1024 * 1024 * 1024)
  const extensionSearchQuery = ref('')
  const extensionPlugins = ref<ExtensionPlugin[]>([])
  const selectedExtensionId = ref<string>('jumpserverSupport')
  let extensionPluginsRefreshPromise: Promise<boolean> | null = null
  const extensionDetailTab = ref<'details' | 'features'>('details')
  const extensionNotice = ref('')
  const extensionInstallLoadingMap = ref<Record<string, boolean>>({})
  const extensionUpdateLoadingMap = ref<Record<string, boolean>>({})
  const extensionInstallProgressMap = ref<Record<string, ExtensionInstallProgress>>({})
  const extensionActiveOperations = ref<Record<string, ExtensionPluginOperation>>({})
  const extensionPendingPackageRequestId = ref('')
  const extensionDragActive = ref(false)
  const extensionInstallingPackageName = ref('')
  const assetManagementOpenRequest = ref<{
    sequence: number
    organizationId?: string
    view?: AssetManagementViewRequest
    action?: AssetManagementOpenAction
  }>({ sequence: 0, action: 'none' })
  const aliasCommands = ref<AliasCommand[]>([])
  const aliasEditSnapshot = ref<AliasCommand | null>(null)
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
  let removeK8sTerminalDataListener: (() => void) | null = null
  let removeK8sTerminalExitListener: (() => void) | null = null
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
  const aiModelOptions = ref<AiModelOption[]>([])
  const lockedAiModelOptions = ref<AiModelOption[]>([])
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
  const settingsSkills = ref<SettingsSkill[]>([])
  const skillsUserPath = ref('~/.config/aiopsterm/skills')
  const skillModal = ref<{ mode: 'create' | 'edit' | null; name: string; description: string; content: string }>({
    mode: null,
    name: '',
    description: '',
    content: ''
  })
  const settingsRules = ref<SettingsRule[]>([])
  const settingsShortcuts = ref<SettingsShortcut[]>([])
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
  let kbSearchRequest = 0
  let k8sKubeconfigImportRequestSequence = 0
  let k8sKubeconfigImportRequestId = ''
  const nextK8sKubeconfigImportRequestId = () => `k8s-kubeconfig-import-${(k8sKubeconfigImportRequestSequence += 1)}`
  let extensionPackageInstallRequestSequence = 0
  const nextExtensionPackageInstallRequestId = () => `extension-package-install-${(extensionPackageInstallRequestSequence += 1)}`
  let k8sAgentCleanupRequest = 0
  let removeSkillsUpdateListener: (() => void) | null = null
  let removeKnowledgeProgressListener: (() => void) | null = null
  let removeExtensionInstallProgressListener: (() => void) | null = null
  let aiModelCatalogLoadPromise: Promise<AiModelCatalog> | null = null
  let pendingSkillImportOverwritePath = ''

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
    if (!window.aiops?.restoreChatConversation) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await window.aiops.restoreChatConversation(id)
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
    if (!window.aiops?.listChatConversations) {
      setTopNotice('会话历史加载服务不可用')
      return false
    }
    let result
    try {
      result = await window.aiops.listChatConversations()
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
    if (!window.aiops?.listAiContextCatalog) {
      setTopNotice('AI 上下文加载服务不可用')
      return false
    }
    let result
    try {
      result = await window.aiops.listAiContextCatalog()
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
    if (!window.aiops?.listAiCommandCatalog) {
      setTopNotice('AI 命令加载服务不可用')
      return false
    }
    let result
    try {
      result = await window.aiops.listAiCommandCatalog()
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
    const listBridge = window.aiops?.listAgentHookInstallers
    if (typeof listBridge !== 'function') {
      agentHookInstallerError.value = 'Agent Hook 安装器服务不可用'
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    }
    agentHookInstallersLoading.value = true
    try {
      const result = await listBridge()
      if (!result?.ok) {
        agentHookInstallerError.value = result?.errorMessage || 'Agent Hook 安装器状态加载失败'
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      if (!isAgentHookInstallerSnapshot(result.data)) {
        agentHookInstallerError.value = 'Agent Hook 安装器状态加载失败'
        if (!options.silent) setTopNotice(agentHookInstallerError.value)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data)
      if (!options.silent) setTopNotice('Agent Hook 状态已刷新')
      return true
    } catch (error) {
      agentHookInstallerError.value = error instanceof Error ? error.message : 'Agent Hook 安装器状态加载失败'
      if (!options.silent) setTopNotice(agentHookInstallerError.value)
      return false
    } finally {
      agentHookInstallersLoading.value = false
    }
  }

  const runAgentHookInstallerOperation = async (source: AgentHookInstallerSource, operation: 'install' | 'uninstall') => {
    const bridge = operation === 'install' ? window.aiops?.installAgentHook : window.aiops?.uninstallAgentHook
    if (typeof bridge !== 'function') {
      setTopNotice('Agent Hook 安装器服务不可用')
      return false
    }
    agentHookInstallerBusySource.value = source
    agentHookInstallerError.value = ''
    try {
      const result = await bridge({ source })
      if (!result?.ok) {
        const message = result?.errorMessage || (operation === 'install' ? 'Agent Hook 安装失败' : 'Agent Hook 卸载失败')
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      if (!isAgentHookInstallOperationData(result.data)) {
        const message = operation === 'install' ? 'Agent Hook 安装结果异常' : 'Agent Hook 卸载结果异常'
        agentHookInstallerError.value = message
        setTopNotice(message)
        return false
      }
      applyAgentHookInstallerSnapshot(result.data.snapshot)
      setTopNotice(`${result.data.status.label} Agent Hook 已${operation === 'install' ? '安装' : '卸载'}`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : operation === 'install' ? 'Agent Hook 安装失败' : 'Agent Hook 卸载失败'
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
    const listAiTodoSnapshot = window.aiops?.listAiTodoSnapshot
    if (typeof listAiTodoSnapshot !== 'function') return false
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
    if (!window.aiops?.updateChatConversation) {
      if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
      return false
    }
    let id = selectedConversationId.value
    if (!id || !conversations.value.some((conversation) => conversation.id === id)) {
      if (!window.aiops.createChatConversation) {
        if (options.notifyUnavailable) setTopNotice('会话历史写入服务不可用')
        return false
      }
      const created = await window.aiops.createChatConversation()
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
    const result = await window.aiops.updateChatConversation({
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

  const selectedLeftFileSession = computed(() => fileSessions.value.find((session) => session.id === selectedLeftFileSessionId.value) || null)
  const selectedRightFileSession = computed(() => fileSessions.value.find((session) => session.id === selectedRightFileSessionId.value) || null)
  const transferTaskGroups = computed(() => {
    const groups = {
      download: fileTransferTasks.value.filter((task) => task.type === 'download'),
      upload: fileTransferTasks.value.filter((task) => task.type === 'upload'),
      r2r: fileTransferTasks.value.filter((task) => task.type === 'r2r')
    }
    return groups
  })
  const transferTaskCount = computed(() => fileTransferTasks.value.length)
  const transferOverallPercent = computed(() => {
    if (!fileTransferTasks.value.length) return 0
    const sum = fileTransferTasks.value.reduce((acc, task) => acc + task.progress, 0)
    return Math.round(sum / fileTransferTasks.value.length)
  })
  const hasRunningFileTransferTasks = computed(() => fileTransferTasks.value.some((task) => task.status === 'running'))
  const terminalCommandModelOptions = computed(() =>
    settingModelOptions.value.filter((model) => model.checked && !model.locked && !model.name.endsWith('-Thinking')).map((model) => model.name)
  )
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
    const listAiModelsBridge = window.aiops?.listAiModels
    if (typeof listAiModelsBridge !== 'function') {
      setSettingsNoticeText('模型列表加载服务不可用')
      return null
    }
    aiModelCatalogLoadPromise ||= listAiModelsBridge({ modelSettings: normalizeModelSettingsConfig(config.value.modelSettings).normalized })
      .then((catalog) => normalizeAiModelCatalog(catalog))
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
  const filteredQuickCommands = computed(() => {
    const query = snippetSearchQuery.value.trim().toLowerCase()
    if (query) {
      return quickCommands.value.filter(
        (command) => command.snippet_name.toLowerCase().includes(query) || command.snippet_content.toLowerCase().includes(query)
      )
    }
    if (selectedSnippetGroupUuid.value) {
      return quickCommands.value.filter((command) => command.group_uuid === selectedSnippetGroupUuid.value)
    }
    return quickCommands.value.filter((command) => !command.group_uuid)
  })
  const currentSnippetGroupName = computed(() => snippetGroups.value.find((group) => group.uuid === selectedSnippetGroupUuid.value)?.group_name || '')
  const filteredKnowledgeTree = computed(() => {
    const query = kbSearchQuery.value.trim().toLowerCase()
    if (!query) return knowledgeTree.value
    const filter = (nodes: KnowledgeNode[]): KnowledgeNode[] =>
      nodes
        .map((node) => {
          const hit = node.title.toLowerCase().includes(query)
          const children = node.children ? filter(node.children) : []
          if (hit || children.length) return { ...node, children: children.length ? children : node.children }
          return null
        })
        .filter(Boolean) as KnowledgeNode[]
    return filter(knowledgeTree.value)
  })
  const kbContentSearchVisible = computed(() => kbSearchQuery.value.trim().length > 1)
  const kbCapacityPercent = computed(() => Math.min(100, Math.round((kbUsedBytes.value / kbTotalBytes.value) * 100)))
  const visibleExtensionPlugins = computed(() =>
    extensionPlugins.value
      .filter((plugin) => plugin.show && (plugin.pluginId !== 'Alias' || extensionSettings.value.aliasStatus))
      .sort((a, b) => {
        const rank = (plugin: ExtensionPlugin) => {
          if (!plugin.isPlugin) return 0
          if (plugin.installed) return 1
          if (plugin.hasUpdate) return 2
          return 3
        }
        const aRank = rank(a)
        const bRank = rank(b)
        if (aRank !== bRank) return aRank - bRank
        return a.name.localeCompare(b.name)
      })
  )
  const filteredExtensionPlugins = computed(() => {
    const query = extensionSearchQuery.value.trim().toLowerCase()
    const visible = visibleExtensionPlugins.value
    if (!query) return visible
    return visible.filter((plugin) =>
      [plugin.name, plugin.description, plugin.pluginId, plugin.source || '', ...(plugin.categories || [])].some((value) => value.toLowerCase().includes(query))
    )
  })
  const selectedExtension = computed(() => visibleExtensionPlugins.value.find((plugin) => plugin.pluginId === selectedExtensionId.value) || null)
  const selectedExtensionInstallProgress = computed(() =>
    selectedExtension.value ? extensionInstallProgressMap.value[selectedExtension.value.pluginId] || null : null
  )
  const filteredAliasCommands = computed(() => {
    const query = aliasSearchQuery.value.trim().toLowerCase()
    if (!query) return aliasCommands.value
    return aliasCommands.value.filter((item) => item.alias.toLowerCase().includes(query) || item.command.toLowerCase().includes(query))
  })
  const k8sHasContexts = computed(() => k8sContexts.value.length > 0)
  const k8sActiveContext = computed(() => k8sContexts.value.find((context) => context.isActive) || null)
  const k8sSelectedCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sSelectedClusterId.value) || null)
  const k8sActiveCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sActiveClusterId.value) || null)
  const k8sDeleteConfirmCluster = computed(() => k8sClusters.value.find((cluster) => cluster.id === k8sDeleteConfirmClusterId.value) || null)
  const filteredK8sClusters = computed(() => {
    const query = k8sSearchQuery.value.trim().toLowerCase()
    return k8sClusters.value.filter((cluster) => {
      if (!query) return true
      return [cluster.name, cluster.context_name, cluster.server_url, cluster.default_namespace].some((value) => value.toLowerCase().includes(query))
    })
  })
  const localK8sClusters = computed(() => filteredK8sClusters.value.filter((cluster) => cluster.source_type === 'local'))
  const filteredK8sBastions = computed(() => {
    const query = k8sSearchQuery.value.trim().toLowerCase()
    if (!query) return k8sBastions.value
    return k8sBastions.value.filter((bastion) => {
      if ([bastion.label, bastion.ip].some((value) => value.toLowerCase().includes(query))) return true
      return k8sClusters.value.some(
        (cluster) =>
          cluster.source_type === 'jumpserver' &&
          cluster.bastion_uuid === bastion.uuid &&
          [cluster.name, cluster.server_url].some((value) => value.toLowerCase().includes(query))
      )
    })
  })
  const k8sActiveTerminal = computed(() => k8sTerminalTabs.value.find((tab) => tab.id === k8sActiveTerminalId.value) || null)
  const k8sAgentCluster = computed(() => (k8sAgentClusterId.value ? k8sClusters.value.find((cluster) => cluster.id === k8sAgentClusterId.value) || null : null))
  const k8sAgentCurrentCluster = computed(() => ({
    clusterId: k8sAgentCluster.value?.id || null,
    contextName: k8sAgentCluster.value?.context_name || k8sAgentContextName.value || null
  }))
  const k8sResourceCluster = computed(() => k8sActiveCluster.value || k8sSelectedCluster.value || k8sClusters.value[0] || null)
  const k8sActiveNamespaces = computed(() => {
    const clusterId = k8sResourceCluster.value?.id
    if (!clusterId) return []
    const namespaceNames = new Set<string>()
    k8sNamespaces.value
      .filter((namespace) => namespace.clusterId === clusterId)
      .forEach((namespace) => namespaceNames.add(namespace.name))
    k8sResources.value
      .filter((resource) => resource.clusterId === clusterId && resource.kind !== 'nodes')
      .forEach((resource) => namespaceNames.add(resource.namespace))
    return [...namespaceNames].sort((a, b) => a.localeCompare(b))
  })
  const filteredK8sResources = computed(() => {
    const clusterId = k8sResourceCluster.value?.id
    if (!clusterId) return []
    const query = k8sResourceQuery.value.trim().toLowerCase()
    return k8sResources.value.filter((resource) => {
      if (resource.clusterId !== clusterId || resource.kind !== k8sResourceKind.value) return false
      if (resource.kind !== 'nodes' && k8sResourceNamespace.value !== 'all' && resource.namespace !== k8sResourceNamespace.value) return false
      if (!query) return true
      return [
        resource.name,
        resource.namespace,
        resource.status,
        resource.ready,
        resource.detail,
        resource.node || '',
        resource.image || '',
        resource.ports || '',
        resource.selector || ''
      ].some((value) => value.toLowerCase().includes(query))
    })
  })
  const k8sResourceSummary = computed<Record<K8sResourceKind, number>>(() => {
    const clusterId = k8sResourceCluster.value?.id
    const summary: Record<K8sResourceKind, number> = { pods: 0, deployments: 0, services: 0, nodes: 0 }
    if (!clusterId) return summary
    k8sResources.value.forEach((resource) => {
      if (resource.clusterId !== clusterId) return
      if (resource.kind !== 'nodes' && k8sResourceNamespace.value !== 'all' && resource.namespace !== k8sResourceNamespace.value) return
      summary[resource.kind] += 1
    })
    return summary
  })
  const onboardingCompletedCount = computed(() => Object.values(onboardingCompleted.value).filter(Boolean).length)
  const onboardingActiveSteps = computed(() => (onboardingActiveTour.value ? onboardingTourSteps[onboardingActiveTour.value] : []))
  const onboardingActiveStep = computed(() => onboardingActiveSteps.value[onboardingActiveStepIndex.value] || null)

  const refreshSshAgentKeychainOptions = async () => {
    const listSshAgentKeychainOptionsBridge = window.aiops?.listSshAgentKeychainOptions
    if (typeof listSshAgentKeychainOptionsBridge !== 'function') {
      setSettingsNotice('SSH Agent 密钥列表服务不可用')
      return false
    }
    try {
      const options = readSshAgentKeychainOptionsSnapshot(await listSshAgentKeychainOptionsBridge())
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
    if (!window.aiops) return
    const savedConfig = await window.aiops.getConfig()
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
    if (window.aiops.getQuickCommands) {
      try {
        const bridgeQuickCommands = await window.aiops.getQuickCommands()
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
    snippetGroups.value = normalizedQuickCommands.groups.map((group) => ({ ...group }))
    quickCommands.value = normalizedQuickCommands.snippets.map((snippet) => ({ ...snippet }))
    const {
      normalized: normalizedKnowledgeBase
    } = normalizeKnowledgeBaseConfig(savedConfig.knowledgeBase)
    knowledgeTree.value = cloneKnowledgeNodes(normalizedKnowledgeBase.tree)
    kbUsedBytes.value = normalizedKnowledgeBase.usedBytes
    kbTotalBytes.value = normalizedKnowledgeBase.totalBytes
    let normalizedAliasCommands = normalizeAliasCommandsConfig().normalized
    let aliasCommandsLoadedFromBridge = false
    try {
      const bridgeAliasCommands = await loadAliasCommandsFromBackend()
      const snapshot = normalizeAliasCommandsConfig(bridgeAliasCommands)
      normalizedAliasCommands = snapshot.normalized
      aliasCommandsLoadedFromBridge = true
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : hasAliasListBridge() ? 'Alias 加载失败' : 'Alias 服务不可用')
    }
    aliasCommands.value = normalizedAliasCommands.map((alias) => ({ ...alias, edit: false }))
    let bridgeSettingsPreferences: SettingsPreferencesSnapshot = {
      shortcuts: normalizeShortcutsConfig(savedConfig.shortcuts).normalized,
      rules: normalizeRulesConfig(savedConfig.rules, savedConfig.customInstructions).normalized
    }
    try {
      const result = await window.aiops.getSettingsPreferences?.()
      if (result?.ok && isSettingsPreferencesSnapshot(result.data)) {
        bridgeSettingsPreferences = result.data
      } else if (result?.ok) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
      } else if (result && !result.ok) {
        setSettingsNotice(result.errorMessage || '设置偏好加载失败')
      }
    } catch {
      setSettingsNotice('设置偏好加载失败')
    }
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(bridgeSettingsPreferences.shortcuts)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    const { normalized: normalizedRules } = normalizeRulesConfig(bridgeSettingsPreferences.rules)
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    const savedSkillsSnapshot = normalizeSkillsConfig(savedConfig.skills)
    const bridgeSkills = await readSkillsSnapshotFromBridge()
    const {
      normalized: normalizedSkills,
      changed: rawSkillsChanged
    } = normalizeSkillsConfig(bridgeSkills || savedConfig.skills)
    const skillsChanged = bridgeSkills ? savedSkillsSnapshot.changed : rawSkillsChanged
    settingsSkills.value = normalizedSkills.map((skill) => ({ ...skill }))
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
      missingAgentsLeftOpen ||
      modelSettingsChanged ||
      missingModelSettings ||
      skillsChanged ||
      missingSkills ||
      savedMcpSnapshot.changed ||
      missingMcpServers
    ) {
      config.value = mergeGenericSavedConfig(
        config.value,
        await window.aiops.saveConfig({
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
    if (window.aiops) {
      config.value = mergeGenericSavedConfig(config.value, await window.aiops.saveConfig(normalizedPatch))
    }
    config.value.theme = normalizeThemeId(config.value.theme)
    editorSettings.value = normalizeEditorSettingsConfig(config.value.editorSettings).normalized
    applyCurrentTheme()
    applyCurrentEditorSettings()
    refreshShortcutRuntime()
    setupThemeBridge()
  }

  const applyQuickCommandsSnapshot = (snapshot: unknown) => {
    if (!isQuickCommandsSnapshotData(snapshot)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    snippetGroups.value = snapshot.groups.map((group) => ({ ...group }))
    quickCommands.value = snapshot.snippets.map((snippet) => ({ ...snippet }))
    config.value = mergeUserConfig(config.value, { quickCommands: snapshot })
    return true
  }

  const refreshQuickCommands = async () => {
    if (!window.aiops?.getQuickCommands) {
      setTopNotice('快捷命令加载服务不可用')
      return false
    }
    try {
      const snapshot = await window.aiops.getQuickCommands()
      return applyQuickCommandsSnapshot(snapshot)
    } catch {
      setTopNotice('快捷命令加载失败')
      return false
    }
  }

  const loadKnowledgeTreeFromBridge = async (relDir = ''): Promise<KnowledgeNode[]> => {
    const knowledgeBridge = getKnowledgeBridge()
    if (!knowledgeBridge) throw new Error('KNOWLEDGE_BRIDGE_UNAVAILABLE')
    const entries = await knowledgeBridge.kbListDir(relDir)
    if (!isKnowledgeEntryListData(entries)) throw new Error(malformedKnowledgeBackendResultMessage)
    const nodes: KnowledgeNode[] = []
    for (const entry of entries) {
      const node = knowledgeEntryToNode(entry)
      if (entry.type === 'dir') {
        node.children = await loadKnowledgeTreeFromBridge(entry.relPath)
      }
      nodes.push(node)
    }
    return nodes
  }

  const refreshKnowledgeTree = async (options: { persist?: boolean } = {}) => {
    void options
    const knowledgeBridge = getKnowledgeBridge()
    if (!knowledgeBridge) {
      setTopNotice('知识库加载服务不可用')
      return false
    }
    try {
      const rootResult = await knowledgeBridge.kbEnsureRoot()
      if (!isKnowledgeEnsureRootResultData(rootResult)) {
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return false
      }
      const nextTree = await loadKnowledgeTreeFromBridge('')
      const nextSnapshot: KnowledgeBaseUserConfig = {
        tree: cloneKnowledgeNodes(nextTree),
        usedBytes: knowledgeTreeSize(nextTree),
        totalBytes: kbTotalBytes.value
      }
      knowledgeTree.value = nextTree
      kbUsedBytes.value = nextSnapshot.usedBytes
      return true
    } catch (error) {
      setTopNotice(error instanceof Error && error.message === malformedKnowledgeBackendResultMessage ? malformedKnowledgeBackendResultMessage : '知识库加载失败')
      return false
    }
  }

  const handleKnowledgeTransferProgress = (event: KnowledgeBaseTransferProgress) => {
    if (!isKnowledgeTransferProgressData(event)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    const total = event.total || 1
    const percent = Math.min(100, Math.round((event.transferred / total) * 100))
    const existing = kbImportJobs.value.find((job) => job.id === event.jobId)
    if (existing) {
      existing.destRelPath = event.destRelPath
      existing.percent = percent
    } else {
      kbImportJobs.value.push({ id: event.jobId, destRelPath: event.destRelPath, percent })
    }
    if (percent >= 100) {
      window.setTimeout(() => {
        kbImportJobs.value = kbImportJobs.value.filter((job) => job.id !== event.jobId)
      }, 500)
    }
  }

  const setupKnowledgeBridgeListeners = () => {
    if (removeKnowledgeProgressListener || !window.aiops?.onKbTransferProgress) return
    removeKnowledgeProgressListener = window.aiops.onKbTransferProgress(handleKnowledgeTransferProgress)
  }

  const getAliasCommandsSnapshot = (): AliasCommandConfig[] =>
    aliasCommands.value
      .filter((alias) => alias.id !== 'new' && alias.alias.trim() && alias.command.trim())
      .map((alias) => ({
        id: alias.id,
        alias: alias.alias.trim(),
        command: alias.command.trim(),
        createdAt: alias.createdAt
      }))

  const hasAliasListBridge = () => typeof (window.aiops as { listAliasCommands?: unknown } | undefined)?.listAliasCommands === 'function'

  const applyAliasCommandsFromBackend = (commands: AliasCommandConfig[]) => {
    const { normalized } = normalizeAliasCommandsConfig(commands)
    aliasCommands.value = normalized.map((alias) => ({ ...alias, edit: false }))
    config.value = mergeUserConfig(config.value, { aliasCommands: normalized })
    return normalized
  }

  const loadAliasCommandsFromBackend = async () => {
    if (!hasAliasListBridge()) throw new Error('Alias 服务不可用')
    const result = await window.aiops.listAliasCommands()
    if (!result?.ok) throw new Error(result?.errorMessage || 'Alias 加载失败')
    if (!isAliasCommandListData(result.data)) throw new Error(malformedAliasBackendResultMessage)
    return result.data
  }

  const refreshAliasCommands = async () => {
    try {
      const commands = await loadAliasCommandsFromBackend()
      applyAliasCommandsFromBackend(commands)
      return true
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : 'Alias 加载失败')
      return false
    }
  }

  const syncAliasConfigFromBackend = (commands: AliasCommandConfig[]) => {
    applyAliasCommandsFromBackend(commands)
  }

  const getExtensionSettingsSnapshot = (): ExtensionUserConfig => ({ ...extensionSettings.value })

  const persistExtensionSettings = async (nextSettings: ExtensionSettings) => {
    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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
        const runtimeBridge = window.aiops?.applyPrivacyRuntimeSettings
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
    const saveConfigBridge = window.aiops?.saveConfig
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
        const runtimeBridge = window.aiops?.applyKnowledgeSearchRuntimeSetting
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
    const saveConfigBridge = window.aiops?.saveConfig
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

  const getShortcutsSnapshot = (): ShortcutUserConfig[] => cloneShortcutConfig(settingsShortcuts.value)

  const getRulesSnapshot = (): UserRuleConfig[] => cloneRuleConfig(settingsRules.value)

  const applySettingsPreferencesSnapshot = (snapshot: SettingsPreferencesSnapshot) => {
    const { normalized: normalizedShortcuts } = normalizeShortcutsConfig(snapshot.shortcuts)
    const { normalized: normalizedRules } = normalizeRulesConfig(snapshot.rules)
    settingsShortcuts.value = normalizedShortcuts.map((shortcut) => ({ ...shortcut }))
    settingsRules.value = normalizedRules.map((rule) => ({ ...rule, isEditing: false }))
    config.value = mergeUserConfig(config.value, {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules,
      customInstructions: ''
    })
    refreshShortcutRuntime()
    return {
      shortcuts: normalizedShortcuts,
      rules: normalizedRules
    }
  }

  const getSkillsSnapshot = (): SkillUserConfig[] => cloneSkillConfig(settingsSkills.value)

  const applySkillsList = (skills: SkillUserConfig[]) => {
    const { normalized } = normalizeSkillsConfig(skills)
    settingsSkills.value = normalized.map((skill) => ({ ...skill }))
    config.value = mergeUserConfig(config.value, { skills: normalized })
  }

  const installSkillsUpdateListener = () => {
    if (removeSkillsUpdateListener || !window.aiops?.onSkillsUpdate) return
    removeSkillsUpdateListener = window.aiops.onSkillsUpdate((skills) => {
      if (!isSkillsSnapshotData(skills)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return
      }
      applySkillsList(skills)
    })
  }

  const readSkillsSnapshotFromBridge = async () => {
    if (!window.aiops?.getSkills) return false
    try {
      installSkillsUpdateListener()
      const [path, skills] = await Promise.all([
        window.aiops.getSkillsUserPath ? window.aiops.getSkillsUserPath() : Promise.resolve(skillsUserPath.value),
        window.aiops.getSkills()
      ])
      if (typeof path !== 'string' || !isSkillsSnapshotData(skills)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return null
      }
      skillsUserPath.value = path
      return skills
    } catch {
      setSettingsNotice('Skills 加载失败')
      return null
    }
  }

  const loadSkillsFromBridge = async (options: { expect?: (skills: SkillUserConfig[]) => boolean; malformedMessage?: string } = {}) => {
    const skills = await readSkillsSnapshotFromBridge()
    if (!skills) return false
    if (options.expect && !options.expect(skills)) {
      setSettingsNotice(options.malformedMessage || malformedSkillsBackendResultMessage)
      return false
    }
    applySkillsList(skills)
    return true
  }

  const refreshSkillsAfterMutation = async (expect: (skills: SkillUserConfig[]) => boolean) => {
    return loadSkillsFromBridge({ expect, malformedMessage: malformedSkillsBackendResultMessage })
  }

  const refreshSkillsFromBridge = () => loadSkillsFromBridge()

  const reloadSkills = async () => {
    if (!window.aiops?.reloadSkills) {
      setSettingsNotice('Skills 重新加载服务不可用')
      return false
    }
    try {
      const skills = await window.aiops.reloadSkills()
      if (!isSkillsSnapshotData(skills)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return false
      }
      applySkillsList(skills)
      setSettingsNotice('Skills 已重新加载')
      return true
    } catch {
      setSettingsNotice('Skills 重新加载失败')
      return false
    }
  }

  const openSkillsFolder = async () => {
    if (!window.aiops?.openSkillsFolder) {
      setSettingsNotice('Skills 文件夹打开服务不可用')
      return false
    }
    try {
      const result = await window.aiops.openSkillsFolder()
      if (!result || typeof result.path !== 'string' || !result.path.trim()) {
        setSettingsNotice('Skills 文件夹打开失败')
        return false
      }
      setSettingsNotice('Skills 文件夹已打开')
      return true
    } catch {
      setSettingsNotice('Skills 文件夹打开失败')
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
    if (!window.aiops?.getMcpServers) {
      setSettingsNotice('MCP 列表加载服务不可用')
      return null
    }
    try {
      const servers = await window.aiops.getMcpServers()
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
    if (removeMcpConfigFileListener || !window.aiops?.onMcpConfigFileChanged) return
    removeMcpConfigFileListener = window.aiops.onMcpConfigFileChanged((content) => {
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

  const ensureSelectedExtensionVisible = () => {
    if (visibleExtensionPlugins.value.some((plugin) => plugin.pluginId === selectedExtensionId.value)) return
    selectedExtensionId.value = visibleExtensionPlugins.value[0]?.pluginId || ''
    extensionDetailTab.value = 'details'
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
    const result = await window.aiops.openSettingsDocumentation(input)
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
    if (!hasAiopsBridgeMethod('openSettingsDocumentation')) {
      setSettingsNotice('文档入口服务不可用')
      return false
    }
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
    if (!hasAiopsBridgeMethod('openSettingsDocumentation')) {
      setSettingsNotice('文档入口服务不可用')
      return false
    }
    try {
      return await readSettingsDocumentation({ documentPath: normalizedPath, basePath: settingsDocumentationPath.value })
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

    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    const showOpenDialog = window.aiops?.showOpenDialog
    if (typeof showOpenDialog !== 'function') {
      setSettingsNotice('自定义背景选择服务不可用')
      return false
    }
    const saveCustomBackground = window.aiops?.saveCustomBackground
    if (typeof saveCustomBackground !== 'function') {
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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

  const updateSshProxyForm = (patch: Partial<SshProxyForm>) => {
    sshProxyForm.value = {
      ...sshProxyForm.value,
      ...patch,
      type: stringFromOptions(patch.type || sshProxyForm.value.type, sshProxyTypes, 'SOCKS5'),
      port: patch.port !== undefined ? numberInRange(patch.port, sshProxyForm.value.port, 1, 65535) : sshProxyForm.value.port
    }
  }

  const persistSshProxyConfigs = async (nextConfigs: SshProxyConfig[], unavailableNotice: string, failureNotice: string) => {
    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    const checkProviderBridge = window.aiops?.checkModelProvider
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
    const saveConfigBridge = window.aiops?.saveConfig
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
    if (removeKeywordHighlightConfigFileListener || !window.aiops?.onKeywordHighlightConfigFileChanged) return
    removeKeywordHighlightConfigFileListener = window.aiops.onKeywordHighlightConfigFileChanged((content) => {
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
    if (!window.aiops) return
    try {
      const [path, content] = await Promise.all([window.aiops.getKeywordHighlightConfigPath(), window.aiops.readKeywordHighlightConfig()])
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
    const writeKeywordHighlightConfig = window.aiops?.writeKeywordHighlightConfig
    if (typeof writeKeywordHighlightConfig !== 'function') {
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
    const writeKeywordHighlightConfig = window.aiops?.writeKeywordHighlightConfig
    if (typeof writeKeywordHighlightConfig !== 'function') {
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
    if (removeSecurityConfigFileListener || !window.aiops?.onSecurityConfigFileChanged) return
    removeSecurityConfigFileListener = window.aiops.onSecurityConfigFileChanged((content) => {
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
    if (!window.aiops) return
    try {
      const [path, content] = await Promise.all([window.aiops.getSecurityConfigPath(), window.aiops.readSecurityConfig()])
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
    const writeSecurityConfig = window.aiops?.writeSecurityConfig
    if (typeof writeSecurityConfig !== 'function') {
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
    const writeSecurityConfig = window.aiops?.writeSecurityConfig
    if (typeof writeSecurityConfig !== 'function') {
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
    if (!window.aiops?.getUserAccount) return false
    try {
      const result = await window.aiops.getUserAccount()
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

  const isValidUserCodeCooldown = (cooldown: UserCodeResultData | undefined): cooldown is UserCodeResultData =>
    Boolean(cooldown && typeof cooldown.expiresAt === 'number' && Number.isFinite(cooldown.expiresAt) && typeof cooldown.message === 'string')

  const startUserCountdown = (target: 'login' | 'contact', kind: 'email' | 'mobile', cooldown: UserCodeResultData) => {
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
    if (!window.aiops?.getUserAccount) {
      setUserNotice('账号中心服务不可用')
      if (options.notifySettings) setSettingsNotice('账户中心服务不可用')
      return false
    }
    const openUserAccountCenterBridge = window.aiops?.openUserAccountCenter
    if (typeof openUserAccountCenterBridge !== 'function') {
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
    const openUserLoginBridge = window.aiops?.openUserLogin
    if (typeof openUserLoginBridge !== 'function') {
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
    const loginUserAccountBridge = window.aiops?.loginUserAccount
    if (typeof loginUserAccountBridge !== 'function') {
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
    const logoutUserAccountBridge = window.aiops?.logoutUserAccount
    if (typeof logoutUserAccountBridge !== 'function') {
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
    const deactivateUserAccountBridge = window.aiops?.deactivateUserAccount
    if (typeof deactivateUserAccountBridge !== 'function') {
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
    const skipUserLoginBridge = window.aiops?.skipUserLogin
    if (typeof skipUserLoginBridge !== 'function') {
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
    const sendUserLoginCodeBridge = window.aiops?.sendUserLoginCode
    if (typeof sendUserLoginCodeBridge !== 'function') {
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
    const loginUserAccountBridge = window.aiops?.loginUserAccount
    if (typeof loginUserAccountBridge !== 'function') {
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
    const loginUserAccountBridge = window.aiops?.loginUserAccount
    if (typeof loginUserAccountBridge !== 'function') {
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
    const loginUserAccountBridge = window.aiops?.loginUserAccount
    if (typeof loginUserAccountBridge !== 'function') {
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
    const updateUserProfileBridge = window.aiops?.updateUserProfile
    if (typeof updateUserProfileBridge !== 'function') {
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
    const resetUserPasswordBridge = window.aiops?.resetUserPassword
    if (typeof resetUserPasswordBridge !== 'function') {
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
    const sendUserContactCodeBridge = window.aiops?.sendUserContactCode
    if (typeof sendUserContactCodeBridge !== 'function') {
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
    const bindUserContactBridge = window.aiops?.bindUserContact
    if (typeof bindUserContactBridge !== 'function') {
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
    const prepareUserAvatarImageBridge = window.aiops?.prepareUserAvatarImage
    if (typeof prepareUserAvatarImageBridge !== 'function') {
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
    if (removeAppUpdateProgressListener || !window.aiops?.onAppUpdateProgress) return
    removeAppUpdateProgressListener = window.aiops.onAppUpdateProgress(handleAppUpdateProgress)
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
    const downloadAppUpdateBridge = window.aiops?.downloadAppUpdate
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
    const installAppUpdateBridge = window.aiops?.installAppUpdate
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
    const checkUpdateBridge = window.aiops?.checkUpdate
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
      ...(input.surfaceId ? { surfaceId: input.surfaceId } : {})
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

  const aiSessionAttentionId = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `managed-ai:${session.source}:${session.id}`

  const managedAiSessionKey = (session: Pick<ManagedAiSession, 'source' | 'id'>) => `${session.source}:${session.id}`

  const managedAiSessionStateForEvent = (event: AiAgentSessionEventName, previous: ManagedAiSessionState = 'unknown'): ManagedAiSessionState => {
    if (event === 'session_start') return 'idle'
    if (event === 'prompt_submit' || event === 'pre_tool_use') return 'working'
    if (event === 'permission_request' || event === 'question' || event === 'notification') return 'needsInput'
    if (event === 'stop') return 'idle'
    if (event === 'session_end') return 'ended'
    return previous
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
          kind: session.lastEvent === 'permission_request' ? 'approval' : 'question',
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
      events: session.events.map((event) => ({ ...event, raw: event.raw ? { ...event.raw } : undefined })),
      decisions: session.decisions.map((decision) => ({ ...decision }))
    }))
    managedAiSessionsError.value = ''
    if (selectedManagedAiSessionKey.value && !managedAiSessions.value.some((session) => managedAiSessionKey(session) === selectedManagedAiSessionKey.value)) {
      selectedManagedAiSessionKey.value = ''
    }
    refreshManagedAiAttentionItems()
  }

  const refreshManagedAiSessions = async (options: { silent?: boolean } = {}) => {
    const listBridge = window.aiops?.listManagedAiSessions
    if (typeof listBridge !== 'function') {
      managedAiSessionsError.value = 'AI 会话管理服务不可用'
      if (!options.silent) setTopNotice(managedAiSessionsError.value)
      return false
    }
    managedAiSessionsLoading.value = true
    try {
      const result = (await listBridge()) as ManagedAiSessionListResult
      if (!result?.ok || !isManagedAiSessionSnapshot(result.data)) {
        managedAiSessionsError.value = result?.errorMessage || 'AI 会话列表加载失败'
        if (!options.silent) setTopNotice(managedAiSessionsError.value)
        return false
      }
      applyManagedAiSessionSnapshot(result.data)
      if (!options.silent) setTopNotice('AI 会话已刷新')
      return true
    } catch (error) {
      managedAiSessionsError.value = error instanceof Error ? error.message : 'AI 会话列表加载失败'
      if (!options.silent) setTopNotice(managedAiSessionsError.value)
      return false
    } finally {
      managedAiSessionsLoading.value = false
    }
  }

  const upsertManagedAiSession = (event: AiAgentSessionEvent) => {
    const existing = managedAiSessions.value.find((session) => session.source === event.source && session.id === event.sessionId)
    const now = Date.now()
    const timelineEvent: ManagedAiSessionTimelineEvent = {
      ...event,
      id: `${event.receivedAt}-${event.event}`
    }
    const next: ManagedAiSession = {
      id: event.sessionId,
      source: event.source,
      title: existing?.userTitle || existing?.title || event.title || event.source,
      summary: event.summary || existing?.summary || '',
    state: managedAiSessionStateForEvent(event.event, existing?.state),
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
      ...(typeof event.actionable === 'boolean' ? { actionable: event.actionable } : existing?.actionable ? { actionable: existing.actionable } : {})
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
    const bridge = window.aiops?.replyManagedAiSession
    if (typeof bridge === 'function') {
      void bridge({ source, sessionId, kind: 'handled' }).then((result: ManagedAiSessionMutationResult) => {
        if (result?.ok && isManagedAiSessionMutationData(result.data)) applyManagedAiSessionSnapshot(result.data.snapshot)
      })
    }
    return changed
  }

  const replyManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, kind: ManagedAiSessionDecision['kind'], message?: string) => {
    const bridge = window.aiops?.replyManagedAiSession
    if (typeof bridge !== 'function') {
      setTopNotice('AI 会话管理服务不可用')
      return false
    }
    try {
      const result = (await bridge({ source, sessionId, kind, message })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || 'AI 会话处理失败')
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(
        kind === 'allow'
          ? '已允许 AI 请求'
          : kind === 'always'
            ? '已持续允许 AI 请求'
            : kind === 'bypass'
              ? '已允许本会话绕过审批'
              : kind === 'deny'
                ? '已拒绝 AI 请求'
                : kind === 'reply'
                  ? '已回复 AI 问题'
                  : '已标记处理'
      )
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : 'AI 会话处理失败')
      return false
    }
  }

  const renameManagedAiSession = async (source: AiAgentSessionSource, sessionId: string, title: string) => {
    const bridge = window.aiops?.renameManagedAiSession
    if (typeof bridge !== 'function') {
      setTopNotice('AI 会话管理服务不可用')
      return false
    }
    try {
      const result = (await bridge({ source, sessionId, title })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || 'AI 会话重命名失败')
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice('AI 会话已重命名')
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : 'AI 会话重命名失败')
      return false
    }
  }

  const clearManagedAiSession = async (source: AiAgentSessionSource, sessionId: string) => {
    const bridge = window.aiops?.clearManagedAiSession
    if (typeof bridge !== 'function') {
      setTopNotice('AI 会话管理服务不可用')
      return false
    }
    try {
      const result = (await bridge({ source, sessionId })) as ManagedAiSessionMutationResult
      if (!result?.ok || !isManagedAiSessionMutationData(result.data)) {
        setTopNotice(result?.errorMessage || 'AI 会话清理失败')
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice('AI 会话已清理')
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : 'AI 会话清理失败')
      return false
    }
  }

  const bulkManagedAiSessions = async (input: ManagedAiSessionBulkInput) => {
    const bridge = window.aiops?.bulkManagedAiSessions
    if (typeof bridge !== 'function') {
      setTopNotice('AI 会话管理服务不可用')
      return false
    }
    try {
      const result = (await bridge(input)) as ManagedAiSessionBulkResult
      if (!result?.ok || !isManagedAiSessionBulkData(result.data)) {
        setTopNotice(result?.errorMessage || 'AI 会话批量操作失败')
        return false
      }
      applyManagedAiSessionSnapshot(result.data.snapshot)
      setTopNotice(`已处理 ${result.data.changed} 个 AI 会话`)
      return true
    } catch (error) {
      setTopNotice(error instanceof Error ? error.message : 'AI 会话批量操作失败')
      return false
    }
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

  const jumpToNextAiAttention = () => {
    const item = currentAiAttentionItem.value
    if (!item) {
      mode.value = 'terminal'
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
      setTopNotice('没有待处理的 AI 消息')
      return null
    }
    const managedSession = item.id.startsWith('managed-ai:') && item.sessionId ? focusManagedAiSession(item.sessionId) : null
    if (managedSession) {
      activeModule.value = 'aiSessions'
      leftPanelOpen.value = true
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
    const checkUpdateBridge = window.aiops?.checkUpdate
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
        if (!hasAiopsBridgeMethod('openLogDir')) {
          setSettingsNotice('日志目录服务不可用')
          return false
        }
        const result = await window.aiops.openLogDir()
        if (!isOpenPathResult(result)) {
          setSettingsNotice('日志目录打开失败')
          return false
        }
        setSettingsNotice('日志目录已打开')
        return true
      }
      if (label === '反馈页面') {
        if (!hasAiopsBridgeMethod('submitSettingsFeedbackReport')) {
          setSettingsNotice('反馈报告服务不可用')
          return false
        }
        const result = await window.aiops.submitSettingsFeedbackReport()
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
    if (!window.aiops) return
    if (!window.aiops.getMcpConfigPath || !window.aiops.readMcpConfig) {
      mcpConfigEditorError.value = 'Failed to read MCP config: MCP 配置读取服务不可用'
      setSettingsNotice('MCP 配置读取服务不可用')
      return
    }
    try {
      const [bridgeSnapshot, path, content] = await Promise.all([readMcpServersSnapshotFromBridge(), window.aiops.getMcpConfigPath(), window.aiops.readMcpConfig()])
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
    if (!window.aiops?.writeMcpConfig) {
      mcpConfigEditorError.value = 'Save failed: MCP 配置保存服务不可用'
      mcpConfigEditorLastSaved.value = false
      setSettingsNotice('MCP 配置保存服务不可用')
      return false
    }
    try {
      const result = await window.aiops.writeMcpConfig(content)
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
    if (!window.aiops?.toggleMcpServer) {
      setSettingsNotice('MCP 状态服务不可用')
      return false
    }
    const nextDisabled = !server.disabled
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await window.aiops.toggleMcpServer(name, nextDisabled)
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
    if (!window.aiops?.deleteMcpServer) {
      setSettingsNotice('MCP 删除服务不可用')
      return false
    }
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await window.aiops.deleteMcpServer(name)
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
    if (!window.aiops?.setMcpToolState) {
      setSettingsNotice('MCP Tool 状态服务不可用')
      return false
    }
    const nextEnabled = !tool.enabled
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await window.aiops.setMcpToolState(serverName, toolName, nextEnabled)
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
    if (!window.aiops?.setMcpToolAutoApprove) {
      setSettingsNotice('MCP Auto Approve 服务不可用')
      return false
    }
    const nextAutoApprove = !tool.autoApprove
    const previousSnapshot = getMcpSnapshot()
    try {
      const result = await window.aiops.setMcpToolAutoApprove(serverName, toolName, nextAutoApprove)
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
    if (!window.aiops?.callMcpTool) {
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
      const result = await window.aiops.callMcpTool(serverName, toolName, parsed.arguments)
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
    if (!window.aiops?.readMcpResource) {
      const message = 'MCP Resource 读取服务不可用'
      setSettingsNotice(message)
      return false
    }
    const previousRecord = mcpOperationResults.value[key] ? { ...mcpOperationResults.value[key] } : undefined
    setMcpOperationResult(key, { status: 'running', output: '', error: '' })
    try {
      const result = await window.aiops.readMcpResource(serverName, uri)
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

  const openSkillModal = async (mode: 'create' | 'edit', skillName?: string) => {
    if (mode === 'edit') {
      const skill = settingsSkills.value.find((item) => item.name === skillName)
      if (!skill) return
      if (!skill.editable) {
        setSettingsNotice('只能编辑用户创建的 Skill')
        return
      }
      if (!window.aiops?.readSkillContent) {
        setSettingsNotice('Skill 内容读取服务不可用')
        return
      }
      try {
        const result = await window.aiops.readSkillContent(skill.name)
        if (!isSkillContentResultData(result, skill.name)) {
          setSettingsNotice(malformedSkillsBackendResultMessage)
          return
        }
        skillModal.value = {
          mode,
          name: skill.name,
          description: typeof result.metadata.description === 'string' ? result.metadata.description : skill.description,
          content: result.content || skill.content
        }
      } catch {
        setSettingsNotice(`${skill.name} 读取失败`)
      }
      return
    }
    skillModal.value = { mode, name: '', description: '', content: '' }
  }

  const closeSkillModal = () => {
    skillModal.value = { mode: null, name: '', description: '', content: '' }
  }

  const saveSkillModal = async () => {
    const name = skillModal.value.name.trim()
    const description = skillModal.value.description.trim()
    const content = skillModal.value.content.trim()
    if (!name || !description || !content) {
      setSettingsNotice('Skill 名称、描述和内容不能为空')
      return false
    }
    if (skillModal.value.mode === 'edit') {
      const skill = settingsSkills.value.find((item) => item.name === name)
      if (!skill) return false
      if (!skill.editable) {
        setSettingsNotice('只能编辑用户创建的 Skill')
        return false
      }
      if (!window.aiops?.updateSkill) {
        setSettingsNotice('Skill 保存服务不可用')
        return false
      }
      try {
        const result = await window.aiops.updateSkill(name, { name, description }, content)
        if (!isSkillWriteResultForRequest(result, { name, description, content })) {
          setSettingsNotice(malformedSkillsBackendResultMessage)
          return false
        }
        const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name, description, content }))
        if (!refreshed) return false
        setSettingsNotice(`${name} 已保存`)
        closeSkillModal()
        return true
      } catch {
        setSettingsNotice(`${name} 保存失败`)
        return false
      }
    }
    if (!/^[a-z-]+$/.test(name)) {
      setSettingsNotice('Skill 名称只能包含小写字母和连字符')
      return false
    }
    if (settingsSkills.value.some((item) => item.name === name)) {
      setSettingsNotice('Skill 已存在')
      return false
    }
    if (!window.aiops?.createSkill) {
      setSettingsNotice('Skill 创建服务不可用')
      return false
    }
    try {
      const created = await window.aiops.createSkill({ name, description }, content)
      if (!isSkillWriteResultForRequest(created, { name, description, content, enabled: true })) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return false
      }
      const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name, description, content }))
      if (!refreshed) return false
      setSettingsNotice(`${name} 已创建`)
      closeSkillModal()
      return true
    } catch {
      setSettingsNotice(`${name} 创建失败`)
      return false
    }
  }

  const toggleSkillEnabled = async (name: string) => {
    const skill = settingsSkills.value.find((item) => item.name === name)
    if (!skill) return
    if (!window.aiops?.setSkillEnabled) {
      setSettingsNotice('Skill 状态服务不可用')
      return
    }
    const previous = skill.enabled
    const nextEnabled = !skill.enabled
    try {
      const result = await window.aiops.setSkillEnabled(name, nextEnabled)
      if (!isSkillEnabledResultForRequest(result, { name, enabled: nextEnabled })) {
        skill.enabled = previous
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return
      }
      const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name, enabled: nextEnabled }))
      if (!refreshed) {
        skill.enabled = previous
        return
      }
      setSettingsNotice(`${name} ${nextEnabled ? '已启用' : '已禁用'}`)
    } catch {
      skill.enabled = previous
      setSettingsNotice(`${name} 状态更新失败`)
    }
  }

  const deleteSkill = async (name: string) => {
    const skill = settingsSkills.value.find((item) => item.name === name)
    if (!skill) return
    if (!skill.editable) {
      setSettingsNotice('只能删除用户创建的 Skill')
      return
    }
    if (!window.aiops?.deleteSkill) {
      setSettingsNotice('Skill 删除服务不可用')
      return
    }
    try {
      const result = await window.aiops.deleteSkill(name)
      if (!isSkillDeleteResultForRequest(result, name)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return
      }
      const refreshed = await refreshSkillsAfterMutation((skills) => !skills.some((item) => item.name === name))
      if (!refreshed) return
      setSettingsNotice(`${name} 已删除`)
    } catch {
      setSettingsNotice(`${name} 删除失败`)
    }
  }

  const showSkillImportError = (errorCode?: string) => {
    const errorMap: Record<string, string> = {
      INVALID_ZIP: 'Skill ZIP 无效',
      NO_SKILL_MD: 'ZIP 中未找到 SKILL.md',
      INVALID_METADATA: 'SKILL.md 元数据无效',
      EXTRACT_FAILED: 'Skill ZIP 解压失败'
    }
    setSettingsNotice(errorMap[errorCode || ''] || 'Skill ZIP 导入失败')
  }

  const importSkillZip = async () => {
    const importSkillZipBridge = window.aiops?.importSkillZip
    if (typeof importSkillZipBridge !== 'function') {
      setSettingsNotice('Skill ZIP 导入服务不可用')
      return false
    }
    try {
      if (pendingSkillImportOverwritePath) {
        const overwritePath = pendingSkillImportOverwritePath
        const overwriteResult = await importSkillZipBridge(overwritePath, true)
        if (!isSkillImportResultData(overwriteResult)) {
          pendingSkillImportOverwritePath = ''
          setSettingsNotice(malformedSkillsBackendResultMessage)
          return false
        }
        if (overwriteResult.success) {
          pendingSkillImportOverwritePath = ''
          const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name: overwriteResult.skillName! }))
          if (!refreshed) return false
          setSettingsNotice(`${overwriteResult.skillName || 'Skill'} 已覆盖导入`)
          return true
        }
        if (overwriteResult.errorCode === 'DIR_EXISTS') {
          setSettingsNotice('Skill 已存在，再次点击 Import 覆盖')
          return false
        }
        pendingSkillImportOverwritePath = ''
        showSkillImportError(overwriteResult.errorCode)
        return false
      }
      const showOpenDialog = window.aiops?.showOpenDialog
      if (typeof showOpenDialog !== 'function') {
        setSettingsNotice('Skill ZIP 选择服务不可用')
        return false
      }
      const result = await showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
      })
      if (!result || result.canceled || !result.filePaths.length) return false
      const importResult = await importSkillZipBridge(result.filePaths[0])
      if (!isSkillImportResultData(importResult)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return false
      }
      if (importResult.success) {
        const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name: importResult.skillName! }))
        if (!refreshed) return false
        setSettingsNotice(`${importResult.skillName || 'Skill'} 已导入`)
        return true
      }
      if (importResult.errorCode === 'DIR_EXISTS') {
        pendingSkillImportOverwritePath = result.filePaths[0]
        setSettingsNotice('Skill 已存在，再次点击 Import 覆盖')
        return false
      }
      showSkillImportError(importResult.errorCode)
      return false
    } catch {
      pendingSkillImportOverwritePath = ''
      setSettingsNotice('Skill ZIP 导入失败')
      return false
    }
  }

  const exportSkillZip = async (name: string) => {
    const exportSkillZipBridge = window.aiops?.exportSkillZip
    if (typeof exportSkillZipBridge !== 'function') {
      setSettingsNotice(`${name} ZIP 导出服务不可用`)
      return false
    }
    try {
      const result = await exportSkillZipBridge(name)
      if (!isSkillExportResultData(result) || (result.success && result.skillName !== name)) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return false
      }
      if (result.success) {
        setSettingsNotice(`${name} 已导出为 ZIP`)
        return true
      } else if (result.error !== 'cancelled') {
        setSettingsNotice(`${name} ZIP 导出失败`)
      }
      return false
    } catch {
      setSettingsNotice(`${name} ZIP 导出失败`)
      return false
    }
  }

  const addSettingsRule = () => {
    if (settingsRules.value.some((rule) => rule.isEditing)) return
    settingsRules.value.unshift({ id: 'rule-draft-new', content: '', enabled: true, isEditing: true, isDraft: true })
  }

  const editSettingsRule = (id: string) => {
    settingsRules.value.forEach((rule) => {
      rule.isEditing = rule.id === id
    })
  }

  const updateSettingsRuleDraft = (id: string, content: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (rule) rule.content = content
  }

  const saveSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    if (!rule.content.trim()) {
      if (rule.isDraft) {
        settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
        return false
      }
      return deleteSettingsRule(id)
    }
    const saveSettingsRuleBridge = window.aiops?.saveSettingsRule
    if (typeof saveSettingsRuleBridge !== 'function') {
      setSettingsNotice('规则保存服务不可用')
      return false
    }
    try {
      const result = await saveSettingsRuleBridge({
        ...(rule.isDraft ? {} : { id }),
        content: rule.content,
        enabled: rule.enabled
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则保存失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice(result.data.message || '规则已保存')
      return true
    } catch {
      setSettingsNotice('规则保存失败')
      return false
    }
  }

  const cancelSettingsRuleEdit = (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return
    if (!rule.content.trim()) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return
    }
    const savedRule = config.value.rules?.find((item) => item.id === id)
    if (savedRule) {
      rule.content = savedRule.content
      rule.enabled = savedRule.enabled
      rule.isDraft = false
    }
    rule.isEditing = false
  }

  const toggleSettingsRule = async (id: string) => {
    const rule = settingsRules.value.find((item) => item.id === id)
    if (!rule) return false
    const nextEnabled = !rule.enabled
    const saveSettingsRuleBridge = window.aiops?.saveSettingsRule
    if (typeof saveSettingsRuleBridge !== 'function') {
      setSettingsNotice('规则更新服务不可用')
      return false
    }
    try {
      const result = await saveSettingsRuleBridge({
        id,
        content: rule.content,
        enabled: nextEnabled
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则更新失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice(`规则${nextEnabled ? '已启用' : '已禁用'}`)
      return true
    } catch {
      setSettingsNotice('规则更新失败')
      return false
    }
  }

  const deleteSettingsRule = async (id: string) => {
    const existing = settingsRules.value.find((item) => item.id === id)
    if (!existing) return false
    if (!existing.content.trim() && existing.isDraft) {
      settingsRules.value = settingsRules.value.filter((item) => item.id !== id)
      return true
    }
    const deleteSettingsRuleBridge = window.aiops?.deleteSettingsRule
    if (typeof deleteSettingsRuleBridge !== 'function') {
      setSettingsNotice('规则删除服务不可用')
      return false
    }
    try {
      const result = await deleteSettingsRuleBridge(id)
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '规则删除失败')
        return false
      }
      if (!isSettingsRuleDeleteData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      setSettingsNotice('规则已删除')
      return true
    } catch {
      setSettingsNotice('规则删除失败')
      return false
    }
  }

  const startShortcutRecording = (actionId: string) => {
    shortcutRecording.value = { actionId, tempShortcut: '' }
    shortcutRuntime.setRecording(true)
  }

  const updateShortcutRecording = (shortcut: string) => {
    shortcutRecording.value.tempShortcut = shortcut
  }

  const saveShortcutRecording = async () => {
    const { actionId, tempShortcut } = shortcutRecording.value
    const nextShortcut = tempShortcut.trim()
    if (!actionId || !nextShortcut) return false
    const shortcut = settingsShortcuts.value.find((item) => item.id === actionId)
    if (!shortcut) return false
    if (!isValidShortcutForAction(actionId, nextShortcut)) {
      setSettingsNotice('快捷键格式无效')
      return false
    }
    const conflicted = settingsShortcuts.value.some((item) => item.id !== actionId && item.shortcut === nextShortcut)
    if (conflicted) {
      setSettingsNotice('快捷键已被占用')
      return false
    }
    const saveSettingsShortcutBridge = window.aiops?.saveSettingsShortcut
    if (typeof saveSettingsShortcutBridge !== 'function') {
      setSettingsNotice('快捷键保存服务不可用')
      return false
    }
    try {
      const result = await saveSettingsShortcutBridge({
        id: actionId,
        shortcut: nextShortcut
      })
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '快捷键保存失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      shortcutRuntime.setRecording(false)
      setSettingsNotice(result.data.message || '快捷键已保存')
      return true
    } catch {
      setSettingsNotice('快捷键保存失败')
      return false
    }
  }

  const cancelShortcutRecording = () => {
    shortcutRecording.value = { actionId: null, tempShortcut: '' }
    shortcutRuntime.setRecording(false)
  }

  const resetAllShortcuts = async () => {
    const resetSettingsShortcutsBridge = window.aiops?.resetSettingsShortcuts
    if (typeof resetSettingsShortcutsBridge !== 'function') {
      setSettingsNotice('快捷键重置服务不可用')
      return false
    }
    try {
      const result = await resetSettingsShortcutsBridge()
      if (!result?.ok || !result.data) {
        setSettingsNotice(result?.errorMessage || '快捷键重置失败')
        return false
      }
      if (!isSettingsPreferencesMutationData(result.data)) {
        setSettingsNotice(malformedSettingsBackendResultMessage)
        return false
      }
      applySettingsPreferencesSnapshot(result.data)
      shortcutRecording.value = { actionId: null, tempShortcut: '' }
      shortcutRuntime.setRecording(false)
      setSettingsNotice(result.data.message || '快捷键已全部重置')
      return true
    } catch {
      setSettingsNotice('快捷键重置失败')
      return false
    }
  }

  const installShortcutRuntime = () => {
    shortcutRuntime.install(getShortcutsSnapshot(), shortcutHandlers)
  }

  const uninstallShortcutRuntime = () => {
    shortcutRuntime.destroy()
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
    const revokeTrustedDeviceBridge = window.aiops?.revokeTrustedDevice
    if (typeof revokeTrustedDeviceBridge !== 'function') {
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
    setTopNotice('已打开 AI 设置')
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

  const setFilesUiMode = (mode: FilesUiMode) => {
    filesUiMode.value = mode
  }

  const clearFileTransferTaskRemovalTimer = (id: string) => {
    const timer = fileTransferTaskRemovalTimers.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    fileTransferTaskRemovalTimers.delete(id)
  }

  const normalizeFileTransferTask = (value: unknown): FileTransferTask | null => {
    if (!isRecord(value)) return null
    const type = value.type === 'download' || value.type === 'upload' || value.type === 'r2r' ? value.type : null
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    const source = typeof value.source === 'string' ? value.source : ''
    const target = typeof value.target === 'string' ? value.target : ''
    const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : ''
    if (!id || !type || !name || !source || !target) return null
    const status =
      value.status === 'running' || value.status === 'success' || value.status === 'failed' || value.status === 'error'
        ? value.status
        : 'running'
    const progress = typeof value.progress === 'number' && Number.isFinite(value.progress) ? Math.min(100, Math.max(0, Math.round(value.progress))) : 0
    const stage = value.stage === 'scanning' || value.stage === 'pending' ? value.stage : undefined
    const task: FileTransferTask = {
      id,
      type,
      name,
      source,
      target,
      progress,
      speed: typeof value.speed === 'string' && value.speed.trim() ? value.speed : status === 'running' ? 'pending' : '',
      status,
      ...(stage ? { stage } : {}),
      ...(value.isGroup === true ? { isGroup: true } : {}),
      ...(typeof value.fromHost === 'string' && value.fromHost ? { fromHost: value.fromHost } : {}),
      ...(typeof value.toHost === 'string' && value.toHost ? { toHost: value.toHost } : {}),
      ...(typeof value.totalFiles === 'number' && Number.isFinite(value.totalFiles) ? { totalFiles: Math.max(0, Math.round(value.totalFiles)) } : {}),
      ...(typeof value.finishedFiles === 'number' && Number.isFinite(value.finishedFiles)
        ? { finishedFiles: Math.max(0, Math.round(value.finishedFiles)) }
        : {})
    }
    const children = Array.isArray(value.children) ? value.children.map(normalizeFileTransferTask).filter((child): child is FileTransferTask => !!child) : []
    if (children.length) task.children = children
    return task
  }

  const normalizedFileTransferTaskSnapshot = (tasks: unknown[]) => {
    if (!tasks.every(isFileTransferTaskData)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return tasks.map(normalizeFileTransferTask).filter((task): task is FileTransferTask => !!task)
  }

  const mergeFileTransferTaskSnapshot = (snapshot: FileTransferTask[], options: { replaceCompleted?: boolean } = {}) => {
    const replaceCompleted = options.replaceCompleted === true
    const activeIds = new Set(snapshot.map((task) => task.id))
    const finished = fileTransferTasks.value.filter((task) => task.status !== 'running' && !activeIds.has(task.id))
    fileTransferTasks.value = replaceCompleted ? snapshot : [...snapshot, ...finished]
    snapshot.forEach((task) => clearFileTransferTaskRemovalTimer(task.id))
    return true
  }

  const refreshFileTransferTasks = async (options: { replaceCompleted?: boolean } = {}) => {
    const listFileTransferTasksBridge = window.aiops?.listFileTransferTasks
    if (typeof listFileTransferTasksBridge !== 'function') {
      setTopNotice('文件传输任务加载服务不可用')
      return false
    }
    try {
      const tasks = await listFileTransferTasksBridge()
      if (!Array.isArray(tasks)) {
        setTopNotice(malformedFilesBackendResultMessage)
        return false
      }
      const snapshot = normalizedFileTransferTaskSnapshot(tasks)
      if (!snapshot) return false
      mergeFileTransferTaskSnapshot(snapshot, options)
      return true
    } catch {
      setTopNotice('文件传输任务加载失败')
      return false
    }
  }

  const applyFileSessionCatalog = (catalog: FileSessionCatalog) => {
    if (!isFileSessionCatalogData(catalog)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    fileSessions.value = catalog.sessions.map((session) => ({ ...session }))
    fileSessionFolders.value = catalog.folders.map((folder) => ({ ...folder }))
    if (!fileSessions.value.some((session) => session.id === selectedLeftFileSessionId.value)) {
      selectedLeftFileSessionId.value = null
    }
    if (!fileSessions.value.some((session) => session.id === selectedRightFileSessionId.value)) {
      selectedRightFileSessionId.value = fileSessions.value.some((session) => session.id === 'local') ? 'local' : fileSessions.value[0]?.id || null
    }
    return catalog
  }

  const refreshFileSessionCatalog = async () => {
    const listFileSessionCatalogBridge = window.aiops?.listFileSessionCatalog
    if (typeof listFileSessionCatalogBridge !== 'function') {
      setTopNotice('文件会话加载服务不可用')
      return null
    }
    try {
      const result = await listFileSessionCatalogBridge()
      if (!result?.ok || !result.data) {
        setTopNotice(result?.errorMessage || '文件会话加载失败')
        return null
      }
      return applyFileSessionCatalog(result.data)
    } catch {
      setTopNotice('文件会话加载失败')
      return null
    }
  }

  const applyFileSessionRecordMutationResult = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['saveFileSession']>>> | undefined,
    fallbackNotice = '文件会话写入失败'
  ) => {
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || fallbackNotice)
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const applyFileSessionFolderMutationResult = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['saveFileSessionFolder']>>> | undefined,
    fallbackNotice = '文件会话文件夹写入失败'
  ) => {
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || fallbackNotice)
      return null
    }
    if (!isFileSessionFolderMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const applyFileSessionFolderDeleteResult = (
    result: Awaited<ReturnType<NonNullable<AiopsPreloadApi['deleteFileSessionFolder']>>> | undefined,
    uuid: string,
    fallbackNotice = '文件会话文件夹删除失败'
  ) => {
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || fallbackNotice)
      return null
    }
    if (!isFileSessionFolderDeleteData(result.data, uuid)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    return applyFileSessionCatalog(result.data)
  }

  const persistFileSession = async (session: FileSessionInfo) => {
    const saveFileSessionBridge = window.aiops?.saveFileSession
    if (typeof saveFileSessionBridge !== 'function') {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    try {
      return applyFileSessionRecordMutationResult(await saveFileSessionBridge({ ...session }))
    } catch {
      setTopNotice('文件会话写入失败')
      return null
    }
  }

  const updateFileSession = async (id: string, patch: FileSessionPatch) => {
    const session = fileSessions.value.find((item) => item.id === id)
    if (!session) return null
    const updateFileSessionBridge = window.aiops?.updateFileSession
    if (typeof updateFileSessionBridge !== 'function') {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    const previous = { ...session }
    Object.assign(session, patch)
    try {
      const result = await updateFileSessionBridge(id, patch)
      const applied = applyFileSessionRecordMutationResult(result)
      if (!applied) Object.assign(session, previous)
      return applied && result?.data && isFileSessionInfoData(result.data.session) ? result.data.session : null
    } catch {
      Object.assign(session, previous)
      setTopNotice('文件会话写入失败')
      return null
    }
  }

  const saveFileSessionFolder = async (folder: FileSessionFolderSaveInput) => {
    const normalized = {
      ...(folder.uuid ? { uuid: folder.uuid } : {}),
      name: folder.name.trim(),
      description: (folder.description || '').trim(),
      ...(folder.parentUuid ? { parentUuid: folder.parentUuid } : {}),
      ...(folder.scope ? { scope: folder.scope } : {})
    }
    if (!normalized.name) return null
    const saveFileSessionFolderBridge = window.aiops?.saveFileSessionFolder
    if (typeof saveFileSessionFolderBridge !== 'function') {
      setTopNotice('文件会话文件夹写入服务不可用')
      return null
    }
    try {
      const result = await saveFileSessionFolderBridge(normalized)
      const applied = applyFileSessionFolderMutationResult(result, '文件会话文件夹写入失败')
      return applied && result?.data ? result.data.folder : null
    } catch {
      setTopNotice('文件会话文件夹写入失败')
      return null
    }
  }

  const deleteFileSessionFolder = async (uuid: string) => {
    const deleteFileSessionFolderBridge = window.aiops?.deleteFileSessionFolder
    if (typeof deleteFileSessionFolderBridge !== 'function') {
      setTopNotice('文件会话文件夹删除服务不可用')
      return false
    }
    try {
      const result = await deleteFileSessionFolderBridge(uuid)
      return Boolean(applyFileSessionFolderDeleteResult(result, uuid, '文件会话文件夹删除失败'))
    } catch {
      setTopNotice('文件会话文件夹删除失败')
      return false
    }
  }

  const scheduleFileTransferTaskRemoval = (id: string, delay = 800) => {
    clearFileTransferTaskRemovalTimer(id)
    const timer = window.setTimeout(() => {
      fileTransferTasks.value = fileTransferTasks.value.filter((item) => item.id !== id)
      fileTransferTaskRemovalTimers.delete(id)
    }, delay)
    fileTransferTaskRemovalTimers.set(id, timer)
  }

  const startFileTransferTaskPolling = () => {
    if (fileTransferTaskPoller !== null) return
    fileTransferTaskPoller = window.setInterval(() => {
      void refreshFileTransferTasks()
    }, 250)
  }

  const stopFileTransferTaskPollingIfIdle = () => {
    if (fileTransferTaskObserverCount > 0 || hasRunningFileTransferTasks.value || fileTransferTaskPoller === null) return
    window.clearInterval(fileTransferTaskPoller)
    fileTransferTaskPoller = null
  }

  const observeFileTransferTasks = () => {
    fileTransferTaskObserverCount += 1
    startFileTransferTaskPolling()
    void refreshFileTransferTasks()
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      fileTransferTaskObserverCount = Math.max(0, fileTransferTaskObserverCount - 1)
      void refreshFileTransferTasks().finally(stopFileTransferTaskPollingIfIdle)
    }
  }

  const selectFileSession = (side: 'left' | 'right', id: string | null) => {
    if (side === 'left') {
      selectedLeftFileSessionId.value = id
      return
    }
    selectedRightFileSessionId.value = id
  }

  const openFileSession = (sessionId: string, side: 'left' | 'right' = selectedLeftFileSessionId.value ? 'right' : 'left') => {
    const session = fileSessions.value.find((item) => item.id === sessionId)
    if (!session) return
    selectFileSession(side, session.id)
  }

  const fileSideForTerminalPanel = () => {
    if (!selectedLeftFileSessionId.value) return 'left'
    if (!selectedRightFileSessionId.value) return 'right'
    return 'left'
  }

  const fileSessionPanelStatus = (status: TerminalPanel['status']): FileSessionTerminalContext['panelStatus'] => {
    if (status === 'error') return 'closed'
    if (status === 'connecting') return 'running'
    return status
  }

  const fileSessionTerminalContextForPanel = (panel: TerminalPanel): FileSessionTerminalContext => {
    const ssh = panel.sshSession
    const hasSshBackendConnection = Boolean(ssh?.connectionId)
    return {
      kind: ssh ? 'ssh' : 'local',
      panelId: panel.id,
      panelTitle: panel.title,
      panelStatus: fileSessionPanelStatus(panel.status),
      sessionId: ssh && !hasSshBackendConnection ? undefined : panel.sessionId,
      cwd: ssh && !hasSshBackendConnection ? undefined : panel.cwd,
      ...(ssh
        ? {
            ssh: {
              connectionId: ssh.connectionId,
              host: ssh.host,
              port: ssh.port,
              username: ssh.username,
              assetId: ssh.assetId,
              assetName: ssh.assetName,
              assetType: ssh.assetType,
              organizationId: ssh.organizationId,
              jumpHostId: ssh.jumpHostId,
              authType: ssh.authType,
              needProxy: ssh.needProxy,
              proxyName: ssh.proxyName,
              createdAt: ssh.createdAt,
              forkFromConnectionId: ssh.forkFromConnectionId
            }
          }
        : {})
    }
  }

  const ensureFileSessionForTerminalPanel = async (panelId = activePanelId.value, side: 'left' | 'right' = fileSideForTerminalPanel()) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    if (!panel || panel.kind === 'knowledge') return null
    const saveFileSessionFromTerminalContextBridge = window.aiops?.saveFileSessionFromTerminalContext
    if (typeof saveFileSessionFromTerminalContextBridge !== 'function') {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    let result
    try {
      result = await saveFileSessionFromTerminalContextBridge(fileSessionTerminalContextForPanel(panel))
    } catch {
      setTopNotice('文件会话创建失败')
      return null
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }

    if (!applyFileSessionCatalog(result.data)) return null
    const session = result.data.session
    setFilesUiMode('transfer')
    openFileSession(session.id, side)
    setActiveModule('files')
    return session
  }

  const closeFileSession = (side: 'left' | 'right') => {
    selectFileSession(side, null)
  }

  const addRemoteFileSession = async (assetId: string, side: 'left' | 'right' = 'left') => {
    const known = fileSessions.value.find((item) => item.id === assetId)
    if (known) {
      openFileSession(assetId, side)
      return known
    }
    const saveFileSessionFromTerminalContextBridge = window.aiops?.saveFileSessionFromTerminalContext
    if (typeof saveFileSessionFromTerminalContextBridge !== 'function') {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    let result
    try {
      result = await saveFileSessionFromTerminalContextBridge({
        kind: 'ssh',
        panelTitle: assetId,
        panelStatus: 'running',
        ssh: {
          assetId
        }
      })
    } catch {
      setTopNotice('文件会话创建失败')
      return null
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    if (!applyFileSessionCatalog(result.data)) return null
    const session = result.data.session
    openFileSession(session.id, side)
    return session
  }

  const addRemoteFileSessionFromSftpPayload = async (payload: Record<string, unknown>, side: 'left' | 'right' = 'left') => {
    const payloadId = String(payload.uuid || payload.id || payload.assetId || '').trim()
    const payloadHost = String(payload.host || payload.ip || '').trim()
    const known = fileSessions.value.find((item) => (payloadId && item.id === payloadId) || (payloadHost && item.host === payloadHost))
    if (known) {
      openFileSession(known.id, side)
      return known
    }
    const saveFileSessionFromSftpPayloadBridge = window.aiops?.saveFileSessionFromSftpPayload
    if (typeof saveFileSessionFromSftpPayloadBridge !== 'function') {
      setTopNotice('文件会话写入服务不可用')
      return null
    }
    let result
    try {
      result = await saveFileSessionFromSftpPayloadBridge({ ...payload })
    } catch {
      setTopNotice('文件会话创建失败')
      return null
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '文件会话创建失败')
      return null
    }
    if (!isFileSessionMutationData(result.data)) {
      setTopNotice(malformedFilesBackendResultMessage)
      return null
    }
    if (!applyFileSessionCatalog(result.data)) return null
    const session = result.data.session
    openFileSession(session.id, side)
    return session
  }

  const pushFileTransferTask = (task: FileTransferTask) => {
    if (!isFileTransferTaskData(task)) return null
    const normalized = normalizeFileTransferTask(task)
    if (!normalized) return null
    clearFileTransferTaskRemovalTimer(normalized.id)
    fileTransferTasks.value = fileTransferTasks.value.filter((item) => item.id !== normalized.id)
    fileTransferTasks.value.unshift(normalized)
    if (normalized.status === 'success' || normalized.status === 'failed' || normalized.status === 'error') {
      scheduleFileTransferTaskRemoval(normalized.id, normalized.status === 'success' ? 2500 : 8000)
    }
    return normalized
  }

  const affectedFileTransferTaskIds = (id: string) => {
    const taskIds = new Set<string>([id])
    fileTransferTasks.value.forEach((item) => {
      if (item.children?.some((child) => child.id === id)) {
        taskIds.add(item.id)
        item.children?.forEach((child) => taskIds.add(child.id))
      }
      if (item.id === id && item.children?.length) {
        item.children.forEach((child) => taskIds.add(child.id))
      }
    })
    return taskIds
  }

  const markFileTransferTasksCancelled = (ids: Iterable<string>) => {
    const taskIds = new Set(ids)
    const affected = fileTransferTasks.value.filter((item) => taskIds.has(item.id))
    affected.forEach((task) => {
      task.status = 'failed'
      task.speed = '已取消'
      task.progress = Math.min(task.progress, 99)
      task.children?.forEach((child) => {
        child.status = 'failed'
        child.speed = '已取消'
        child.progress = Math.min(child.progress, 99)
      })
      scheduleFileTransferTaskRemoval(task.id, 800)
    })
  }

  const cancelFileTransferTask = async (id: string) => {
    const cancelFileTransferTaskBridge = window.aiops?.cancelFileTransferTask
    if (typeof cancelFileTransferTaskBridge !== 'function') {
      setTopNotice('取消传输任务服务不可用')
      return false
    }
    let result
    try {
      result = await cancelFileTransferTaskBridge({ id })
    } catch {
      setTopNotice('取消传输任务失败')
      return false
    }
    if (!result?.ok || !result.data) {
      setTopNotice(result?.errorMessage || '取消传输任务失败')
      return false
    }
    if (!isFileTransferTaskCancelData(result.data) || result.data.id !== id) {
      setTopNotice(malformedFilesBackendResultMessage)
      return false
    }
    if (result.data.status !== 'aborted') {
      setTopNotice('传输任务已结束或不存在')
      return false
    }
    markFileTransferTasksCancelled(result.data.taskIds.length ? result.data.taskIds : affectedFileTransferTaskIds(id))
    void refreshFileTransferTasks().finally(stopFileTransferTaskPollingIfIdle)
    return true
  }

  const createSnippetGroup = async (groupName: string) => {
    const name = groupName.trim()
    if (!name) return null
    if (!window.aiops?.saveQuickCommandGroup) {
      setTopNotice('快捷命令分组写入服务不可用')
      return null
    }
    let result
    try {
      result = await window.aiops.saveQuickCommandGroup({ group_name: name })
    } catch {
      setTopNotice('快捷命令分组写入失败')
      return null
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令分组写入失败')
      return null
    }
    if (!isQuickCommandGroupSaveData(result.data, { groupName: name })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return null
    }
    applyQuickCommandsSnapshot(result.data)
    return result.data.group
  }

  const renameSnippetGroup = async (uuid: string, groupName: string) => {
    const name = groupName.trim()
    if (!name) return false
    if (!window.aiops?.saveQuickCommandGroup) {
      setTopNotice('快捷命令分组写入服务不可用')
      return false
    }
    let result
    try {
      result = await window.aiops.saveQuickCommandGroup({ uuid, group_name: name })
    } catch {
      setTopNotice('快捷命令分组写入失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令分组写入失败')
      return false
    }
    if (!isQuickCommandGroupSaveData(result.data, { uuid, groupName: name })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    return true
  }

  const deleteSnippetGroup = async (uuid: string) => {
    if (!window.aiops?.deleteQuickCommandGroup) {
      setTopNotice('快捷命令分组删除服务不可用')
      return false
    }
    let result
    try {
      result = await window.aiops.deleteQuickCommandGroup(uuid)
    } catch {
      setTopNotice('快捷命令分组删除失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令分组删除失败')
      return false
    }
    if (!isQuickCommandGroupDeleteData(result.data, uuid)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    if (selectedSnippetGroupUuid.value === uuid) selectedSnippetGroupUuid.value = null
    return true
  }

  const createQuickCommand = async (payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const snippetName = payload.snippet_name.trim()
    if (!snippetName || !payload.snippet_content) return null
    if (!window.aiops?.saveQuickCommandSnippet) {
      setTopNotice('快捷命令写入服务不可用')
      return null
    }
    const result = await window.aiops.saveQuickCommandSnippet({
      snippet_name: snippetName,
      snippet_content: payload.snippet_content,
      group_uuid: payload.group_uuid ?? null
    }).catch(() => null)
    if (!result) {
      setTopNotice('快捷命令写入失败')
      return null
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令写入失败')
      return null
    }
    if (!isQuickCommandSnippetSaveData(result.data, { snippetName, snippetContent: payload.snippet_content, groupUuid: payload.group_uuid ?? null })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return null
    }
    applyQuickCommandsSnapshot(result.data)
    setTopNotice('快捷命令已保存。')
    return result.data.snippet
  }

  const updateQuickCommand = async (id: number, payload: Pick<QuickCommandSnippet, 'snippet_name' | 'snippet_content'> & { group_uuid?: string | null }) => {
    const snippetName = payload.snippet_name.trim()
    if (!snippetName || !payload.snippet_content) return false
    if (!window.aiops?.saveQuickCommandSnippet) {
      setTopNotice('快捷命令写入服务不可用')
      return false
    }
    const result = await window.aiops
      .saveQuickCommandSnippet({
        id,
        snippet_name: snippetName,
        snippet_content: payload.snippet_content,
        group_uuid: payload.group_uuid ?? null
      })
      .catch(() => null)
    if (!result) {
      setTopNotice('快捷命令写入失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令写入失败')
      return false
    }
    if (!isQuickCommandSnippetSaveData(result.data, { id, snippetName, snippetContent: payload.snippet_content, groupUuid: payload.group_uuid ?? null })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    setTopNotice('快捷命令已保存。')
    return true
  }

  const deleteQuickCommand = async (id: number) => {
    if (!window.aiops?.deleteQuickCommandSnippet) {
      setTopNotice('快捷命令删除服务不可用')
      return false
    }
    const result = await window.aiops.deleteQuickCommandSnippet(id).catch(() => null)
    if (!result) {
      setTopNotice('快捷命令删除失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令删除失败')
      return false
    }
    if (!isQuickCommandSnippetDeleteData(result.data, id)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    return true
  }

  const reorderQuickCommand = async (sourceId: number, targetId: number) => {
    if (!window.aiops?.reorderQuickCommands) {
      setTopNotice('快捷命令排序服务不可用')
      return false
    }
    const currentList = [...filteredQuickCommands.value]
    const sourceIndex = currentList.findIndex((command) => command.id === sourceId)
    const targetIndex = currentList.findIndex((command) => command.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false
    const [moved] = currentList.splice(sourceIndex, 1)
    currentList.splice(targetIndex, 0, moved)
    const groupUuid = selectedSnippetGroupUuid.value || null
    const orderedIds = currentList.map((command) => command.id)
    const result = await window.aiops.reorderQuickCommands({ orderedIds, groupUuid }).catch(() => null)
    if (!result) {
      setTopNotice('快捷命令排序失败')
      return false
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '快捷命令排序失败')
      return false
    }
    if (!isQuickCommandReorderData(result.data, orderedIds, groupUuid)) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return false
    }
    applyQuickCommandsSnapshot(result.data)
    return true
  }

  const resolveQuickCommandPanelIds = (allTabs: boolean) => {
    const terminalPanels = panels.value.filter((panel) => panel.kind !== 'knowledge')
    if (allTabs) {
      const writablePanelIds = terminalPanels.filter((panel) => panel.sessionId).map((panel) => panel.id)
      return writablePanelIds.length ? writablePanelIds : terminalPanels.map((panel) => panel.id)
    }
    const targetPanel = activePanel.value.kind === 'knowledge' ? terminalPanels[0] || activePanel.value : activePanel.value
    return [targetPanel.id]
  }

  const reportQuickCommandPlanUnavailable = (command: string, panelIds: string[], reason = '快捷命令执行计划服务不可用') => {
    setTopNotice(reason)
    terminalSecurityPrompt.value = null
    return { status: 'unavailable', command, panelIds, reason } as TerminalSecurityDecision
  }

  const resolveQuickCommandScriptPlan = async (command: QuickCommandSnippet, autoExecute: boolean): Promise<QuickCommandScriptPlanResolution> => {
    const planQuickCommandScriptBridge = window.aiops?.planQuickCommandScript
    if (typeof planQuickCommandScriptBridge !== 'function') return { ok: false, reason: '快捷命令执行计划服务不可用' }
    try {
      const result = await planQuickCommandScriptBridge({ snippetId: command.id, autoExecute })
      if (!result) return { ok: false, reason: '快捷命令执行计划生成失败' }
      if (!result.ok) return { ok: false, reason: result.errorMessage || '快捷命令执行计划生成失败' }
      if (!isQuickCommandScriptPlanForRequest(result.data, { snippetId: command.id, snippetName: command.snippet_name, autoExecute })) {
        return { ok: false, reason: malformedQuickCommandsBackendResultMessage }
      }
      return { ok: true, plan: result.data }
    } catch {
      return { ok: false, reason: '快捷命令执行计划生成失败' }
    }
  }

  const runQuickCommand = async (id: number, autoExecute = true, allTabs = false) => {
    const command = quickCommands.value.find((item) => item.id === id)
    if (!command) return
    const targetPanelIds = resolveQuickCommandPanelIds(allTabs)
    const planResolution = await resolveQuickCommandScriptPlan(command, autoExecute)
    if (!planResolution.ok) {
      return reportQuickCommandPlanUnavailable(command.snippet_name, targetPanelIds, planResolution.reason)
    }
    const plan = planResolution.plan
    if (!plan.segments.length) {
      return reportQuickCommandPlanUnavailable(command.snippet_name, targetPanelIds, '快捷命令内容为空')
    }
    const decision = prepareTerminalSecurityExecution({
      command: plan.securityCommand || command.snippet_name,
      securityCommands: plan.commands,
      panelIds: targetPanelIds,
      inputText: plan.shellText,
      shellText: plan.shellText,
      writeToShell: true,
      source: 'snippet',
      snippetSegments: plan.segments
    })
    if (decision.status !== 'allow' || !decision.execution?.writeToShell) return decision
    return writeTerminalExecution(decision.execution)
  }

  const clearMacroAutoStopTimer = () => {
    if (macroAutoStopTimer !== null) {
      clearTimeout(macroAutoStopTimer)
      macroAutoStopTimer = null
    }
  }

  const commitMacroCurrentLine = (timestamp = Date.now()) => {
    if (!macroCurrentLineBuffer.value.length) return true
    const added = addMacroCommandEntry(macroCurrentLineBuffer.value, timestamp)
    macroCurrentLineBuffer.value = ''
    return added
  }

  function addMacroCommandEntry(command: string, timestamp = Date.now()) {
    if (!isMacroRecording.value) return false
    if (macroCommandBuffer.value.length >= MACRO_MAX_COMMAND_COUNT) {
      void autoStopMacroRecording('count')
      return false
    }
    macroCommandBuffer.value.push({ command, timestamp })
    if (macroCommandBuffer.value.length >= MACRO_MAX_COMMAND_COUNT) {
      void autoStopMacroRecording('count')
    }
    return true
  }

  const saveMacroSnippet = async (
    entries: MacroCommandEntry[],
    snippetName = macroDefaultName.value || createMacroSnippetName(),
    groupUuid = macroTargetGroupUuid.value,
    sleepThresholdMs = macroSleepThresholdMs.value
  ) => {
    if (!entries.length) return null
    if (!window.aiops?.saveQuickCommandMacro) {
      setTopNotice('宏录制保存服务不可用')
      return null
    }
    let result
    try {
      result = await window.aiops.saveQuickCommandMacro({
        snippet_name: snippetName,
        group_uuid: groupUuid,
        entries: entries.map((entry) => ({ command: entry.command, timestamp: entry.timestamp })),
        sleepThresholdMs
      })
    } catch {
      setTopNotice('宏录制保存失败')
      return null
    }
    if (!result.ok || !result.data) {
      setTopNotice(result.errorMessage || '宏录制保存失败')
      return null
    }
    if (!isQuickCommandMacroSaveData(result.data, { snippetName, groupUuid })) {
      setTopNotice(malformedQuickCommandsBackendResultMessage)
      return null
    }
    applyQuickCommandsSnapshot(result.data)
    setTopNotice('宏录制已保存为快捷命令。')
    return result.data.snippet
  }

  const resetMacroRecordingState = () => {
    clearMacroAutoStopTimer()
    isMacroRecording.value = false
    macroTerminalId.value = null
    macroCommandBuffer.value = []
    macroCurrentLineBuffer.value = ''
    macroRecordingStartTime.value = null
    macroDefaultName.value = ''
    macroTargetGroupUuid.value = null
  }

  async function autoStopMacroRecording(reason: 'time' | 'count') {
    if (!isMacroRecording.value) return null
    macroLimitReason.value = reason
    commitMacroCurrentLine()
    const entries = macroCommandBuffer.value.map((entry) => ({ ...entry }))
    const snippetName = macroDefaultName.value || createMacroSnippetName()
    const groupUuid = macroTargetGroupUuid.value
    const sleepThresholdMs = macroSleepThresholdMs.value
    resetMacroRecordingState()
    const saved = await saveMacroSnippet(entries, snippetName, groupUuid, sleepThresholdMs)
    if (saved) setTopNotice(reason === 'count' ? '宏录制达到命令上限，已保存为快捷命令。' : '宏录制达到时间上限，已保存为快捷命令。')
    return saved
  }

  const startMacroRecording = (terminalId?: string | null) => {
    if (isMacroRecording.value) return
    isMacroRecording.value = true
    macroTerminalId.value = terminalId || (activePanel.value.kind === 'knowledge' ? panels.value.find((panel) => panel.kind !== 'knowledge')?.id || null : activePanel.value.id)
    macroCommandBuffer.value = []
    macroCurrentLineBuffer.value = ''
    macroRecordingStartTime.value = Date.now()
    macroDefaultName.value = createMacroSnippetName()
    macroTargetGroupUuid.value = selectedSnippetGroupUuid.value
    macroLimitReason.value = null
    clearMacroAutoStopTimer()
    macroAutoStopTimer = setTimeout(() => {
      void autoStopMacroRecording('time')
    }, MACRO_MAX_RECORDING_DURATION_MS)
  }

  const recordMacroCommand = (command: string, timestamp = Date.now()) => {
    const text = command.trim()
    if (!text) return
    addMacroCommandEntry(text, timestamp)
  }

  const setMacroRecordControlKeys = (enabled: boolean) => {
    macroRecordControlKeys.value = enabled
  }

  const setMacroSleepThreshold = (milliseconds: number) => {
    macroSleepThresholdMs.value = Math.max(0, Math.round(milliseconds))
  }

  const recordMacroTerminalInput = (panelId: string, data: string, timestamp = Date.now()) => {
    if (!isMacroRecording.value || !data) return
    if (macroTerminalId.value && panelId !== macroTerminalId.value) return
    if (macroRecordingStartTime.value && timestamp - macroRecordingStartTime.value >= MACRO_MAX_RECORDING_DURATION_MS) {
      void autoStopMacroRecording('time')
      return
    }

    let cursor = 0
    while (cursor < data.length) {
      if (!isMacroRecording.value) return
      const remaining = data.slice(cursor)
      const keyMatch = keySequences.find(([, sequence]) => remaining.startsWith(sequence))
      if (keyMatch) {
        const [key, sequence] = keyMatch
        if (key === 'return') {
          commitMacroCurrentLine(timestamp)
        } else if (key === 'backspace') {
          macroCurrentLineBuffer.value = macroCurrentLineBuffer.value.slice(0, -1)
        } else if (macroRecordControlKeys.value) {
          commitMacroCurrentLine(timestamp)
          addMacroCommandEntry(key, timestamp)
        }
        cursor += sequence.length
        continue
      }

      const ctrlMatch = ctrlSequences.find(([, sequence]) => remaining.startsWith(sequence))
      if (ctrlMatch) {
        const [ctrl, sequence] = ctrlMatch
        if (macroRecordControlKeys.value) {
          commitMacroCurrentLine(timestamp)
          addMacroCommandEntry(ctrl, timestamp)
        }
        if (ctrl === 'ctrl+c') {
          macroCurrentLineBuffer.value = ''
        }
        cursor += sequence.length
        continue
      }

      const char = data[cursor]
      if (char === '\n' || char === '\r') {
        commitMacroCurrentLine(timestamp)
      } else if (char === '\b' || char === '\x7f') {
        macroCurrentLineBuffer.value = macroCurrentLineBuffer.value.slice(0, -1)
      } else if (char === '\t') {
        if (macroRecordControlKeys.value) {
          commitMacroCurrentLine(timestamp)
          addMacroCommandEntry('tab', timestamp)
        }
      } else if (char.charCodeAt(0) >= 32) {
        macroCurrentLineBuffer.value += char
      }
      cursor += 1
    }
  }

  const stopMacroRecording = async () => {
    if (!isMacroRecording.value) return
    commitMacroCurrentLine()
    const entries = macroCommandBuffer.value.map((entry) => ({ ...entry }))
    const snippetName = macroDefaultName.value || createMacroSnippetName()
    const groupUuid = macroTargetGroupUuid.value
    const sleepThresholdMs = macroSleepThresholdMs.value
    if (!entries.length) {
      resetMacroRecordingState()
      setTopNotice('没有录制到命令。')
      return null
    }
    const saved = await saveMacroSnippet(entries, snippetName, groupUuid, sleepThresholdMs)
    if (saved) resetMacroRecordingState()
    return saved
  }

  const cancelMacroRecording = () => {
    if (!isMacroRecording.value) return
    resetMacroRecordingState()
  }

  const findKnowledgeNode = (relPath: string, nodes = knowledgeTree.value): KnowledgeNode | null => {
    for (const node of nodes) {
      if (node.relPath === relPath) return node
      if (node.children) {
        const hit = findKnowledgeNode(relPath, node.children)
        if (hit) return hit
      }
    }
    return null
  }

  const selectKnowledgeNode = (relPath: string, multi = false) => {
    if (!multi) {
      kbSelectedKeys.value = [relPath]
      return
    }
    kbSelectedKeys.value = kbSelectedKeys.value.includes(relPath)
      ? kbSelectedKeys.value.filter((item) => item !== relPath)
      : [...kbSelectedKeys.value, relPath]
  }

  const refreshKnowledgeSearchStatus = async () => {
    if (!window.aiops?.kbSearchStatus) return false
    try {
      const status = await window.aiops.kbSearchStatus()
      if (!isKnowledgeSearchStatusData(status)) {
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return false
      }
      kbSearchStatus.value = status
      return true
    } catch {
      return false
    }
  }

  const searchKnowledgeContent = async (query = kbSearchQuery.value) => {
    const normalizedQuery = query.trim()
    const request = ++kbSearchRequest
    if (normalizedQuery.length <= 1) {
      kbContentSearchResults.value = []
      kbSearchLoading.value = false
      kbSearchError.value = ''
      return []
    }
    if (!window.aiops?.kbSearch) {
      kbSearchLoading.value = false
      kbSearchError.value = '知识库搜索服务不可用'
      return kbContentSearchResults.value
    }
    kbSearchLoading.value = true
    kbSearchError.value = ''
    try {
      const results = await window.aiops.kbSearch(normalizedQuery, { maxResults: 12, minScore: 0.15 })
      if (request !== kbSearchRequest) return kbContentSearchResults.value
      if (!isKnowledgeSearchResultListData(results)) {
        kbSearchError.value = malformedKnowledgeBackendResultMessage
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return kbContentSearchResults.value
      }
      kbContentSearchResults.value = results
      await refreshKnowledgeSearchStatus()
      return results
    } catch (searchError) {
      if (request !== kbSearchRequest) return kbContentSearchResults.value
      kbSearchError.value = searchError instanceof Error ? searchError.message : String(searchError)
      return kbContentSearchResults.value
    } finally {
      if (request === kbSearchRequest) kbSearchLoading.value = false
    }
  }

  const knowledgeSearchResultToAiContext = (result: KnowledgeBaseSearchResult): AiContextOption | null => {
    const relPath = result.path.trim()
    if (!relPath) return null
    const label = relPath.split('/').filter(Boolean).pop() || relPath
    return {
      id: `kb-doc:${relPath}`,
      kind: 'docs',
      label,
      relPath,
      detail: `Auto search match lines ${result.startLine}-${result.endLine}, score ${result.score.toFixed(2)}: ${result.snippet.trim()}`
    }
  }

  const resolveAiKnowledgeSearchContexts = async (query: string, existingContexts: AiContextOption[]) => {
    const normalizedQuery = query.trim()
    if (!aiPreferences.value.kbSearchEnabled || normalizedQuery.length <= 1 || typeof window.aiops?.kbSearch !== 'function') return []
    try {
      const results = await window.aiops.kbSearch(normalizedQuery, { maxResults: 3, minScore: 0.25 })
      if (!isKnowledgeSearchResultListData(results)) return []
      const existingIds = new Set(existingContexts.map((context) => context.id))
      return results
        .map(knowledgeSearchResultToAiContext)
        .filter((context): context is AiContextOption => Boolean(context && !existingIds.has(context.id)))
    } catch {
      return []
    }
  }

  const reindexKnowledgeContent = async () => {
    if (!window.aiops?.kbReindex) {
      setTopNotice('知识库索引服务不可用')
      return null
    }
    try {
      const result = await window.aiops.kbReindex()
      if (!isKnowledgeReindexResultData(result)) {
        setTopNotice(malformedKnowledgeBackendResultMessage)
        return null
      }
      await refreshKnowledgeSearchStatus()
      if (kbSearchQuery.value.trim().length > 1) void searchKnowledgeContent()
      return result
    } catch (indexError) {
      const message = indexError instanceof Error ? indexError.message : String(indexError)
      setTopNotice(message ? `知识库索引服务不可用：${message}` : '知识库索引服务不可用')
      return null
    }
  }

  const backendRelPathOrNotice = (result: unknown, notice: string) => {
    if (!isKnowledgeRelPathResultData(result)) {
      setTopNotice(notice)
      return ''
    }
    return result.relPath.trim()
  }

  const backendKnowledgeEntryOrNotice = (result: unknown, notice: string) => {
    if (!isKnowledgeMutationEntryData(result)) {
      setTopNotice(notice)
      return null
    }
    return result
  }

  const knowledgeRelPathParentMatches = (relPath: string, expectedParentRelDir: string) => getKbParent(relPath.trim()) === expectedParentRelDir.trim().replace(/^\/+|\/+$/g, '')

  const pruneMissingKnowledgeUiState = (candidateRelPaths: string[]) => {
    const missingRelPaths = [...new Set(candidateRelPaths.filter(Boolean))].filter((relPath) => !findKnowledgeNode(relPath))
    if (!missingRelPaths.length) return
    kbSelectedKeys.value = kbSelectedKeys.value.filter((key) => !missingRelPaths.some((relPath) => knowledgePathContains(relPath, key)))
    kbExpandedKeys.value = kbExpandedKeys.value.filter((key) => !missingRelPaths.some((relPath) => knowledgePathContains(relPath, key)))
    closeKnowledgePanelsForRemoved(missingRelPaths)
  }

  const refreshKnowledgeTreeAfterMutationFailure = async (notice: string, candidateRemovedRelPaths: string[] = []) => {
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return false
    pruneMissingKnowledgeUiState(candidateRemovedRelPaths)
    setTopNotice(notice)
    return true
  }

  const createKnowledgeNode = async (kind: KnowledgeNodeType, parentRelDir: string, title: string) => {
    const name = title.trim()
    if (!name) return null
    if (!window.aiops?.kbCreateFile || !window.aiops?.kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result =
      kind === 'dir'
        ? await window.aiops.kbMkdir(parentRelDir, name)
        : await window.aiops.kbCreateFile(parentRelDir, name, '')
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const relPath = entry.relPath.trim()
    const pathMatchesRequest =
      kind === 'dir'
        ? relPath === expectedKnowledgeRelPath(parentRelDir, name)
        : isKnowledgeRelPathInParentWithRequestedName(relPath, parentRelDir, name)
    if (!pathMatchesRequest) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    if (entry.type !== kind) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return null
    const created = findKnowledgeNode(relPath)
    if (!created || created.type !== kind) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    kbSelectedKeys.value = [relPath]
    if (kind === 'dir' && !kbExpandedKeys.value.includes(relPath)) {
      kbExpandedKeys.value.push(relPath)
    }
    if (kind === 'file') {
      openKnowledgeFile(relPath)
    }
    return created
  }

  const renameKnowledgeNode = async (relPath: string, title: string) => {
    const node = findKnowledgeNode(relPath)
    const name = title.trim()
    if (!node || !name) return
    if (!window.aiops?.kbRename) {
      setTopNotice('知识库重命名服务不可用')
      return
    }
    const result = await window.aiops.kbRename(relPath, name)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return
    const nextRelPath = entry.relPath.trim()
    if (nextRelPath !== expectedKnowledgeRelPath(getKbParent(relPath), name)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    if (entry.type !== node.type) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return
    if (!findKnowledgeNode(nextRelPath)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    kbSelectedKeys.value = [nextRelPath]
    kbExpandedKeys.value = kbExpandedKeys.value.map((key) => (key === relPath || key.startsWith(`${relPath}/`) ? key.replace(relPath, nextRelPath) : key))
    syncKnowledgePanelsAfterRename(relPath, nextRelPath)
  }

  const deleteKnowledgeNodes = async (relPaths: string[]) => {
    if (!window.aiops?.kbDelete) {
      setTopNotice('知识库删除服务不可用')
      return
    }
    const candidateRemovedRelPaths: string[] = []
    for (const relPath of relPaths) {
      const node = findKnowledgeNode(relPath)
      if (!node) continue
      let result: unknown
      try {
        result = await window.aiops.kbDelete(relPath, node.type === 'dir')
      } catch {
        await refreshKnowledgeTreeAfterMutationFailure('知识库删除服务不可用', [...candidateRemovedRelPaths, relPath])
        return
      }
      if (!isKnowledgeDeleteResultData(result)) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, [...candidateRemovedRelPaths, relPath])
        return
      }
      if (result.relPath.trim() !== relPath || result.type !== node.type || result.deleted !== true) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, [...candidateRemovedRelPaths, relPath])
        return
      }
      candidateRemovedRelPaths.push(relPath)
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return
    if (relPaths.some((relPath) => findKnowledgeNode(relPath))) {
      pruneMissingKnowledgeUiState(relPaths)
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    pruneMissingKnowledgeUiState(relPaths)
  }

  const copyKnowledgeNodes = (relPaths: string[], mode: 'copy' | 'cut') => {
    if (!relPaths.length) return
    kbClipboard.value = { mode, sources: relPaths }
  }

  const pasteKnowledgeNodes = async (targetRelDir: string) => {
    if (!kbClipboard.value) return
    const destination = findKnowledgeNode(targetRelDir)
    const dstRelDir = destination?.type === 'file' ? getKbParent(destination.relPath) : targetRelDir
    if (!window.aiops?.kbCopy || !window.aiops?.kbMove) {
      setTopNotice('知识库复制移动服务不可用')
      return
    }
    const sources = [...kbClipboard.value.sources]
    const mode = kbClipboard.value.mode
    const resultRelPaths: string[] = []
    const candidateRemovedSources: string[] = []
    for (const source of sources) {
      const sourceNode = findKnowledgeNode(source)
      if (!sourceNode) continue
      let result: unknown
      try {
        if (mode === 'copy') {
          result = await window.aiops.kbCopy(source, dstRelDir)
        } else {
          result = await window.aiops.kbMove(source, dstRelDir)
        }
      } catch {
        await refreshKnowledgeTreeAfterMutationFailure('知识库复制移动服务不可用', mode === 'cut' ? [...candidateRemovedSources, source] : [])
        return
      }
      const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
      if (!entry) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, mode === 'cut' ? [...candidateRemovedSources, source] : [])
        return
      }
      const resultRelPath = entry.relPath.trim()
      if (!knowledgeRelPathParentMatches(resultRelPath, dstRelDir) || entry.type !== sourceNode.type) {
        await refreshKnowledgeTreeAfterMutationFailure(malformedKnowledgeBackendResultMessage, mode === 'cut' ? [...candidateRemovedSources, source] : [])
        return
      }
      resultRelPaths.push(resultRelPath)
      if (mode === 'cut') candidateRemovedSources.push(source)
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return
    if (resultRelPaths.some((relPath) => !findKnowledgeNode(relPath))) {
      if (mode === 'cut') pruneMissingKnowledgeUiState(sources)
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    if (mode === 'cut' && sources.some((source) => findKnowledgeNode(source))) {
      pruneMissingKnowledgeUiState(sources)
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return
    }
    if (mode === 'cut') kbClipboard.value = null
    if (mode === 'cut') pruneMissingKnowledgeUiState(sources)
  }

  const addKnowledgeImportJob = async (destRelPath: string, srcAbsPath?: string, sourceType: 'file' | 'folder' = 'file') => {
    if (!srcAbsPath) {
      setTopNotice('知识库导入需要真实本地路径')
      return false
    }
    if (!window.aiops?.kbImportFile || !window.aiops?.kbImportFolder) {
      setTopNotice('知识库导入服务不可用')
      return false
    }
    const dstRelDir = getKbParent(destRelPath)
    const result = sourceType === 'folder' ? await window.aiops.kbImportFolder(srcAbsPath, dstRelDir) : await window.aiops.kbImportFile(srcAbsPath, dstRelDir)
    if (!isKnowledgeImportResultForRequest(result, dstRelDir, sourceType)) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return false
    }
    if (!kbImportJobs.value.some((job) => job.id === result.jobId)) {
      kbImportJobs.value.push({ id: result.jobId, destRelPath: result.relPath, percent: 100 })
      window.setTimeout(() => {
        kbImportJobs.value = kbImportJobs.value.filter((job) => job.id !== result.jobId)
      }, 500)
    }
    const refreshed = await refreshKnowledgeTree()
    if (!refreshed) return false
    const imported = findKnowledgeNode(result.relPath)
    if (!imported || imported.type !== sourceType) {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return false
    }
    return true
  }

  const addKnowledgeFilesToChat = async (relPaths: string[]) => {
    const filePaths = relPaths.filter((relPath) => findKnowledgeNode(relPath)?.type === 'file')
    for (const relPath of filePaths) {
      const node = findKnowledgeNode(relPath)
      const label = node?.title || relPath.split('/').pop() || relPath
      if (isKnowledgeImagePath(relPath)) {
        let imageContext: AiContextOption = {
          id: `kb-image:${relPath}`,
          kind: 'images',
          label,
          detail: relPath,
          relPath,
          mediaType: mediaTypeFromKnowledgePath(relPath)
        }
        if (window.aiops?.kbReadFile) {
          try {
            const result = await window.aiops.kbReadFile(relPath, 'base64')
            if (isKnowledgeReadResultData(result, 'base64')) {
              imageContext = {
                ...imageContext,
                mediaType: result.mimeType || imageContext.mediaType,
                data: result.content
              }
            } else {
              setTopNotice(malformedKnowledgeBackendResultMessage)
              continue
            }
          } catch {
            setTopNotice('知识库文件读取失败')
            continue
          }
        }
        selectedContexts.value = selectedContexts.value.some((context) => context.id === imageContext.id)
          ? selectedContexts.value
          : [...selectedContexts.value, imageContext]
      } else {
        const docContext: AiContextOption = {
          id: `kb-doc:${relPath}`,
          kind: 'docs',
          label,
          detail: relPath,
          relPath
        }
        selectedContexts.value = selectedContexts.value.some((context) => context.id === docContext.id)
          ? selectedContexts.value
          : [...selectedContexts.value, docContext]
      }
    }
    rightPanelOpen.value = true
  }

  const selectExtension = (pluginId: string) => {
    if (!visibleExtensionPlugins.value.some((plugin) => plugin.pluginId === pluginId)) return
    selectedExtensionId.value = pluginId
    extensionDetailTab.value = 'details'
  }

  const setExtensionNotice = (text: string) => {
    extensionNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (extensionNotice.value === text) extensionNotice.value = ''
    }, 2400)
  }

  const setExtensionDragActive = (active: boolean) => {
    extensionDragActive.value = active
  }

  const setExtensionInstallLoading = (pluginId: string, loading: boolean) => {
    const next = { ...extensionInstallLoadingMap.value }
    if (loading) next[pluginId] = true
    else delete next[pluginId]
    extensionInstallLoadingMap.value = next
  }

  const setExtensionUpdateLoading = (pluginId: string, loading: boolean) => {
    const next = { ...extensionUpdateLoadingMap.value }
    if (loading) next[pluginId] = true
    else delete next[pluginId]
    extensionUpdateLoadingMap.value = next
  }

  const setExtensionInstallProgress = (pluginId: string, stage: ExtensionInstallStage, percent = 0) => {
    const next = { ...extensionInstallProgressMap.value }
    if (!stage || ['done', 'error', 'cancelled'].includes(stage)) {
      if (stage) next[pluginId] = { pluginId, stage, percent: Math.max(0, Math.min(100, Math.round(percent))) }
      else delete next[pluginId]
    } else {
      next[pluginId] = {
        pluginId,
        stage,
        percent: Math.max(0, Math.min(100, Math.round(percent)))
      }
    }
    extensionInstallProgressMap.value = next
  }

  const setExtensionActiveOperation = (pluginId: string, operation: ExtensionPluginOperation | null) => {
    if (!pluginId) return
    const next = { ...extensionActiveOperations.value }
    if (operation) next[pluginId] = operation
    else delete next[pluginId]
    extensionActiveOperations.value = next
  }

  const clearExtensionActiveOperation = (pluginId: string) => {
    setExtensionActiveOperation(pluginId, null)
  }

  const extensionHasActiveOperation = (pluginId: string) =>
    Boolean(extensionInstallLoadingMap.value[pluginId] || extensionUpdateLoadingMap.value[pluginId] || extensionActiveOperations.value[pluginId])

  const isExpectedExtensionProgress = (event: BackendExtensionInstallProgress) => {
    if (event.operation === 'package') {
      const expectedRequestId = extensionPendingPackageRequestId.value
      if (expectedRequestId) {
        if (event.requestId !== expectedRequestId) return false
        setExtensionActiveOperation(event.pluginId, 'package')
        return true
      }
    }
    const expectedOperation = extensionActiveOperations.value[event.pluginId]
    if (expectedOperation) return expectedOperation === event.operation
    if (!extensionInstallLoadingMap.value[event.pluginId] && !extensionUpdateLoadingMap.value[event.pluginId]) return false
    return event.operation === 'update' ? Boolean(extensionUpdateLoadingMap.value[event.pluginId]) : Boolean(extensionInstallLoadingMap.value[event.pluginId])
  }

  const handleExtensionInstallProgress = (event: BackendExtensionInstallProgress) => {
    if (!isExtensionInstallProgressData(event)) {
      setExtensionNotice(malformedExtensionBackendResultMessage)
      return
    }
    if (!isExpectedExtensionProgress(event)) {
      setExtensionNotice(malformedExtensionBackendResultMessage)
      return
    }
    if (event.operation === 'update') {
      setExtensionUpdateLoading(event.pluginId, !['done', 'error', 'cancelled'].includes(event.stage))
    } else {
      setExtensionInstallLoading(event.pluginId, !['done', 'error', 'cancelled'].includes(event.stage))
    }
    setExtensionInstallProgress(event.pluginId, event.stage, event.percent)
    if (['done', 'error', 'cancelled'].includes(event.stage)) clearExtensionActiveOperation(event.pluginId)
  }

  const installExtensionInstallProgressListener = () => {
    if (removeExtensionInstallProgressListener || !window.aiops?.onExtensionInstallProgress) return
    removeExtensionInstallProgressListener = window.aiops.onExtensionInstallProgress(handleExtensionInstallProgress)
  }

  const clearExtensionInstallProgressLater = (pluginId: string) => {
    window.setTimeout(() => {
      const current = extensionInstallProgressMap.value[pluginId]
      if (!current || !['done', 'error', 'cancelled'].includes(current.stage)) return
      const next = { ...extensionInstallProgressMap.value }
      delete next[pluginId]
      extensionInstallProgressMap.value = next
    }, 900)
  }

  const cloneExtensionPluginForBackend = (plugin: ExtensionPlugin): ExtensionPluginRuntimeConfig => ({
    ...plugin,
    categories: plugin.categories ? [...plugin.categories] : undefined,
    functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
    guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
    connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined,
    packageUrl: plugin.packageUrl || undefined,
    packageSha256: plugin.packageSha256 || undefined
  })

  const applyExtensionPluginFromBackend = (plugin: ExtensionPluginRuntimeConfig) => {
    const nextPlugin: ExtensionPlugin = {
      ...plugin,
      iconKey: plugin.iconKey || 'local',
      categories: plugin.categories ? [...plugin.categories] : undefined,
      functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
      guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
      connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined,
      packageUrl: plugin.packageUrl || undefined,
      packageSha256: plugin.packageSha256 || undefined
    }
    const index = extensionPlugins.value.findIndex((item) => item.pluginId === nextPlugin.pluginId)
    if (nextPlugin.show === false && nextPlugin.source === 'local') {
      if (index >= 0) extensionPlugins.value = extensionPlugins.value.filter((item) => item.pluginId !== nextPlugin.pluginId)
      ensureSelectedExtensionVisible()
      return
    }
    if (index >= 0) {
      extensionPlugins.value[index] = { ...extensionPlugins.value[index], ...nextPlugin }
    } else {
      extensionPlugins.value.push(nextPlugin)
    }
  }

  const refreshExtensionPlugins = async () => {
    const listExtensionPluginsBridge = window.aiops?.listExtensionPlugins
    if (typeof listExtensionPluginsBridge !== 'function') {
      setExtensionNotice('插件列表加载服务不可用')
      ensureSelectedExtensionVisible()
      return false
    }
    if (extensionPluginsRefreshPromise) return extensionPluginsRefreshPromise
    extensionPluginsRefreshPromise = (async () => {
    try {
      const result = await listExtensionPluginsBridge()
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || '插件列表加载失败')
        return false
      }
      if (!isExtensionPluginListData(result.data)) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return false
      }
      extensionPlugins.value = result.data.map((plugin) => ({
        ...plugin,
        iconKey: plugin.iconKey || 'local',
        categories: plugin.categories ? [...plugin.categories] : undefined,
        functions: plugin.functions ? plugin.functions.map((item) => ({ ...item })) : undefined,
        guideSteps: plugin.guideSteps ? [...plugin.guideSteps] : undefined,
        connectionLog: plugin.connectionLog ? plugin.connectionLog.map((item) => ({ ...item })) : undefined,
        packageUrl: plugin.packageUrl || undefined,
        packageSha256: plugin.packageSha256 || undefined
      }))
      ensureSelectedExtensionVisible()
      return true
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : '插件列表加载失败')
      ensureSelectedExtensionVisible()
      return false
    }
    })().finally(() => {
      extensionPluginsRefreshPromise = null
    })
    return extensionPluginsRefreshPromise
  }

  const installExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    if (plugin.installable === false) {
      setExtensionNotice('该插件需要订阅后安装')
      return
    }
    const installExtensionPluginBridge = window.aiops?.installExtensionPlugin
    if (typeof installExtensionPluginBridge !== 'function') {
      setExtensionNotice(`${plugin.name} 安装服务不可用`)
      return
    }
    installExtensionInstallProgressListener()
    setExtensionActiveOperation(pluginId, 'install')
    setExtensionInstallLoading(pluginId, true)
    setExtensionNotice(`正在安装 ${plugin.name}`)
    try {
      const result = await installExtensionPluginBridge({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok) {
        const cancelled = result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED'
        setExtensionInstallProgress(pluginId, cancelled ? 'cancelled' : 'error', 0)
        setExtensionNotice(cancelled ? `${plugin.name} 安装已取消` : result?.errorMessage || `${plugin.name} 安装失败`)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      if (!isExtensionPluginOperationData(result.data, 'install') || result.data.plugin.pluginId !== pluginId) {
        setExtensionInstallProgress(pluginId, 'error', 0)
        setExtensionNotice(malformedExtensionBackendResultMessage)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionInstallProgress(pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 安装成功`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionInstallProgress(pluginId, 'error', 0)
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 安装失败`)
      clearExtensionInstallProgressLater(pluginId)
    } finally {
      setExtensionInstallLoading(pluginId, false)
      clearExtensionActiveOperation(pluginId)
    }
  }

  const updateExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || !plugin.installed || !plugin.hasUpdate) return
    const updateExtensionPluginBridge = window.aiops?.updateExtensionPlugin
    if (typeof updateExtensionPluginBridge !== 'function') {
      setExtensionNotice(`${plugin.name} 更新服务不可用`)
      return
    }
    installExtensionInstallProgressListener()
    setExtensionActiveOperation(pluginId, 'update')
    setExtensionUpdateLoading(pluginId, true)
    setExtensionNotice(`正在更新 ${plugin.name}`)
    try {
      const result = await updateExtensionPluginBridge({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok) {
        const cancelled = result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED'
        setExtensionInstallProgress(pluginId, cancelled ? 'cancelled' : 'error', 0)
        setExtensionNotice(cancelled ? `${plugin.name} 安装已取消` : result?.errorMessage || `${plugin.name} 更新失败`)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      if (!isExtensionPluginOperationData(result.data, 'update') || result.data.plugin.pluginId !== pluginId) {
        setExtensionInstallProgress(pluginId, 'error', 0)
        setExtensionNotice(malformedExtensionBackendResultMessage)
        clearExtensionInstallProgressLater(pluginId)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionInstallProgress(pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 已更新`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionInstallProgress(pluginId, 'error', 0)
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 更新失败`)
      clearExtensionInstallProgressLater(pluginId)
    } finally {
      setExtensionUpdateLoading(pluginId, false)
      clearExtensionActiveOperation(pluginId)
    }
  }

  const uninstallExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin || plugin.required) return
    const uninstallExtensionPluginBridge = window.aiops?.uninstallExtensionPlugin
    if (typeof uninstallExtensionPluginBridge !== 'function') {
      setExtensionNotice(`${plugin.name} 卸载服务不可用`)
      return
    }
    try {
      const result = await uninstallExtensionPluginBridge({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || `${plugin.name} 卸载失败`)
        return
      }
      if (!isExtensionPluginOperationData(result.data, 'uninstall') || result.data.plugin.pluginId !== pluginId) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return
      }
      applyExtensionPluginFromBackend(result.data.plugin)
      setExtensionNotice(`${result.data.plugin.name} 已卸载`)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 卸载失败`)
    }
  }

  const subscribeExtensionPlugin = async (pluginId: string) => {
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    if (!plugin || !plugin.isPlugin) return
    const openExtensionSubscriptionBridge = window.aiops?.openExtensionSubscription
    if (typeof openExtensionSubscriptionBridge !== 'function') {
      setExtensionNotice(`${plugin.name} 订阅服务不可用`)
      return
    }
    try {
      const result = await openExtensionSubscriptionBridge({ plugin: cloneExtensionPluginForBackend(plugin) })
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || `${plugin.name} 订阅入口打开失败`)
        return
      }
      if (!isExtensionSubscriptionData(result.data) || result.data.pluginId !== pluginId) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return
      }
      setExtensionNotice(`${plugin.name} 已打开订阅入口`)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin.name} 订阅入口打开失败`)
    }
  }

  const cancelExtensionInstall = async (pluginId: string) => {
    if (!extensionHasActiveOperation(pluginId)) return
    const plugin = extensionPlugins.value.find((item) => item.pluginId === pluginId)
    const cancelExtensionInstallBridge = window.aiops?.cancelExtensionInstall
    if (typeof cancelExtensionInstallBridge !== 'function') {
      setExtensionNotice(`${plugin?.name || '插件'} 取消服务不可用`)
      return
    }
    try {
      const result = await cancelExtensionInstallBridge(pluginId)
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || `${plugin?.name || '插件'} 取消失败`)
        return
      }
      if (!isExtensionPluginCancelData(result.data) || result.data.pluginId !== pluginId) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return
      }
      setExtensionInstallLoading(pluginId, false)
      setExtensionUpdateLoading(pluginId, false)
      setExtensionInstallProgress(pluginId, 'cancelled', 0)
      clearExtensionActiveOperation(pluginId)
      setExtensionNotice(`${plugin?.name || '插件'} 安装已取消`)
      clearExtensionInstallProgressLater(pluginId)
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${plugin?.name || '插件'} 取消失败`)
    }
  }

  const dropExtensionPackage = async (file: string | { name?: string; path?: string; size?: number }) => {
    extensionDragActive.value = false
    const rawPath = typeof file === 'string' ? file : file?.path || ''
    const pathLooksLocal = rawPath.includes('/') || rawPath.includes('\\')
    const filePath = typeof file === 'string' ? (pathLooksLocal ? rawPath : '') : rawPath
    const pathFileName = rawPath.split(/[\\/]/).pop() || ''
    const fileName = typeof file === 'string' ? pathFileName || file : file?.name || pathFileName
    const size = typeof file === 'string' ? undefined : file?.size
    if (!fileName.endsWith('.external-reference')) {
      setExtensionNotice('插件包格式错误，请拖入 .external-reference 文件')
      return false
    }
    const packageName = fileName.replace(/\.external-reference$/i, '').replace(/[-_]+/g, ' ').trim() || 'Local Plugin'
    if (!filePath) {
      setExtensionNotice(`${packageName} 安装需要真实本地路径，请从桌面客户端拖入 .external-reference 文件`)
      return false
    }
    const installExtensionPackageBridge = window.aiops?.installExtensionPackage
    if (typeof installExtensionPackageBridge !== 'function') {
      setExtensionNotice(`${packageName} 安装服务不可用`)
      return false
    }
    installExtensionInstallProgressListener()
    const requestId = nextExtensionPackageInstallRequestId()
    extensionPendingPackageRequestId.value = requestId
    extensionInstallingPackageName.value = packageName
    setExtensionNotice(`正在安装 ${packageName}`)
    let pendingPluginId = ''
    try {
      const result = await installExtensionPackageBridge({
        fileName,
        filePath,
        size,
        existingPluginIds: extensionPlugins.value.map((plugin) => plugin.pluginId),
        requestId
      })
      if (!result?.ok) {
        setExtensionNotice(result?.errorCode === 'EXTENSION_PLUGIN_OPERATION_CANCELLED' ? `${packageName} 安装已取消` : result?.errorMessage || `${packageName} 安装失败`)
        return false
      }
      if (!isExtensionPluginOperationData(result.data, 'package')) {
        setExtensionNotice(malformedExtensionBackendResultMessage)
        return false
      }
      pendingPluginId = result.data.plugin.pluginId
      setExtensionActiveOperation(pendingPluginId, 'package')
      applyExtensionPluginFromBackend(result.data.plugin)
      selectedExtensionId.value = result.data.plugin.pluginId
      setExtensionInstallProgress(result.data.plugin.pluginId, 'done', 100)
      setExtensionNotice(`${result.data.plugin.name} 安装成功`)
      clearExtensionInstallProgressLater(result.data.plugin.pluginId)
      return true
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : `${packageName} 安装失败`)
      return false
    } finally {
      if (pendingPluginId) setExtensionInstallLoading(pendingPluginId, false)
      if (pendingPluginId) clearExtensionActiveOperation(pendingPluginId)
      if (extensionPendingPackageRequestId.value === requestId) extensionPendingPackageRequestId.value = ''
      extensionInstallingPackageName.value = ''
    }
  }

  const createAliasCommand = () => {
    if (aliasCommands.value.some((item) => item.id === 'new')) return
    aliasSearchQuery.value = ''
    if (aliasEditSnapshot.value && aliasEditSnapshot.value.id !== 'new') {
      aliasCommands.value = aliasCommands.value.map((item) =>
        item.id === aliasEditSnapshot.value?.id ? { ...aliasEditSnapshot.value, edit: false } : { ...item, edit: false }
      )
    } else {
      aliasCommands.value = aliasCommands.value.map((item) => ({ ...item, edit: false }))
    }
    aliasEditSnapshot.value = { id: 'new', alias: '', command: '', edit: true }
    aliasCommands.value = [{ id: 'new', alias: '', command: '', edit: true }, ...aliasCommands.value]
  }

  const startAliasEdit = (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return
    if (aliasCommands.value.some((item) => item.id === 'new')) {
      aliasCommands.value = aliasCommands.value.filter((item) => item.id !== 'new')
    }
    if (aliasEditSnapshot.value && aliasEditSnapshot.value.id !== 'new') {
      aliasCommands.value = aliasCommands.value.map((item) =>
        item.id === aliasEditSnapshot.value?.id ? { ...aliasEditSnapshot.value, edit: false } : item
      )
    }
    aliasEditSnapshot.value = { ...target }
    aliasCommands.value = aliasCommands.value.map((item) => ({ ...item, edit: item.id === id }))
  }

  const updateAliasDraft = (id: string, patch: Partial<Pick<AliasCommand, 'alias' | 'command'>>) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return
    Object.assign(target, patch)
  }

  const saveAliasCommand = async (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return { ok: false, reason: 'not-found' as const }
    const alias = target.alias.trim()
    const command = target.command.trim()
    if (!alias || !command) {
      setExtensionNotice('Alias 和 Command 不能为空')
      return { ok: false, reason: 'missing' as const }
    }
    const payload: AliasCommandSaveInput = {
      id: target.id === 'new' ? undefined : target.id,
      previousAlias: target.id === 'new' ? undefined : aliasEditSnapshot.value?.alias || target.alias,
      alias,
      command,
      createdAt: target.createdAt
    }
    if (!window.aiops?.saveAliasCommand) {
      setExtensionNotice('Alias 保存服务不可用')
      return { ok: false, reason: 'backend' as const }
    }
    try {
      const result = await window.aiops.saveAliasCommand(payload)
      if (!result?.ok) {
        if (result?.errorCode === 'ALIAS_DUPLICATE') {
          setExtensionNotice('Alias 已存在')
          return { ok: false, reason: 'duplicate' as const }
        }
        setExtensionNotice(result?.errorMessage || 'Alias 保存失败')
        return { ok: false, reason: 'backend' as const }
      }
      if (!isAliasCommandMutationData(result.data)) {
        setExtensionNotice(malformedAliasBackendResultMessage)
        return { ok: false, reason: 'backend' as const }
      }
      await syncAliasConfigFromBackend(result.data.commands)
      aliasEditSnapshot.value = null
      setExtensionNotice('Alias 已保存')
      return { ok: true, reason: 'saved' as const }
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : 'Alias 保存失败')
      return { ok: false, reason: 'backend' as const }
    }
  }

  const cancelAliasEdit = (id: string) => {
    if (id === 'new') {
      aliasCommands.value = aliasCommands.value.filter((item) => item.id !== 'new')
      aliasEditSnapshot.value = null
      return
    }
    const target = aliasCommands.value.find((item) => item.id === id)
    if (target && aliasEditSnapshot.value?.id === id) {
      target.alias = aliasEditSnapshot.value.alias
      target.command = aliasEditSnapshot.value.command
      target.edit = false
    } else if (target) {
      target.edit = false
    }
    aliasEditSnapshot.value = null
  }

  const deleteAliasCommand = async (id: string) => {
    const target = aliasCommands.value.find((item) => item.id === id)
    if (!target) return { ok: false, reason: 'not-found' as const }
    if (!window.aiops?.deleteAliasCommand) {
      setExtensionNotice('Alias 删除服务不可用')
      return { ok: false, reason: 'backend' as const }
    }
    try {
      const result = await window.aiops.deleteAliasCommand({ id: target.id, alias: target.alias })
      if (!result?.ok) {
        setExtensionNotice(result?.errorMessage || 'Alias 删除失败')
        return { ok: false, reason: 'backend' as const }
      }
      if (!isAliasCommandDeleteData(result.data)) {
        setExtensionNotice(malformedAliasBackendResultMessage)
        return { ok: false, reason: 'backend' as const }
      }
      await syncAliasConfigFromBackend(result.data.commands)
      if (aliasEditSnapshot.value?.id === id) aliasEditSnapshot.value = null
      setExtensionNotice('Alias 已删除')
      return { ok: true, reason: 'deleted' as const }
    } catch (error) {
      setExtensionNotice(error instanceof Error ? error.message : 'Alias 删除失败')
      return { ok: false, reason: 'backend' as const }
    }
  }

  const setK8sNotice = (text: string) => {
    k8sClusterNotice.value = text
    if (!text) return
    window.setTimeout(() => {
      if (k8sClusterNotice.value === text) k8sClusterNotice.value = ''
    }, 2400)
  }

  const activateK8sTerminal = (id: string) => {
    k8sActiveTerminalId.value = id
    k8sTerminalTabs.value.forEach((tab) => {
      tab.isActive = tab.id === id
    })
  }

  const applyKubernetesCatalog = (catalog: KubernetesCatalog) => {
    k8sContexts.value = catalog.contexts.map((context) => ({ ...context }))
    k8sClusters.value = catalog.clusters.map((cluster) => ({ ...cluster }))
    k8sBastions.value = catalog.bastions.map((bastion) => ({ ...bastion }))
    k8sNamespaces.value = catalog.namespaces.map((namespace) => ({ ...namespace }))
    k8sResources.value = catalog.resources.map((resource) => ({ ...resource }))
    k8sImportContexts.value = catalog.importContexts.map((context) => ({ ...context }))
    k8sActiveClusterId.value = catalog.activeClusterId
    if (!k8sSelectedClusterId.value || !k8sClusters.value.some((cluster) => cluster.id === k8sSelectedClusterId.value)) {
      k8sSelectedClusterId.value = catalog.selectedClusterId
    }
    k8sConnectingClusterIds.value = k8sConnectingClusterIds.value.filter((id) => k8sClusters.value.some((cluster) => cluster.id === id))
    k8sSyncingBastionIds.value = k8sSyncingBastionIds.value.filter((id) => k8sBastions.value.some((bastion) => bastion.uuid === id))
    k8sTerminalTabs.value = k8sTerminalTabs.value.filter((tab) => k8sClusters.value.some((cluster) => cluster.id === tab.clusterId))

    if (!k8sTerminalTabs.value.length) {
      k8sActiveTerminalId.value = null
    } else if (!k8sActiveTerminalId.value || !k8sTerminalTabs.value.some((tab) => tab.id === k8sActiveTerminalId.value)) {
      activateK8sTerminal(k8sTerminalTabs.value[0].id)
    }

    const agentProxyConfig = catalog.agentProxyConfig || defaultK8sProxyConfig
    savedK8sProxyConfig.value = cloneK8sProxyConfig(agentProxyConfig)
    if (!k8sProxyConfigOpen.value) {
      k8sProxyConfig.value = cloneK8sProxyConfig(agentProxyConfig)
    }

    const activeCluster = k8sClusters.value.find((cluster) => cluster.id === k8sActiveClusterId.value)
    if (activeCluster && (!k8sAgentClusterId.value || !k8sClusters.value.some((cluster) => cluster.id === k8sAgentClusterId.value))) {
      k8sAgentClusterId.value = activeCluster.id
      k8sAgentContextName.value = activeCluster.context_name
      k8sAgentStatus.value = 'ready'
    } else if (!activeCluster && k8sAgentClusterId.value && !k8sClusters.value.some((cluster) => cluster.id === k8sAgentClusterId.value)) {
      k8sAgentClusterId.value = null
      k8sAgentContextName.value = ''
      k8sAgentStatus.value = 'idle'
    }

    return catalog
  }

  const refreshKubernetesCatalog = async () => {
    if (!window.aiops?.listKubernetesCatalog) return null
    const result = await window.aiops.listKubernetesCatalog()
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes 配置加载失败')
      return null
    }
    if (!isK8sCatalogSnapshot(result.data)) {
      setK8sNotice('Kubernetes catalog backend returned malformed result data.')
      return null
    }
    return applyKubernetesCatalog(result.data)
  }

  const switchK8sContext = async (name: string) => {
    if (!window.aiops?.switchKubernetesContext) {
      setK8sNotice('Kubernetes context API 不可用')
      return false
    }
    const result = await window.aiops.switchKubernetesContext(name)
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes Context 切换失败')
      return false
    }
    if (!isK8sContextSwitchData(result.data, name)) {
      setK8sNotice('Kubernetes context backend returned malformed result data.')
      return false
    }
    applyKubernetesCatalog(result.data)
    setK8sNotice(`已切换到 ${name}`)
    return true
  }

  const reloadK8sConfig = async () => {
    const catalog = await refreshKubernetesCatalog()
    setK8sNotice(catalog ? 'Kubernetes 配置已刷新' : 'Kubernetes 配置刷新失败')
    return Boolean(catalog)
  }

  const clearK8sSearch = () => {
    k8sSearchQuery.value = ''
    setK8sActionMenu(null)
  }

  const setK8sActionMenu = (clusterId: string | null) => {
    k8sClusterActionMenuId.value = clusterId
  }

  const setK8sConnecting = (clusterId: string, connecting: boolean) => {
    k8sConnectingClusterIds.value = connecting
      ? [...new Set([...k8sConnectingClusterIds.value, clusterId])]
      : k8sConnectingClusterIds.value.filter((id) => id !== clusterId)
  }

  const setK8sSyncingBastion = (bastionUuid: string, syncing: boolean) => {
    k8sSyncingBastionIds.value = syncing
      ? [...new Set([...k8sSyncingBastionIds.value, bastionUuid])]
      : k8sSyncingBastionIds.value.filter((id) => id !== bastionUuid)
  }

  const selectK8sCluster = (id: string | null) => {
    k8sSelectedClusterId.value = id
  }

  const openK8sProxyConfig = () => {
    k8sProxyConfig.value = cloneK8sProxyConfig(savedK8sProxyConfig.value)
    k8sProxyConfigOpen.value = true
  }

  const closeK8sProxyConfig = () => {
    k8sProxyConfig.value = cloneK8sProxyConfig(savedK8sProxyConfig.value)
    k8sProxyConfigOpen.value = false
  }

  const updateK8sProxyConfig = (patch: Partial<K8sProxyConfig>) => {
    k8sProxyConfig.value = {
      ...k8sProxyConfig.value,
      ...patch,
      port: patch.port === undefined ? k8sProxyConfig.value.port : Math.max(1, Math.min(65535, Number(patch.port) || 1))
    }
    if (!k8sProxyConfig.value.enableProxyIdentity) {
      k8sProxyConfig.value.username = ''
      k8sProxyConfig.value.password = ''
    }
  }

  const saveK8sProxyConfig = async () => {
    if (k8sProxyConfig.value.enabled && (!k8sProxyConfig.value.host.trim() || !k8sProxyConfig.value.port)) {
      setK8sNotice('请补全 Kubernetes Agent 代理主机和端口')
      return false
    }
    if (!window.aiops?.saveKubernetesAgentProxyConfig) {
      setK8sNotice('Kubernetes Agent 代理配置服务不可用')
      return false
    }
    const draft = cloneK8sProxyConfig(k8sProxyConfig.value)
    try {
      const result = await window.aiops.saveKubernetesAgentProxyConfig(draft)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes Agent 代理配置保存失败')
        return false
      }
      if (!isK8sProxyConfigData(result.data)) {
        setK8sNotice('Kubernetes Agent proxy backend returned malformed result data.')
        return false
      }
      savedK8sProxyConfig.value = cloneK8sProxyConfig(result.data.proxyConfig)
      k8sProxyConfig.value = cloneK8sProxyConfig(result.data.proxyConfig)
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes Agent 代理配置保存失败')
      return false
    }
    k8sProxyConfigOpen.value = false
    setK8sNotice(savedK8sProxyConfig.value.enabled ? 'Kubernetes Agent 代理配置已应用' : 'Kubernetes Agent 代理已关闭')
    return true
  }

  const setK8sAgentCluster = (clusterId: string | null) => {
    const cluster = clusterId ? k8sClusters.value.find((item) => item.id === clusterId) : null
    k8sAgentClusterId.value = cluster?.id || null
    k8sAgentContextName.value = cluster?.context_name || ''
    k8sAgentStatus.value = cluster ? 'ready' : 'idle'
    if (cluster) setK8sNotice(`Kubernetes Agent 已切换到 ${cluster.name}`)
    return Boolean(cluster)
  }

  const connectK8sCluster = async (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return false
    if (!window.aiops?.connectKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    setK8sActionMenu(null)
    setK8sConnecting(id, true)
    setK8sNotice(`正在连接 ${cluster.name}`)
    try {
      const result = await window.aiops.connectKubernetesCluster(id)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || `${cluster.name} 连接失败`)
        return false
      }
      if (!isK8sClusterMutationData(result.data, id, 'connected')) {
        setK8sNotice('Kubernetes cluster backend returned malformed result data.')
        return false
      }
      applyKubernetesCatalog(result.data)
      const latest = result.data.cluster || result.data.clusters.find((item) => item.id === id)
      if (latest) {
        k8sAgentClusterId.value = latest.id
        k8sAgentContextName.value = latest.context_name
        k8sAgentStatus.value = 'ready'
      }
      completeK8sTerminalConnect(id)
      const appliedProxyConfig = savedK8sProxyConfig.value
      setK8sNotice(
        appliedProxyConfig.enabled
          ? `${latest?.name || cluster.name} 连接成功，K8s Agent 代理 ${appliedProxyConfig.type} ${appliedProxyConfig.host}:${appliedProxyConfig.port} 已应用`
          : `${latest?.name || cluster.name} 连接成功`
      )
      return true
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : `${cluster.name} 连接失败`)
      return false
    } finally {
      setK8sConnecting(id, false)
    }
  }

  const disconnectK8sCluster = async (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return false
    if (!window.aiops?.disconnectKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    setK8sActionMenu(null)
    setK8sConnecting(id, false)
    try {
      const result = await window.aiops.disconnectKubernetesCluster(id)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || `${cluster.name} 断开失败`)
        return false
      }
      if (!isK8sClusterMutationData(result.data, id, 'disconnected')) {
        setK8sNotice('Kubernetes cluster backend returned malformed result data.')
        return false
      }
      applyKubernetesCatalog(result.data)
      if (k8sAgentClusterId.value === id) {
        k8sAgentClusterId.value = null
        k8sAgentContextName.value = ''
        k8sAgentStatus.value = 'idle'
      }
      k8sTerminalTabs.value
        .filter((tab) => tab.clusterId === id && tab.status !== 'ended')
        .forEach((tab) => {
          tab.status = 'ended'
          tab.exitCode = 0
          tab.collectingAiOutput = false
          tab.updatedAt = '刚刚'
        })
      setK8sNotice(`${cluster.name} 已断开`)
      return true
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : `${cluster.name} 断开失败`)
      return false
    }
  }

  const appendK8sTerminalOutput = (tab: K8sTerminalTab, text: string) => {
    tab.output = tab.output.endsWith('\n') || !tab.output ? `${tab.output}${text}` : `${tab.output}\n${text}`
    tab.updatedAt = '刚刚'
  }

  const handleK8sTerminalData = (event: KubernetesTerminalDataEvent) => {
    if (!isK8sTerminalDataEvent(event)) return
    const tab = k8sTerminalTabs.value.find((item) => item.sessionId === event.sessionId && item.id === event.id && item.clusterId === event.clusterId)
    if (!tab || tab.status === 'ended' || tab.status === 'error') return
    if (event.data) appendK8sTerminalOutput(tab, event.data)
    tab.lastCommandOutput = event.data
    tab.updatedAt = event.emittedAt
  }

  const handleK8sTerminalExit = (event: KubernetesTerminalExitEvent) => {
    if (!isK8sTerminalExitEvent(event)) return
    const tab = k8sTerminalTabs.value.find((item) => item.sessionId === event.sessionId && item.id === event.id && item.clusterId === event.clusterId)
    if (!tab) return
    tab.status = event.reason === 'error' ? 'error' : 'ended'
    tab.exitCode = event.exitCode
    tab.collectingAiOutput = false
    tab.updatedAt = event.emittedAt
    if (event.reason === 'error' && event.error) setK8sNotice(event.error)
  }

  const installK8sTerminalListeners = () => {
    if (!removeK8sTerminalDataListener && typeof window.aiops?.onKubernetesTerminalData === 'function') {
      removeK8sTerminalDataListener = window.aiops.onKubernetesTerminalData(handleK8sTerminalData)
    }
    if (!removeK8sTerminalExitListener && typeof window.aiops?.onKubernetesTerminalExit === 'function') {
      removeK8sTerminalExitListener = window.aiops.onKubernetesTerminalExit(handleK8sTerminalExit)
    }
  }

  const completeK8sTerminalConnect = (clusterId: string) => {
    k8sTerminalTabs.value
      .filter((tab) => tab.clusterId === clusterId && tab.status === 'connecting')
      .forEach((tab) => {
        tab.status = 'connected'
        tab.updatedAt = '刚刚'
      })
  }

  const openK8sTerminal = async (clusterId: string, options: { forceNew?: boolean; namespace?: string; cols?: number; rows?: number } = {}) => {
    const cluster = k8sClusters.value.find((item) => item.id === clusterId)
    if (!cluster) return null
    installK8sTerminalListeners()
    let tab = options.forceNew ? undefined : k8sTerminalTabs.value.find((item) => item.clusterId === clusterId && item.status !== 'ended')
    if (!tab) {
      if (!window.aiops?.createKubernetesTerminal) {
        setK8sNotice('Kubernetes terminal API 不可用')
        return null
      }
      const result = await window.aiops.createKubernetesTerminal({
        clusterId,
        namespace: options.namespace,
        cols: options.cols,
        rows: options.rows
      })
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端创建失败')
        return null
      }
      if (!isK8sTerminalRecord(result.data) || result.data.clusterId !== clusterId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return null
      }
      tab = k8sTerminalTabFromRecord(result.data)
      k8sTerminalTabs.value.push(tab)
    }
    activateK8sTerminal(tab.id)
    if (cluster.connection_status !== 'connected') {
      const connected = await connectK8sCluster(clusterId)
      if (!connected && tab.status === 'connecting') tab.status = 'error'
    } else if (tab.status === 'connecting') completeK8sTerminalConnect(clusterId)
    return tab
  }

  const createNewK8sTerminalTab = async (clusterId?: string) => {
    const targetClusterId = clusterId || k8sActiveCluster.value?.id || k8sSelectedCluster.value?.id || k8sClusters.value[0]?.id
    return targetClusterId ? openK8sTerminal(targetClusterId, { forceNew: true }) : null
  }

  const closeK8sTerminalTab = async (id: string) => {
    const index = k8sTerminalTabs.value.findIndex((tab) => tab.id === id)
    if (index < 0) return
    const tab = k8sTerminalTabs.value[index]
    if (tab.status !== 'ended') {
      if (!window.aiops?.closeKubernetesTerminal) {
        setK8sNotice('Kubernetes terminal API 不可用')
        return
      }
      const result = await window.aiops.closeKubernetesTerminal(tab.sessionId, 0)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端关闭失败')
        return
      }
      if (!isK8sTerminalCloseData(result.data) || result.data.sessionId !== tab.sessionId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return
      }
      k8sTerminalTabs.value[index] = {
        ...k8sTerminalTabs.value[index],
        status: result.data.status,
        exitCode: result.data.exitCode,
        updatedAt: result.data.updatedAt
      }
    }
    k8sTerminalTabs.value.splice(index, 1)
    if (k8sActiveTerminalId.value === id) {
      const next = k8sTerminalTabs.value[Math.min(index, k8sTerminalTabs.value.length - 1)]
      if (next) activateK8sTerminal(next.id)
      else k8sActiveTerminalId.value = null
    }
  }

  const setActiveK8sTerminal = (id: string) => {
    if (!k8sTerminalTabs.value.some((tab) => tab.id === id)) return
    activateK8sTerminal(id)
  }

  const resizeK8sTerminal = async (id: string, cols: number, rows: number) => {
    const tab = k8sTerminalTabs.value.find((item) => item.id === id || item.sessionId === id)
    if (!tab) return false
    if (window.aiops?.resizeKubernetesTerminal) {
      const result = await window.aiops.resizeKubernetesTerminal(tab.sessionId, cols, rows)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端尺寸同步失败')
        return false
      }
      if (!isK8sTerminalRecord(result.data) || result.data.sessionId !== tab.sessionId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return false
      }
      tab.cols = result.data.cols
      tab.rows = result.data.rows
      tab.updatedAt = result.data.updatedAt
      tab.status = result.data.status
    } else {
      setK8sNotice('Kubernetes terminal API 不可用')
      return false
    }
    setK8sNotice(`${tab.name} 终端尺寸已同步 ${tab.cols}x${tab.rows}`)
    return true
  }

  const executeK8sBackendCommand = async (command: string, clusterId: string, namespace: string, source: 'terminal' | 'agent' | 'resource'): Promise<K8sBackendCommandData | null> => {
    const cluster = k8sClusters.value.find((item) => item.id === clusterId)
    if (!window.aiops?.executeKubernetesCommand) {
      setK8sNotice('Kubernetes command API 不可用')
      return null
    }
    try {
      const result = await window.aiops.executeKubernetesCommand({
        command,
        clusterId,
        clusterName: cluster?.name,
        contextName: cluster?.context_name,
        namespace,
        defaultNamespace: cluster?.default_namespace,
        source
      })
      if (result.ok && isK8sBackendCommandForRequest(result.data, { command, clusterId, namespace, source })) return result.data
      if (result.ok) {
        setK8sNotice('Kubernetes command backend returned malformed result data.')
        return null
      }
      setK8sNotice(result.errorMessage || 'Kubernetes command failed.')
      return null
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes command failed.')
      return null
    }
  }

  const sendK8sTerminalCommand = async (command: string) => {
    const tab = k8sActiveTerminal.value
    const text = command.trim()
    if (!tab || !text || tab.status === 'ended') return ''
    if (tab.status !== 'connected') {
      setK8sNotice('Kubernetes terminal is not connected.')
      tab.collectingAiOutput = false
      return ''
    }
    const writeKubernetesTerminal = window.aiops?.writeKubernetesTerminal
    if (typeof writeKubernetesTerminal !== 'function') {
      setK8sNotice('Kubernetes terminal write API 不可用')
      tab.collectingAiOutput = false
      return ''
    }
    const payload = text.endsWith('\n') ? text : `${text}\n`
    let result: Awaited<ReturnType<AiopsPreloadApi['writeKubernetesTerminal']>>
    try {
      result = await writeKubernetesTerminal(tab.sessionId, payload)
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes terminal command failed.')
      tab.collectingAiOutput = false
      return ''
    }
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes terminal command failed.')
      tab.collectingAiOutput = false
      return ''
    }
    if (!isK8sTerminalWriteDataForRequest(result.data, { id: tab.sessionId, data: payload, command: text })) {
      setK8sNotice('Kubernetes terminal backend returned malformed write data.')
      tab.collectingAiOutput = false
      return ''
    }
    const terminalOutput = result.data.terminalOutput || ''
    tab.commandHistory = [text, ...tab.commandHistory.filter((item) => item !== text)].slice(0, 20)
    tab.lastCommand = text
    tab.updatedAt = result.data.updatedAt
    if (tab.collectingAiOutput) {
      tab.collectingAiOutput = false
      if (!terminalOutput.trim()) {
        setK8sNotice('Kubernetes terminal backend returned no output to send.')
      } else {
        const cluster = k8sClusters.value.find((item) => item.id === tab.clusterId)
        const host: AiContextOption | undefined = cluster
          ? {
              id: `k8s-${cluster.id}`,
              kind: 'hosts',
              label: cluster.name,
              detail: `${cluster.context_name} / ${tab.namespace}`
            }
          : undefined
        void sendChat(`Terminal output:\n\`\`\`\n${terminalOutput}\n\`\`\``, undefined, host ? [host] : undefined, { skipKnowledgeSearch: true })
        setK8sNotice(`${tab.name} 命令输出已发送到 AI`)
      }
    }
    return terminalOutput
  }

  const executeK8sTerminalAiCommand = async (command: string, tabId?: string) => {
    const target = tabId ? k8sTerminalTabs.value.find((tab) => tab.id === tabId || tab.sessionId === tabId) : k8sActiveTerminal.value
    if (!target || target.status === 'ended') return false
    const text = command.trim()
    if (!text) {
      target.collectingAiOutput = false
      target.aiCommandTabId = null
      setK8sNotice('当前没有可采集到 AI 的 kubectl 命令')
      return false
    }
    activateK8sTerminal(target.id)
    target.collectingAiOutput = true
    target.aiCommandTabId = tabId || target.id
    const terminalOutput = await sendK8sTerminalCommand(text)
    return Boolean(terminalOutput.trim())
  }

  const endK8sTerminalSession = async (id: string, exitCode = 0) => {
    const tab = k8sTerminalTabs.value.find((item) => item.id === id || item.sessionId === id)
    if (!tab) return false
    if (window.aiops?.closeKubernetesTerminal) {
      const result = await window.aiops.closeKubernetesTerminal(tab.sessionId, exitCode)
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 终端会话结束失败')
        return false
      }
      if (!isK8sTerminalCloseData(result.data) || result.data.sessionId !== tab.sessionId) {
        setK8sNotice('Kubernetes terminal backend returned malformed result data.')
        return false
      }
      tab.updatedAt = result.data.updatedAt
      tab.status = result.data.status
      tab.exitCode = result.data.exitCode
    } else {
      setK8sNotice('Kubernetes terminal API 不可用')
      return false
    }
    tab.collectingAiOutput = false
    setK8sNotice(`${tab.name} 终端会话已结束`)
    return true
  }

  const currentK8sOutputCommand = () => k8sResourceOutput.value.split('\n').find((line) => line.trim().startsWith('kubectl '))?.trim() || ''

  const planK8sResourceAction = async (resourceId: string, action: K8sResourceAction = 'get'): Promise<K8sBackendResourceActionPlanData | null> => {
    if (!window.aiops?.planKubernetesResourceAction) {
      setK8sNotice('Kubernetes resource action API 不可用')
      return null
    }
    try {
      const result = await window.aiops.planKubernetesResourceAction({ resourceId, action })
      const resource = k8sResources.value.find((item) => item.id === resourceId)
      if (result.ok && isK8sResourceActionPlanData(result.data, { resourceId, action, resource })) return result.data
      if (result.ok) {
        setK8sNotice('Kubernetes resource action backend returned malformed plan data.')
        return null
      }
      setK8sNotice(result.errorMessage || 'Kubernetes 资源命令生成失败')
      return null
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes 资源命令生成失败')
      return null
    }
  }

  const executeK8sResourceAction = async (resourceId: string, action: K8sResourceAction = 'get'): Promise<K8sBackendResourceActionData | null> => {
    if (!window.aiops?.executeKubernetesResourceAction) {
      setK8sNotice('Kubernetes resource action API 不可用')
      return null
    }
    try {
      const result = await window.aiops.executeKubernetesResourceAction({ resourceId, action })
      const resource = k8sResources.value.find((item) => item.id === resourceId)
      if (result.ok && isK8sBackendResourceActionData(result.data, { resourceId, action, resource })) return result.data
      if (result.ok) {
        setK8sNotice('Kubernetes resource action backend returned malformed result data.')
        return null
      }
      setK8sNotice(result.errorMessage || 'Kubernetes 资源操作失败')
      return null
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes 资源操作失败')
      return null
    }
  }

  const setK8sResourceKind = (kind: K8sResourceKind) => {
    k8sResourceKind.value = kind
    if (kind === 'nodes') k8sResourceNamespace.value = 'all'
  }

  const setK8sResourceNamespace = (namespace: string) => {
    k8sResourceNamespace.value = namespace
  }

  const addK8sAgentRun = (result: K8sBackendCommandData | K8sBackendResourceRefreshData, fallbackCluster?: K8sCluster | null) => {
    const cluster = fallbackCluster ?? k8sAgentCluster.value
    const record: K8sAgentRunRecord = {
      id: result.runId,
      command: result.command,
      status: result.success ? 'success' : 'error',
      output: result.output,
      error: result.error || undefined,
      clusterId: result.clusterId || cluster?.id || null,
      contextName: result.contextName || cluster?.context_name || k8sAgentContextName.value || null,
      namespace: result.namespace,
      startedAt: result.startedAt,
      durationMs: result.durationMs
    }
    k8sAgentRuns.value = [record, ...k8sAgentRuns.value].slice(0, 12)
    k8sAgentLastResult.value = record
    return record
  }

  const runK8sAgentKubectl = async (command?: string) => {
    const cluster = k8sAgentCluster.value
    const text = (command ?? k8sAgentCommandDraft.value).trim()
    if (!cluster || !text) {
      const result = await executeK8sBackendCommand(text, cluster?.id || '', k8sResourceNamespace.value === 'all' ? 'all' : k8sResourceNamespace.value, 'agent')
      if (!result) {
        k8sAgentStatus.value = 'error'
        setK8sNotice('Kubernetes Agent 执行失败')
        return null
      }
      const failed = addK8sAgentRun(result, cluster)
      k8sAgentStatus.value = 'error'
      setK8sNotice(failed.error || 'Kubernetes Agent 执行失败')
      return failed
    }
    k8sAgentStatus.value = 'running'
    const namespace = k8sResourceNamespace.value === 'all' ? cluster.default_namespace || 'default' : k8sResourceNamespace.value
    const result = await executeK8sBackendCommand(text, cluster.id, namespace, 'agent')
    if (!result) {
      k8sAgentStatus.value = 'error'
      k8sResourceOutputTitle.value = `Agent kubectl / ${cluster.name}`
      k8sResourceOutput.value = text
      return null
    }
    const record = addK8sAgentRun(result, cluster)
    k8sAgentCommandHistory.value = [text, ...k8sAgentCommandHistory.value.filter((item) => item !== text)].slice(0, 12)
    k8sAgentCommandDraft.value = text
    k8sAgentStatus.value = result.success ? 'ready' : 'error'
    k8sResourceOutputTitle.value = `Agent kubectl / ${cluster.name}`
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
    setK8sNotice(result.success ? 'Kubernetes Agent 命令执行完成' : result.error || result.output || 'Kubernetes Agent 命令执行失败')
    return record
  }

  const testK8sAgentConnection = async () => {
    const cluster = k8sAgentCluster.value
    k8sAgentTesting.value = true
    const record = await runK8sAgentKubectl('kubectl version --request-timeout=10s')
    if (!record) {
      k8sAgentStatus.value = 'error'
      k8sResourceOutputTitle.value = 'Agent Test Connection'
      window.setTimeout(() => {
        k8sAgentTesting.value = false
      }, 160)
      setK8sNotice('Kubernetes Agent 连接测试失败')
      return null
    }
    k8sAgentStatus.value = record.status === 'success' ? 'ready' : 'error'
    k8sResourceOutputTitle.value = 'Agent Test Connection'
    k8sResourceOutput.value = k8sCommandDisplayOutput(record)
    window.setTimeout(() => {
      k8sAgentTesting.value = false
    }, 160)
    setK8sNotice(record.status === 'success' ? 'Kubernetes Agent 连接测试成功' : 'Kubernetes Agent 连接测试失败')
    return record
  }

  const refreshK8sAgentNamespaces = async () => {
    const cluster = k8sAgentCluster.value
    if (!cluster) {
      setK8sNotice('请选择 Kubernetes Agent 集群')
      return null
    }
    const result = await executeK8sBackendCommand('kubectl get namespaces', cluster.id, cluster.default_namespace, 'agent')
    if (!result) return null
    const record = addK8sAgentRun(result, cluster)
    k8sResourceOutputTitle.value = `Namespaces / ${cluster.name}`
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
    setK8sNotice(result.success ? 'Kubernetes namespaces 已刷新' : result.error || 'Kubernetes namespaces 刷新失败')
    return record
  }

  const cleanupK8sAgent = async () => {
    if (!window.aiops?.cleanupKubernetesAgent) {
      setK8sNotice('Kubernetes Agent cleanup API 不可用')
      return false
    }
    const requestId = ++k8sAgentCleanupRequest
    const requestedClusterId = k8sAgentClusterId.value
    const requestedContextName = k8sAgentContextName.value
    try {
      const result = await window.aiops.cleanupKubernetesAgent()
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes Agent 清理失败')
        return false
      }
      if (!isK8sAgentCleanupData(result.data)) {
        setK8sNotice('Kubernetes Agent cleanup backend returned malformed result data.')
        return false
      }
      if (requestId !== k8sAgentCleanupRequest || requestedClusterId !== k8sAgentClusterId.value || requestedContextName !== k8sAgentContextName.value) return false
    } catch (error) {
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes Agent 清理失败')
      return false
    }
    k8sAgentClusterId.value = null
    k8sAgentContextName.value = ''
    k8sAgentStatus.value = 'idle'
    k8sAgentLastResult.value = null
    setK8sNotice('Kubernetes Agent 已清理')
    return true
  }

  const refreshK8sResources = async () => {
    const cluster = k8sResourceCluster.value
    if (!cluster) {
      setK8sNotice('请选择 Kubernetes 集群')
      return
    }
    if (!window.aiops?.refreshKubernetesResources) {
      setK8sNotice('Kubernetes resource refresh API 不可用')
      return null
    }
    k8sResourceLoading.value = true
    k8sResourceOutputTitle.value = `${cluster.name} / ${k8sKindLabels[k8sResourceKind.value]}`
    try {
      const result = await window.aiops.refreshKubernetesResources({
        clusterId: cluster.id,
        namespace: k8sResourceNamespace.value,
        kind: k8sResourceKind.value
      })
      if (!result?.ok) {
        setK8sNotice(result?.errorMessage || 'Kubernetes 资源刷新失败')
        k8sResourceLoading.value = false
        return null
      }
      if (!isK8sBackendResourceRefreshData(result.data, { clusterId: cluster.id, kind: k8sResourceKind.value, namespace: k8sResourceNamespace.value })) {
        setK8sNotice('Kubernetes resource refresh backend returned malformed result data.')
        k8sResourceLoading.value = false
        return null
      }
      applyKubernetesCatalog(result.data)
      const record = addK8sAgentRun(result.data, cluster)
      k8sResourceOutput.value = k8sCommandDisplayOutput(result.data)
      k8sResourceLoading.value = false
      setK8sNotice(result.data.success ? result.data.message || 'Kubernetes 资源已刷新' : result.data.error || result.data.message || 'Kubernetes 资源刷新失败')
      return record
    } catch (error) {
      k8sResourceLoading.value = false
      setK8sNotice(error instanceof Error ? error.message : 'Kubernetes 资源刷新失败')
      return null
    }
  }

  const describeK8sResource = async (resourceId: string) => {
    const result = await executeK8sResourceAction(resourceId, 'describe')
    if (!result) return
    k8sResourceOutputTitle.value = result.title
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
  }

  const showK8sPodLogs = async (resourceId: string) => {
    const result = await executeK8sResourceAction(resourceId, 'logs')
    if (!result) return
    k8sResourceOutputTitle.value = result.title
    k8sResourceOutput.value = k8sCommandDisplayOutput(result)
  }

  const writeK8sClipboardText = async (text: string, fallbackError: string) => {
    const copied = await copyTextToClipboard(text)
    if (!copied) setK8sNotice(fallbackError)
    return copied
  }

  const copyK8sResourceCommand = async (resourceId: string, action: K8sResourceAction = 'get') => {
    const plan = await planK8sResourceAction(resourceId, action)
    if (!plan) return ''
    const command = plan.command
    const copied = await writeK8sClipboardText(command, 'Kubernetes kubectl command copy failed.')
    if (!copied) return ''
    k8sCopiedCommand.value = command
    setK8sNotice('kubectl 命令已复制')
    return command
  }

  const copyK8sResourceOutput = async () => {
    const output = k8sResourceOutput.value.trim()
    if (!output) return ''
    const copied = await writeK8sClipboardText(output, 'Kubernetes output copy failed.')
    if (!copied) return ''
    setK8sNotice('Kubernetes 输出已复制')
    return output
  }

  const clearK8sResourceOutput = () => {
    k8sCopiedCommand.value = ''
    k8sResourceOutputTitle.value = '资源输出'
    k8sResourceOutput.value = '选择 Kubernetes 资源后，可在这里查看 Describe、Logs 或 kubectl 执行结果。'
    setK8sNotice('Kubernetes 输出已清空')
  }

  const sendK8sCurrentOutputToTerminal = async () => {
    const cluster = k8sResourceCluster.value
    const command = currentK8sOutputCommand()
    if (!cluster || !command) {
      setK8sNotice('当前没有可发送到终端的 kubectl 命令')
      return ''
    }
    await openK8sTerminal(cluster.id)
    const terminalOutput = await sendK8sTerminalCommand(command)
    if (!terminalOutput) return ''
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
    return command
  }

  const sendK8sCurrentOutputToAi = async () => {
    const cluster = k8sResourceCluster.value
    const output = k8sResourceOutput.value.trim()
    if (!cluster || !output) {
      setK8sNotice('当前没有可发送到 AI 的 Kubernetes 输出')
      return false
    }
    const host: AiContextOption = {
      id: `k8s-${cluster.id}`,
      kind: 'hosts',
      label: cluster.name,
      detail: `${cluster.context_name} / ${cluster.default_namespace}`
    }
    const sent = await sendChat(`请分析这个 Kubernetes 输出并给出下一步排查建议：\n\nTerminal output:\n\`\`\`\n${output}\n\`\`\``, undefined, [host], {
      skipKnowledgeSearch: true
    })
    if (!sent) return false
    setK8sNotice('Kubernetes 输出已发送到 AI')
    return true
  }

  const sendK8sResourceCommand = async (resourceId: string, action: K8sResourceAction = 'get') => {
    const plan = await planK8sResourceAction(resourceId, action)
    const cluster = plan ? k8sClusters.value.find((item) => item.id === plan.clusterId) : null
    if (!plan || !cluster) return
    await openK8sTerminal(plan.clusterId)
    const terminalOutput = await sendK8sTerminalCommand(plan.command)
    if (!terminalOutput) return
    setK8sNotice(`已发送到 ${cluster.name} 终端`)
  }

  const testK8sClusterConnection = async (input: Partial<KubernetesClusterTestInput>) => {
    if (!window.aiops?.testKubernetesClusterConnection) {
      k8sTestResult.value = false
      setK8sNotice('Kubernetes cluster test API 不可用')
      return false
    }
    const request = {
      contextName: input.contextName || '',
      serverUrl: input.serverUrl,
      kubeconfigPath: input.kubeconfigPath,
      kubeconfigContent: input.kubeconfigContent
    }
    const result = await window.aiops.testKubernetesClusterConnection(request)
    if (result?.ok && !isK8sClusterTestDataForRequest(result.data, request)) {
      k8sTestResult.value = false
      setK8sNotice('Kubernetes cluster test backend returned malformed result data.')
      return false
    }
    const ok = Boolean(result?.ok && isK8sClusterTestDataForRequest(result.data, request) && result.data.isValid)
    k8sTestResult.value = ok
    setK8sNotice(ok ? result.data?.message || '连接测试成功' : result?.errorMessage || result?.data?.message || '连接测试失败，请确认 Context 和 Server URL')
    return ok
  }

  const selectK8sImportContext = (contextName: string) => {
    return k8sImportContexts.value.find((context) => context.name === contextName) || null
  }

  const normalizeK8sKubeconfigImportResult = (
    result: Awaited<ReturnType<AiopsPreloadApi['importKubernetesKubeconfig']>>,
    expected: K8sKubeconfigImportRequest
  ): K8sKubeconfigImportResult => {
    if (expected.requestId !== k8sKubeconfigImportRequestId) {
      return {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        stale: true,
        error: 'Kubeconfig backend returned stale result data.'
      }
    }
    if (result?.ok) {
      if (!isK8sKubeconfigImportDataForRequest(result.data, expected)) {
        return {
          success: false,
          contexts: [],
          kubeconfigPath: '',
          kubeconfigContent: '',
          currentContext: '',
          error: 'Kubeconfig backend returned malformed result data.'
        }
      }
      return {
        success: true,
        contexts: result.data.contexts,
        kubeconfigPath: result.data.kubeconfigPath,
        kubeconfigContent: result.data.kubeconfigContent,
        currentContext: result.data.currentContext
      }
    }
    return {
      success: false,
      contexts: [],
      kubeconfigPath: '',
      kubeconfigContent: '',
      currentContext: '',
      error: result?.errorMessage || 'Kubeconfig 导入失败'
    }
  }

  const importK8sKubeconfigContent = async (content: string) => {
    const importKubeconfig = window.aiops?.importKubernetesKubeconfig
    if (typeof importKubeconfig !== 'function') {
      const failed: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        error: 'Kubeconfig 导入服务不可用'
      }
      setK8sNotice('Kubeconfig 导入服务不可用')
      return failed
    }
    const request: K8sKubeconfigImportRequest = { requestId: nextK8sKubeconfigImportRequestId(), kubeconfigContent: content }
    k8sKubeconfigImportRequestId = request.requestId
    const result = normalizeK8sKubeconfigImportResult(await importKubeconfig(request), request)
    if (result.success) {
      k8sImportContexts.value = result.contexts
      setK8sNotice(`已发现 ${result.contexts.length} 个 kubeconfig Context`)
    } else if (result.stale) {
      return result
    } else {
      setK8sNotice(result.error || 'Kubeconfig 导入失败')
    }
    return result
  }

  const importK8sKubeconfigFile = async (filePath: string) => {
    const kubeconfigPath = filePath.trim()
    if (!kubeconfigPath) {
      const emptyResult: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        error: '请选择 kubeconfig 文件'
      }
      setK8sNotice(emptyResult.error || '请选择 kubeconfig 文件')
      return emptyResult
    }
    try {
      const importKubeconfig = window.aiops?.importKubernetesKubeconfig
      if (typeof importKubeconfig !== 'function') {
        const failed: K8sKubeconfigImportResult = {
          success: false,
          contexts: [],
          kubeconfigPath: '',
          kubeconfigContent: '',
          currentContext: '',
          error: 'Kubeconfig 导入服务不可用'
        }
        setK8sNotice('Kubeconfig 导入服务不可用')
        return failed
      }
      const request: K8sKubeconfigImportRequest = { requestId: nextK8sKubeconfigImportRequestId(), kubeconfigPath }
      k8sKubeconfigImportRequestId = request.requestId
      const imported = normalizeK8sKubeconfigImportResult(await importKubeconfig(request), request)
      if (imported.success) {
        k8sImportContexts.value = imported.contexts
        setK8sNotice(`已选择 kubeconfig 文件，发现 ${imported.contexts.length} 个 Context`)
      } else if (imported.stale) {
        return imported
      } else {
        setK8sNotice(`Kubeconfig 导入失败：${imported.error}`)
      }
      return imported
    } catch (error) {
      const failed: K8sKubeconfigImportResult = {
        success: false,
        contexts: [],
        kubeconfigPath: '',
        kubeconfigContent: '',
        currentContext: '',
        error: error instanceof Error ? error.message : String(error)
      }
      setK8sNotice(`Kubeconfig 导入失败：${failed.error}`)
      return failed
    }
  }

  const addK8sCluster = async (payload: {
    name: string
    contextName: string
    serverUrl: string
    defaultNamespace?: string
    kubeconfigPath?: string | null
    kubeconfigContent?: string | null
    sourceType?: 'local' | 'jumpserver'
    bastionUuid?: string | null
  }) => {
    const name = payload.name.trim()
    const contextName = payload.contextName.trim()
    const serverUrl = payload.serverUrl.trim()
    if (!name || !contextName || !serverUrl) {
      setK8sNotice('请补全集群名称、Context 和 Server URL')
      return null
    }
    if (!window.aiops?.addKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return null
    }
    const result = await window.aiops.addKubernetesCluster({
      name,
      contextName,
      serverUrl,
      defaultNamespace: payload.defaultNamespace,
      kubeconfigPath: payload.kubeconfigPath,
      kubeconfigContent: payload.kubeconfigContent,
      sourceType: payload.sourceType,
      bastionUuid: payload.bastionUuid
    })
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || 'Kubernetes 集群添加失败')
      return null
    }
    if (!isK8sClusterMutationData(result.data)) {
      setK8sNotice('Kubernetes cluster backend returned malformed result data.')
      return null
    }
    applyKubernetesCatalog(result.data)
    const cluster = result.data.cluster
    k8sSelectedClusterId.value = cluster.id
    k8sAddModalOpen.value = false
    setK8sNotice(`${cluster.name} 已添加`)
    return cluster
  }

  const updateK8sCluster = async (id: string, patch: { name?: string; defaultNamespace?: string; autoConnect?: boolean }) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!cluster) return null
    if (!window.aiops?.updateKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return null
    }
    const result = await window.aiops.updateKubernetesCluster(id, patch)
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || `${cluster.name} 更新失败`)
      return null
    }
    if (!isK8sClusterMutationData(result.data, id)) {
      setK8sNotice('Kubernetes cluster backend returned malformed result data.')
      return null
    }
    applyKubernetesCatalog(result.data)
    const updated = result.data.cluster
    k8sEditModalOpen.value = false
    k8sEditingClusterId.value = null
    setK8sNotice(`${updated.name} 已更新`)
    return updated
  }

  const requestDeleteK8sCluster = (id: string) => {
    k8sDeleteConfirmClusterId.value = id
    setK8sActionMenu(null)
  }

  const cancelDeleteK8sCluster = () => {
    k8sDeleteConfirmClusterId.value = null
  }

  const confirmDeleteK8sCluster = async () => {
    if (!k8sDeleteConfirmClusterId.value) return
    await deleteK8sCluster(k8sDeleteConfirmClusterId.value)
    k8sDeleteConfirmClusterId.value = null
  }

  const deleteK8sCluster = async (id: string) => {
    const cluster = k8sClusters.value.find((item) => item.id === id)
    if (!window.aiops?.deleteKubernetesCluster) {
      setK8sNotice('Kubernetes cluster API 不可用')
      return false
    }
    const result = await window.aiops.deleteKubernetesCluster(id)
    if (!result?.ok) {
      setK8sNotice(result?.errorMessage || `${cluster?.name || '集群'} 删除失败`)
      return false
    }
    if (!isK8sClusterDeleteData(result.data, id)) {
      setK8sNotice('Kubernetes cluster backend returned malformed result data.')
      return false
    }
    applyKubernetesCatalog(result.data)
    k8sTerminalTabs.value = k8sTerminalTabs.value.filter((tab) => tab.clusterId !== id)
    if (k8sSelectedClusterId.value === id) k8sSelectedClusterId.value = null
    if (k8sActiveClusterId.value === id) k8sActiveClusterId.value = null
    if (k8sActiveTerminalId.value && !k8sTerminalTabs.value.some((tab) => tab.id === k8sActiveTerminalId.value)) {
      k8sActiveTerminalId.value = k8sTerminalTabs.value[0]?.id || null
      k8sTerminalTabs.value.forEach((tab) => {
        tab.isActive = tab.id === k8sActiveTerminalId.value
      })
    }
    setK8sNotice(`${cluster?.name || '集群'} 已删除`)
    return true
  }

  const syncK8sBastion = (bastionUuid: string) => {
    const bastion = k8sBastions.value.find((item) => item.uuid === bastionUuid)
    if (!bastion) return false
    if (!window.aiops?.syncKubernetesBastion) {
      setK8sNotice('Kubernetes bastion API 不可用')
      return false
    }
    setK8sSyncingBastion(bastionUuid, true)
    setK8sNotice(`正在同步 ${bastion.label}`)
    void window.aiops
      .syncKubernetesBastion(bastionUuid)
      .then((result) => {
        if (!result?.ok) {
          setK8sNotice(result?.errorMessage || `${bastion.label} Kubernetes 资产同步失败`)
          return false
        }
        if (!isK8sBastionSyncData(result.data)) {
          setK8sNotice('Kubernetes bastion backend returned malformed result data.')
          return false
        }
        applyKubernetesCatalog(result.data)
        k8sConfigTab.value = 'jumpserver'
        setK8sNotice(
          result.data.syncedCount
            ? `${bastion.label} Kubernetes 资产已同步，新增 ${result.data.syncedCount} 个`
            : `${bastion.label} Kubernetes 资产已同步，更新 ${result.data.updatedCount} 个`
        )
        return true
      })
      .catch((error) => {
        setK8sNotice(error instanceof Error ? error.message : `${bastion.label} Kubernetes 资产同步失败`)
      })
      .finally(() => {
        setK8sSyncingBastion(bastionUuid, false)
      })
    return true
  }

  const toggleK8sBastionCollapsed = (uuid: string) => {
    k8sCollapsedBastionIds.value = k8sCollapsedBastionIds.value.includes(uuid)
      ? k8sCollapsedBastionIds.value.filter((id) => id !== uuid)
      : [...k8sCollapsedBastionIds.value, uuid]
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
    const sourcePanel = split ? panels.value.find((panel) => panel.id === activePanelId.value) : undefined
    const welcomePlaceholder =
      !split &&
      panels.value.length === 1 &&
      panels.value[0].id === 'panel-main' &&
      panels.value[0].title === defaultTerminalPanelTitle &&
      panels.value[0].kind !== 'knowledge' &&
      !panels.value[0].sessionId &&
      !panels.value[0].output &&
      panels.value[0].outputSegments.length === 0 &&
      !panels.value[0].sshSession &&
      panels.value[0].status === 'ready'
    if (welcomePlaceholder) {
      const panel = panels.value[0]
      panel.id = createRendererLocalId('panel')
      panel.title = 'Terminal 1'
      activePanelId.value = panel.id
      return panel
    }
    const sourceId = sourcePanel?.id
    const groupId = split ? sourcePanel?.splitGroupId || sourceId : undefined
    const splitOrder = split ? Date.now() + panels.value.length : undefined
    const panel = createEmptyTerminalPanel(
      createRendererLocalId('panel'),
      split && sourcePanel ? sourcePanel.title : `Terminal ${panels.value.length}`,
      split,
      sourceId,
      groupId,
      splitOrder,
      sourcePanel
    )
    if (split && sourcePanel && groupId) {
      sourcePanel.splitGroupId = groupId
      const sourceIndex = panels.value.findIndex((item) => item.id === sourcePanel.id)
      panels.value.splice(sourceIndex + 1, 0, panel)
    } else {
      panels.value.push(panel)
    }
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
    if (!window.aiops?.createTerminal) {
      discardPendingPanel()
      setTopNotice('终端启动服务不可用')
      return null
    }
    if (host.isLocalShell || host.id === 'opened-local') {
      try {
        const session = await window.aiops.createTerminal({
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
      const session = await window.aiops.createTerminal({
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

  const clearPanelSplitState = (panel: TerminalPanel) => {
    panel.split = undefined
    panel.splitSourceId = undefined
    panel.splitGroupId = undefined
    panel.splitOrder = undefined
  }

  const hasSplitState = (panelId: string) => {
    const panel = panels.value.find((item) => item.id === panelId)
    if (!panel) return false
    if (panel.split || panel.splitGroupId) return true
    return panels.value.some((item) => item.splitSourceId === panel.id || (panel.splitGroupId && item.splitGroupId === panel.splitGroupId))
  }

  const normalizeSplitState = () => {
    const ids = new Set(panels.value.map((panel) => panel.id))
    const groupCounts = new Map<string, number>()
    panels.value.forEach((panel) => {
      if (!panel.split && !panel.splitGroupId) {
        panel.splitSourceId = undefined
        return
      }
      if (panel.split && (!panel.splitSourceId || !ids.has(panel.splitSourceId) || panel.splitSourceId === panel.id)) {
        clearPanelSplitState(panel)
        return
      }
      if (panel.splitGroupId) {
        groupCounts.set(panel.splitGroupId, (groupCounts.get(panel.splitGroupId) || 0) + 1)
      }
    })
    panels.value.forEach((panel) => {
      if (panel.splitGroupId && (groupCounts.get(panel.splitGroupId) || 0) < 2) {
        clearPanelSplitState(panel)
      }
    })
  }

  const detachPanelFromSplit = (panel: TerminalPanel) => {
    const previousGroupId = panel.splitGroupId
    const previousSourceId = panel.splitSourceId
    const groupSiblings = previousGroupId
      ? panels.value.filter((item) => item.id !== panel.id && item.splitGroupId === previousGroupId)
      : []
    const fallbackSourceId =
      (previousSourceId && groupSiblings.some((item) => item.id === previousSourceId) ? previousSourceId : undefined) ||
      groupSiblings[0]?.id

    clearPanelSplitState(panel)
    panels.value.forEach((item) => {
      if (item.id === panel.id || item.splitSourceId !== panel.id) return
      if (!fallbackSourceId) {
        clearPanelSplitState(item)
        return
      }
      if (item.id === fallbackSourceId) {
        item.split = undefined
        item.splitSourceId = undefined
        item.splitOrder = undefined
        item.splitGroupId = previousGroupId
        return
      }
      item.splitSourceId = fallbackSourceId
    })
    normalizeSplitState()
  }

  const unsplitPanel = (panelId = activePanelId.value) => {
    const panel = panels.value.find((item) => item.id === panelId)
    if (!panel) return false
    detachPanelFromSplit(panel)
    activePanelId.value = panel.id
    return true
  }

  const attachPanelToSplit = (panelId: string, targetPanelId: string, direction: PanelDirection = 'right') => {
    const panel = panels.value.find((item) => item.id === panelId)
    const target = panels.value.find((item) => item.id === targetPanelId)
    if (!panel || !target || panel.id === target.id) return false
    detachPanelFromSplit(panel)
    const groupId = target.splitGroupId || target.id
    target.splitGroupId = groupId
    panel.split = direction
    panel.splitSourceId = target.id
    panel.splitGroupId = groupId
    panel.splitOrder = Date.now() + panels.value.length
    const currentIndex = panels.value.findIndex((item) => item.id === panel.id)
    const targetIndex = panels.value.findIndex((item) => item.id === target.id)
    if (currentIndex >= 0 && targetIndex >= 0 && currentIndex !== targetIndex + 1) {
      const [moved] = panels.value.splice(currentIndex, 1)
      const nextTargetIndex = panels.value.findIndex((item) => item.id === target.id)
      panels.value.splice(nextTargetIndex + 1, 0, moved)
    }
    normalizeSplitState()
    activePanelId.value = panel.id
    return true
  }

  const resetToDefaultTerminalPanel = (panel: TerminalPanel) => {
    panel.id = 'panel-main'
    panel.title = defaultTerminalPanelTitle
    panel.cwd = '~'
    panel.kind = 'terminal'
    panel.status = 'ready'
    clearPanelSplitState(panel)
    panel.sessionId = undefined
    panel.knowledge = undefined
    panel.sshSession = undefined
    panel.terminalLifecycle = undefined
    panel.terminalExit = undefined
    setTerminalOutput(panel, '')
  }

  const closePanel = (id = activePanelId.value) => {
    if (panels.value.length === 1) {
      resetToDefaultTerminalPanel(panels.value[0])
      activePanelId.value = panels.value[0].id
      return
    }
    panels.value = panels.value.filter((panel) => panel.id !== id)
    normalizeSplitState()
    if (!panels.value.some((panel) => panel.id === activePanelId.value)) {
      activePanelId.value = panels.value[0].id
    }
  }

  const discardPendingTerminalPanel = (id: string, preferredActiveId?: string) => {
    const panel = panels.value.find((item) => item.id === id)
    if (!panel || panel.kind !== 'terminal' || panel.sessionId) return false
    if (panels.value.length === 1) {
      resetToDefaultTerminalPanel(panel)
      activePanelId.value = panel.id
      return true
    }
    const wasActive = activePanelId.value === id
    panels.value = panels.value.filter((item) => item.id !== id)
    normalizeSplitState()
    if (preferredActiveId && panels.value.some((item) => item.id === preferredActiveId)) {
      activePanelId.value = preferredActiveId
    } else if (wasActive || !panels.value.some((item) => item.id === activePanelId.value)) {
      activePanelId.value = panels.value[0].id
    }
    return true
  }

  const closeOthers = () => {
    panels.value = panels.value.filter((panel) => panel.id === activePanelId.value)
    panels.value.forEach(clearPanelSplitState)
  }

  const closeAllPanels = () => {
    panels.value = [createEmptyTerminalPanel('panel-main', defaultTerminalPanelTitle)]
    activePanelId.value = 'panel-main'
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

  const renamePanel = (id: string, title: string) => {
    const panel = panels.value.find((item) => item.id === id)
    if (panel && title.trim()) {
      panel.title = title.trim()
    }
  }

  const canForkSshPanel = (panelId: string) => {
    const panel = panels.value.find((item) => item.id === panelId)
    return Boolean(panel?.kind === 'terminal' && panel.sshSession?.connectionId)
  }

  const forkSshPanel = (panelId: string) => {
    const source = panels.value.find((item) => item.id === panelId)
    if (!source?.sshSession?.connectionId) return null
    const sourceSession = source.sshSession
    const forkSession: TerminalSshSession = {
      host: sourceSession.host,
      port: sourceSession.port,
      username: sourceSession.username,
      assetId: sourceSession.assetId,
      assetName: sourceSession.assetName,
      assetType: sourceSession.assetType,
      organizationId: sourceSession.organizationId,
      jumpHostId: sourceSession.jumpHostId,
      authType: sourceSession.authType,
      needProxy: sourceSession.needProxy,
      proxyName: sourceSession.proxyName,
      sourcePanelId: source.id,
      forkFromConnectionId: sourceSession.connectionId
    }
    const forkPanel: TerminalPanel = {
      id: createRendererLocalId('panel'),
      title: `${source.title} fork`,
      cwd: source.cwd,
      kind: 'terminal',
      output: '',
      outputSegments: [],
      status: 'ready',
      split: source.split,
      sshSession: forkSession
    }
    panels.value.push(forkPanel)
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
      cwd: getKbParent(relPath) || '@knowledgebase',
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
      panel.cwd = getKbParent(nextRelPath) || '@knowledgebase'
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
    const panel = panels.value.find((item) => item.sessionId === id || item.id === id)
    if (!panel) return
    appendTerminalSegment(panel, data, 'output')
    panel.status = 'running'
  }

  const applyTerminalLifecycle = (event: TerminalLifecycleEvent) => {
    if (!isTerminalLifecycleEvent(event)) return null
    const panel = panels.value.find((item) => item.sessionId === event.id || item.id === event.id || item.terminalLifecycle?.id === event.id)
    if (!panel) return null
    if (panel.terminalLifecycle?.id === event.id && panel.terminalLifecycle.kind !== event.kind) return null
    if (event.kind === 'local' && panel.sshSession && (panel.sessionId === event.id || panel.terminalLifecycle?.id === event.id)) return null
    let nextSshSession: TerminalSshSession | null = null
    if (event.kind === 'ssh') {
      const previous = panel.sshSession
      const connectionId = event.connectionId || previous?.connectionId
      const host = event.host || previous?.host
      const port = isTerminalPort(event.port) ? event.port : previous?.port
      const username = event.username || previous?.username
      if (!isNonEmptyText(connectionId) || !isNonEmptyText(host) || !isTerminalPort(port) || !isNonEmptyText(username)) return null
      if (!previous && (!event.connectionId || !event.host || !event.username || !isTerminalPort(event.port))) return null
      nextSshSession = {
        connectionId,
        sourcePanelId: previous?.sourcePanelId,
        forkFromConnectionId: previous?.forkFromConnectionId,
        host,
        port,
        username,
        assetId: previous?.assetId,
        assetName: previous?.assetName || host,
        assetType: previous?.assetType,
        organizationId: previous?.organizationId,
        jumpHostId: previous?.jumpHostId,
        authType: previous?.authType,
        needProxy: previous?.needProxy === true,
        proxyName: event.proxyName || previous?.proxyName || '',
        createdAt: previous?.createdAt
      }
    }
    panel.terminalLifecycle = event
    panel.kind = 'terminal'
    if (event.cwd) panel.cwd = event.cwd
    if (nextSshSession) panel.sshSession = nextSshSession
    if (event.stage === 'starting' || event.stage === 'connecting' || event.stage === 'proxy-opening') {
      panel.status = 'connecting'
      return panel
    }
    if (event.stage === 'connected' || event.stage === 'shell-ready') {
      panel.status = 'running'
      return panel
    }
    panel.status = event.stage === 'error' ? 'error' : 'closed'
    panel.terminalExit = {
      id: event.id,
      code: event.code ?? null,
      kind: event.kind,
      reason: event.reason,
      isNetworkDisconnect: event.isNetworkDisconnect,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage
    }
    if (panel.sessionId === event.id) {
      panel.sessionId = undefined
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
    const panel = panels.value.find((item) => item.sessionId === event.id || item.id === event.id || item.terminalLifecycle?.id === event.id)
    if (!panel) return null
    if (event.kind && panel.terminalLifecycle?.id === event.id && panel.terminalLifecycle.kind !== event.kind) return null
    if (event.kind === 'local' && panel.sshSession && (panel.sessionId === event.id || panel.terminalLifecycle?.id === event.id)) return null
    if (event.kind === 'ssh' && !panel.sshSession && panel.terminalLifecycle?.kind !== 'ssh') return null
    panel.terminalExit = event
    if (panel.sessionId === event.id) {
      panel.sessionId = undefined
    }
    panel.status = event.reason === 'error' || event.reason === 'network' || event.errorMessage ? 'error' : 'closed'
    appendTerminalSegment(panel, `\n[process exited: ${event.code ?? 'unknown'}]\n`, 'output')
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
    const panel = panels.value.find((item) => item.sessionId === id || item.id === id)
    if (!panel) return
    appendTerminalSegment(panel, data, 'input')
    recordMacroTerminalInput(panel.id, data)
  }

  const replaceTerminalOutput = (id: string, data: string, scope: TerminalOutputScope = 'output') => {
    const panel = panels.value.find((item) => item.sessionId === id || item.id === id)
    if (!panel) return
    setTerminalOutput(panel, data, scope)
  }

  const getHighlightedTerminalOutput = (id: string) => {
    const panel = panels.value.find((item) => item.id === id || item.sessionId === id)
    if (!panel) return ''
    if (!extensionSettings.value.highlightStatus) return panel.output
    if (!panel.outputSegments?.length) {
      panel.outputSegments = createTerminalSegments(panel.output)
    }
    return panel.outputSegments
      .map((segment) => applyKeywordHighlight(keywordHighlightSettings.value, segment.text, segment.scope))
      .join('')
  }

  const commandSecurityNotice = (result: CommandSecurityResult, command: string) => {
    const reason = result.reason || 'Security policy requires review'
    return `命令已被安全策略阻止：${command}（${reason}）`
  }

  const applyTerminalExecution = (execution: TerminalSecurityExecution) => {
    execution.panelIds.forEach((panelId) => {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      if (!panel) return
      appendTerminalSegment(panel, execution.inputText, 'input')
      if (execution.source !== 'snippet') {
        recordMacroTerminalInput(panel.id, execution.shellText || execution.inputText)
      }
    })
  }

  const recordTerminalExecutionInput = (execution: TerminalSecurityExecution) => {
    if (execution.source === 'snippet') return
    execution.panelIds.forEach((panelId) => {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      if (panel) recordMacroTerminalInput(panel.id, execution.shellText || execution.inputText)
    })
  }

  const reportTerminalExecutionUnavailable = (command: string, panelIds: string[] = [], reason = '终端会话不可用，请先打开本地 shell 或连接 SSH') => {
    setTopNotice(reason)
    terminalSecurityPrompt.value = null
    return { status: 'unavailable', command, panelIds, reason } as TerminalSecurityDecision
  }

  const terminalWriteFailureReason = (result?: TerminalWriteBridgeResult) => result?.errorMessage || '终端写入失败，请重新打开本地 shell 或连接 SSH'

  const terminalWriteExceptionReason = (error: unknown) =>
    error instanceof Error && error.message.trim() ? error.message.trim() : '终端写入失败，请重新打开本地 shell 或连接 SSH'

  const validateTerminalWriteResult = (result: TerminalWriteBridgeResult | undefined, sessionId: string, data: string): TerminalWriteValidation => {
    if (!isRecord(result)) return { ok: false, reason: malformedTerminalWriteResultMessage }
    if (result.ok === false) return { ok: false, reason: terminalWriteFailureReason(result as TerminalWriteBridgeResult) }
    if (result.ok !== true || !isTerminalWriteResultData(result.data, sessionId, data)) {
      return { ok: false, reason: malformedTerminalWriteResultMessage }
    }
    return { ok: true }
  }

  const writeTerminalSegment = async (sessionId: string, data: string): Promise<TerminalWriteValidation> => {
    try {
      const result = await window.aiops.writeTerminal(sessionId, data)
      return validateTerminalWriteResult(result, sessionId, data)
    } catch (error) {
      return { ok: false, reason: terminalWriteExceptionReason(error) }
    }
  }

  const waitForSnippetDelay = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, delayMs)))

  const canWriteTerminalExecution = (execution: Pick<TerminalSecurityExecution, 'panelIds' | 'writeToShell'>) => {
    if (!execution.writeToShell) return true
    if (typeof window.aiops?.writeTerminal !== 'function') return false
    return execution.panelIds.every((panelId) => {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      return Boolean(panel?.sessionId)
    })
  }

  const prepareTerminalSecurityExecution = (execution: TerminalSecurityExecution): TerminalSecurityDecision => {
    const securityCommands = execution.securityCommands?.length ? execution.securityCommands : [execution.command]
    for (const securityCommand of securityCommands) {
      const result = validateCommandSecurity(securitySettings.value, securityCommand)
      if (result.requiresApproval) {
        const promptExecution = { ...execution, command: securityCommand }
        const prompt = {
          id: createRendererLocalId('terminal-security'),
          command: securityCommand,
          panelIds: execution.panelIds,
          source: execution.source,
          result,
          execution: promptExecution
        }
        terminalSecurityPrompt.value = prompt
        return { status: 'needs-approval', prompt }
      }

      if (!result.isAllowed) {
        setTopNotice(commandSecurityNotice(result, securityCommand))
        terminalSecurityPrompt.value = null
        return { status: 'blocked', result }
      }
    }

    terminalSecurityPrompt.value = null
    if (!execution.writeToShell) applyTerminalExecution(execution)
    return { status: 'allow', execution }
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
          const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
          if (!panel?.sessionId) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
          const writeResult = await writeTerminalSegment(panel.sessionId, segment.text)
          if (!writeResult.ok) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds, writeResult.reason)
        }
      }
      return { status: 'allow', execution }
    }
    for (const panelId of execution.panelIds) {
      const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
      if (!panel?.sessionId) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds)
      const writeData = execution.shellText || execution.inputText
      const writeResult = await writeTerminalSegment(panel.sessionId, writeData)
      if (!writeResult.ok) return reportTerminalExecutionUnavailable(execution.command, execution.panelIds, writeResult.reason)
    }
    recordTerminalExecutionInput(execution)
    return { status: 'allow', execution }
  }

  const executeTerminalCommand = (panelId: string, command: string, options: Partial<Pick<TerminalSecurityExecution, 'inputText' | 'shellText' | 'writeToShell' | 'source'>> = {}) => {
    const text = command.trim()
    if (!text) return { status: 'allow' } as TerminalSecurityDecision
    const writeToShell = options.writeToShell ?? true
    const execution: TerminalSecurityExecution = {
      command: text,
      panelIds: [panelId],
      inputText: options.inputText ?? `${text}\n`,
      shellText: options.shellText ?? `${text}\n`,
      writeToShell,
      source: options.source ?? 'direct'
    }
    return prepareTerminalSecurityExecution(execution)
  }

  const runTerminalCommand = async (
    panelId: string,
    command: string,
    options: Partial<Pick<TerminalSecurityExecution, 'inputText' | 'shellText' | 'writeToShell' | 'source'>> = {}
  ) => {
    const decision = executeTerminalCommand(panelId, command, options)
    if (decision.status !== 'allow' || !decision.execution?.writeToShell) return decision
    return writeTerminalExecution(decision.execution)
  }

  const executeGlobalTerminalCommand = (command: string) => {
    const text = command.trim()
    if (!text) return { status: 'allow' } as TerminalSecurityDecision
    const terminalPanelIds = panels.value.filter((panel) => panel.kind !== 'knowledge' && panel.sessionId).map((panel) => panel.id)
    if (!terminalPanelIds.length || typeof window.aiops?.writeTerminal !== 'function') {
      return reportTerminalExecutionUnavailable(text, panels.value.filter((panel) => panel.kind !== 'knowledge').map((panel) => panel.id))
    }
    const execution: TerminalSecurityExecution = {
      command: text,
      panelIds: terminalPanelIds,
      inputText: `${text}\n`,
      shellText: `${text}\n`,
      writeToShell: true,
      source: 'global'
    }
    return prepareTerminalSecurityExecution(execution)
  }

  const runGlobalTerminalCommand = async (command: string) => {
    const decision = executeGlobalTerminalCommand(command)
    if (decision.status !== 'allow' || !decision.execution?.writeToShell) return decision
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
    setTopNotice(`命令执行已取消：${prompt.command}`)
    terminalSecurityPrompt.value = null
    return prompt.execution
  }

  const resolveActiveWritableTerminalPanel = () =>
    activePanel.value.kind === 'knowledge' ? panels.value.find((item) => item.kind !== 'knowledge') : activePanel.value

  const sleep = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, delayMs)))

  const waitForTerminalOutputAfter = async (panelId: string, startLength: number, timeoutMs = 2_500) => {
    const startedAt = Date.now()
    const panelForOutput = () => panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    let panel = panelForOutput()
    if (!panel) return ''
    while (Date.now() - startedAt < timeoutMs) {
      panel = panelForOutput()
      if (!panel) return ''
      const output = panel.output.slice(startLength)
      if (output.trim()) return output
      await sleep(80)
    }
    panel = panelForOutput()
    return panel?.output.slice(startLength) || ''
  }

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

  const aiChatMessageInputFromChatMessage = (message: ChatMessage): AiChatMessageInput => ({
    role: message.role,
    text: message.text,
    ask: message.ask,
    say: message.say,
    action: message.action,
    commandExecution: message.commandExecution ? cloneStructuredValue(message.commandExecution) : undefined
  })

  const filterAgentCommandOutputForPrompt = (output: string) => {
    const trimmed = output.trimEnd()
    if (!aiPreferences.value.commandOutputFilteringEnabled || trimmed.length <= agentCommandOutputFilterLimit) return trimmed
    const omittedChars = trimmed.length - agentCommandOutputFilterHead - agentCommandOutputFilterTail
    return [
      trimmed.slice(0, agentCommandOutputFilterHead).trimEnd(),
      '',
      `[aiopsterm omitted ${omittedChars.toLocaleString()} characters from the middle of this command output because AI command output filtering is enabled.]`,
      '',
      trimmed.slice(-agentCommandOutputFilterTail).trimStart()
    ].join('\n')
  }

  const buildAgentCommandOutputPrompt = (command: string, output: string) =>
    [
      'Command output from the approved execute_command tool is available.',
      '',
      `<command>${command}</command>`,
      '',
      'Output:',
      '```',
      filterAgentCommandOutputForPrompt(output),
      '```',
      '',
      'Continue the Agent loop: analyze this observation, request another <execute_command> block only if another terminal step is needed, otherwise provide the final answer.'
    ].join('\n')

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
    const commandOutputMessage: ChatMessage = {
      id: `${requestId}-command-output`,
      role: 'assistant',
      text: output,
      state: 'done',
      say: 'command_output',
      action: 'approved',
      commandExecution: input.commandExecution ? cloneStructuredValue(input.commandExecution) : undefined,
      executedCommand: command
    }
    const assistantMessage: ChatMessage = {
      id: `${requestId}-assistant`,
      role: 'assistant',
      text: '正在分析命令输出...',
      state: 'streaming'
    }
    chatMessages.value.push(commandOutputMessage, assistantMessage)
    const prompt = buildAgentCommandOutputPrompt(command, output)
    const messages: AiChatMessageInput[] = chatMessages.value.slice(-16).map((message) => {
      const mapped = aiChatMessageInputFromChatMessage(message)
      if (message.id === commandOutputMessage.id) mapped.text = filterAgentCommandOutputForPrompt(message.text)
      return mapped
    })
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

  const buildTerminalCommandContext = (panel: TerminalPanel): TerminalCommandGenerationContext => {
    const ssh = panel.sshSession
    return {
      host: ssh?.host || '127.0.0.1',
      username: ssh?.username || 'local',
      cwd: panel.cwd || '~',
      shell: panel.sessionId ? 'local-shell' : 'bash',
      connectionType: ssh ? ('ssh' as const) : ('local' as const)
    }
  }

  const generateTerminalCommand = async (panelId: string, instruction: string, modelName?: string) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    const prompt = instruction.trim()
    if (!panel || panel.kind === 'knowledge' || !prompt) return null
    const selectedModel = modelName || terminalCommandModelOptions.value[0]
    if (!selectedModel) {
      setTopNotice('请先配置可用模型')
      return null
    }
    const generateBridge = window.aiops?.generateTerminalCommand
    if (typeof generateBridge !== 'function') {
      setTopNotice('终端命令生成服务不可用')
      return null
    }

    let result: Awaited<ReturnType<AiopsPreloadApi['generateTerminalCommand']>>
    try {
      result = await generateBridge({
        panelId: panel.id,
        instruction: prompt,
        modelName: selectedModel,
        context: buildTerminalCommandContext(panel)
      })
    } catch (error) {
      setTopNotice(aiBridgeErrorMessage(error, '终端命令生成失败'))
      return null
    }
    if (!result.ok) {
      setTopNotice(result.errorMessage || '终端命令生成失败')
      return null
    }
    if (!isTerminalCommandGenerationRecord(result.data) || result.data.panelId !== panel.id || result.data.instruction !== prompt) {
      setTopNotice('终端命令生成结果无效')
      return null
    }
    const record = result.data
    terminalCommandGenerationRecords.value = [record, ...terminalCommandGenerationRecords.value].slice(0, 20)
    return record
  }

  const injectGeneratedTerminalCommand = (panelId: string, command: string) => {
    const panel = panels.value.find((item) => item.id === panelId || item.sessionId === panelId)
    const text = command.trim()
    if (!panel || panel.kind === 'knowledge' || !text) return null
    appendTerminalSegment(panel, text, 'input')
    recordMacroTerminalInput(panel.id, text)
    return { status: 'allow' } as TerminalSecurityDecision
  }

  const buildPlainTextFromAiParts = (parts: AiContentPart[]) =>
    parts
      .map((part) => {
        if (part.type === 'text') return part.text
        if (part.type === 'image') return '[image]'
        if (part.chipType === 'doc') return `@${part.ref.absPath || ''}`
        if (part.chipType === 'command') return part.ref.command
        if (part.chipType === 'skill') return `@skill:${part.ref.skillName}`
        const taskName = part.ref.title || ''
        return taskName ? `@${part.ref.taskId}_${taskName}` : `@${part.ref.taskId}`
      })
      .join('')

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
    const responseBridge = window.aiops?.generateAiChatResponse
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
    const cancelBridge = window.aiops?.cancelAiChatResponse
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
    const safeContentParts = contentParts?.filter((part) => part.type !== 'text' || part.text.trim()) || []
    const hasStructuredParts = safeContentParts.some((part) => part.type !== 'text')
    const prompt = text.trim() || buildPlainTextFromAiParts(safeContentParts).trim()
    if (!prompt && !hasStructuredParts) return false
    const baseMessageContexts = overrideHosts ? [...overrideHosts, ...selectedContexts.value.filter((item) => item.kind !== 'hosts')] : [...selectedContexts.value]
    const autoKnowledgeContexts = options.skipKnowledgeSearch ? [] : await resolveAiKnowledgeSearchContexts(prompt, baseMessageContexts)
    const messageContexts = [...baseMessageContexts, ...autoKnowledgeContexts]
    const commandDisplay = selectedCommandRef.value?.label || selectedCommandRef.value?.command || selectedCommandId.value
    const historyForBackend: AiChatMessageInput[] = chatMessages.value.slice(-12).map((message) => ({ role: message.role, text: message.text }))
    const hostContexts = overrideHosts ?? selectedContexts.value.filter((item) => item.kind === 'hosts')
    const responseMode = options.mode || (mode.value === 'agents' ? 'agent' : 'command')
    const exchangeBridge = window.aiops?.createAiChatExchangeRequest
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

  const resendUserMessageFromParts = async (messageId: string, contentParts: AiContentPart[], overrideHosts?: AiContextOption[]) => {
    const index = chatMessages.value.findIndex((message) => message.id === messageId && message.role === 'user')
    if (index === -1) return false
    const originalHosts = chatMessages.value[index].hosts
    const prompt = buildPlainTextFromAiParts(contentParts).trim()
    const hasStructuredParts = contentParts.some((part) => part.type !== 'text')
    if (!prompt && !hasStructuredParts) return false
    chatMessages.value.splice(index)
    clearAiContextUsage()
    return appendChatExchange(prompt, contentParts, overrideHosts ?? originalHosts)
  }

  const createConversation = async () => {
    if (!window.aiops?.createChatConversation) return null
    const result = await window.aiops.createChatConversation()
    if (!result?.ok || !isAiChatConversationMutationData(result.data)) return null
    applyChatHistorySnapshot({
      conversations: result.data.conversations,
      selectedConversationId: result.data.selectedConversationId
    })
    await restoreChatMessagesFromBackend(result.data.conversation.id)
    return conversations.value.find((conversation) => conversation.id === result.data!.conversation.id) || cloneConversationRecord(result.data.conversation)
  }

  const deleteConversation = async (id: string) => {
    if (!window.aiops?.deleteChatConversation) return false
    const result = await window.aiops.deleteChatConversation(id)
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
    if (!window.aiops?.updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await window.aiops.updateChatConversation({
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
    if (!window.aiops?.updateChatConversation) {
      setTopNotice('会话历史写入服务不可用')
      return false
    }
    const result = await window.aiops.updateChatConversation({
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
    const bridge = action === 'approve' ? window.aiops?.approveAiMcpToolCall : window.aiops?.rejectAiMcpToolCall
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
    const bridge = action === 'approve' ? window.aiops?.approveAiMcpResourceAccess : window.aiops?.rejectAiMcpResourceAccess
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
    if (!window.aiops?.saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const nextFeedback = message.feedback === feedback ? null : feedback
    const result = await window.aiops.saveChatMessageMetadata({
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
    if (!window.aiops?.saveChatMessageMetadata) {
      setTopNotice('AI 消息写入服务不可用')
      return false
    }
    const result = await window.aiops.saveChatMessageMetadata({
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

  const uniqueKnowledgeFileName = (parentRelDir: string, fileName: string) => {
    const dotIndex = fileName.lastIndexOf('.')
    const base = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName
    const ext = dotIndex >= 0 ? fileName.slice(dotIndex) : ''
    let candidate = fileName
    let index = 1
    while (findKnowledgeNode(createKbRelPath(parentRelDir, candidate))) {
      candidate = `${base}-${index}${ext}`
      index += 1
    }
    return candidate
  }

  const ensureLocalKnowledgeDir = async (title: string) => {
    const relPath = title
    const existing = findKnowledgeNode(relPath)
    if (existing?.type === 'dir') return existing
    if (!window.aiops?.kbMkdir) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await window.aiops.kbMkdir('', title)
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
    if (!window.aiops?.kbCreateFile || !window.aiops?.kbWriteFile) {
      setTopNotice('知识库写入服务不可用')
      return null
    }
    const result = await window.aiops.kbCreateFile('summary', fileName, content)
    const entry = backendKnowledgeEntryOrNotice(result, malformedKnowledgeBackendResultMessage)
    if (!entry) return null
    const relPath = entry.relPath.trim()
    if (!isKnowledgeRelPathInParentWithRequestedName(relPath, 'summary', fileName) || entry.type !== 'file') {
      setTopNotice(malformedKnowledgeBackendResultMessage)
      return null
    }
    const writeResult = await window.aiops.kbWriteFile(relPath, content)
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
    if (!window.aiops?.createSkill) {
      setSettingsNotice('Skill 创建服务不可用')
      return null
    }
    try {
      const created = await window.aiops.createSkill({ name: skill.name, description: skill.description }, skill.content)
      if (!isSkillWriteResultForRequest(created, { name: skill.name, description: skill.description, content: skill.content, enabled: true })) {
        setSettingsNotice(malformedSkillsBackendResultMessage)
        return null
      }
      const refreshed = await refreshSkillsAfterMutation((skills) => snapshotContainsSkill(skills, { name: skill.name, description: skill.description, content: skill.content }))
      if (!refreshed) return null
      return created.skill
    } catch {
      setSettingsNotice(`${name} 创建失败`)
      return null
    }
  }

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
    pendingAiAttentionItems,
    aiAttentionUnreadCount,
    currentAiAttentionItem,
    aiAttentionFocusRequest,
    managedAiSessions,
    managedAiSessionsLoading,
    managedAiSessionsError,
    sortedManagedAiSessions,
    managedAiNeedsInputSessions,
    selectedManagedAiSession,
    managedAiSessionFocusRequest,
    selectedManagedAiSessionKey,
    upsertAiAttentionItem,
    refreshManagedAiSessions,
    applyManagedAiSessionSnapshot,
    upsertManagedAiSession,
    markManagedAiSessionHandled,
    replyManagedAiSession,
    renameManagedAiSession,
    clearManagedAiSession,
    bulkManagedAiSessions,
    managedAiSessionNeedsAttentionForPanel,
    focusManagedAiSession,
    removeAiAttentionItem,
    markAiAttentionHandled,
    clearAiAttentionForConversation,
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
    isMacroRecording,
    recordedCommands,
    macroCurrentLineBuffer,
    macroTerminalId,
    macroRecordControlKeys,
    macroSleepThresholdMs,
    macroLimitReason,
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
    setActiveSettingsSection,
    openSettingsPageDocumentation,
    openSettingsDocumentationLink,
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
