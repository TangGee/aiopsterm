import type { AiopsAssetRecord } from '@shared/contracts/assets'
import type {
  TerminalCreateOptions,
  TerminalBinaryWriteResult,
  TerminalDataEvent,
  TerminalDisconnectReason,
  TerminalKillResult,
  TerminalLifecycleEvent,
  TerminalSshConnectionInfo,
  TerminalWriteResult
} from '@shared/contracts/terminalSessions'

export type SshTerminalConnectionTarget = {
  asset?: Partial<
    Pick<AiopsAssetRecord, 'id' | 'name' | 'title' | 'asset_type' | 'organizationId' | 'group_name' | 'auth_type' | 'needProxy' | 'proxyName' | 'jumpHostId'>
  > | null
  host: string
  port: number
  username: string
  title?: string
}

export type SshConnectionErrorContext = {
  authType?: string
  hasPassword?: boolean
  hasPrivateKey?: boolean
  hasAgent?: boolean
  tryKeyboard?: boolean
  username?: string
  host?: string
  port?: number
}

export type SshConnectionErrorDiagnosis = {
  errorCode: string
  errorMessage: string
  reason: TerminalDisconnectReason
  isNetworkDisconnect: boolean
}

export type TerminalBackgroundCommandOptions = {
  command: string
  cwd?: string
  timeoutMs: number
  maxOutputBytes?: number
}

export type TerminalBackgroundCommandResult = {
  output: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  outputTruncated?: boolean
}

const cleanOptional = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

const terminalNetworkErrorCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ECONNABORTED'
])

const cleanTerminalErrorCode = (value: unknown): string | undefined => {
  const text = cleanOptional(value)
  return text ? text.toUpperCase() : undefined
}

const terminalErrorMessage = (error: unknown): string => {
  const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : {}
  return cleanOptional(error instanceof Error ? error.message : record.message || error) || 'Terminal session failed.'
}

export const isLikelyTerminalNetworkError = (error: unknown): boolean => {
  const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : {}
  const code = cleanTerminalErrorCode(record.code || record.errno)
  if (code && terminalNetworkErrorCodes.has(code)) return true
  const message = terminalErrorMessage(error)
  return Boolean(message && /(connection|network|timeout|timed out|reset|refused|unreachable|broken pipe|socket)/i.test(message))
}

const sshErrorOriginalSuffix = (message: string, fallback = '') => {
  const original = cleanOptional(message) || fallback
  if (!original) return ''
  return `（原始错误：${original.slice(0, 240)}）`
}

const sshAuthMethodsFromPermissionDenied = (message: string) => {
  const match = message.match(/Permission denied\s*\(([^)]+)\)/i)
  if (!match) return []
  return match[1]
    .split(/[,\s]+/)
    .map((method) => method.trim().toLowerCase())
    .filter(Boolean)
}

const normalizeSshAuthType = (value: unknown) => cleanOptional(value)?.toLowerCase() || ''

const cleanTerminalAuthScope = (value: unknown): TerminalLifecycleEvent['authScope'] | undefined => {
  const text = cleanOptional(value)
  return text === 'target' || text === 'jump' ? text : undefined
}

const cleanTerminalAuthPurpose = (value: unknown): TerminalLifecycleEvent['authPurpose'] | undefined => {
  const text = cleanOptional(value)
  return text === 'password' || text === 'keyboard-interactive' ? text : undefined
}

const cleanTerminalSshTransport = (value: unknown): TerminalLifecycleEvent['sshTransport'] | undefined => {
  const text = cleanOptional(value)
  return text === 'direct' || text === 'proxy' || text === 'jump' || text === 'relay-shell' ? text : undefined
}

const cleanTerminalConnectionReuse = (value: unknown): TerminalLifecycleEvent['connectionReuse'] | undefined => {
  const text = cleanOptional(value)
  return text === 'created' || text === 'reused' ? text : undefined
}

const cleanTerminalRemoteHop = (value: unknown): TerminalLifecycleEvent['remoteHop'] | undefined => {
  const text = cleanOptional(value)
  return text === 'relay' || text === 'target' || text === 'unknown' ? text : undefined
}

const cleanTerminalEndpointConfidence = (value: unknown): TerminalLifecycleEvent['endpointConfidence'] | undefined => {
  const text = cleanOptional(value)
  return text === 'confirmed' || text === 'inferred' || text === 'unknown' ? text : undefined
}

const cleanPositiveInteger = (value: unknown) => {
  if (!Number.isFinite(value)) return undefined
  const normalized = Math.floor(Number(value))
  return normalized > 0 ? normalized : undefined
}

