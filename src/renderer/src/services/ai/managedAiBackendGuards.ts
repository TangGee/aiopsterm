import type {
  AgentHibernationConfig,
  AiAgentSessionEventName,
  AiAgentSessionSource,
  ManagedAiDecisionMode,
  ManagedAiRequestKind,
  ManagedAiSessionBulkResult,
  ManagedAiSessionDecision,
  ManagedAiSessionHibernateResult,
  ManagedAiSessionKind,
  ManagedAiSessionLifecycle,
  ManagedAiSessionMutationResult,
  ManagedAiSessionRecord,
  ManagedAiSessionSnapshot,
  ManagedAiSessionState,
  ManagedAiSessionTimelineEvent
} from '@shared/contracts/managedAiSessions'
import type {
  ManagedAiSessionContentDeleteResult,
  ManagedAiSessionContentRecord,
  ManagedAiSessionContentSnapshot
} from '@shared/contracts/managedAiSessionContent'
import type {
  AgentHookInstallerOperationResult,
  AgentHookInstallerSnapshot,
  AgentHookInstallerSource,
  AgentHookInstallerStatus
} from '@shared/contracts/agentHooks'
import type {
  ExportMcpBridgeStatus,
  ExportMcpClientSource,
  ExportMcpClientStatus,
  ExportMcpInstallerOperationResult,
  ExportMcpInstallerSnapshot
} from '@shared/contracts/exportMcp'

export type ManagedAiSessionMutationData = NonNullable<ManagedAiSessionMutationResult['data']>
export type ManagedAiSessionBulkData = NonNullable<ManagedAiSessionBulkResult['data']>
export type ManagedAiSessionHibernateData = NonNullable<ManagedAiSessionHibernateResult['data']>
export type ManagedAiSessionContentRecordData = { record: ManagedAiSessionContentRecord }
export type ManagedAiSessionContentDeleteData = NonNullable<ManagedAiSessionContentDeleteResult['data']>
export type AgentHookInstallOperationData = NonNullable<AgentHookInstallerOperationResult['data']>
export type ExportMcpInstallOperationData = NonNullable<ExportMcpInstallerOperationResult['data']>
export type AgentHibernationConfigData = { config: AgentHibernationConfig }

const agentHookInstallerSources = new Set<AgentHookInstallerSource>([
  'codex',
  'claude-code',
  'cursor',
  'gemini',
  'copilot',
  'grok',
  'opencode',
  'codebuddy',
  'factory',
  'qoder',
  'amp',
  'pi',
  'omp',
  'kiro',
  'rovodev'
])
const exportMcpClientSources = new Set<ExportMcpClientSource>(['codex', 'claude-code'])
const aiAgentSessionSources = new Set<AiAgentSessionSource>([
  'codex',
  'claude-code',
  'cursor',
  'gemini',
  'copilot',
  'grok',
  'opencode',
  'codebuddy',
  'factory',
  'qoder',
  'antigravity',
  'kiro',
  'hermes-agent',
  'rovodev',
  'amp',
  'pi',
  'omp'
])
const aiAgentSessionEventNames = new Set<AiAgentSessionEventName>([
  'session_start',
  'prompt_submit',
  'pre_tool_use',
  'permission_request',
  'question',
  'notification',
  'lifecycle',
  'stop',
  'session_end'
])
const managedAiSessionStates = new Set<ManagedAiSessionState>(['idle', 'working', 'needsInput', 'ended', 'unknown'])
const managedAiSessionKinds = new Set<ManagedAiSessionKind>(['main', 'subagent', 'internal'])
const managedAiSessionLifecycles = new Set<ManagedAiSessionLifecycle>(['idle', 'running', 'needsInput', 'ended', 'unknown'])
const managedAiRequestKinds = new Set<ManagedAiRequestKind>(['permission', 'question', 'plan', 'notification', 'telemetry'])
const managedAiDecisionModes = new Set<ManagedAiDecisionMode>(['blocking', 'telemetry', 'local'])
const managedAiContentFormats = new Set(['jsonl', 'opencode-sqlite', 'events', 'unsupported'])
const managedAiContentRoles = new Set(['system', 'developer', 'user', 'assistant', 'tool', 'unknown'])

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0
const hasOwnField = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key)
const isOptionalField = (record: Record<string, unknown>, key: string, guard: (value: unknown) => boolean) =>
  !hasOwnField(record, key) || record[key] === undefined || guard(record[key])

