import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UserConfig } from '../src/shared/preload'

let generateAiChatResponse: (input: Record<string, unknown>) => Promise<any>
let createAiChatExchangeRequest: (input: Record<string, unknown>) => any
let cancelAiChatResponse: (input: Record<string, unknown>) => any
let configureAiTodoBackendRuntime: (config?: { stateFilePath?: string; useSeedData?: boolean }) => void
let resetAiTodosForTests: () => void
let listAiTodoSnapshot: () => any
let configureAiChatRuntime: (config?: {
  getConfig?: () => UserConfig
  fetch?: typeof fetch
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
}) => void
let localAiChatResponseMinDelayMs: number
const tempDirs: string[] = []

beforeAll(async () => {
  const modulePath = '../src/main/backend/aiChat'
  const backend = await import(modulePath)
  createAiChatExchangeRequest = backend.createAiChatExchangeRequest
  generateAiChatResponse = backend.generateAiChatResponse
  cancelAiChatResponse = backend.cancelAiChatResponse
  configureAiChatRuntime = backend.configureAiChatRuntime
  localAiChatResponseMinDelayMs = backend.LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS
  const aiTodoModulePath = '../src/main/backend/aiTodos'
  const aiTodos = await import(aiTodoModulePath)
  configureAiTodoBackendRuntime = aiTodos.configureAiTodoBackendRuntime
  resetAiTodosForTests = aiTodos.resetAiTodosForTests
  listAiTodoSnapshot = aiTodos.listAiTodoSnapshot
})

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-chat-todos-'))
  tempDirs.push(dir)
  configureAiTodoBackendRuntime({ stateFilePath: join(dir, 'ai-todos.json'), useSeedData: false })
  resetAiTodosForTests()
})

afterEach(async () => {
  configureAiChatRuntime()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ai chat backend response boundary', () => {
  it('creates backend-owned chat exchange message records before response generation', () => {
    const result = createAiChatExchangeRequest({
      text: '检查生产磁盘',
      hosts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1', detail: 'production' }]
    })

    expect(result.ok).toBe(true)
    expect(result.data?.requestId).toEqual(expect.stringMatching(/^aichat-request-.+/))
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

    const todoSnapshot = listAiTodoSnapshot()
    expect(todoSnapshot.ok).toBe(true)
    expect(todoSnapshot.data).toMatchObject({
      focusedTodoId: 'todo-2',
      totalTodos: 3,
      completedTodos: 1
    })
    expect(todoSnapshot.data?.todos[1]).toMatchObject({
      content: '生成命令建议',
      status: 'in_progress',
      isFocused: true,
      description: expect.stringContaining('检查生产磁盘')
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
      model: 'aiopsterm-local-agent',
      status: 'done'
    })
    expect(result.data?.text).toContain('hosts:prod-1')
    expect(result.data?.text).toContain('当前响应由 aiopsterm 本地后端生成')
    expect(wait).toHaveBeenCalledWith(localAiChatResponseMinDelayMs)

    const todoSnapshot = listAiTodoSnapshot()
    expect(todoSnapshot.ok).toBe(true)
    expect(todoSnapshot.data).toMatchObject({
      focusedTodoId: 'todo-3',
      completedTodos: 2,
      totalTodos: 3
    })
    expect(todoSnapshot.data?.todos[2]).toMatchObject({
      content: '等待确认',
      status: 'in_progress',
      isFocused: true
    })
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
      status: 'done',
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

  it('cancels active local responses at the backend boundary', async () => {
    let nowMs = 50_000
    const waits: Array<{ durationMs: number; resolve: () => void }> = []
    configureAiChatRuntime({
      now: () => nowMs,
      wait: (durationMs: number) =>
        new Promise((resolve) => {
          waits.push({
            durationMs,
            resolve: () => {
              nowMs += durationMs
              resolve(undefined)
            }
          })
        })
    })

    const response = generateAiChatResponse({
      requestId: 'aichat-request-cancel-1',
      assistantMessageId: 'aichat-request-cancel-1-assistant',
      prompt: '检查生产磁盘',
      model: 'aiopsterm-local-agent'
    })
    expect(waits).toHaveLength(1)

    const cancel = cancelAiChatResponse({
      assistantMessageId: 'aichat-request-cancel-1-assistant'
    })
    expect(cancel).toEqual({
      ok: true,
      data: {
        status: 'cancelled',
        requestId: 'aichat-request-cancel-1',
        assistantMessageId: 'aichat-request-cancel-1-assistant',
        text: '已停止生成。',
        active: true
      }
    })

    let todoSnapshot = listAiTodoSnapshot()
    expect(todoSnapshot.ok).toBe(true)
    expect(todoSnapshot.data?.todos[1]).toMatchObject({
      content: '生成命令建议',
      status: 'in_progress',
      isFocused: true,
      description: '生成已停止，可调整上下文后重试'
    })

    waits[0].resolve()
    await expect(response).resolves.toMatchObject({
      ok: true,
      data: {
        text: '已停止生成。',
        provider: 'aiopsterm-local',
        model: 'aiopsterm-local-agent',
        status: 'cancelled',
        requestId: 'aichat-request-cancel-1',
        assistantMessageId: 'aichat-request-cancel-1-assistant'
      }
    })
    todoSnapshot = listAiTodoSnapshot()
    expect(todoSnapshot.data).toMatchObject({
      focusedTodoId: 'todo-2',
      completedTodos: 1,
      totalTodos: 3
    })
  })

  it('aborts active provider responses when the backend cancel boundary is used', async () => {
    let fetchAbortSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_url: string, options?: RequestInit) =>
        new Promise((resolve, reject) => {
          fetchAbortSignal = options?.signal || undefined
          fetchAbortSignal?.addEventListener(
            'abort',
            () => {
              reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
            },
            { once: true }
          )
        })
    ) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 60_000,
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

    const response = generateAiChatResponse({
      requestId: 'aichat-request-provider-cancel-1',
      assistantMessageId: 'aichat-request-provider-cancel-1-assistant',
      prompt: '检查生产磁盘',
      model: 'ops-chat'
    })
    await vi.waitFor(() => expect(fetchAbortSignal).toBeDefined())

    const cancel = cancelAiChatResponse({
      requestId: 'aichat-request-provider-cancel-1'
    })
    expect(cancel.ok).toBe(true)
    expect(fetchAbortSignal?.aborted).toBe(true)
    await expect(response).resolves.toMatchObject({
      ok: true,
      data: {
        text: '已停止生成。',
        status: 'cancelled',
        requestId: 'aichat-request-provider-cancel-1',
        assistantMessageId: 'aichat-request-provider-cancel-1-assistant'
      }
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