export const diagnoseSshConnectionError = (error: unknown, context: SshConnectionErrorContext = {}): SshConnectionErrorDiagnosis => {
  const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : {}
  const rawMessage = terminalErrorMessage(error)
  const normalizedMessage = rawMessage.toLowerCase()
  const rawCode = cleanTerminalErrorCode(record.code || record.errno)
  const level = normalizeSshAuthType(record.level)
  const authType = normalizeSshAuthType(context.authType)
  const hasPassword = Boolean(context.hasPassword) || authType === 'password'
  const hasPrivateKey = Boolean(context.hasPrivateKey) || authType === 'keybased'
  const hasAgent = Boolean(context.hasAgent)
  const usesKeyAuth = hasPrivateKey || hasAgent
  const permissionMethods = sshAuthMethodsFromPermissionDenied(rawMessage)
  const permissionHasPassword = permissionMethods.some((method) => /password|keyboard-interactive/.test(method))
  const permissionHasPublicKey = permissionMethods.some((method) => /publickey|hostbased/.test(method))
  const clientAuthFailure =
    level === 'client-authentication' ||
    /all configured authentication methods failed|configured authentication methods failed|permission denied|authentication failed|unable to authenticate|auth fail|no supported authentication methods|no configured authentication methods|too many authentication failures|connection closed before ready/i.test(
      rawMessage
    )
  const passwordDisabled =
    hasPassword &&
    (/password authentication.*disabled|password.*authentication.*disabled|password.*not allowed|password.*not permitted|server.*does not allow.*password|no supported authentication methods.*password/i.test(
      rawMessage
    ) ||
      (permissionMethods.length > 0 && permissionHasPublicKey && !permissionHasPassword) ||
      /permission denied\s*\(\s*publickey\s*\)/i.test(rawMessage))

  if (clientAuthFailure) {
    if (/no supported authentication methods|no configured authentication methods/i.test(rawMessage) && !hasPassword && !usesKeyAuth && !context.tryKeyboard) {
      return {
        errorCode: 'SSH_AUTH_METHOD_UNAVAILABLE',
        errorMessage: `SSH 登录失败：没有可用的认证方式。请为该主机配置密码、KeyChain/私钥或启用 SSH Agent。${sshErrorOriginalSuffix(rawMessage)}`,
        reason: 'error',
        isNetworkDisconnect: false
      }
    }
    if (passwordDisabled) {
      return {
        errorCode: 'SSH_AUTH_PASSWORD_DISABLED',
        errorMessage: `SSH 登录失败：服务器未开放密码登录，当前账号可能只允许密钥登录。请改用 KeyChain/私钥，或让服务器开启 PasswordAuthentication。${sshErrorOriginalSuffix(rawMessage)}`,
        reason: 'error',
        isNetworkDisconnect: false
      }
    }
    if (hasPassword) {
      return {
        errorCode: 'SSH_AUTH_PASSWORD_REJECTED',
        errorMessage: `SSH 登录失败：用户名或密码不正确，或该账号不允许密码登录。请检查用户名、密码和服务器 SSHD 配置。${sshErrorOriginalSuffix(rawMessage)}`,
        reason: 'error',
        isNetworkDisconnect: false
      }
    }
    if (usesKeyAuth || permissionHasPublicKey || /publickey|private key|key exchange|key/i.test(normalizedMessage)) {
      return {
        errorCode: 'SSH_AUTH_KEY_REJECTED',
        errorMessage: `SSH 登录失败：服务器拒绝当前密钥。请检查 KeyChain/私钥、公钥是否已加入服务器 authorized_keys，以及用户名是否正确。${sshErrorOriginalSuffix(rawMessage)}`,
        reason: 'error',
        isNetworkDisconnect: false
      }
    }
    return {
      errorCode: 'SSH_AUTH_FAILED',
      errorMessage: `SSH 登录失败：认证未通过。请检查用户名、认证方式、密码/密钥和服务器 SSHD 配置。${sshErrorOriginalSuffix(rawMessage)}`,
      reason: 'error',
      isNetworkDisconnect: false
    }
  }

  const isNetworkDisconnect = isLikelyTerminalNetworkError(error)
  return {
    errorCode: rawCode || (isNetworkDisconnect ? 'SSH_NETWORK_ERROR' : 'SSH_CONNECTION_FAILED'),
    errorMessage: rawMessage,
    reason: isNetworkDisconnect ? 'network' : 'error',
    isNetworkDisconnect
  }
}