export const isAgentHookInstallerSource = (value: unknown): value is AgentHookInstallerSource =>
  agentHookInstallerSources.has(value as AgentHookInstallerSource)

export const isExportMcpClientSource = (value: unknown): value is ExportMcpClientSource =>
  exportMcpClientSources.has(value as ExportMcpClientSource)

export const isAiAgentSessionSource = (value: unknown): value is AiAgentSessionSource => aiAgentSessionSources.has(value as AiAgentSessionSource)

export const isAiAgentSessionEventName = (value: unknown): value is AiAgentSessionEventName =>
  aiAgentSessionEventNames.has(value as AiAgentSessionEventName)

export const isManagedAiSessionState = (value: unknown): value is ManagedAiSessionState => managedAiSessionStates.has(value as ManagedAiSessionState)

export const isManagedAiSessionKind = (value: unknown): value is ManagedAiSessionKind => managedAiSessionKinds.has(value as ManagedAiSessionKind)

export const isManagedAiSessionLifecycle = (value: unknown): value is ManagedAiSessionLifecycle =>
  managedAiSessionLifecycles.has(value as ManagedAiSessionLifecycle)

export const isManagedAiRequestKind = (value: unknown): value is ManagedAiRequestKind => managedAiRequestKinds.has(value as ManagedAiRequestKind)

export const isManagedAiDecisionMode = (value: unknown): value is ManagedAiDecisionMode => managedAiDecisionModes.has(value as ManagedAiDecisionMode)

export const isManagedAiSessionTimelineEvent = (value: unknown): value is ManagedAiSessionTimelineEvent =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isAiAgentSessionSource(value.source) &&
  isAiAgentSessionEventName(value.event) &&
  isNonEmptyString(value.sessionId) &&
  isNonEmptyString(value.title) &&
  typeof value.summary === 'string' &&
  typeof value.receivedAt === 'number' &&
  isOptionalField(value, 'requestKind', isManagedAiRequestKind) &&
  isOptionalField(value, 'decisionMode', isManagedAiDecisionMode) &&
  isOptionalField(value, 'waitTimeoutMs', isPositiveInteger) &&
  isOptionalField(value, 'toolName', isNonEmptyString) &&
  isOptionalField(value, 'canonicalCwd', isNonEmptyString) &&
  isOptionalField(value, 'gitBranch', isNonEmptyString) &&
  isOptionalField(value, 'gitDirty', (item) => typeof item === 'boolean') &&
  isOptionalField(value, 'gitStatusUpdatedAt', (item) => typeof item === 'number' && Number.isFinite(item)) &&
  isOptionalField(value, 'launchCommand', isNonEmptyString) &&
  isOptionalField(value, 'resumeCommand', isNonEmptyString) &&
  isOptionalField(value, 'sessionKind', isManagedAiSessionKind) &&
  isOptionalField(value, 'parentSessionId', isNonEmptyString) &&
  isOptionalField(value, 'restorable', (item) => typeof item === 'boolean') &&
  isOptionalField(value, 'processId', isPositiveInteger) &&
  isOptionalField(value, 'parentProcessId', isPositiveInteger) &&
  isOptionalField(value, 'processGroupId', isPositiveInteger) &&
  isOptionalField(value, 'agentLifecycle', isManagedAiSessionLifecycle)

export const isManagedAiSessionDecision = (value: unknown): value is ManagedAiSessionDecision =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  (value.kind === 'allow' || value.kind === 'always' || value.kind === 'bypass' || value.kind === 'deny' || value.kind === 'reply' || value.kind === 'handled') &&
  typeof value.createdAt === 'number'

export const isAgentHibernationConfig = (value: unknown): value is AgentHibernationConfig =>
  isRecord(value) &&
  typeof value.enabled === 'boolean' &&
  isPositiveInteger(value.idleSeconds) &&
  isPositiveInteger(value.maxLiveTerminals) &&
  typeof value.confirmationSeconds === 'number' &&
  Number.isFinite(value.confirmationSeconds) &&
  value.confirmationSeconds >= 0

export const isAgentHibernationConfigData = (value: unknown): value is AgentHibernationConfigData => isRecord(value) && isAgentHibernationConfig(value.config)

