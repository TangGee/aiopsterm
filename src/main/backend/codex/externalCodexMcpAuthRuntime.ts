import type { ExternalCodexMcpResponse } from '@shared/contracts/control'
import type {
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult
} from '@shared/contracts/terminalSessions'
import type { UserConfig } from '@shared/contracts/userConfig'

export type ExternalMcpAuthMessageKey =
  | 'externalMcp.auth.required.openAiopsterm'
  | 'externalMcp.auth.agentSubmitDisabled'
  | 'externalMcp.auth.requestNotFound'
  | 'externalMcp.auth.requestNotPending'
  | 'externalMcp.auth.responseRequired'
  | 'externalMcp.auth.submitted'
  | 'externalMcp.auth.canceled'
  | 'externalMcp.auth.focused'
  | 'externalMcp.auth.focusUnavailable'

export type ExternalCodexMcpAuthRequestSnapshot = {
  authRequestId: string
  connectionId: string
  assetId?: string
  host: string
  port: number
  username: string
  title?: string
  purpose: 'password' | 'keyboard-interactive'
  authScope: 'target' | 'jump'
  prompts: Array<{ prompt: string; echo: boolean }>
  attempts: number
  maxAttempts: number
  timeoutMs: number
  createdAt: number
  expiresAt: number
  status: 'pending' | 'submitted' | 'success' | 'failed' | 'canceled' | 'timeout'
  errorMessage?: string
  agentSideAuthAvailable: true
  agentSideAuthEnabled: boolean
}

type ExternalCodexMcpAuthRuntimeConfig = {
  getConfig?: () => Pick<UserConfig, 'language' | 'exportMcp'> | UserConfig
  requestInAppAuth?: (request: TerminalKeyboardInteractiveRequest) => Promise<TerminalKeyboardInteractiveResponse>
  sendInAppAuthResult?: (result: TerminalKeyboardInteractiveResult) => void
  dismissInAppAuth?: (id: string, message?: string) => void
  focusInAppAuth?: (request: TerminalKeyboardInteractiveRequest) => boolean | void
}

