import type { ModelProviderCheckKey } from '@shared/contracts/appRuntime'
import type { TerminalCommandGenerationContext, TerminalCommandGenerationRecord } from '@shared/contracts/terminalTools'
import type {
  TerminalDisconnectReason,
  TerminalExitEvent,
  TerminalLifecycleEvent,
  TerminalLifecycleStage,
  TerminalSessionInfo,
  TerminalSshConnectionInfo
} from '@shared/contracts/terminalSessions'

export const malformedTerminalWriteResultMessage = '终端写入服务返回数据无效'

export type TerminalWriteResultLike = {
  ok?: boolean
  data?: unknown
  errorMessage?: string
}

export type TerminalWriteValidation = { ok: true } | { ok: false; reason: string }

const terminalLifecycleStages: TerminalLifecycleStage[] = ['starting', 'connecting', 'proxy-opening', 'connected', 'shell-ready', 'error', 'closed']
const terminalDisconnectReasons: TerminalDisconnectReason[] = ['manual', 'network', 'process', 'error', 'unknown']
const aiProviderKeys: Array<'aiopsterm-local' | ModelProviderCheckKey> = ['aiopsterm-local', 'litellm', 'openai', 'bedrock', 'deepseek', 'anthropic', 'ollama']

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const isNonNegativeFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isPositiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0
const hasOwnField = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key)
const isOptionalField = (record: Record<string, unknown>, key: string, guard: (value: unknown) => boolean) =>
  !hasOwnField(record, key) || record[key] === undefined || guard(record[key])
const isTerminalKind = (value: unknown): value is 'local' | 'ssh' => value === 'local' || value === 'ssh'
const isTerminalExitCode = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))
export const isTerminalPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535
const isTerminalDisconnectReason = (value: unknown): value is TerminalDisconnectReason =>
  terminalDisconnectReasons.includes(value as TerminalDisconnectReason)
const isOptionalNonEmptyString = (record: Record<string, unknown>, key: string) => isOptionalField(record, key, isNonEmptyString)
const isAiProviderKey = (value: unknown): value is 'aiopsterm-local' | ModelProviderCheckKey => typeof value === 'string' && aiProviderKeys.includes(value as 'aiopsterm-local' | ModelProviderCheckKey)

export const isTerminalCommandGenerationContext = (source: unknown): source is TerminalCommandGenerationContext =>
  isRecord(source) &&
  isNonEmptyString(source.host) &&
  isNonEmptyString(source.username) &&
  typeof source.cwd === 'string' &&
  isNonEmptyString(source.shell) &&
  (source.connectionType === 'local' || source.connectionType === 'ssh')

export const isTerminalCommandGenerationRecord = (source: unknown): source is TerminalCommandGenerationRecord =>
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

export const isTerminalLifecycleEvent = (value: unknown, expectedId?: string, expectedKind?: 'local' | 'ssh'): value is TerminalLifecycleEvent => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
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
    isOptionalField(value, 'processId', isPositiveInteger) &&
    isOptionalField(value, 'processGroupId', isPositiveInteger) &&
    isOptionalNonEmptyString(value, 'shell') &&
    isOptionalNonEmptyString(value, 'cwd') &&
    isOptionalNonEmptyString(value, 'host') &&
    isOptionalField(value, 'port', isTerminalPort) &&
    isOptionalNonEmptyString(value, 'username') &&
    isOptionalNonEmptyString(value, 'targetHost') &&
    isOptionalField(value, 'targetPort', isTerminalPort) &&
    isOptionalNonEmptyString(value, 'targetUsername') &&
    isOptionalNonEmptyString(value, 'jumpHost') &&
    isOptionalField(value, 'jumpPort', isTerminalPort) &&
    isOptionalNonEmptyString(value, 'jumpUsername') &&
    isOptionalField(value, 'authScope', (field) => field === 'target' || field === 'jump') &&
    isOptionalField(value, 'authPurpose', (field) => field === 'password' || field === 'keyboard-interactive') &&
    isOptionalField(value, 'sshTransport', (field) => field === 'direct' || field === 'proxy' || field === 'jump' || field === 'relay-shell') &&
    isOptionalNonEmptyString(value, 'sshAuthMethods') &&
    isOptionalField(value, 'connectionReuse', (field) => field === 'created' || field === 'reused') &&
    isOptionalField(value, 'remoteHop', (field) => field === 'relay' || field === 'target' || field === 'unknown') &&
    isOptionalNonEmptyString(value, 'expectedHost') &&
    isOptionalNonEmptyString(value, 'actualHost') &&
    isOptionalNonEmptyString(value, 'actualUsername') &&
    isOptionalField(value, 'endpointConfidence', (field) => field === 'confirmed' || field === 'inferred' || field === 'unknown') &&
    isOptionalNonEmptyString(value, 'connectionId') &&
    isOptionalNonEmptyString(value, 'proxyName') &&
    isOptionalNonEmptyString(value, 'message') &&
    isOptionalField(value, 'code', isTerminalExitCode) &&
    isOptionalField(value, 'reason', isTerminalDisconnectReason) &&
    isOptionalField(value, 'isNetworkDisconnect', (field) => typeof field === 'boolean') &&
    isOptionalNonEmptyString(value, 'errorCode') &&
    isOptionalNonEmptyString(value, 'errorMessage')
  )
}

