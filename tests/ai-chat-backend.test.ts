import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserConfig } from '../src/shared/preload'

let generateAiChatResponse: (input: Record<string, unknown>) => Promise<any>
let createAiChatExchangeRequest: (input: Record<string, unknown>) => any
let configureAiChatRuntime: (config?: {
  getConfig?: () => UserConfig
  fetch?: typeof fetch
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
}) => void
let localAiChatResponseMinDelayMs: number

beforeAll(async () => {
  const modulePath = '../src/main/backend/aiChat'
  const backend = await import(modulePath)
  createAiChatExchangeRequest = backend.createAiChatExchangeRequest
  generateAiChatResponse = backend.generateAiChatResponse
  configureAiChatRuntime = backend.configureAiChatRuntime
  localAiChatResponseMinDelayMs = backend.LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS
})

afterEach(() => {
  configureAiChatRuntime()
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

  it('generates local backend assistant text with a backend-owned loading window', async () => {
    let nowMs = 10_000
    const wait = vi.fn(async (durationMs: number) => {
      nowMs += durationMs
    })
    configureAiChatRuntime({
      now: () => nowMs,
      wait
    })

    const result = await generateAiChatResponse({
      prompt: '检查生产磁盘',
      model: 'aiopsterm-local-agent',
      mode: 'agent',
      contexts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1' }],
      messages: [{ role: 'user', text: '上一轮输入' }]
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'aiopsterm-local',
      model: 'aiopsterm-local-agent'
    })
    expect(result.data?.text).toContain('hosts:prod-1')
    expect(result.data?.text).toContain('当前响应由 aiopsterm 本地后端生成')
    expect(wait).toHaveBeenCalledWith(localAiChatResponseMinDelayMs)
  })

  it('calls the configured model provider for non-local AI chat responses', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: '先执行 df -h 和 journalctl -n 120 --no-pager，确认磁盘与错误日志后再给变更建议。'
              }
            }
          ]
        })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 20_000,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
          modelProvider: 'openai-compatible',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'ops-chat', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {
              openai: {
                baseUrl: 'http://127.0.0.1:4010',
                apiKey: 'sk-test',
                modelId: 'ops-chat',
                apiFormat: 'chat-completions'
              }
            }
          }
        }) as UserConfig
    })

    const result = await generateAiChatResponse({
      prompt: '检查生产磁盘',
      model: 'ops-chat',
      mode: 'agent',
      contexts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1' }],
      skills: [{ name: 'incident-triage', description: 'triage', content: 'Always collect read-only evidence first.' }],
      messages: [
        { role: 'user', text: '上一轮输入' },
        { role: 'assistant', text: '上一轮响应' },
        { role: 'user', text: '检查生产磁盘' }
      ]
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'openai',
      model: 'ops-chat',
      text: '先执行 df -h 和 journalctl -n 120 --no-pager，确认磁盘与错误日志后再给变更建议。'
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' })
      })
    )
    const body = JSON.parse(String((fetchMock as any).mock.calls[0][1].body))
    expect(body.model).toBe('ops-chat')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('Selected context: hosts:prod-1')
    expect(body.messages[0].content).toContain('Skill: incident-triage')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: '检查生产磁盘' })
  })

  it('rejects non-local models when no provider configuration is available', async () => {
    configureAiChatRuntime({
      getConfig: () =>
        ({
          modelName: 'ops-chat',
          modelProvider: 'openai-compatible',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'ops-chat', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {}
          }
        }) as UserConfig
    })

    await expect(generateAiChatResponse({ prompt: '检查生产磁盘', model: 'ops-chat' })).resolves.toEqual({
      ok: false,
      errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
      errorMessage: 'AI chat provider is unavailable'
    })
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