type ExternalCodexMcpAuthRecord = {
  snapshot: ExternalCodexMcpAuthRequestSnapshot
  request: TerminalKeyboardInteractiveRequest
  resolve: (response: TerminalKeyboardInteractiveResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type ExternalCodexMcpAuthListener = (snapshot: ExternalCodexMcpAuthRequestSnapshot) => void

const authRequests = new Map<string, ExternalCodexMcpAuthRecord>()
const authListeners = new Set<ExternalCodexMcpAuthListener>()
let runtimeConfig: ExternalCodexMcpAuthRuntimeConfig = {}

const messages: Record<ExternalMcpAuthMessageKey, { zhCN: string; zhTW: string; enUS: string }> = {
  'externalMcp.auth.required.openAiopsterm': {
    zhCN:
      'SSH 认证需要在 aiopsterm 中完成。请切回 aiopsterm，在弹出的认证窗口里输入 {target} 的认证信息；如需让外部 Agent 代填，可在 设置 -> 导出 MCP 开启“允许外部 Agent 提交 SSH 认证信息”。',
    zhTW:
      'SSH 認證需要在 aiopsterm 中完成。請切回 aiopsterm，在彈出的認證視窗裡輸入 {target} 的認證資訊；如需讓外部 Agent 代填，可在 設定 -> 匯出 MCP 開啟「允許外部 Agent 提交 SSH 認證資訊」。',
    enUS:
      'SSH authentication must be completed in aiopsterm. Switch to aiopsterm and enter the authentication response for {target} in the prompt. To let an external Agent submit it, enable "Allow external Agents to submit SSH authentication" in Settings -> Export MCP.'
  },
  'externalMcp.auth.agentSubmitDisabled': {
    zhCN:
      '外部 Agent 提交 SSH 认证信息当前未启用。请在 aiopsterm 的 设置 -> 导出 MCP 开启“允许外部 Agent 提交 SSH 认证信息”，或直接回到 aiopsterm 完成认证。',
    zhTW:
      '外部 Agent 提交 SSH 認證資訊目前未啟用。請在 aiopsterm 的 設定 -> 匯出 MCP 開啟「允許外部 Agent 提交 SSH 認證資訊」，或直接回到 aiopsterm 完成認證。',
    enUS:
      'External Agent SSH authentication submission is disabled. Enable "Allow external Agents to submit SSH authentication" in aiopsterm Settings -> Export MCP, or complete authentication in aiopsterm.'
  },
  'externalMcp.auth.requestNotFound': {
    zhCN: '未找到 SSH 认证请求，可能已经完成、取消或超时。',
    zhTW: '未找到 SSH 認證請求，可能已經完成、取消或逾時。',
    enUS: 'SSH authentication request was not found. It may have completed, been canceled, or timed out.'
  },
  'externalMcp.auth.requestNotPending': {
    zhCN: 'SSH 认证请求当前不可提交，状态为 {status}。',
    zhTW: 'SSH 認證請求目前不可提交，狀態為 {status}。',
    enUS: 'SSH authentication request cannot be submitted while its status is {status}.'
  },
  'externalMcp.auth.responseRequired': {
    zhCN: 'SSH 认证响应不能为空。',
    zhTW: 'SSH 認證回應不能為空。',
    enUS: 'SSH authentication response must not be empty.'
  },
  'externalMcp.auth.submitted': {
    zhCN: 'SSH 认证信息已提交给 aiopsterm。',
    zhTW: 'SSH 認證資訊已提交給 aiopsterm。',
    enUS: 'SSH authentication response was submitted to aiopsterm.'
  },
  'externalMcp.auth.canceled': {
    zhCN: 'SSH 认证请求已取消。',
    zhTW: 'SSH 認證請求已取消。',
    enUS: 'SSH authentication request was canceled.'
  },
  'externalMcp.auth.focused': {
    zhCN: '已请求 aiopsterm 聚焦 SSH 认证窗口。',
    zhTW: '已請求 aiopsterm 聚焦 SSH 認證視窗。',
    enUS: 'Requested aiopsterm to focus the SSH authentication prompt.'
  },
  'externalMcp.auth.focusUnavailable': {
    zhCN: 'aiopsterm 认证窗口暂时不可聚焦，请手动切回 aiopsterm。',
    zhTW: 'aiopsterm 認證視窗暫時不可聚焦，請手動切回 aiopsterm。',
    enUS: 'The aiopsterm authentication prompt cannot be focused right now. Switch to aiopsterm manually.'
  }
}

const cleanText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const currentLanguage = () => {
  try {
    return cleanText(runtimeConfig.getConfig?.().language)
  } catch {
    return ''
  }
}

const currentMessageLocale = () => {
  const language = currentLanguage().toLowerCase()
  if (language === 'zh-tw' || language.includes('hant') || language.includes('hk')) return 'zhTW'
  if (language === 'en-us' || language.startsWith('en')) return 'enUS'
  return 'zhCN'
}

export const localizeExternalMcpAuthMessage = (key: ExternalMcpAuthMessageKey, params: Record<string, string | number> = {}) => {
  const template = messages[key][currentMessageLocale()] || messages[key].zhCN
  return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template)
}

export const externalMcpAuthMessageData = (key: ExternalMcpAuthMessageKey, params: Record<string, string | number> = {}) => {
  const message = localizeExternalMcpAuthMessage(key, params)
  return {
    messageKey: key,
    messageParams: params,
    userMessage: message,
    localizedMessage: {
      key,
      params,
      fallback: message
    }
  }
}

const ok = <T extends Record<string, unknown>>(data: T): ExternalCodexMcpResponse<T> => ({
  ok: true,
  data
})

const fail = (errorCode: string, messageKey: ExternalMcpAuthMessageKey, params: Record<string, string | number> = {}, data: Record<string, unknown> = {}): ExternalCodexMcpResponse => {
  const messageData = externalMcpAuthMessageData(messageKey, params)
  return {
    ok: false,
    errorCode,
    errorMessage: messageData.userMessage,
    data: {
      ...messageData,
      ...data
    }
  }
}

export const configureExternalCodexMcpAuthRuntime = (config: ExternalCodexMcpAuthRuntimeConfig = {}) => {
  runtimeConfig = { ...runtimeConfig, ...config }
}

export const isExternalMcpAgentSshAuthSubmitEnabled = () => {
  if (process.env.AIOPSTERM_EXTERNAL_CODEX_MCP_ALLOW_AGENT_AUTH === '1') return true
  try {
    return runtimeConfig.getConfig?.().exportMcp?.allowAgentSshAuthSubmit === true
  } catch {
    return false
  }
}

const normalizePrompts = (request: TerminalKeyboardInteractiveRequest) =>
  request.prompts.map((prompt) => ({
    prompt: String(prompt.prompt || ''),
    echo: prompt.echo === true
  }))

const requestTargetLabel = (request: Pick<TerminalKeyboardInteractiveRequest, 'username' | 'host' | 'port'>) =>
  `${request.username}@${request.host}:${request.port}`

const snapshotForRecord = (record: ExternalCodexMcpAuthRecord): ExternalCodexMcpAuthRequestSnapshot => ({
  ...record.snapshot,
  agentSideAuthEnabled: isExternalMcpAgentSshAuthSubmitEnabled()
})

const emitAuthRequest = (snapshot: ExternalCodexMcpAuthRequestSnapshot) => {
  authListeners.forEach((listener) => listener(snapshot))
}

export const subscribeExternalMcpAuthRequests = (listener: ExternalCodexMcpAuthListener) => {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

const pruneCompletedAuthRequests = () => {
  const now = Date.now()
  for (const [id, record] of authRequests.entries()) {
    if (record.snapshot.status === 'pending' || record.snapshot.status === 'submitted') continue
    if (now - record.snapshot.createdAt > 5 * 60_000) authRequests.delete(id)
  }
}

const settleAuthRequest = (
  authRequestId: string,
  status: ExternalCodexMcpAuthRequestSnapshot['status'],
  callback: (record: ExternalCodexMcpAuthRecord) => void,
  errorMessage?: string
) => {
  const record = authRequests.get(authRequestId)
  if (!record || (record.snapshot.status !== 'pending' && record.snapshot.status !== 'submitted')) return false
  clearTimeout(record.timer)
  record.snapshot = {
    ...record.snapshot,
    status,
    ...(errorMessage ? { errorMessage } : {})
  }
  callback(record)
  pruneCompletedAuthRequests()
  return true
}

const normalizeAgentResponses = (params: Record<string, unknown>) => {
  const rawResponses = Array.isArray(params.responses)
    ? params.responses
    : Array.isArray(params.response)
      ? params.response
      : typeof params.response === 'string'
        ? [params.response]
        : []
  return rawResponses.map((item) => String(item ?? '')).slice(0, 8)
}

export const requestExternalMcpSshAuth = (
  connectionId: string,
  request: TerminalKeyboardInteractiveRequest
): Promise<TerminalKeyboardInteractiveResponse> => {
  const authRequestId = request.id
  const createdAt = Date.now()
  const snapshot: ExternalCodexMcpAuthRequestSnapshot = {
    authRequestId,
    connectionId,
    ...(request.assetId ? { assetId: request.assetId } : {}),
    host: request.host,
    port: request.port,
    username: request.username,
    ...(request.title ? { title: request.title } : {}),
    purpose: request.purpose === 'password' ? 'password' : 'keyboard-interactive',
    authScope: request.authScope === 'jump' ? 'jump' : 'target',
    prompts: normalizePrompts(request),
    attempts: request.attempts,
    maxAttempts: request.maxAttempts,
    timeoutMs: request.timeoutMs,
    createdAt,
    expiresAt: createdAt + request.timeoutMs,
    status: 'pending',
    agentSideAuthAvailable: true,
    agentSideAuthEnabled: isExternalMcpAgentSshAuthSubmitEnabled()
  }

  return new Promise<TerminalKeyboardInteractiveResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      settleAuthRequest(
        authRequestId,
        'timeout',
        (record) => {
          const message = 'SSH authentication timed out.'
          record.reject(new Error(message))
          runtimeConfig.sendInAppAuthResult?.({
            id: authRequestId,
            status: 'timeout',
            authScope: snapshot.authScope,
            attempts: snapshot.attempts,
            final: true,
            errorMessage: message
          })
        },
        'SSH authentication timed out.'
      )
    }, request.timeoutMs)

    const record: ExternalCodexMcpAuthRecord = {
      snapshot,
      request,
      resolve,
      reject,
      timer
    }
    authRequests.set(authRequestId, record)
    emitAuthRequest(snapshot)

    if (runtimeConfig.requestInAppAuth) {
      runtimeConfig
        .requestInAppAuth(request)
        .then((response) => {
          settleAuthRequest(authRequestId, 'submitted', (activeRecord) => {
            activeRecord.resolve({
              responses: Array.isArray(response.responses) ? response.responses.map((item) => String(item ?? '')).slice(0, 8) : [],
              ...(response.rememberPassword === true ? { rememberPassword: true } : {})
            })
          })
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          const status = /cancel/i.test(message) ? 'canceled' : /timed out|timeout/i.test(message) ? 'timeout' : 'failed'
          settleAuthRequest(
            authRequestId,
            status,
            (activeRecord) => {
              activeRecord.reject(new Error(message))
            },
            message
          )
        })
    }
  })
}