export const isTerminalExitEvent = (value: unknown): value is TerminalExitEvent => {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isTerminalExitCode(value.code)) return false
  return (
    isOptionalField(value, 'kind', isTerminalKind) &&
    isOptionalField(value, 'reason', isTerminalDisconnectReason) &&
    isOptionalField(value, 'isNetworkDisconnect', (field) => typeof field === 'boolean') &&
    isOptionalNonEmptyString(value, 'errorCode') &&
    isOptionalNonEmptyString(value, 'errorMessage')
  )
}

export const isLocalTerminalSessionInfo = (value: unknown): value is TerminalSessionInfo =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  value.kind === 'local' &&
  isNonEmptyString(value.shell) &&
  isNonEmptyString(value.cwd) &&
  (value.lifecycle === undefined || isTerminalLifecycleEvent(value.lifecycle, value.id, 'local'))

export const isSshTerminalSessionInfo = (value: unknown): value is TerminalSessionInfo & { connection: TerminalSshConnectionInfo } => {
  if (!isRecord(value) || !isNonEmptyString(value.id) || value.kind !== 'ssh' || !isNonEmptyString(value.shell) || !isNonEmptyString(value.cwd)) return false
  if (value.lifecycle !== undefined && !isTerminalLifecycleEvent(value.lifecycle, value.id, 'ssh')) return false
  const connection = value.connection
  return (
    isRecord(connection) &&
    isNonEmptyString(connection.connectionId) &&
    isNonEmptyString(connection.host) &&
    isTerminalPort(connection.port) &&
    isNonEmptyString(connection.username) &&
    isNonEmptyString(connection.assetName) &&
    typeof connection.createdAt === 'number' &&
    Number.isFinite(connection.createdAt)
  )
}

export const terminalWriteByteLength = (data: string) => new TextEncoder().encode(data).length

export const isTerminalWriteResultData = (value: unknown, sessionId: string, data: string) =>
  isRecord(value) &&
  value.id === sessionId &&
  typeof value.bytes === 'number' &&
  Number.isInteger(value.bytes) &&
  value.bytes >= 0 &&
  value.bytes === terminalWriteByteLength(data)

const terminalWriteFailureReason = (result?: TerminalWriteResultLike) => result?.errorMessage || '终端写入失败，请重新打开本地 shell 或连接 SSH'

export const terminalWriteExceptionReason = (error: unknown) =>
  error instanceof Error && error.message.trim() ? error.message.trim() : '终端写入失败，请重新打开本地 shell 或连接 SSH'

export const validateTerminalWriteResult = (result: unknown, sessionId: string, data: string): TerminalWriteValidation => {
  if (!isRecord(result)) return { ok: false, reason: malformedTerminalWriteResultMessage }
  if (result.ok === false) return { ok: false, reason: terminalWriteFailureReason(result as TerminalWriteResultLike) }
  if (result.ok !== true || !isTerminalWriteResultData(result.data, sessionId, data)) {
    return { ok: false, reason: malformedTerminalWriteResultMessage }
  }
  return { ok: true }
}
