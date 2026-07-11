import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserConfig } from '@shared/contracts/userConfig'

let classicClineSeedMessages: (messages: any[], prompt: string) => Array<{ role: string; content: string }>
let generateClassicClineResponse: (input: any) => Promise<any>

beforeAll(async () => {
  const modulePath = '../src/main/backend/ai/classicClineAiChatRuntime'
  const runtime = await import(modulePath)
  classicClineSeedMessages = runtime.classicClineSeedMessages
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
      conversationKey: 'conversation-1\u0000locale:zh-cn',
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

  it('maps Command proposal tool output into the existing command card contract', async () => {
    const runTurn = vi.fn(async () => doneOutcome({
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
          commandExecution: { command: 'df -h', requiresApproval: false },
          agentTask: { toolCallId: 'proposal-1', toolName: 'propose_host_command', status: 'done' }
        }
      }
    })
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
        terminalSessionId: 'terminal-session-1',
        input: { command: 'systemctl restart api' },
        iteration: 1,
        reason: 'State-changing command'
      }
    }))
    const result = await generateClassicClineResponse({
      request: {
        requestId: 'request-agent',
        assistantMessageId: 'request-agent-assistant',
        conversationId: 'conversation-agent',
        terminalSessionId: 'terminal-session-1',
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
          commandExecution: { command: 'systemctl restart api', requiresApproval: true },
          agentTask: {
            taskId: 'request-agent',
            turnId: 'request-agent-assistant',
            toolCallId: 'host-tool-1',
            terminalSessionId: 'terminal-session-1',
            status: 'waiting-approval'
          }
        }
      }
    })
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'classic-agent',
      conversationKey: 'conversation-agent\u0000locale:zh-cn\u0000terminal:terminal-session-1',
      terminalSessionId: 'terminal-session-1'
    }))
  })

  it('requires a stable conversation and an active terminal for Agent mode', async () => {
    const runTurn = vi.fn()
    await expect(generateClassicClineResponse({
      request: { prompt: 'inspect disk', mode: 'chat' },
      config: providerConfig(),
      modelName: 'ops-model',
      runTurn
    })).resolves.toMatchObject({ ok: false, errorCode: 'AI_CHAT_CLINE_CONVERSATION_REQUIRED' })
    await expect(generateClassicClineResponse({
      request: { conversationId: 'conversation-1', prompt: 'inspect disk', mode: 'agent' },
      config: providerConfig(),
      modelName: 'ops-model',
      runTurn
    })).resolves.toMatchObject({ ok: false, errorCode: 'AI_CHAT_TERMINAL_SESSION_REQUIRED' })
    expect(runTurn).not.toHaveBeenCalled()
  })
})
