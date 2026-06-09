import { randomUUID } from 'crypto'
import type {
  AiChatCancelInput,
  AiChatCancelResult,
  AiChatExchangeRequestInput,
  AiChatExchangeRequestResult,
  AiChatHistoryHostContext,
  AiChatMessageInput,
  AiChatResponseInput,
  AiChatResponseResult,
  ModelProviderCheckKey,
  UserConfig
} from '@shared/preload'
import { createProviderTextRequest, fetchProviderText, resolveModelProvider, type AiProviderTextMessage } from './modelProviderText'

const normalizeText = (value: unknown) => String(value || '').trim()
export const LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS = 600
const AI_CHAT_CANCELLED_TEXT = '已停止生成。'

type AiChatRuntimeConfig = {
  getConfig?: () => UserConfig
  fetch?: typeof fetch
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
}

let runtimeConfig: AiChatRuntimeConfig = {}

type AiChatResponseControl = {
  requestId?: string
  assistantMessageId?: string
  controller: AbortController
  cancelled: boolean
}

const activeAiChatResponses = new Map<string, AiChatResponseControl>()
const pendingCancelledAiChatResponses = new Set<string>()

const wait = (durationMs: number) => {
  if (runtimeConfig.wait) return runtimeConfig.wait(durationMs)
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

const now = () => (runtimeConfig.now ? runtimeConfig.now() : Date.now())

export const configureAiChatRuntime = (config?: AiChatRuntimeConfig) => {
  runtimeConfig = config ? { ...config } : {}
  activeAiChatResponses.forEach((control) => control.controller.abort())
  activeAiChatResponses.clear()
  pendingCancelledAiChatResponses.clear()
}

const requestIdFromAssistantMessageId = (assistantMessageId?: string) => {
  const normalized = normalizeText(assistantMessageId)
  return normalized.endsWith('-assistant') ? normalized.slice(0, -'-assistant'.length) : ''
}

const normalizeAiChatResponseIds = (input: AiChatCancelInput | AiChatResponseInput) => {
  const assistantMessageId = normalizeText(input.assistantMessageId)
  const requestId = normalizeText(input.requestId) || requestIdFromAssistantMessageId(assistantMessageId)
  return {
    requestId: requestId || undefined,
    assistantMessageId: assistantMessageId || (requestId ? `${requestId}-assistant` : undefined)
  }
}

const aiChatResponseKeys = (input: AiChatCancelInput | AiChatResponseInput | AiChatResponseControl) => {
  const requestId = normalizeText(input.requestId)
  const assistantMessageId = normalizeText(input.assistantMessageId)
  return [
    requestId ? `request:${requestId}` : '',
    assistantMessageId ? `assistant:${assistantMessageId}` : ''
  ].filter(Boolean)
}

const registerAiChatResponseControl = (input: AiChatResponseInput) => {
  const ids = normalizeAiChatResponseIds(input)
  const control: AiChatResponseControl = {
    requestId: ids.requestId,
    assistantMessageId: ids.assistantMessageId,
    controller: new AbortController(),
    cancelled: false
  }
  const keys = aiChatResponseKeys(control)
  control.cancelled = keys.some((key) => pendingCancelledAiChatResponses.has(key))
  if (control.cancelled) control.controller.abort()
  keys.forEach((key) => activeAiChatResponses.set(key, control))
  return control
}

const unregisterAiChatResponseControl = (control: AiChatResponseControl) => {
  aiChatResponseKeys(control).forEach((key) => {
    if (activeAiChatResponses.get(key) === control) activeAiChatResponses.delete(key)
    pendingCancelledAiChatResponses.delete(key)
  })
}

const isAiChatResponseCancelled = (control: AiChatResponseControl) => control.cancelled || control.controller.signal.aborted

const cancelledAiChatResponse = (control: AiChatResponseControl, modelName: string, startedAt: number): AiChatResponseResult => ({
  ok: true,
  data: {
    text: AI_CHAT_CANCELLED_TEXT,
    provider: 'aiopsterm-local',
    model: modelName,
    durationMs: Math.max(1, now() - startedAt),
    status: 'cancelled',
    requestId: control.requestId,
    assistantMessageId: control.assistantMessageId
  }
})

export const cancelAiChatResponse = (input: AiChatCancelInput): AiChatCancelResult => {
  const ids = normalizeAiChatResponseIds(input)
  const keys = aiChatResponseKeys(ids)
  if (!keys.length) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_CANCEL_TARGET_REQUIRED',
      errorMessage: 'AI chat response cancellation requires a request or assistant message id'
    }
  }

  let active = false
  let control: AiChatResponseControl | undefined
  for (const key of keys) {
    const existing = activeAiChatResponses.get(key)
    if (existing) {
      control = existing
      break
    }
  }
  if (control) {
    active = true
    control.cancelled = true
    control.controller.abort()
  }
  keys.forEach((key) => pendingCancelledAiChatResponses.add(key))

  return {
    ok: true,
    data: {
      status: 'cancelled',
      requestId: control?.requestId || ids.requestId,
      assistantMessageId: control?.assistantMessageId || ids.assistantMessageId,
      text: AI_CHAT_CANCELLED_TEXT,
      active
    }
  }
}