export const createTerminalLifecycleEvent = (
  id: string,
  event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number },
  at = Date.now()
): TerminalLifecycleEvent => {
  const sessionId = cleanOptional(id) || ''
  const errorCode = cleanTerminalErrorCode(event.errorCode)
  const reason = cleanOptional(event.reason) as TerminalDisconnectReason | undefined
  const authScope = cleanTerminalAuthScope(event.authScope)
  const authPurpose = cleanTerminalAuthPurpose(event.authPurpose)
  const sshTransport = cleanTerminalSshTransport(event.sshTransport)
  const connectionReuse = cleanTerminalConnectionReuse(event.connectionReuse)
  const remoteHop = cleanTerminalRemoteHop(event.remoteHop)
  const endpointConfidence = cleanTerminalEndpointConfidence(event.endpointConfidence)
  return {
    id: sessionId,
    kind: event.kind,
    stage: event.stage,
    at: Number.isFinite(event.at) ? Number(event.at) : at,
    ...(cleanPositiveInteger(event.processId) ? { processId: cleanPositiveInteger(event.processId) } : {}),
    ...(cleanPositiveInteger(event.processGroupId) ? { processGroupId: cleanPositiveInteger(event.processGroupId) } : {}),
    ...(cleanOptional(event.shell) ? { shell: cleanOptional(event.shell) } : {}),
    ...(cleanOptional(event.cwd) ? { cwd: cleanOptional(event.cwd) } : {}),
    ...(cleanOptional(event.host) ? { host: cleanOptional(event.host) } : {}),
    ...(Number.isFinite(event.port) ? { port: Math.max(1, Math.min(65535, Math.round(Number(event.port)))) } : {}),
    ...(cleanOptional(event.username) ? { username: cleanOptional(event.username) } : {}),
    ...(cleanOptional(event.targetHost) ? { targetHost: cleanOptional(event.targetHost) } : {}),
    ...(Number.isFinite(event.targetPort) ? { targetPort: Math.max(1, Math.min(65535, Math.round(Number(event.targetPort)))) } : {}),
    ...(cleanOptional(event.targetUsername) ? { targetUsername: cleanOptional(event.targetUsername) } : {}),
    ...(cleanOptional(event.jumpHost) ? { jumpHost: cleanOptional(event.jumpHost) } : {}),
    ...(Number.isFinite(event.jumpPort) ? { jumpPort: Math.max(1, Math.min(65535, Math.round(Number(event.jumpPort)))) } : {}),
    ...(cleanOptional(event.jumpUsername) ? { jumpUsername: cleanOptional(event.jumpUsername) } : {}),
    ...(authScope ? { authScope } : {}),
    ...(authPurpose ? { authPurpose } : {}),
    ...(sshTransport ? { sshTransport } : {}),
    ...(cleanOptional(event.sshAuthMethods) ? { sshAuthMethods: cleanOptional(event.sshAuthMethods) } : {}),
    ...(connectionReuse ? { connectionReuse } : {}),
    ...(remoteHop ? { remoteHop } : {}),
    ...(cleanOptional(event.expectedHost) ? { expectedHost: cleanOptional(event.expectedHost) } : {}),
    ...(cleanOptional(event.actualHost) ? { actualHost: cleanOptional(event.actualHost) } : {}),
    ...(cleanOptional(event.actualUsername) ? { actualUsername: cleanOptional(event.actualUsername) } : {}),
    ...(endpointConfidence ? { endpointConfidence } : {}),
    ...(cleanOptional(event.connectionId) ? { connectionId: cleanOptional(event.connectionId) } : {}),
    ...(cleanOptional(event.proxyName) ? { proxyName: cleanOptional(event.proxyName) } : {}),
    ...(cleanOptional(event.message) ? { message: cleanOptional(event.message) } : {}),
    ...(event.code === null || Number.isFinite(event.code) ? { code: event.code === null ? null : Number(event.code) } : {}),
    ...(reason ? { reason } : {}),
    ...(event.isNetworkDisconnect === undefined ? {} : { isNetworkDisconnect: Boolean(event.isNetworkDisconnect) }),
    ...(errorCode ? { errorCode } : {}),
    ...(cleanOptional(event.errorMessage) ? { errorMessage: cleanOptional(event.errorMessage) } : {})
  }
}

