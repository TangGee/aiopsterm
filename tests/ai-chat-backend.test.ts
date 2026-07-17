import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UserConfig } from '../src/shared/contracts/userConfig'
import type { SkillUserConfig } from '../src/shared/contracts/skills'
import type { McpToolCallInput, McpToolCallResult } from '../src/shared/contracts/mcp'

let generateAiChatResponse: (input: Record<string, unknown>) => Promise<any>
let createAiChatExchangeRequest: (input: Record<string, unknown>) => Promise<any>
let cancelAiChatResponse: (input: Record<string, unknown>) => any
let configureAiTodoBackendRuntime: (config?: { stateFilePath?: string; useSeedData?: boolean }) => void
let resetAiTodosForTests: () => void
let listAiTodoSnapshot: () => any
let configureAiChatRuntime: (config?: {
  getConfig?: () => UserConfig
  listSkills?: () => SkillUserConfig[] | Promise<SkillUserConfig[]>
  callMcpTool?: (input: McpToolCallInput) => Promise<McpToolCallResult>
  localBackendDouble?: boolean
  fetch?: typeof fetch
  wait?: (durationMs: number) => Promise<unknown>
  now?: () => number
  timeoutMs?: number
}) => void
let localAiChatResponseMinDelayMs: number
const tempDirs: string[] = []
const originalAiChatBackendDouble = process.env.AIOPSTERM_AI_CHAT_BACKEND_DOUBLE

beforeAll(async () => {
  const modulePath = '../src/main/backend/ai/aiChat'
  const backend = await import(modulePath)
  createAiChatExchangeRequest = backend.createAiChatExchangeRequest
  generateAiChatResponse = backend.generateAiChatResponse
  cancelAiChatResponse = backend.cancelAiChatResponse
  configureAiChatRuntime = backend.configureAiChatRuntime
  localAiChatResponseMinDelayMs = backend.LOCAL_AI_CHAT_RESPONSE_MIN_DELAY_MS
  const aiTodoModulePath = '../src/main/backend/ai/aiTodos'
  const aiTodos = await import(aiTodoModulePath)
  configureAiTodoBackendRuntime = aiTodos.configureAiTodoBackendRuntime
  resetAiTodosForTests = aiTodos.resetAiTodosForTests
  listAiTodoSnapshot = aiTodos.listAiTodoSnapshot
})

beforeEach(async () => {
  delete process.env.AIOPSTERM_AI_CHAT_BACKEND_DOUBLE
  const dir = await mkdtemp(join(tmpdir(), 'aiopsterm-ai-chat-todos-'))
  tempDirs.push(dir)
  configureAiTodoBackendRuntime({ stateFilePath: join(dir, 'ai-todos.json'), useSeedData: false })
  resetAiTodosForTests()
})