export const recordExternalMcpAuthResult = (result: TerminalKeyboardInteractiveResult) => {
  const record = authRequests.get(result.id)
  if (!record) return
  if (result.status === 'success' || result.final) {
    clearTimeout(record.timer)
  }
  record.snapshot = {
    ...record.snapshot,
    status: result.status,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {})
  }
  runtimeConfig.sendInAppAuthResult?.(result)
  pruneCompletedAuthRequests()
}

export const getPendingExternalMcpAuthRequestForConnection = (connectionId: string) => {
  for (const record of authRequests.values()) {
    if (record.snapshot.connectionId === connectionId && record.snapshot.status === 'pending') return snapshotForRecord(record)
  }
  return null
}

export const listExternalMcpAuthRequests = (params: Record<string, unknown> = {}) => {
  pruneCompletedAuthRequests()
  const includeCompleted = params.includeCompleted === true || params.include_completed === true
  const connectionId = cleanText(params.connectionId)
  const requests = [...authRequests.values()]
    .map(snapshotForRecord)
    .filter((request) => (includeCompleted ? true : request.status === 'pending' || request.status === 'submitted'))
    .filter((request) => (!connectionId ? true : request.connectionId === connectionId))
  return ok({ authRequests: requests, count: requests.length })
}

export const getExternalMcpAuthRequestStatus = (params: Record<string, unknown>) => {
  const authRequestId = cleanText(params.authRequestId || params.id)
  const record = authRequests.get(authRequestId)
  if (!record) return fail('SSH_AUTH_REQUEST_NOT_FOUND', 'externalMcp.auth.requestNotFound')
  return ok({ authRequest: snapshotForRecord(record) })
}

