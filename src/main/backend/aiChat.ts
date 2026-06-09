import { randomUUID } from 'crypto'
import type {
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

type AiChatRuntimeConfig = {
  getConfig?: () => UserConfig
  fetch?: typeof fetch
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
}

let runtimeConfig: AiChatRuntimeConfig = {}

const wait = (durationMs: number) => {
  if (runtimeConfig.wait) return runtimeConfig.wait(durationMs)
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

const now = () => (runtimeConfig.now ? runtimeConfig.now() : Date.now())

export const configureAiChatRuntime = (config?: AiChatRuntimeConfig) => {
  runtimeConfig = config ? { ...config } : {}
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
  startedAt: number
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
    errorCodePrefix: 'AI_CHAT_PROVIDER'
  })
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
      durationMs: Math.max(1, now() - startedAt)
    }
  }
}

export const generateAiChatResponse = async (input: AiChatResponseInput): Promise<AiChatResponseResult> => {
  const startedAt = now()
  const prompt = normalizeText(input.prompt)
  if (!prompt && !(input.skills || []).length && !input.command) {
    return { ok: false, errorCode: 'empty_prompt', errorMessage: 'Prompt is required' }
  }

  const modelName = normalizeText(input.model) || normalizeText(runtimeConfig.getConfig?.().modelName) || 'aiopsterm-local-agent'
  const config = runtimeConfig.getConfig?.()
  if (config) {
    const providerResponse = await generateProviderAiChatResponse(input, config, modelName, startedAt)
    if (providerResponse) return providerResponse
  }
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

  return {
    ok: true,
    data: {
      text: lines.join('\n'),
      provider: 'aiopsterm-local',
      model: modelName,
      durationMs: Math.max(1, now() - startedAt)
    }
  }
}
