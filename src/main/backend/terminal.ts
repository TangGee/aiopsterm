import type {
  AiopsAssetRecord,
  TerminalCreateOptions,
  TerminalBinaryWriteResult,
  TerminalDataEvent,
  TerminalDisconnectReason,
  TerminalKillResult,
  TerminalLifecycleEvent,
  TerminalWriteResult,
  TerminalSshConnectionInfo
} from '@shared/preload'

export type SshTerminalConnectionTarget = {
  asset?: Partial<
    Pick<AiopsAssetRecord, 'id' | 'name' | 'title' | 'asset_type' | 'organizationId' | 'group_name' | 'auth_type' | 'needProxy' | 'proxyName'>
  > | null
  host: string
  port: number
  username: string
  title?: string
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

export const isLikelyTerminalNetworkError = (error: unknown): boolean => {
  const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : {}
  const code = cleanTerminalErrorCode(record.code || record.errno)
  if (code && terminalNetworkErrorCodes.has(code)) return true
  const message = cleanOptional(error instanceof Error ? error.message : record.message || error)
  return Boolean(message && /(connection|network|timeout|timed out|reset|refused|unreachable|broken pipe|socket)/i.test(message))
}

export const createTerminalLifecycleEvent = (
  id: string,
  event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number },
  at = Date.now()
): TerminalLifecycleEvent => {
  const sessionId = cleanOptional(id) || ''
  const errorCode = cleanTerminalErrorCode(event.errorCode)
  const reason = cleanOptional(event.reason) as TerminalDisconnectReason | undefined
  return {
    id: sessionId,
    kind: event.kind,
    stage: event.stage,
    at: Number.isFinite(event.at) ? Number(event.at) : at,
    ...(cleanOptional(event.shell) ? { shell: cleanOptional(event.shell) } : {}),
    ...(cleanOptional(event.cwd) ? { cwd: cleanOptional(event.cwd) } : {}),
    ...(cleanOptional(event.host) ? { host: cleanOptional(event.host) } : {}),
    ...(Number.isFinite(event.port) ? { port: Math.max(1, Math.min(65535, Math.round(Number(event.port)))) } : {}),
    ...(cleanOptional(event.username) ? { username: cleanOptional(event.username) } : {}),
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
  event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at' | 'reason' | 'isNetworkDisconnect' | 'errorCode' | 'errorMessage'>> = {},
  at = Date.now()
): TerminalLifecycleEvent => {
  const record = typeof error === 'object' && error ? (error as Record<string, unknown>) : {}
  const errorCode = cleanTerminalErrorCode(record.code || record.errno)
  const errorMessage = cleanOptional(error instanceof Error ? error.message : record.message || error) || 'Terminal session failed.'
  const isNetworkDisconnect = isLikelyTerminalNetworkError(error)
  return createTerminalLifecycleEvent(
    id,
    {
      ...event,
      kind,
      stage: 'error',
      reason: isNetworkDisconnect ? 'network' : 'error',
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

export const createTerminalDataEvent = (id: string, chunk: string | Buffer): TerminalDataEvent => {
  const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8')
  return {
    id: cleanOptional(id) || '',
    data: Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || ''),
    raw: Array.from(raw)
  }
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