export const submitExternalMcpAuthResponse = (params: Record<string, unknown>) => {
  const authRequestId = cleanText(params.authRequestId || params.id)
  if (!isExternalMcpAgentSshAuthSubmitEnabled()) {
    return fail('AGENT_SIDE_AUTH_DISABLED', 'externalMcp.auth.agentSubmitDisabled', {}, { settingsTarget: 'exportMcp' })
  }
  const record = authRequests.get(authRequestId)
  if (!record) return fail('SSH_AUTH_REQUEST_NOT_FOUND', 'externalMcp.auth.requestNotFound')
  if (record.snapshot.status !== 'pending') {
    return fail('SSH_AUTH_REQUEST_NOT_PENDING', 'externalMcp.auth.requestNotPending', { status: record.snapshot.status }, { authRequest: snapshotForRecord(record) })
  }
  const responses = normalizeAgentResponses(params)
  if (responses.length === 0 || responses.some((value) => !value.trim())) {
    return fail('SSH_AUTH_RESPONSE_REQUIRED', 'externalMcp.auth.responseRequired', {}, { authRequest: snapshotForRecord(record) })
  }
  settleAuthRequest(authRequestId, 'submitted', (activeRecord) => {
    activeRecord.resolve({
      responses,
      ...(params.rememberPassword === true ? { rememberPassword: true } : {})
    })
    runtimeConfig.sendInAppAuthResult?.({
      id: authRequestId,
      status: 'success',
      authScope: activeRecord.snapshot.authScope,
      attempts: activeRecord.snapshot.attempts,
      final: true
    })
    runtimeConfig.dismissInAppAuth?.(authRequestId, localizeExternalMcpAuthMessage('externalMcp.auth.submitted'))
  })
  const messageData = externalMcpAuthMessageData('externalMcp.auth.submitted')
  return ok({
    ...messageData,
    submitted: true,
    authRequest: snapshotForRecord(record)
  })
}

