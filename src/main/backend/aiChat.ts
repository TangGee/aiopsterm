import { randomUUID } from 'crypto'
import type { AiChatExchangeRequestInput, AiChatExchangeRequestResult, AiChatHistoryHostContext, AiChatResponseInput, AiChatResponseResult } from '@shared/preload'

const normalizeText = (value: unknown) => String(value || '').trim()
export const LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS = 600

const wait = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs))

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

export const generateAiChatResponse = async (input: AiChatResponseInput): Promise<AiChatResponseResult> => {
  const startedAt = Date.now()
  const prompt = normalizeText(input.prompt)
  if (!prompt && !(input.skills || []).length && !input.command) {
    return { ok: false, errorCode: 'empty_prompt', errorMessage: 'Prompt is required' }
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
  const elapsedMs = Date.now() - startedAt
  if (elapsedMs < LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS) {
    await wait(LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS - elapsedMs)
  }

  return {
    ok: true,
    data: {
      text: lines.join('\n'),
      provider: 'aiopsterm-local',
      model: normalizeText(input.model) || 'aiopsterm-local-agent',
      durationMs: Math.max(1, Date.now() - startedAt)
    }
  }
}
