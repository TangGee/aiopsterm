import { beforeAll, describe, expect, it } from 'vitest'

let generateAiChatResponse: (input: Record<string, unknown>) => Promise<any>
let createAiChatExchangeRequest: (input: Record<string, unknown>) => any
let localAiChatResponseMinDelayMs: number

beforeAll(async () => {
  const modulePath = '../src/main/backend/aiChat'
  const backend = await import(modulePath)
  createAiChatExchangeRequest = backend.createAiChatExchangeRequest
  generateAiChatResponse = backend.generateAiChatResponse
  localAiChatResponseMinDelayMs = backend.LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS
})

describe('ai chat backend response boundary', () => {
  it('creates backend-owned chat exchange message records before response generation', () => {
    const result = createAiChatExchangeRequest({
      text: '检查生产磁盘',
      hosts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1', detail: 'production' }]
    })

    expect(result.ok).toBe(true)
    expect(result.data?.userMessage).toMatchObject({
      id: expect.stringMatching(/^aichat-request-.+-user$/),
      role: 'user',
      text: '检查生产磁盘',
      hosts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1', detail: 'production' }]
    })
    expect(result.data?.assistantMessage).toMatchObject({
      id: expect.stringMatching(/^aichat-request-.+-assistant$/),
      role: 'assistant',
      text: '正在请求 aiopsterm AI 后端...',
      state: 'streaming'
    })
  })

  it('generates local backend assistant text with a visible loading window', async () => {
    const startedAt = Date.now()
    const result = await generateAiChatResponse({
      prompt: '检查生产磁盘',
      model: 'qwen2.5-coder',
      mode: 'agent',
      contexts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1' }],
      messages: [{ role: 'user', text: '上一轮输入' }]
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'aiopsterm-local',
      model: 'qwen2.5-coder'
    })
    expect(result.data?.text).toContain('hosts:prod-1')
    expect(result.data?.text).toContain('当前响应由 aiopsterm 本地后端生成')
    expect(elapsedMs).toBeGreaterThanOrEqual(localAiChatResponseMinDelayMs - 25)
  })

  it('rejects empty requests before the local response delay', async () => {
    const startedAt = Date.now()
    const result = await generateAiChatResponse({ prompt: '' })
    const elapsedMs = Date.now() - startedAt

    expect(result).toEqual({
      ok: false,
      errorCode: 'empty_prompt',
      errorMessage: 'Prompt is required'
    })
    expect(elapsedMs).toBeLessThan(localAiChatResponseMinDelayMs)
  })
})