export const isManagedAiSessionRecord = (value: unknown): value is ManagedAiSessionRecord =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isAiAgentSessionSource(value.source) &&
  isNonEmptyString(value.title) &&
  typeof value.summary === 'string' &&
  isManagedAiSessionState(value.state) &&
  isAiAgentSessionEventName(value.lastEvent) &&
  isOptionalField(value, 'requestKind', isManagedAiRequestKind) &&
  isOptionalField(value, 'decisionMode', isManagedAiDecisionMode) &&
  typeof value.lastActivityAt === 'number' &&
  typeof value.createdAt === 'number' &&
  typeof value.updatedAt === 'number' &&
  isOptionalField(value, 'waitTimeoutMs', isPositiveInteger) &&
  isOptionalField(value, 'toolName', isNonEmptyString) &&
  isOptionalField(value, 'canonicalCwd', isNonEmptyString) &&
  isOptionalField(value, 'gitBranch', isNonEmptyString) &&
  isOptionalField(value, 'gitDirty', (item) => typeof item === 'boolean') &&
  isOptionalField(value, 'gitStatusUpdatedAt', (item) => typeof item === 'number' && Number.isFinite(item)) &&
  isOptionalField(value, 'launchCommand', isNonEmptyString) &&
  isOptionalField(value, 'resumeCommand', isNonEmptyString) &&
  isOptionalField(value, 'sessionKind', isManagedAiSessionKind) &&
  isOptionalField(value, 'parentSessionId', isNonEmptyString) &&
  isOptionalField(value, 'restorable', (item) => typeof item === 'boolean') &&
  isOptionalField(value, 'processId', isPositiveInteger) &&
  isOptionalField(value, 'parentProcessId', isPositiveInteger) &&
  isOptionalField(value, 'processGroupId', isPositiveInteger) &&
  isOptionalField(value, 'agentLifecycle', isManagedAiSessionLifecycle) &&
  isOptionalField(value, 'terminalProcessId', isPositiveInteger) &&
  isOptionalField(value, 'terminalActivityAt', (item) => typeof item === 'number' && Number.isFinite(item)) &&
  isOptionalField(value, 'hibernated', (item) => typeof item === 'boolean') &&
  isOptionalField(value, 'hibernatedAt', (item) => typeof item === 'number' && Number.isFinite(item)) &&
  isOptionalField(value, 'hibernationReason', isNonEmptyString) &&
  isOptionalField(value, 'hibernatedTerminalSessionId', isNonEmptyString) &&
  Array.isArray(value.events) &&
  value.events.every(isManagedAiSessionTimelineEvent) &&
  Array.isArray(value.decisions) &&
  value.decisions.every(isManagedAiSessionDecision)

export const isManagedAiSessionSnapshot = (value: unknown): value is ManagedAiSessionSnapshot =>
  isRecord(value) && Array.isArray(value.sessions) && value.sessions.every(isManagedAiSessionRecord)

export const isManagedAiSessionMutationData = (value: unknown): value is ManagedAiSessionMutationData =>
  isRecord(value) && isManagedAiSessionSnapshot(value.snapshot) && (value.session === undefined || isManagedAiSessionRecord(value.session))

export const isManagedAiSessionBulkData = (value: unknown): value is ManagedAiSessionBulkData =>
  isRecord(value) && typeof value.changed === 'number' && isManagedAiSessionSnapshot(value.snapshot)

export const isManagedAiSessionHibernateData = (value: unknown): value is ManagedAiSessionHibernateData =>
  isRecord(value) && isManagedAiSessionRecord(value.session) && isManagedAiSessionSnapshot(value.snapshot) && isAgentHibernationConfig(value.config)

export const isManagedAiSessionContentRecord = (value: unknown): value is ManagedAiSessionContentRecord =>
  isRecord(value) &&
  isAiAgentSessionSource(value.source) &&
  isNonEmptyString(value.sessionId) &&
  managedAiContentFormats.has(String(value.format)) &&
  isNonEmptyString(value.recordId) &&
  typeof value.ordinal === 'number' &&
  typeof value.locationLabel === 'string' &&
  managedAiContentRoles.has(String(value.role)) &&
  typeof value.messageType === 'string' &&
  typeof value.content === 'string' &&
  typeof value.contentTruncated === 'boolean' &&
  typeof value.fullLength === 'number' &&
  typeof value.editable === 'boolean' &&
  isOptionalField(value, 'editBlockedReason', (item) => typeof item === 'string') &&
  isNonEmptyString(value.sourceRevision) &&
  isOptionalField(value, 'createdAt', (item) => typeof item === 'number' && Number.isFinite(item))