const normalizeHostContexts = (hosts?: AiChatExchangeRequestInput['hosts']): AiChatHistoryHostContext[] | undefined => {
  const normalized = (hosts || [])
    .map((host): AiChatHistoryHostContext | null => {
      const label = normalizeText(host.label)
      if (!label) return null
      return {
        id: normalizeText(host.id) || `host-${randomUUID()}`,
        kind: 'hosts',
        label,
        detail: normalizeText(host.detail) || undefined
      }
    })
    .filter(Boolean) as AiChatHistoryHostContext[]
  return normalized.length ? normalized : undefined
}

export const createAiChatExchangeRequest = (input: AiChatExchangeRequestInput): AiChatExchangeRequestResult => {
  const text = normalizeText(input.text)
  if (!text) return { ok: false, errorCode: 'empty_prompt', errorMessage: 'Prompt is required' }
  const requestId = `aichat-request-${randomUUID()}`
  return {
    ok: true,
    data: {
      requestId,
      userMessage: {
        id: `${requestId}-user`,
        role: 'user',
        text,
        hosts: normalizeHostContexts(input.hosts)
      },
      assistantMessage: {
        id: `${requestId}-assistant`,
        role: 'assistant',
        text: '正在请求 aiopsterm AI 后端...',
        state: 'streaming'
      }
    }
  }
}

const summarizeContexts = (input: AiChatResponseInput) => {
  const contexts = (input.contexts || []).slice(0, 5).map((item) => `${item.kind}:${item.label}`)
  if (!contexts.length) return '未附加外部上下文'
  return contexts.join('、')
}

