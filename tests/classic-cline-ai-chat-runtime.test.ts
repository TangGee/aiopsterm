import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserConfig } from '@shared/contracts/userConfig'

let classicClineSeedMessages: (messages: any[], prompt: string) => Array<{ role: string; content: string }>
let classicClineSessionScopeKey: (conversationId: string) => string
let classicClineNativeBinding: (request: any, language?: string) => {
  profile: string
  scopeKey: string
  nativeSessionId: string
}
let generateClassicClineResponse: (input: any) => Promise<any>

beforeAll(async () => {
  const modulePath = '../src/main/backend/ai/classicClineAiChatRuntime'
  const runtime = await import(modulePath)
  classicClineSeedMessages = runtime.classicClineSeedMessages
  classicClineSessionScopeKey = runtime.classicClineSessionScopeKey
  classicClineNativeBinding = runtime.classicClineNativeBinding
  generateClassicClineResponse = runtime.generateClassicClineResponse
})

const providerConfig = (language = 'zh-CN') =>
  ({
    language,
    modelName: 'ops-model',
    modelProvider: 'openai-compatible',
    modelSettings: {
      addModelSwitch: true,
      options: [{ name: 'ops-model', checked: true, locked: false, apiProvider: 'openai' }],
      providers: {
        openai: {
          baseUrl: 'http://127.0.0.1:4010',
          apiKey: 'sk-test',
          modelId: 'ops-model',
          apiFormat: 'chat-completions'
        }
      }
    }
  }) as UserConfig

const doneOutcome = (input: Record<string, unknown> = {}) => ({
  status: 'done',
  result: {
    sessionId: 'cline-session',
    taskId: 'request-1',
    turnId: 'request-1-assistant',
    text: '磁盘使用正常。',
    finishReason: 'stop',
    iterations: 1,
    ...input
  }
})

const agentHostTarget = {
  targetId: 'asset-api',
  terminalSessionId: 'terminal-session-1',
  label: 'API production',
  kind: 'ssh' as const,
  cwd: '/srv/api'
}