export const isManagedAiSessionContentSnapshot = (value: unknown): value is ManagedAiSessionContentSnapshot =>
  isRecord(value) &&
  isAiAgentSessionSource(value.source) &&
  isNonEmptyString(value.sessionId) &&
  typeof value.title === 'string' &&
  managedAiContentFormats.has(String(value.format)) &&
  isNonEmptyString(value.sourceRevision) &&
  typeof value.total === 'number' &&
  typeof value.offset === 'number' &&
  typeof value.limit === 'number' &&
  typeof value.editable === 'boolean' &&
  isOptionalField(value, 'editBlockedReason', (item) => typeof item === 'string') &&
  isOptionalField(value, 'sessionState', isManagedAiSessionState) &&
  isOptionalField(value, 'storagePath', (item) => typeof item === 'string') &&
  isOptionalField(value, 'unsupportedReason', (item) => typeof item === 'string') &&
  Array.isArray(value.records) &&
  value.records.every(isManagedAiSessionContentRecord)

export const isManagedAiSessionContentRecordData = (value: unknown): value is ManagedAiSessionContentRecordData =>
  isRecord(value) && isManagedAiSessionContentRecord(value.record)

export const isManagedAiSessionContentDeleteData = (value: unknown): value is ManagedAiSessionContentDeleteData =>
  isRecord(value) &&
  isNonEmptyString(value.recordId) &&
  isNonEmptyString(value.sourceRevision) &&
  isOptionalField(value, 'backupPath', (item) => typeof item === 'string')

export const isAgentHookInstallerStatus = (value: unknown): value is AgentHookInstallerStatus =>
  isRecord(value) &&
  isAgentHookInstallerSource(value.source) &&
  isNonEmptyString(value.label) &&
  isNonEmptyString(value.binaryName) &&
  typeof value.binaryPath === 'string' &&
  isNonEmptyString(value.configPath) &&
  typeof value.configExists === 'boolean' &&
  typeof value.installed === 'boolean' &&
  typeof value.scriptPath === 'string' &&
  Array.isArray(value.warnings) &&
  value.warnings.every((item) => typeof item === 'string') &&
  isOptionalField(value, 'extraConfigPath', isNonEmptyString) &&
  isOptionalField(value, 'error', isNonEmptyString)

export const isAgentHookInstallerSnapshot = (value: unknown): value is AgentHookInstallerSnapshot =>
  isRecord(value) && Array.isArray(value.installers) && value.installers.every(isAgentHookInstallerStatus)

export const isAgentHookInstallOperationData = (value: unknown): value is AgentHookInstallOperationData =>
  isRecord(value) &&
  (value.operation === 'install' || value.operation === 'uninstall') &&
  isAgentHookInstallerSource(value.source) &&
  isAgentHookInstallerStatus(value.status) &&
  isAgentHookInstallerSnapshot(value.snapshot)

export const isExportMcpBridgeStatus = (value: unknown): value is ExportMcpBridgeStatus =>
  isRecord(value) &&
  typeof value.enabled === 'boolean' &&
  typeof value.listening === 'boolean' &&
  typeof value.tokenConfigured === 'boolean' &&
  isNonEmptyString(value.socketPath) &&
  isNonEmptyString(value.serverName)

export const isExportMcpClientStatus = (value: unknown): value is ExportMcpClientStatus =>
  isRecord(value) &&
  isExportMcpClientSource(value.source) &&
  isNonEmptyString(value.label) &&
  isNonEmptyString(value.binaryName) &&
  typeof value.binaryPath === 'string' &&
  isNonEmptyString(value.configPath) &&
  typeof value.configExists === 'boolean' &&
  typeof value.installed === 'boolean' &&
  typeof value.scriptPath === 'string' &&
  typeof value.runtimePath === 'string' &&
  isNonEmptyString(value.serverName) &&
  isExportMcpBridgeStatus(value.bridge) &&
  Array.isArray(value.warnings) &&
  value.warnings.every((item) => typeof item === 'string') &&
  isOptionalField(value, 'error', isNonEmptyString)

export const isExportMcpInstallerSnapshot = (value: unknown): value is ExportMcpInstallerSnapshot =>
  isRecord(value) && isExportMcpBridgeStatus(value.bridge) && Array.isArray(value.clients) && value.clients.every(isExportMcpClientStatus)

export const isExportMcpInstallOperationData = (value: unknown): value is ExportMcpInstallOperationData =>
  isRecord(value) &&
  (value.operation === 'install' || value.operation === 'uninstall') &&
  isExportMcpClientSource(value.source) &&
  isExportMcpClientStatus(value.status) &&
  isExportMcpInstallerSnapshot(value.snapshot)