afterEach(async () => {
  configureAiChatRuntime()
  if (originalAiChatBackendDouble === undefined) {
    delete process.env.AIOPSTERM_AI_CHAT_BACKEND_DOUBLE
  } else {
    process.env.AIOPSTERM_AI_CHAT_BACKEND_DOUBLE = originalAiChatBackendDouble
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ai chat backend response boundary', () => {
  it('creates backend-owned chat exchange message records before response generation', async () => {
    const result = await createAiChatExchangeRequest({
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
    expect(result.data?.responseInput).toMatchObject({
      requestId: result.data?.requestId,
      assistantMessageId: result.data?.assistantMessage.id,
      prompt: '检查生产磁盘',
      messages: [{ role: 'user', text: '检查生产磁盘' }]
    })
    expect(result.data?.contextUsage).toMatchObject({
      source: 'backend',
      requestId: result.data?.requestId,
      assistantMessageId: result.data?.assistantMessage.id,
      contextWindow: 128000,
      percent: expect.any(Number),
      tokensIn: expect.any(Number),
      tokensOut: 0
    })
    expect(result.data?.contextUsage?.used).toBeGreaterThan(0)

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

  it('attaches valid images and rejects invalid image data before creating an exchange', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    const valid = await createAiChatExchangeRequest({
      text: 'explain this image',
      contentParts: [{ type: 'image', mediaType: 'image/png', data: png, name: 'screen.png' }]
    })

    expect(valid).toMatchObject({
      ok: true,
      data: {
        responseInput: {
          userImages: [`data:image/png;base64,${png}`]
        }
      }
    })

    const invalid = await createAiChatExchangeRequest({
      text: 'explain this image',
      contentParts: [{ type: 'image', mediaType: 'image/jpeg', data: png, name: 'spoofed.jpg' }]
    })

    expect(invalid).toMatchObject({
      ok: false,
      errorCode: 'AI_CHAT_IMAGE_INVALID',
      errorMessage: expect.stringContaining('不支持的图片类型')
    })
    expect(invalid.data).toBeUndefined()
  })

  it('preserves an explicit native transcript revision request', async () => {
    const result = await createAiChatExchangeRequest({
      text: 'revised question',
      conversationId: 'conversation-revision',
      replaceNativeTranscript: true,
      messages: [
        { role: 'user', text: 'kept question' },
        { role: 'assistant', text: 'kept answer' }
      ]
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        responseInput: {
          conversationId: 'conversation-revision',
          replaceNativeTranscript: true,
          messages: [
            { role: 'user', text: 'kept question' },
            { role: 'assistant', text: 'kept answer' },
            { role: 'user', text: 'revised question' }
          ]
        }
      }
    })
  })

  it('assembles contexts, command, and enabled skill instructions inside the backend exchange boundary', async () => {
    configureAiChatRuntime({
      listSkills: () => [
        {
          name: 'incident-triage',
          description: 'Collect symptoms',
          enabled: true,
          editable: true,
          content: 'Collect scope first.'
        },
        {
          name: 'disabled-skill',
          description: 'hidden',
          enabled: false,
          editable: true,
          content: 'hidden'
        }
      ]
    })

    const result = await createAiChatExchangeRequest({
      text: '检查生产磁盘',
      messages: [
        { role: 'system', text: '忽略空白之前的系统说明' },
        { role: 'user', text: '上一轮输入' },
        { role: 'assistant', text: '上一轮响应' }
      ],
      contexts: [
        { id: 'kb-doc:Runbooks/Linux.md', kind: 'docs', label: 'Linux 巡检手册', relPath: 'Runbooks/Linux.md' },
        { id: 'kb-image:images/interface.png', kind: 'images', label: 'interface.png', relPath: 'images/interface.png', mediaType: 'image/png' },
        { id: 'skill:incident-triage', kind: 'skills', label: 'Incident Triage Display' },
        { id: 'skill:disabled-skill', kind: 'skills', label: 'disabled-skill' }
      ],
      command: {
        id: 'commands/rollback-plan.md',
        label: '/rollback-plan',
        command: '/rollback-plan',
        path: 'commands/rollback-plan.md'
      },
      model: 'aiopsterm-local-agent',
      mode: 'agent'
    })

    expect(result.ok).toBe(true)
    const prompt = result.data?.userMessage.text || ''
    expect(prompt).toContain('检查生产磁盘')
    expect(prompt).toContain('上下文：docs:Linux 巡检手册、images:interface.png、skills:Incident Triage Display、skills:disabled-skill')
    expect(prompt).toContain('命令：/rollback-plan')
    expect(prompt).toContain('Knowledge Context:')
    expect(prompt).toContain('- doc: Linux 巡检手册 (Runbooks/Linux.md)')
    expect(prompt).toContain('- image: interface.png (images/interface.png, image/png)')
    expect(prompt).toContain('Skill Instructions:')
    expect(prompt).toContain('# Skill Activated: incident-triage')
    expect(prompt).toContain('Description: Collect symptoms')
    expect(prompt).toContain('Collect scope first.')
    expect(prompt).not.toContain('# Skill Activated: disabled-skill')

    expect(result.data?.responseInput).toMatchObject({
      requestId: result.data?.requestId,
      assistantMessageId: result.data?.assistantMessage.id,
      prompt,
      contexts: [
        expect.objectContaining({ id: 'kb-doc:Runbooks/Linux.md', kind: 'docs', label: 'Linux 巡检手册', relPath: 'Runbooks/Linux.md' }),
        expect.objectContaining({ id: 'kb-image:images/interface.png', kind: 'images', label: 'interface.png', relPath: 'images/interface.png', mediaType: 'image/png' }),
        expect.objectContaining({ id: 'skill:incident-triage', kind: 'skills', label: 'Incident Triage Display' }),
        expect.objectContaining({ id: 'skill:disabled-skill', kind: 'skills', label: 'disabled-skill' })
      ],
      skills: [expect.objectContaining({ name: 'incident-triage', description: 'Collect symptoms', content: 'Collect scope first.' })],
      command: expect.objectContaining({ label: '/rollback-plan', command: '/rollback-plan', path: 'commands/rollback-plan.md' }),
      model: 'aiopsterm-local-agent',
      mode: 'agent'
    })
    expect(result.data?.responseInput.messages).toEqual([
      { role: 'system', text: '忽略空白之前的系统说明' },
      { role: 'user', text: '上一轮输入' },
      { role: 'assistant', text: '上一轮响应' },
      { role: 'user', text: prompt }
    ])
  })

  it('generates local backend assistant text with a backend-owned loading window', async () => {
    let nowMs = 10_000
    const wait = vi.fn(async (durationMs: number) => {
      nowMs += durationMs
    })
    configureAiChatRuntime({
      localBackendDouble: true,
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
    expect(result.data?.contextUsage).toMatchObject({
      source: 'backend',
      contextWindow: 128000,
      tokensIn: expect.any(Number),
      tokensOut: expect.any(Number)
    })
    expect(result.data?.contextUsage?.used).toBeGreaterThan(result.data?.contextUsage?.tokensIn || 0)
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
        }) as unknown as UserConfig
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
    expect(result.data?.contextUsage).toMatchObject({
      source: 'backend',
      contextWindow: 128000,
      tokensIn: expect.any(Number),
      tokensOut: expect.any(Number)
    })
    expect(result.data?.contextUsage?.used).toBeGreaterThan(result.data?.contextUsage?.tokensIn || 0)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4010/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' })
      })
    )
    const body = JSON.parse(String((fetchMock as any).mock.calls[0][1].body))
    expect(body.model).toBe('ops-chat')
    expect(body.max_tokens).toBe(1600 + 4096)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('Selected context: hosts:prod-1')
    expect(body.messages[0].content).toContain('Skill: incident-triage')
    expect(body.messages[0].content).toContain('AI preferences:')
    expect(body.messages[0].content).toContain('Reasoning effort target: medium.')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: '检查生产磁盘' })
  })

  it('passes AI reasoning preferences to OpenAI Responses chat requests', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ output_text: '已按高推理强度生成响应。' })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'ops-reasoning',
          modelProvider: 'openai-compatible',
          aiPreferences: {
            enableExtendedThinking: false,
            thinkingBudgetTokens: 0,
            autoExecuteReadOnlyCommands: false,
            commandOutputFilteringEnabled: false,
            kbSearchEnabled: false,
            experienceExtractionEnabled: false,
            managedAiAutoNamingEnabled: false,
            autoApproval: true,
            reasoningEffort: 'high',
            needProxy: false,
            proxy: {
              type: 'HTTP',
              host: '127.0.0.1',
              port: 7890,
              enableProxyIdentity: false,
              username: '',
              password: ''
            },
            shellIntegrationTimeout: 8
          },
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'ops-reasoning', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {
              openai: {
                baseUrl: 'http://127.0.0.1:4010',
                apiKey: 'sk-test',
                modelId: 'ops-reasoning',
                apiFormat: 'responses'
              }
            }
          }
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      prompt: '检查生产磁盘',
      model: 'ops-reasoning',
      mode: 'chat'
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        provider: 'openai',
        model: 'ops-reasoning',
        text: '已按高推理强度生成响应。'
      }
    })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4010/v1/responses', expect.any(Object))
    const body = JSON.parse(String((fetchMock as any).mock.calls[0][1].body))
    expect(body).toMatchObject({
      model: 'ops-reasoning',
      max_output_tokens: 1600,
      reasoning: { effort: 'high' }
    })
    expect(body.input[0].content).toContain('Extended Thinking is disabled')
    expect(body.input[0].content).toContain('Knowledge base search is disabled')
    expect(body.input[0].content).toContain('Auto approval may exist only for low-risk read-only actions')
  })

  it('retries timed-out AI chat provider requests up to five times before surfacing failure', async () => {
    let attempts = 0
    const fetchMock = vi.fn(async () => {
      attempts += 1
      if (attempts <= 5) {
        throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '第六次 provider 请求成功。'
                }
              }
            ]
          })
      }
    }) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      timeoutMs: 500,
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      prompt: '检查生产磁盘',
      model: 'ops-chat'
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        provider: 'openai',
        model: 'ops-chat',
        text: '第六次 provider 请求成功。'
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('preserves versioned OpenAI-compatible provider base URLs', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Versioned provider response'
              }
            }
          ]
        })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      getConfig: () =>
        ({
          modelName: 'versioned-code-model',
          modelProvider: 'openai-compatible',
          modelSettings: {
            addModelSwitch: true,
            options: [{ name: 'versioned-code-model', locked: false, checked: true, apiProvider: 'openai' }],
            providers: {
              openai: {
                baseUrl: 'https://ark.example.test/api/coding/v3#',
                apiKey: 'sk-test',
                modelId: 'versioned-code-model',
                apiFormat: 'chat-completions'
              }
            }
          }
        }) as unknown as UserConfig
    })

    await expect(generateAiChatResponse({ prompt: '检查生产磁盘', model: 'versioned-code-model' })).resolves.toMatchObject({
      ok: true,
      data: {
        provider: 'openai',
        model: 'versioned-code-model',
        text: 'Versioned provider response'
      }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ark.example.test/api/coding/v3/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' })
      })
    )
  })

  it('turns provider MCP tool blocks into backend-owned approval messages', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '<use_mcp_tool><server_name>filesystem</server_name><tool_name>read_file</tool_name><arguments>{"path":"/tmp/readme.md"}</arguments></use_mcp_tool>'
              }
            }
          ]
        })
    })) as unknown as typeof fetch
    const callMcpTool = vi.fn(async (): Promise<McpToolCallResult> => {
      throw new Error('tool should require approval')
    })

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 70_000,
      callMcpTool,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
          mcpServers: [
            {
              name: 'filesystem',
              status: 'connected',
              disabled: false,
              tools: [{ name: 'read_file', description: 'Read file', enabled: true, parameters: [] }],
              resources: []
            }
          ],
          mcpToolStates: { 'filesystem:read_file': true },
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-mcp-ask',
      assistantMessageId: 'aichat-request-mcp-ask-assistant',
      prompt: '读取文件',
      model: 'ops-chat'
    })

    expect(result.ok).toBe(true)
    expect(callMcpTool).not.toHaveBeenCalled()
    expect(result.data).toMatchObject({
      text: '请求执行 MCP Tool filesystem/read_file。',
      message: {
        id: 'aichat-request-mcp-ask-assistant',
        role: 'assistant',
        state: 'done',
        ask: 'mcp_tool_call',
        mcpToolCall: {
          serverName: 'filesystem',
          toolName: 'read_file',
          arguments: { path: '/tmp/readme.md' }
        }
      }
    })
  })

  it('turns provider execute_command blocks into backend-owned command approval messages', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '<execute_command><ip>10.24.8.12</ip><command>uptime</command><requires_approval>false</requires_approval><interactive>false</interactive></execute_command>'
              }
            }
          ]
        })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 65_000,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-command',
      assistantMessageId: 'aichat-request-command-assistant',
      prompt: '检查负载',
      model: 'ops-chat',
      mode: 'command'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      text: '请求执行 Command 10.24.8.12: uptime。',
      message: {
        id: 'aichat-request-command-assistant',
        role: 'assistant',
        text: 'uptime',
        state: 'done',
        ask: 'command',
        commandExecution: {
          ip: '10.24.8.12',
          command: 'uptime',
          requiresApproval: false,
          interactive: false
        }
      }
    })
    const requestBody = JSON.parse(String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body || '{}')) as { messages: Array<{ role: string; content: string }> }
    expect(requestBody.messages[0]?.role).toBe('system')
    expect(requestBody.messages[0]?.content).toContain('Put plain shell text directly inside <command>; do not wrap it in CDATA')
    expect(requestBody.messages[0]?.content).toContain('escape them as entities inside <command>')
  })

  it('rejects CDATA wrapped execute_command blocks instead of creating command cards', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '<execute_command><ip>10.24.8.12</ip><command><![CDATA[uptime]]></command><requires_approval>false</requires_approval><interactive>false</interactive></execute_command>'
              }
            }
          ]
        })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 65_500,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-command-cdata',
      assistantMessageId: 'aichat-request-command-cdata-assistant',
      prompt: '检查负载',
      model: 'ops-chat',
      mode: 'command'
    })

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'AI_COMMAND_CONTRACT_INVALID',
      errorMessage: expect.stringContaining('must not use CDATA')
    })
  })

  it('sends agent command output back to the provider with the execute_command loop contract', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: '负载正常，无需继续执行命令。'
              }
            }
          ]
        })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 66_000,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-agent-loop',
      assistantMessageId: 'aichat-request-agent-loop-assistant',
      prompt: 'Command output from the approved execute_command tool is available.',
      model: 'ops-chat',
      mode: 'agent',
      messages: [
        { role: 'user', text: '检查负载' },
        {
          role: 'assistant',
          text: 'uptime',
          ask: 'command',
          commandExecution: {
            ip: '10.24.8.12',
            command: 'uptime',
            requiresApproval: false,
            interactive: false
          }
        },
        {
          role: 'assistant',
          text: 'load average: 0.10, 0.20, 0.30',
          say: 'command_output',
          action: 'approved',
          commandExecution: {
            ip: '10.24.8.12',
            command: 'uptime',
            requiresApproval: false,
            interactive: false
          }
        }
      ]
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        text: '负载正常，无需继续执行命令。',
        provider: 'openai',
        model: 'ops-chat'
      }
    })
    const fetchCalls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls
    const requestBody = JSON.parse(String(fetchCalls[0]?.[1]?.body || '{}')) as { messages: Array<{ role: string; content: string }> }
    expect(requestBody.messages[0]?.role).toBe('system')
    expect(requestBody.messages[0]?.content).toContain('Agent mode tool contract:')
    expect(requestBody.messages[0]?.content).toContain('After the conversation includes command_output from an approved command')
    expect(requestBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('Requested command:')
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Command output for "uptime":')
        })
      ])
    )
  })

  it('turns command-mode fenced shell output into backend-owned read-only command cards', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: '可以先查询进程：\n\n```bash\nps aux | grep nginx\n```'
              }
            }
          ]
        })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 66_000,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-command-fence',
      assistantMessageId: 'aichat-request-command-fence-assistant',
      prompt: '生成查询 nginx 进程的命令',
      model: 'ops-chat',
      mode: 'command',
      contexts: [{ id: 'host-prod-1', kind: 'hosts', label: 'prod-1', detail: 'production' }]
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      message: {
        id: 'aichat-request-command-fence-assistant',
        role: 'assistant',
        text: 'ps aux | grep nginx',
        state: 'done',
        ask: 'command',
        commandExecution: {
          ip: 'prod-1',
          command: 'ps aux | grep nginx',
          requiresApproval: false,
          interactive: false
        }
      }
    })
  })

  it('keeps command-mode state-changing command suggestions approval-gated', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Command: systemctl restart nginx'
              }
            }
          ]
        })
    })) as unknown as typeof fetch

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 67_000,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-command-risky',
      assistantMessageId: 'aichat-request-command-risky-assistant',
      prompt: '生成重启 nginx 的命令',
      model: 'ops-chat',
      mode: 'command'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      message: {
        id: 'aichat-request-command-risky-assistant',
        ask: 'command',
        commandExecution: {
          ip: 'local',
          command: 'systemctl restart nginx',
          requiresApproval: true,
          interactive: false
        }
      }
    })
  })

  it('turns provider MCP resource blocks into backend-owned approval messages', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '<access_mcp_resource><server_name>filesystem</server_name><uri>file:///workspace</uri></access_mcp_resource>'
              }
            }
          ]
        })
    })) as unknown as typeof fetch
    const readMcpResource = vi.fn()

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 75_000,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
          mcpServers: [
            {
              name: 'filesystem',
              status: 'connected',
              disabled: false,
              tools: [],
              resources: [{ uri: 'file:///workspace', name: 'Workspace', description: 'Workspace files', mimeType: 'text/plain' }]
            }
          ],
          mcpToolStates: {},
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-mcp-resource',
      assistantMessageId: 'aichat-request-mcp-resource-assistant',
      prompt: '读取工作区资源',
      model: 'ops-chat'
    })

    expect(result.ok).toBe(true)
    expect(readMcpResource).not.toHaveBeenCalled()
    expect(result.data).toMatchObject({
      text: '请求访问 MCP Resource filesystem:file:///workspace。',
      message: {
        id: 'aichat-request-mcp-resource-assistant',
        role: 'assistant',
        state: 'done',
        ask: 'mcp_resource_access',
        mcpResourceAccess: {
          serverName: 'filesystem',
          uri: 'file:///workspace'
        }
      }
    })
  })

  it('auto-executes provider MCP tool blocks when the tool is configured for auto approve', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '<use_mcp_tool><server_name>filesystem</server_name><tool_name>read_file</tool_name><arguments>{"path":"/tmp/readme.md"}</arguments></use_mcp_tool>'
              }
            }
          ]
        })
    })) as unknown as typeof fetch
    const callMcpTool = vi.fn(async (input: McpToolCallInput): Promise<McpToolCallResult> => ({
      ok: true,
      data: {
        serverName: input.serverName,
        toolName: input.toolName,
        arguments: input.arguments,
        content: [{ type: 'text', text: 'README contents' }],
        isError: false,
        durationMs: 2
      }
    }))

    configureAiChatRuntime({
      fetch: fetchMock,
      now: () => 80_000,
      callMcpTool,
      getConfig: () =>
        ({
          modelName: 'ops-chat',
          mcpServers: [
            {
              name: 'filesystem',
              status: 'connected',
              disabled: false,
              tools: [{ name: 'read_file', description: 'Read file', enabled: true, autoApprove: true, parameters: [] }],
              resources: []
            }
          ],
          mcpToolStates: { 'filesystem:read_file': true },
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
        }) as unknown as UserConfig
    })

    const result = await generateAiChatResponse({
      requestId: 'aichat-request-mcp-auto',
      assistantMessageId: 'aichat-request-mcp-auto-assistant',
      prompt: '读取文件',
      model: 'ops-chat'
    })

    expect(callMcpTool).toHaveBeenCalledWith({
      serverName: 'filesystem',
      toolName: 'read_file',
      arguments: { path: '/tmp/readme.md' }
    })
    expect(result).toMatchObject({
      ok: true,
      data: {
        text: 'README contents',
        message: {
          id: 'aichat-request-mcp-auto-assistant',
          say: 'command_output',
          action: 'approved',
          state: 'done',
          text: 'README contents'
        }
      }
    })
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
    expect(listAiTodoSnapshot().data).toMatchObject({ focusedTodoId: null, totalTodos: 0, completedTodos: 0, todos: [] })
  })

  it('rejects local assistant generation unless the backend double is explicitly enabled', async () => {
    const wait = vi.fn()
    configureAiChatRuntime({
      wait
    })

    await expect(
      generateAiChatResponse({
        prompt: '检查生产磁盘',
        model: 'aiopsterm-local-agent'
      })
    ).resolves.toEqual({
      ok: false,
      errorCode: 'AI_CHAT_PROVIDER_UNAVAILABLE',
      errorMessage: 'AI chat provider is unavailable'
    })
    expect(wait).not.toHaveBeenCalled()
    expect(listAiTodoSnapshot().data).toMatchObject({ focusedTodoId: null, totalTodos: 0, completedTodos: 0, todos: [] })
  })

  it('allows local assistant generation when the backend double environment switch is enabled', async () => {
    process.env.AIOPSTERM_AI_CHAT_BACKEND_DOUBLE = '1'
    let nowMs = 70_000
    const wait = vi.fn(async (durationMs: number) => {
      nowMs += durationMs
    })
    configureAiChatRuntime({
      now: () => nowMs,
      wait
    })

    const result = await generateAiChatResponse({
      prompt: '检查生产磁盘',
      model: 'aiopsterm-local-agent'
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      provider: 'aiopsterm-local',
      model: 'aiopsterm-local-agent',
      status: 'done'
    })
    expect(wait).toHaveBeenCalledWith(localAiChatResponseMinDelayMs)
  })

  it('cancels active local responses at the backend boundary', async () => {
    let nowMs = 50_000
    const waits: Array<{ durationMs: number; resolve: () => void }> = []
    configureAiChatRuntime({
      localBackendDouble: true,
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
    expect(listAiTodoSnapshot().data).toMatchObject({ focusedTodoId: null, totalTodos: 0, completedTodos: 0, todos: [] })
  })
})