export const focusExternalMcpAuthRequest = (params: Record<string, unknown>) => {
  const authRequestId = cleanText(params.authRequestId || params.id)
  const record = authRequests.get(authRequestId)
  if (!record) return fail('SSH_AUTH_REQUEST_NOT_FOUND', 'externalMcp.auth.requestNotFound')
  const focused = runtimeConfig.focusInAppAuth?.(record.request) !== false
  const key: ExternalMcpAuthMessageKey = focused ? 'externalMcp.auth.focused' : 'externalMcp.auth.focusUnavailable'
  const messageData = externalMcpAuthMessageData(key)
  return ok({
    ...messageData,
    focused,
    authRequest: snapshotForRecord(record)
  })
}

export const cancelExternalMcpAuthRequest = (params: Record<string, unknown>) => {
  const authRequestId = cleanText(params.authRequestId || params.id)
  const record = authRequests.get(authRequestId)
  if (!record) return fail('SSH_AUTH_REQUEST_NOT_FOUND', 'externalMcp.auth.requestNotFound')
  if (record.snapshot.status !== 'pending' && record.snapshot.status !== 'submitted') {
    return fail('SSH_AUTH_REQUEST_NOT_PENDING', 'externalMcp.auth.requestNotPending', { status: record.snapshot.status }, { authRequest: snapshotForRecord(record) })
  }
  settleAuthRequest(
    authRequestId,
    'canceled',
    (activeRecord) => {
      activeRecord.reject(new Error(localizeExternalMcpAuthMessage('externalMcp.auth.canceled')))
      runtimeConfig.sendInAppAuthResult?.({
        id: authRequestId,
        status: 'canceled',
        authScope: activeRecord.snapshot.authScope,
        attempts: activeRecord.snapshot.attempts,
        final: true,
        errorMessage: localizeExternalMcpAuthMessage('externalMcp.auth.canceled')
      })
      runtimeConfig.dismissInAppAuth?.(authRequestId, localizeExternalMcpAuthMessage('externalMcp.auth.canceled'))
    },
    localizeExternalMcpAuthMessage('externalMcp.auth.canceled')
  )
  const messageData = externalMcpAuthMessageData('externalMcp.auth.canceled')
  return ok({
    ...messageData,
    canceled: true,
    authRequest: snapshotForRecord(record)
  })
}

export const cancelExternalMcpAuthRequestsForConnection = (connectionId: string, reason = 'SSH connection closed before authentication completed.') => {
  for (const record of authRequests.values()) {
    if (record.snapshot.connectionId !== connectionId) continue
    if (record.snapshot.status !== 'pending' && record.snapshot.status !== 'submitted') continue
    settleAuthRequest(
      record.snapshot.authRequestId,
      'canceled',
      (activeRecord) => activeRecord.reject(new Error(reason)),
      reason
    )
  }
}

export const clearExternalMcpAuthRequests = () => {
  for (const record of authRequests.values()) {
    clearTimeout(record.timer)
    if (record.snapshot.status === 'pending' || record.snapshot.status === 'submitted') {
      record.reject(new Error('External MCP bridge was closed.'))
    }
  }
  authRequests.clear()
  authListeners.clear()
}

export const createExternalMcpAuthRequiredData = (authRequest: ExternalCodexMcpAuthRequestSnapshot, extra: Record<string, unknown> = {}) => {
  const target = requestTargetLabel(authRequest)
  const messageData = externalMcpAuthMessageData('externalMcp.auth.required.openAiopsterm', { target })
  return {
    ...messageData,
    ...extra,
    nextAction: 'OPEN_AIOPSTERM_AUTH_PROMPT',
    authRequestId: authRequest.authRequestId,
    authRequest,
    agentSideAuthAvailable: authRequest.agentSideAuthAvailable,
    agentSideAuthEnabled: authRequest.agentSideAuthEnabled,
    settingsTarget: 'exportMcp'
  }
}