const createAiChatSystemPrompt = (input: AiChatResponseInput) => {
  const modeLabel = input.mode === 'agent' ? 'Agent mode' : input.mode === 'command' ? 'Command mode' : 'Chat mode'
  const contextSummary = summarizeContexts(input)
  const skills = (input.skills || [])
    .slice(0, 5)
    .map((skill) =>
      [`Skill: ${normalizeText(skill.name)}`, normalizeText(skill.description) ? `Description: ${normalizeText(skill.description)}` : '', normalizeText(skill.content)]
        .filter(Boolean)
        .join('\n')
    )
    .filter(Boolean)
    .join('\n\n')
  const command = normalizeText(input.command?.command || input.command?.label || input.command?.id)

  return [
    'You are aiopsterm, an AI operations assistant for terminal, SSH, Kubernetes, files, and database workflows.',
    'Respond in the same language as the operator when possible.',
    'Use the provided conversation, selected contexts, skills, and command chip as the source of truth.',
    'Prefer read-only diagnostics before proposing destructive or state-changing actions.',
    'Do not claim that you executed commands, changed files, connected to hosts, or queried databases unless the user-provided context explicitly includes that output.',
    'When an action is risky, explain the risk and ask for confirmation before providing an executable command.',
    '',
    `Mode: ${modeLabel}`,
    `Selected context: ${contextSummary}`,
    command ? `Selected command chip: ${command}` : '',
    skills ? `Activated skills:\n${skills}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

const mapConversationForProvider = (messages: AiChatMessageInput[] | undefined, prompt: string): AiProviderTextMessage[] => {
  const normalized = (messages || [])
    .slice(-16)
    .map((message): AiProviderTextMessage | null => {
      const content = normalizeText(message.text)
      if (!content) return null
      if (message.role === 'assistant') return { role: 'assistant', content }
      if (message.role === 'system') return { role: 'user', content: `System note: ${content}` }
      return { role: 'user', content }
    })
    .filter(Boolean) as AiProviderTextMessage[]
  const last = normalized[normalized.length - 1]
  if (!last || last.role !== 'user' || last.content !== prompt) {
    normalized.push({ role: 'user', content: prompt })
  }
  return normalized
}

async function generateProviderAiChatResponse(
  input: AiChatResponseInput,
  config: UserConfig,
  modelName: string,
  startedAt: number,
  control: AiChatResponseControl
): Promise<AiChatResponseResult | null> {
  const providerConfig = resolveModelProvider(config, modelName)
  if (!providerConfig) return null
  const prompt = normalizeText(input.prompt)
  const request = createProviderTextRequest(providerConfig, createAiChatSystemPrompt(input), mapConversationForProvider(input.messages, prompt), 1600)
  if (!request) {
    return {
      ok: false,
      errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
      errorMessage: 'AI chat provider is unavailable'
    }
  }
  const response = await fetchProviderText(request, {
    fetch: runtimeConfig.fetch,
    timeoutMs: runtimeConfig.timeoutMs || 30_000,
    errorCodePrefix: 'AI_CHAT_PROVIDER',
    signal: control.controller.signal
  })
  if (isAiChatResponseCancelled(control)) return cancelledAiChatResponse(control, modelName, startedAt)
  if (!response.ok) {
    return {
      ok: false,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage
    }
  }
  return {
    ok: true,
    data: {
      text: response.text,
      provider: providerConfig.provider as ModelProviderCheckKey,
      model: modelName,
      durationMs: Math.max(1, now() - startedAt),
      status: 'done',
      requestId: control.requestId,
      assistantMessageId: control.assistantMessageId
    }
  }
}

export const generateAiChatResponse = async (input: AiChatResponseInput): Promise<AiChatResponseResult> => {
  const startedAt = now()
  const control = registerAiChatResponseControl(input)
  const prompt = normalizeText(input.prompt)
  try {
    if (!prompt && !(input.skills || []).length && !input.command) {
      return { ok: false, errorCode: 'empty_prompt', errorMessage: 'Prompt is required' }
    }

    const modelName = normalizeText(input.model) || normalizeText(runtimeConfig.getConfig?.().modelName) || 'aiopsterm-local-agent'
    if (isAiChatResponseCancelled(control)) return cancelledAiChatResponse(control, modelName, startedAt)
    const config = runtimeConfig.getConfig?.()
    if (config) {
      const providerResponse = await generateProviderAiChatResponse(input, config, modelName, startedAt, control)
      if (providerResponse) return providerResponse
    }
    if (isAiChatResponseCancelled(control)) return cancelledAiChatResponse(control, modelName, startedAt)
    if (modelName !== 'aiopsterm-local-agent') {
      return {
        ok: false,
        errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
        errorMessage: 'AI chat provider is unavailable'
      }
    }

    const skillLines = (input.skills || [])
      .slice(0, 3)
      .map((skill) => `Activated Skill: ${skill.name}`)
    const commandLabel = normalizeText(input.command?.label || input.command?.command || input.command?.id)
    const recentUserTurns = (input.messages || []).filter((message) => message.role === 'user').slice(-3).length
    const lines = [
      ...skillLines,
      skillLines.length ? '' : '',
      '正在读取当前终端、资产和知识库上下文...',
      '',
      '计划：',
      `1. 确认目标环境：${summarizeContexts(input)}。`,
      `2. 根据请求生成只读检查步骤${commandLabel ? `，优先参考命令 ${commandLabel}` : ''}。`,
      `3. 等待用户确认后执行，当前会话已纳入 ${recentUserTurns} 条用户输入。`,
      '',
      '当前响应由 aiopsterm 本地后端生成，未连接远端 AI 服务。'
    ].filter((line, index, all) => line !== '' || all[index - 1] !== '')
    const elapsedMs = now() - startedAt
    if (elapsedMs < LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS) {
      await wait(LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS - elapsedMs)
    }
    if (isAiChatResponseCancelled(control)) return cancelledAiChatResponse(control, modelName, startedAt)

    return {
      ok: true,
      data: {
        text: lines.join('\n'),
        provider: 'aiopsterm-local',
        model: modelName,
        durationMs: Math.max(1, now() - startedAt),
        status: 'done',
        requestId: control.requestId,
        assistantMessageId: control.assistantMessageId
      }
    }
  } finally {
    unregisterAiChatResponseControl(control)
  }
}