export const createTerminalErrorLifecycleEvent = (
  id: string,
  kind: TerminalLifecycleEvent['kind'],
  error: unknown,
  event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> = {},
  at = Date.now()
): TerminalLifecycleEvent => {
  const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : {}
  const errorCode = cleanTerminalErrorCode(event.errorCode) || cleanTerminalErrorCode(record.code || record.errno)
  const errorMessage = cleanOptional(event.errorMessage) || terminalErrorMessage(error)
  const isNetworkDisconnect = event.isNetworkDisconnect === undefined ? isLikelyTerminalNetworkError(error) : Boolean(event.isNetworkDisconnect)
  const reason = (cleanOptional(event.reason) as TerminalDisconnectReason | undefined) || (isNetworkDisconnect ? 'network' : 'error')
  return createTerminalLifecycleEvent(
    id,
    {
      ...event,
      kind,
      stage: 'error',
      reason,
      isNetworkDisconnect,
      ...(errorCode ? { errorCode } : {}),
      errorMessage
    },
    at
  )
}

export const createSshTerminalConnectionInfo = (
  terminalId: string,
  target: SshTerminalConnectionTarget,
  options: TerminalCreateOptions = {},
  createdAt = Date.now()
): TerminalSshConnectionInfo => {
  const asset = target.asset || null
  const host = cleanOptional(target.host) || ''
  const username = cleanOptional(target.username) || ''
  const title = cleanOptional(target.title) || cleanOptional(asset?.name) || cleanOptional(asset?.title) || host
  return {
    connectionId: `ssh-${terminalId}`,
    host,
    port: Number.isFinite(target.port) ? Math.max(1, Math.min(65535, Math.round(target.port))) : 22,
    username,
    ...(cleanOptional(asset?.id) || cleanOptional(options.assetId) ? { assetId: cleanOptional(asset?.id) || cleanOptional(options.assetId) } : {}),
    assetName: title || host || username || 'ssh',
    ...(cleanOptional(asset?.asset_type) ? { assetType: cleanOptional(asset?.asset_type) } : {}),
    ...(cleanOptional(asset?.organizationId) || cleanOptional(asset?.group_name)
      ? { organizationId: cleanOptional(asset?.organizationId) || cleanOptional(asset?.group_name) }
      : {}),
    ...(cleanOptional(asset?.auth_type) ? { authType: cleanOptional(asset?.auth_type) } : {}),
    ...(cleanOptional(asset?.jumpHostId) || cleanOptional(options.ssh?.jumpHostId)
      ? { jumpHostId: cleanOptional(asset?.jumpHostId) || cleanOptional(options.ssh?.jumpHostId) }
      : {}),
    ...(asset?.needProxy ? { needProxy: true } : {}),
    ...(asset?.needProxy && cleanOptional(asset?.proxyName) ? { proxyName: cleanOptional(asset?.proxyName) } : {}),
    ...(title ? { title } : {}),
    createdAt,
    ...(cleanOptional(options.ssh?.forkFromConnectionId) ? { forkFromConnectionId: cleanOptional(options.ssh?.forkFromConnectionId) } : {})
  }
}

export const createTerminalWriteResult = (id: string, data: string, exists: boolean): TerminalWriteResult => {
  const sessionId = cleanOptional(id) || ''
  if (!sessionId || !exists) {
    return {
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    }
  }
  return {
    ok: true,
    data: {
      id: sessionId,
      bytes: Buffer.byteLength(String(data || ''), 'utf8')
    }
  }
}

export const createTerminalBinaryWriteResult = (id: string, bytes: number, exists: boolean): TerminalBinaryWriteResult => {
  const sessionId = cleanOptional(id) || ''
  if (!sessionId || !exists) {
    return {
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    }
  }
  return {
    ok: true,
    data: {
      id: sessionId,
      bytes: Math.max(0, Math.floor(Number(bytes) || 0))
    }
  }
}

export const createTerminalDataEvent = (id: string, chunk: string | Buffer, options?: { includeRaw?: boolean }): TerminalDataEvent => {
  const event: TerminalDataEvent = {
    id: cleanOptional(id) || '',
    data: Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
  }
  // raw 仅供 ZMODEM 检测消费:字符串 chunk 的字节可由 data 无损重建,只有二进制 Buffer 需要附带;
  // 独立拷贝为 Uint8Array,避免结构化克隆携带 Buffer 池的整个底层 ArrayBuffer。
  if (options?.includeRaw && Buffer.isBuffer(chunk)) event.raw = new Uint8Array(chunk)
  return event
}

export const createTerminalKillResult = (id: string, exists: boolean): TerminalKillResult => {
  const sessionId = cleanOptional(id) || ''
  if (!sessionId || !exists) {
    return {
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    }
  }
  return {
    ok: true,
    data: {
      id: sessionId
    }
  }
}