describe('Classic Cline AI chat adapter', () => {
  it('seeds the complete existing transcript once and excludes the current prompt', () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      text: `history-${index}`
    }))
    messages.push({ role: 'user', text: 'current request' })

    const seed = classicClineSeedMessages(messages, 'current request')

    expect(seed).toHaveLength(24)
    expect(seed[0]).toEqual({ role: 'user', content: 'history-0' })
    expect(seed.at(-1)).toEqual({ role: 'assistant', content: 'history-23' })
  })

  it('maps Chat mode to a tool-free Cline turn with Chinese locale instructions', async () => {
    const runTurn = vi.fn(async (input) => doneOutcome({ taskId: input.taskId, turnId: input.turnId }))
    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-1',
        assistantMessageId: 'request-1-assistant',
        conversationId: 'conversation-1',
        prompt: '检查磁盘',
        messages: [{ role: 'user', text: '之前的问题' }, { role: 'assistant', text: '之前的回答' }, { role: 'user', text: '检查磁盘' }],
        mode: 'chat'
      },
      config: providerConfig(),
      modelName: 'ops-model',
      runTurn
    })

    expect(result).toMatchObject({ ok: true, data: { text: '磁盘使用正常。', provider: 'openai', agentTask: { status: 'done' } } })
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'classic-chat',
      conversationKey: classicClineSessionScopeKey('conversation-1'),
      taskId: 'request-1',
      turnId: 'request-1-assistant',
      tools: [],
      initialMessages: [
        { role: 'user', content: '之前的问题' },
        { role: 'assistant', content: '之前的回答' }
      ],
      maxIterations: 8,
      systemPrompt: expect.stringContaining('使用简体中文回答')
    }))
  })

  it('passes validated provider images to the official Cline turn', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    const runTurn = vi.fn(async (input) => doneOutcome({ taskId: input.taskId, turnId: input.turnId }))
    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-image',
        assistantMessageId: 'request-image-assistant',
        conversationId: 'conversation-image',
        prompt: 'explain the screenshot',
        userImages: [`data:image/png;base64,${png}`],
        mode: 'chat'
      },
      config: providerConfig('en-US'),
      modelName: 'ops-model',
      runTurn
    })

    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      userImages: [`data:image/png;base64,${png}`]
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects an invalid provider image instead of silently omitting it', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
    const runTurn = vi.fn(async (input) => doneOutcome({ taskId: input.taskId, turnId: input.turnId }))
    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-invalid-image',
        assistantMessageId: 'request-invalid-image-assistant',
        conversationId: 'conversation-invalid-image',
        prompt: 'explain the screenshot',
        userImages: [`data:image/jpeg;base64,${png}`],
        mode: 'chat'
      },
      config: providerConfig('en-US'),
      modelName: 'ops-model',
      runTurn
    })

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'AI_CHAT_IMAGE_INVALID',
      errorMessage: expect.stringContaining('不支持的图片类型')
    })
    expect(runTurn).not.toHaveBeenCalled()
  })

  it('requests canonical transcript replacement for an edited or retried turn', async () => {
    const runTurn = vi.fn(async (input) => doneOutcome({ taskId: input.taskId, turnId: input.turnId }))
    await generateClassicClineResponse({
      request: {
        requestId: 'request-revision',
        assistantMessageId: 'request-revision-assistant',
        conversationId: 'conversation-revision',
        prompt: 'revised question',
        messages: [
          { role: 'user', text: 'kept question' },
          { role: 'assistant', text: 'kept answer' },
          { role: 'user', text: 'revised question' }
        ],
        replaceNativeTranscript: true,
        mode: 'chat'
      },
      config: providerConfig('en-US'),
      modelName: 'ops-model',
      runTurn
    })

    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      replaceTranscript: true,
      initialMessages: [
        { role: 'user', content: 'kept question' },
        { role: 'assistant', content: 'kept answer' }
      ]
    }))
  })

  it('keeps the Agent native session stable when a host target reconnects to a new terminal runtime', () => {
    const request = {
      conversationId: 'conversation-agent-stable',
      prompt: 'inspect',
      mode: 'agent',
      hostTargets: [{
        targetId: 'asset-orders',
        terminalSessionId: 'terminal-first',
        label: 'Orders',
        kind: 'ssh'
      }]
    }
    const first = classicClineNativeBinding(request, 'zh-CN')
    const second = classicClineNativeBinding({
      ...request,
      hostTargets: [{ ...request.hostTargets[0], terminalSessionId: 'terminal-second' }]
    }, 'zh-CN')

    expect(second.scopeKey).toBe(first.scopeKey)
    expect(second.nativeSessionId).toBe(first.nativeSessionId)
    expect(first.scopeKey).toBe(classicClineSessionScopeKey(request.conversationId))
    expect(first.scopeKey).toBe(request.conversationId)
    expect(first.scopeKey).not.toContain('terminal-first')
  })

  it('maps Command proposal tool output into the existing command card contract', async () => {
    const runTurn = vi.fn(async (_turnInput: any) => doneOutcome({
      text: '',
      toolCalls: [{
        id: 'proposal-1',
        name: 'propose_host_command',
        input: { command: 'df -h', rationale: 'Inspect disk usage.' },
        output: { command: 'df -h', rationale: 'Inspect disk usage.' }
      }]
    }))
    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-command',
        assistantMessageId: 'request-command-assistant',
        conversationId: 'conversation-command',
        prompt: 'give me a disk command',
        mode: 'command'
      },
      config: providerConfig('en-US'),
      modelName: 'ops-model',
      runTurn
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        text: 'Inspect disk usage.',
        message: {
          id: 'request-command-assistant',
          ask: 'command',
          text: 'df -h',
          commandExecution: { ip: '', command: 'df -h', requiresApproval: false },
          agentTask: { toolCallId: 'proposal-1', toolName: 'propose_host_command', status: 'done' }
        }
      }
    })
  })

  it('binds a Command proposal and card to the selected host target', async () => {
    const runTurn = vi.fn(async (_turnInput: any) => doneOutcome({
      text: '',
      toolCalls: [{
        id: 'proposal-targeted',
        name: 'propose_host_command',
        input: { targetId: agentHostTarget.targetId, command: 'df -h' },
        output: { targetId: agentHostTarget.targetId, command: 'df -h' }
      }]
    }))

    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-command-targeted',
        assistantMessageId: 'request-command-targeted-assistant',
        conversationId: 'conversation-command-targeted',
        hostTargets: [agentHostTarget],
        prompt: 'check disk on API production',
        mode: 'command'
      },
      config: providerConfig('en-US'),
      modelName: 'ops-model',
      runTurn
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        message: {
          commandExecution: { ip: agentHostTarget.label, command: 'df -h' },
          agentTask: {
            targetId: agentHostTarget.targetId,
            targetLabel: agentHostTarget.label,
            terminalSessionId: agentHostTarget.terminalSessionId
          }
        }
      }
    })
    const turnInput = runTurn.mock.calls[0][0]
    expect(turnInput.hostTargets).toEqual([agentHostTarget])
    expect(turnInput.tools[0].inputSchema.required).toEqual(['targetId', 'command'])
  })

  it('returns a trusted Agent approval card bound to the terminal session', async () => {
    const runTurn = vi.fn(async () => ({
      status: 'approval-required',
      event: {
        protocolVersion: 1,
        sessionId: 'cline-agent-session',
        taskId: 'request-agent',
        turnId: 'request-agent-assistant',
        seq: 3,
        at: '2026-07-11T00:00:00.000Z',
        type: 'approval-requested',
        toolCallId: 'host-tool-1',
        toolName: 'run_host_command',
        targetId: agentHostTarget.targetId,
        targetLabel: agentHostTarget.label,
        terminalSessionId: 'terminal-session-1',
        input: { targetId: agentHostTarget.targetId, command: 'systemctl restart api', requiresApproval: true },
        iteration: 1,
        reason: 'State-changing command'
      }
    }))
    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-agent',
        assistantMessageId: 'request-agent-assistant',
        conversationId: 'conversation-agent',
        hostTargets: [agentHostTarget],
        prompt: 'restart api',
        mode: 'agent'
      },
      config: providerConfig(),
      modelName: 'ops-model',
      runTurn
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        message: {
          ask: 'command',
          commandExecutionStatus: 'pending',
          commandExecution: { ip: agentHostTarget.label, command: 'systemctl restart api', requiresApproval: true },
          agentTask: {
            taskId: 'request-agent',
            turnId: 'request-agent-assistant',
            toolCallId: 'host-tool-1',
            targetId: agentHostTarget.targetId,
            targetLabel: agentHostTarget.label,
            terminalSessionId: 'terminal-session-1',
            status: 'waiting-approval'
          }
        }
      }
    })
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'classic-agent',
      conversationKey: classicClineSessionScopeKey('conversation-agent'),
      hostTargets: [agentHostTarget]
    }))
  })

  it('projects a model-declared read-only approval as eligible for session auto-run', async () => {
    const runTurn = vi.fn(async () => ({
      status: 'approval-required' as const,
      event: {
        protocolVersion: 1 as const,
        sessionId: 'cline-agent-session',
        taskId: 'request-agent-read-only',
        turnId: 'request-agent-read-only-assistant',
        seq: 3,
        at: '2026-07-11T00:00:00.000Z',
        type: 'approval-requested' as const,
        toolCallId: 'host-tool-read-only',
        toolName: 'run_host_command',
        targetId: agentHostTarget.targetId,
        targetLabel: agentHostTarget.label,
        terminalSessionId: 'terminal-session-1',
        input: { targetId: agentHostTarget.targetId, command: 'uptime', requiresApproval: false },
        iteration: 1,
        autoApprovable: true
      }
    }))
    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-agent-read-only',
        assistantMessageId: 'request-agent-read-only-assistant',
        conversationId: 'conversation-agent',
        hostTargets: [agentHostTarget],
        prompt: 'inspect load',
        mode: 'agent'
      },
      config: providerConfig(),
      modelName: 'ops-model',
      runTurn
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        message: {
          commandExecution: { ip: agentHostTarget.label, command: 'uptime', requiresApproval: false },
          agentTask: {
            targetId: agentHostTarget.targetId,
            targetLabel: agentHostTarget.label,
            status: 'waiting-approval'
          }
        }
      }
    })
  })

  it('returns a Cline-bound MCP resource approval card instead of treating it as a host command', async () => {
    const runTurn = vi.fn(async () => ({
      status: 'approval-required' as const,
      event: {
        protocolVersion: 1 as const,
        sessionId: 'cline-agent-session',
        taskId: 'request-resource',
        turnId: 'request-resource-assistant',
        seq: 2,
        at: '2026-07-11T00:00:00.000Z',
        type: 'approval-requested' as const,
        toolCallId: 'resource-tool-1',
        toolName: 'access_mcp_resource',
        serverName: 'inventory',
        resourceUri: 'inventory://hosts',
        input: { serverName: 'inventory', uri: 'inventory://hosts' },
        iteration: 1,
        autoApprovable: false
      }
    }))
    const config = providerConfig()
    config.mcpServers = [{
      name: 'inventory',
      status: 'connected',
      disabled: false,
      tools: [],
      resources: [{ name: 'Hosts', description: 'Managed hosts', uri: 'inventory://hosts' }]
    }]

    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-resource',
        assistantMessageId: 'request-resource-assistant',
        conversationId: 'conversation-resource',
        prompt: 'inspect inventory',
        mode: 'agent'
      },
      config,
      modelName: 'ops-model',
      runTurn
    })

    expect(result).toMatchObject({
      ok: true,
      data: {
        message: {
          ask: 'mcp_resource_access',
          mcpResourceAccess: { serverName: 'inventory', uri: 'inventory://hosts' },
          agentTask: {
            taskId: 'request-resource',
            turnId: 'request-resource-assistant',
            toolCallId: 'resource-tool-1',
            toolName: 'access_mcp_resource',
            status: 'waiting-approval'
          }
        }
      }
    })
    expect(result.data.message.agentTask.targetId).toBeUndefined()
  })

  it('requires a stable conversation and keeps host capabilities unavailable without host targets', async () => {
    const runTurn = vi.fn(async (input) => doneOutcome({ taskId: input.taskId, turnId: input.turnId }))
    const config = providerConfig()
    config.mcpServers = [{
      name: 'inventory',
      status: 'connected',
      disabled: false,
      tools: [],
      resources: [{ name: 'Hosts', description: 'Managed hosts', uri: 'inventory://hosts' }]
    }]
    await expect(generateClassicClineResponse({
      request: { prompt: 'inspect disk', mode: 'chat' },
      config,
      modelName: 'ops-model',
      runTurn
    })).resolves.toMatchObject({ ok: false, errorCode: 'AI_CHAT_CLINE_CONVERSATION_REQUIRED' })
    await expect(generateClassicClineResponse({
      request: { conversationId: 'conversation-1', prompt: 'inspect disk', mode: 'agent' },
      config,
      modelName: 'ops-model',
      runTurn
    })).resolves.toMatchObject({ ok: true, data: { text: '磁盘使用正常。' } })
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'classic-agent',
      hostTargets: [],
      tools: expect.arrayContaining([
        expect.objectContaining({ name: 'search_knowledge_base', autoApprove: true }),
        expect.objectContaining({ name: 'todo_read', autoApprove: true }),
        expect.objectContaining({ name: 'todo_write', autoApprove: true }),
        expect.objectContaining({ name: 'access_mcp_resource', autoApprove: false }),
        expect.objectContaining({ name: 'read_host_command_output', autoApprove: true })
      ]),
      systemPrompt: expect.stringContaining('"serverName":"inventory","uri":"inventory://hosts"')
    }))
    expect(runTurn.mock.calls[0]?.[0]?.systemPrompt).toContain('No host target is bound')
    const tools = runTurn.mock.calls[0]?.[0]?.tools || []
    expect(tools.map((tool: any) => tool.name)).not.toContain('run_host_command')
    expect(tools.map((tool: any) => tool.name)).not.toContain('read_host_file')
    expect(tools.map((tool: any) => tool.name)).not.toContain('search_host_files')
  })
})
