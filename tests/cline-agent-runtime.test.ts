import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLINE_AGENT_PROTOCOL_VERSION,
  type ClineAgentSidecarCallback,
  type ClineAgentTurnResult
} from '../src/shared/contracts/clineAgent'

const aiChatBackendMocks = vi.hoisted(() => ({
  createAiChatExchangeRequest: vi.fn(() => ({ ok: true, data: {} })),
  generateAiChatResponse: vi.fn(async () => ({ ok: true, data: {} })),
  cancelAiChatResponse: vi.fn(() => ({ ok: true, data: {} }))
}))

const proxyFetchBackendMocks = vi.hoisted(() => ({
  createAiProviderProxyFetch: vi.fn()
}))

const terminalBridgeMocks = vi.hoisted(() => ({
  callCodexTerminalBridgeTool: vi.fn(),
  cancelCodexTerminalBridgeCommand: vi.fn()
}))

vi.mock('../src/main/backend/ai/aiChat', () => aiChatBackendMocks)
vi.mock('../src/main/backend/ai/aiProviderProxyFetch', () => proxyFetchBackendMocks)
vi.mock('../src/main/backend/codex/codexTerminalBridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callCodexTerminalBridgeTool: terminalBridgeMocks.callCodexTerminalBridgeTool,
  cancelCodexTerminalBridgeCommand: terminalBridgeMocks.cancelCodexTerminalBridgeCommand
}))

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/agent/clineAgentRuntime'
  return (await import(modulePath)) as any
}

const loadOwnerRuntime = async () => {
  const modulePath = '../src/main/backend/agent/clineAgentOwnerRuntime'
  return (await import(modulePath)) as any
}

const loadIpc = async () => {
  const modulePath = '../src/main/ipc/clineAgent'
  return (await import(modulePath)) as any
}

const loadAiChatIpc = async () => {
  const modulePath = '../src/main/ipc/aiChat'
  return (await import(modulePath)) as any
}

const turnResult = (input: Record<string, unknown>): ClineAgentTurnResult => ({
  sessionId: String(input.sessionId),
  taskId: String(input.taskId),
  turnId: String(input.turnId),
  text: 'done',
  finishReason: 'stop',
  iterations: 1
})

const runInput = (overrides: Record<string, unknown> = {}) => ({
  profile: 'classic-chat' as const,
  taskId: 'task-1',
  turnId: 'turn-1',
  conversationKey: 'conversation-1',
  prompt: 'Check the host',
  systemPrompt: 'You are a host assistant.',
  provider: { providerId: 'openai-compatible' as const, modelId: 'test-model' },
  tools: [],
  ...overrides
})

const providerFetchCallback = (payload: Record<string, unknown>, id: string): ClineAgentSidecarCallback => ({
  version: CLINE_AGENT_PROTOCOL_VERSION,
  kind: 'callback',
  id,
  callback: 'provider.fetch',
  payload: {
    sessionId: payload.sessionId,
    taskId: payload.taskId,
    turnId: payload.turnId,
    url: 'https://provider.example/v1/responses',
    method: 'POST',
    headers: { 'content-type': 'application/json' }
  }
})

const createAbortableProxyFetch = () => {
  let signal: AbortSignal | undefined
  const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    signal = init?.signal || undefined
    const rejectAbort = () => {
      const error = new Error('Provider proxy fetch was aborted.')
      error.name = 'AbortError'
      reject(error)
    }
    if (signal?.aborted) rejectAbort()
    else signal?.addEventListener('abort', rejectAbort, { once: true })
  }))
  return { fetch, getSignal: () => signal }
}

describe('Cline Agent Electron runtime boundary', () => {
  afterEach(async () => {
    const { closeClineAgentRuntime, configureClineAgentRuntime } = await loadRuntime()
    await closeClineAgentRuntime()
    configureClineAgentRuntime()
    proxyFetchBackendMocks.createAiProviderProxyFetch.mockReset()
    terminalBridgeMocks.callCodexTerminalBridgeTool.mockReset()
    terminalBridgeMocks.cancelCodexTerminalBridgeCommand.mockReset()
  })

  it('rejects tool definitions outside the exact profile allowlist before starting the sidecar', async () => {
    const { runClineAgentTurn } = await loadRuntime()

    await expect(runClineAgentTurn(runInput({
      tools: [{
        name: 'run_host_command',
        description: 'Unexpected host tool.',
        inputSchema: { type: 'object' },
        autoApprove: false
      }]
    }))).rejects.toThrow('requires exactly these tools: (none)')
  })

  it('preserves the renderer owner across asynchronous work and directs task events to that window only', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { currentClineAgentRendererOwner, withClineAgentRendererOwner } = await loadOwnerRuntime()
    await withClineAgentRendererOwner(22, async () => {
      await Promise.resolve()
      expect(currentClineAgentRendererOwner()).toBe(22)
    })

    const ownerSend = vi.fn()
    const otherSend = vi.fn()
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) =>
        method === 'session.send' ? turnResult(payload) : {}
      ),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({} as any),
      getWindows: () => [
        { webContents: { id: 11, send: otherSend, isDestroyed: () => false }, isDestroyed: () => false },
        { webContents: { id: 22, send: ownerSend, isDestroyed: () => false }, isDestroyed: () => false }
      ] as any,
      createSupervisor: () => supervisor as any
    })

    await expect(
      withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput()))
    ).resolves.toMatchObject({ status: 'done', result: { taskId: 'task-1', turnId: 'turn-1' } })

    expect(ownerSend).toHaveBeenCalledWith(
      'cline-agent:task-event',
      expect.objectContaining({ type: 'status', status: 'starting', taskId: 'task-1', turnId: 'turn-1' })
    )
    expect(otherSend).not.toHaveBeenCalled()
  })

  it('normalizes sidecar event sequence numbers into one strictly increasing task stream', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const ownerSend = vi.fn()
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const base = {
          protocolVersion: CLINE_AGENT_PROTOCOL_VERSION,
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          turnId: payload.turnId,
          at: '2026-07-11T00:00:00.000Z'
        }
        supervisorOptions.onEvent({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'event',
          event: 'agent.task',
          payload: { ...base, seq: 1, type: 'status', status: 'running' }
        })
        supervisorOptions.onEvent({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'event',
          event: 'agent.task',
          payload: { ...base, seq: 1, type: 'text-delta', text: 'done' }
        })
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({} as any),
      getWindows: () => [
        { webContents: { id: 22, send: ownerSend, isDestroyed: () => false }, isDestroyed: () => false }
      ] as any,
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput()))

    expect(ownerSend.mock.calls.map((call) => call[1].seq)).toEqual([1, 2, 3])
  })

  it('routes proxy-enabled provider fetch callbacks through the main SSH proxy fetch', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const upstreamBody = 'data: {"type":"response.output_text.delta","delta":"ok"}\n\n'
    const proxyFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(upstreamBody, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/event-stream' }
    }))
    proxyFetchBackendMocks.createAiProviderProxyFetch.mockReturnValue(proxyFetch)
    let supervisorOptions: any
    let startPayload: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method === 'session.start') {
          startPayload = payload
          return {}
        }
        if (method !== 'session.send') return {}
        const result = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'provider-fetch-1',
          callback: 'provider.fetch',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            url: 'https://provider.example/v1/responses',
            method: 'POST',
            headers: {
              authorization: 'Bearer provider-secret',
              'content-type': 'application/json'
            },
            bodyBase64: Buffer.from('{"model":"ops-model"}').toString('base64')
          }
        } satisfies ClineAgentSidecarCallback)
        expect(result).toMatchObject({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/event-stream' }
        })
        expect(Buffer.from(result.bodyBase64, 'base64').toString('utf8')).toBe(upstreamBody)
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    const aiPreferences = {
      needProxy: true,
      proxy: {
        type: 'SOCKS5',
        host: 'proxy.internal',
        port: 1080,
        enableProxyIdentity: true,
        username: 'proxy-user',
        password: 'proxy-password'
      }
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await runClineAgentTurn(runInput({
      provider: {
        providerId: 'openai-native',
        modelId: 'ops-model',
        useHostProxy: true
      }
    }))

    expect(startPayload.metadata).toMatchObject({ taskId: 'task-1', turnId: 'turn-1' })
    expect(startPayload.provider).toMatchObject({ useHostProxy: true })
    expect(JSON.stringify(startPayload)).not.toContain('proxy.internal')
    expect(JSON.stringify(startPayload)).not.toContain('proxy-user')
    expect(JSON.stringify(startPayload)).not.toContain('proxy-password')
    expect(proxyFetchBackendMocks.createAiProviderProxyFetch).toHaveBeenCalledWith(
      aiPreferences,
      { maxResponseBytes: 2 * 1024 * 1024 }
    )
    expect(proxyFetch).toHaveBeenCalledWith(
      'https://provider.example/v1/responses',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) })
    )
    const proxyInit = proxyFetch.mock.calls[0][1]!
    expect(Buffer.from(proxyInit.body as Uint8Array).toString('utf8')).toBe('{"model":"ops-model"}')
    expect(proxyInit.headers).toMatchObject({ authorization: 'Bearer provider-secret' })
  })

  it('aborts an in-flight provider proxy fetch before forwarding the task abort', async () => {
    const { abortClineAgentTask, configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const abortable = createAbortableProxyFetch()
    proxyFetchBackendMocks.createAiProviderProxyFetch.mockReturnValue(abortable.fetch)
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method === 'session.send') {
          await expect(supervisorOptions.onCallback(providerFetchCallback(payload, 'abort-fetch'))).rejects.toMatchObject({
            name: 'AbortError'
          })
          return turnResult(payload)
        }
        if (method === 'session.abort') {
          expect(abortable.getSignal()?.aborted).toBe(true)
        }
        return {}
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { needProxy: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const running = runClineAgentTurn(runInput({
      provider: { providerId: 'openai-native', modelId: 'ops-model', useHostProxy: true }
    }))
    await vi.waitFor(() => expect(abortable.fetch).toHaveBeenCalledTimes(1))

    await expect(abortClineAgentTask({ taskId: 'task-1', turnId: 'turn-1' })).resolves.toMatchObject({ ok: true })
    await expect(running).resolves.toMatchObject({ status: 'done' })
    expect(abortable.getSignal()?.aborted).toBe(true)
  })

  it('aborts an in-flight provider proxy fetch when the turn finishes', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const abortable = createAbortableProxyFetch()
    proxyFetchBackendMocks.createAiProviderProxyFetch.mockReturnValue(abortable.fetch)
    let supervisorOptions: any
    let callback: Promise<unknown> | undefined
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const pendingCallback = supervisorOptions.onCallback(providerFetchCallback(payload, 'finished-fetch')) as Promise<unknown>
        callback = pendingCallback
        void pendingCallback.catch(() => undefined)
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { needProxy: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await expect(runClineAgentTurn(runInput({
      provider: { providerId: 'openai-native', modelId: 'ops-model', useHostProxy: true }
    }))).resolves.toMatchObject({ status: 'done' })

    await vi.waitFor(() => expect(abortable.getSignal()?.aborted).toBe(true))
    await expect(callback).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('aborts in-flight provider proxy fetches when the sidecar exits', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const abortable = createAbortableProxyFetch()
    proxyFetchBackendMocks.createAiProviderProxyFetch.mockReturnValue(abortable.fetch)
    let supervisorOptions: any
    let finishTurn: ((result: ClineAgentTurnResult) => void) | undefined
    let callback: Promise<unknown> | undefined
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const pendingCallback = supervisorOptions.onCallback(providerFetchCallback(payload, 'exit-fetch')) as Promise<unknown>
        callback = pendingCallback
        void pendingCallback.catch(() => undefined)
        return new Promise<ClineAgentTurnResult>((resolve) => {
          finishTurn = resolve
        })
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { needProxy: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const running = runClineAgentTurn(runInput({
      provider: { providerId: 'openai-native', modelId: 'ops-model', useHostProxy: true }
    }))
    await vi.waitFor(() => expect(abortable.fetch).toHaveBeenCalledTimes(1))
    supervisorOptions.onExit({ code: 7, signal: null, errorMessage: 'sidecar exited' })

    expect(abortable.getSignal()?.aborted).toBe(true)
    await expect(callback).rejects.toMatchObject({ name: 'AbortError' })
    finishTurn?.(turnResult({ sessionId: 'session', taskId: 'task-1', turnId: 'turn-1' }))
    await expect(running).resolves.toMatchObject({ status: 'done' })
  })

  it('aborts in-flight provider proxy fetches before closing the runtime', async () => {
    const { closeClineAgentRuntime, configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const abortable = createAbortableProxyFetch()
    proxyFetchBackendMocks.createAiProviderProxyFetch.mockReturnValue(abortable.fetch)
    let supervisorOptions: any
    let finishTurn: ((result: ClineAgentTurnResult) => void) | undefined
    let callback: Promise<unknown> | undefined
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const pendingCallback = supervisorOptions.onCallback(providerFetchCallback(payload, 'close-fetch')) as Promise<unknown>
        callback = pendingCallback
        void pendingCallback.catch(() => undefined)
        return new Promise<ClineAgentTurnResult>((resolve) => {
          finishTurn = resolve
        })
      }),
      shutdown: vi.fn(async () => {
        expect(abortable.getSignal()?.aborted).toBe(true)
      })
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { needProxy: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const running = runClineAgentTurn(runInput({
      provider: { providerId: 'openai-native', modelId: 'ops-model', useHostProxy: true }
    }))
    await vi.waitFor(() => expect(abortable.fetch).toHaveBeenCalledTimes(1))
    await closeClineAgentRuntime()

    expect(abortable.getSignal()?.aborted).toBe(true)
    await expect(callback).rejects.toMatchObject({ name: 'AbortError' })
    expect(supervisor.shutdown).toHaveBeenCalledTimes(1)
    finishTurn?.(turnResult({ sessionId: 'session', taskId: 'task-1', turnId: 'turn-1' }))
    await expect(running).resolves.toMatchObject({ status: 'done' })
  })

  it('aborts only the active task owned by the invoking renderer', async () => {
    const { abortClineAgentTask, configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    let finishTurn: ((result: ClineAgentTurnResult) => void) | undefined
    let sendPayload: Record<string, unknown> = {}
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method === 'session.send') {
          sendPayload = payload
          return new Promise<ClineAgentTurnResult>((resolve) => {
            finishTurn = resolve
          })
        }
        if (method === 'session.abort') finishTurn?.(turnResult(sendPayload))
        return {}
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({} as any),
      getWindows: () => [],
      createSupervisor: () => supervisor as any
    })

    const running = withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput()))
    await vi.waitFor(() => expect(supervisor.request).toHaveBeenCalledWith('session.send', expect.any(Object)))
    await expect(abortClineAgentTask({ taskId: 'task-1', turnId: 'turn-1' }, 99)).resolves.toMatchObject({ ok: false })
    await expect(withClineAgentRendererOwner(22, () => abortClineAgentTask({
      taskId: 'task-1',
      turnId: 'turn-1',
      reason: 'operator_cancelled'
    }))).resolves.toEqual({
      ok: true,
      data: { taskId: 'task-1', turnId: 'turn-1', status: 'cancelled' }
    })
    await expect(running).resolves.toMatchObject({ status: 'done' })
    expect(supervisor.request).toHaveBeenCalledWith(
      'session.abort',
      expect.objectContaining({ reason: 'operator_cancelled' })
    )
  })

  it('requires the renderer and trusted terminal binding to match before resolving an approval', async () => {
    const {
      abortClineAgentTask,
      configureClineAgentRuntime,
      respondClineAgentApproval,
      runClineAgentTurn
    } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const ownerSend = vi.fn()
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const decision = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-callback-1',
          callback: 'approval.request',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-call-1',
            toolName: 'run_host_command',
            input: { command: 'uptime' },
            iteration: 1
          }
        } satisfies ClineAgentSidecarCallback)
        expect(decision).toEqual({ approved: true, reason: undefined })
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({} as any),
      getWindows: () => [
        { webContents: { id: 22, send: ownerSend, isDestroyed: () => false }, isDestroyed: () => false }
      ] as any,
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput({
      profile: 'classic-agent',
      terminalSessionId: 'terminal-trusted',
      tools: [{
        name: 'run_host_command',
        description: 'Run a trusted host command.',
        inputSchema: { type: 'object' },
        autoApprove: false
      }]
    })))

    expect(outcome).toMatchObject({
      status: 'approval-required',
      event: {
        type: 'approval-requested',
        taskId: 'task-1',
        turnId: 'turn-1',
        toolCallId: 'tool-call-1',
        terminalSessionId: 'terminal-trusted'
      }
    })
    const approval = {
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-1',
      terminalSessionId: 'terminal-trusted',
      approved: true
    }
    expect(respondClineAgentApproval({ ...approval, terminalSessionId: 'terminal-spoofed' }, 22)).toMatchObject({ ok: false })
    expect(respondClineAgentApproval(approval, 99)).toMatchObject({ ok: false })
    expect(respondClineAgentApproval(approval, 22)).toEqual({
      ok: true,
      data: {
        taskId: 'task-1',
        turnId: 'turn-1',
        toolCallId: 'tool-call-1',
        terminalSessionId: 'terminal-trusted',
        status: 'approved'
      }
    })
    await vi.waitFor(() => expect(supervisor.request).toHaveBeenCalledTimes(2))
    await expect(abortClineAgentTask({ taskId: 'task-1' }, 99)).resolves.toMatchObject({ ok: false })
  })

  it('does not execute a host tool callback without a matching main-process approval', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'tool-without-approval',
          callback: 'tool.execute',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-call-unapproved',
            toolName: 'run_host_command',
            input: { command: 'uptime' }
          }
        } satisfies ClineAgentSidecarCallback)).rejects.toThrow('has not been approved')
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({} as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      terminalSessionId: 'terminal-trusted',
      tools: [{
        name: 'run_host_command',
        description: 'Run a trusted host command.',
        inputSchema: { type: 'object' },
        autoApprove: false
      }]
    }))).resolves.toMatchObject({ status: 'done' })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).not.toHaveBeenCalled()
  })

  it('executes an approved toolCallId once and caps the host output returned to Cline', async () => {
    const {
      configureClineAgentRuntime,
      respondClineAgentApproval,
      runClineAgentTurn
    } = await loadRuntime()
    const output = 'x'.repeat(256 * 1024 + 17)
    terminalBridgeMocks.callCodexTerminalBridgeTool.mockResolvedValue({
      ok: true,
      target: { sessionId: 'terminal-trusted' },
      data: { output, exitCode: 0 }
    })
    let supervisorOptions: any
    let finishSend: (value: unknown) => void = () => undefined
    let failSend: (error: unknown) => void = () => undefined
    const sendCompleted = new Promise((resolve, reject) => {
      finishSend = resolve
      failSend = reject
    })
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        try {
          const decision = await supervisorOptions.onCallback({
            version: CLINE_AGENT_PROTOCOL_VERSION,
            kind: 'callback',
            id: 'approval-for-idempotent-tool',
            callback: 'approval.request',
            payload: {
              sessionId: payload.sessionId,
              taskId: payload.taskId,
              turnId: payload.turnId,
              toolCallId: 'tool-call-idempotent',
              toolName: 'run_host_command',
              input: { command: 'uptime' },
              iteration: 1
            }
          } satisfies ClineAgentSidecarCallback)
          expect(decision).toEqual({ approved: true, reason: undefined })
          const callback = {
            version: CLINE_AGENT_PROTOCOL_VERSION,
            kind: 'callback',
            id: 'execute-idempotent-tool',
            callback: 'tool.execute',
            payload: {
              sessionId: payload.sessionId,
              taskId: payload.taskId,
              turnId: payload.turnId,
              toolCallId: 'tool-call-idempotent',
              toolName: 'run_host_command',
              input: { command: 'uptime' }
            }
          } satisfies ClineAgentSidecarCallback
          const [first, duplicate] = await Promise.all([
            supervisorOptions.onCallback(callback),
            supervisorOptions.onCallback({ ...callback, id: 'execute-idempotent-tool-retry' })
          ])
          expect(first).toEqual(duplicate)
          expect(first).toMatchObject({
            outputTruncated: true,
            originalOutputBytes: 256 * 1024 + 17,
            exitCode: 0
          })
          expect(Buffer.byteLength(first.output, 'utf8')).toBe(256 * 1024)
          await expect(supervisorOptions.onCallback({
            ...callback,
            id: 'execute-idempotent-tool-mismatch',
            payload: {
              ...callback.payload,
              input: { command: 'hostname' }
            }
          })).rejects.toThrow('reused a toolCallId')
          finishSend(undefined)
          return turnResult(payload)
        } catch (error) {
          failSend(error)
          throw error
        }
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({} as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await runClineAgentTurn(runInput({
      profile: 'classic-agent',
      terminalSessionId: 'terminal-trusted',
      tools: [{
        name: 'run_host_command',
        description: 'Run a trusted host command.',
        inputSchema: { type: 'object' },
        autoApprove: false
      }]
    }))
    expect(outcome).toMatchObject({ status: 'approval-required' })
    expect(respondClineAgentApproval({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-idempotent',
      terminalSessionId: 'terminal-trusted',
      approved: true
    })).toMatchObject({ ok: true })
    await expect(sendCompleted).resolves.toBeUndefined()
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).toHaveBeenCalledTimes(1)
  })

  it('registers automatic read-only approval before executing the host tool', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    terminalBridgeMocks.callCodexTerminalBridgeTool.mockResolvedValue({ ok: true, data: { output: 'ok', exitCode: 0 } })
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const callbackPayload = {
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          turnId: payload.turnId,
          toolCallId: 'tool-call-auto-approved',
          toolName: 'run_host_command',
          input: { command: 'uptime' }
        }
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-auto',
          callback: 'approval.request',
          payload: { ...callbackPayload, iteration: 1 }
        } satisfies ClineAgentSidecarCallback)).resolves.toEqual({ approved: true })
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'execute-auto',
          callback: 'tool.execute',
          payload: callbackPayload
        } satisfies ClineAgentSidecarCallback)).resolves.toMatchObject({ output: 'ok', exitCode: 0 })
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { autoApproval: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      terminalSessionId: 'terminal-trusted',
      tools: [{
        name: 'run_host_command',
        description: 'Run a trusted host command.',
        inputSchema: { type: 'object' },
        autoApprove: false
      }]
    }))).resolves.toMatchObject({ status: 'done' })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).toHaveBeenCalledTimes(1)
  })

  it('interrupts an in-flight terminal command when the Agent task is aborted', async () => {
    const { abortClineAgentTask, configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    let finishCommand: (value: unknown) => void = () => undefined
    terminalBridgeMocks.callCodexTerminalBridgeTool.mockImplementation(() => new Promise((resolve) => {
      finishCommand = resolve
    }))
    terminalBridgeMocks.cancelCodexTerminalBridgeCommand.mockImplementation((_commandId: string, reason: string) => {
      finishCommand({ ok: false, errorCode: 'COMMAND_ABORTED', errorMessage: reason })
      return true
    })
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method === 'session.abort') return {}
        if (method !== 'session.send') return {}
        const callbackPayload = {
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          turnId: payload.turnId,
          toolCallId: 'tool-call-abort',
          toolName: 'run_host_command',
          input: { command: 'uptime' }
        }
        await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-abort',
          callback: 'approval.request',
          payload: { ...callbackPayload, iteration: 1 }
        } satisfies ClineAgentSidecarCallback)
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'execute-abort',
          callback: 'tool.execute',
          payload: callbackPayload
        } satisfies ClineAgentSidecarCallback)).rejects.toThrow('operator stopped the Agent')
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { autoApproval: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const running = runClineAgentTurn(runInput({
      profile: 'classic-agent',
      terminalSessionId: 'terminal-trusted',
      tools: [{
        name: 'run_host_command',
        description: 'Run a trusted host command.',
        inputSchema: { type: 'object' },
        autoApprove: false
      }]
    }))
    await vi.waitFor(() => expect(terminalBridgeMocks.callCodexTerminalBridgeTool).toHaveBeenCalledTimes(1))

    await expect(abortClineAgentTask({
      taskId: 'task-1',
      turnId: 'turn-1',
      reason: 'operator stopped the Agent'
    })).resolves.toMatchObject({ ok: true })
    await expect(running).resolves.toMatchObject({ status: 'done' })
    expect(terminalBridgeMocks.cancelCodexTerminalBridgeCommand).toHaveBeenCalledWith(
      expect.stringMatching(/^cline_[a-f0-9]{32}$/),
      'operator stopped the Agent'
    )
  })

  it('rejects a pending approval when the sidecar turn ends first', async () => {
    const {
      configureClineAgentRuntime,
      respondClineAgentApproval,
      runClineAgentTurn
    } = await loadRuntime()
    let supervisorOptions: any
    let approvalDecision: Promise<{ approved: boolean; reason?: string }> | undefined
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        approvalDecision = supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-abandoned',
          callback: 'approval.request',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-call-abandoned',
            toolName: 'run_host_command',
            input: { command: 'uptime' },
            iteration: 1
          }
        } satisfies ClineAgentSidecarCallback)
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({} as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await runClineAgentTurn(runInput({
      profile: 'classic-agent',
      terminalSessionId: 'terminal-trusted',
      tools: [{
        name: 'run_host_command',
        description: 'Run a trusted host command.',
        inputSchema: { type: 'object' },
        autoApprove: false
      }]
    }))
    expect(['approval-required', 'done']).toContain(outcome.status)
    await expect(approvalDecision).resolves.toEqual({
      approved: false,
      reason: 'The Cline Agent turn ended before approval completed.'
    })
    expect(respondClineAgentApproval({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-abandoned',
      terminalSessionId: 'terminal-trusted',
      approved: true
    })).toMatchObject({ ok: false })
  })

  it('forwards approval and abort IPC calls with the invoking webContents owner', async () => {
    const { registerClineAgentIpc } = await loadIpc()
    const handlers = new Map<string, (event: any, input: any) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, input: any) => unknown) => handlers.set(channel, handler))
    } as any
    const respondApproval = vi.fn(() => ({ ok: true, data: {} } as any))
    const abortTask = vi.fn(async () => ({ ok: true, data: {} } as any))
    registerClineAgentIpc(ipcMain, { respondApproval, abortTask })
    const event = { sender: { id: 41 } }
    const approval = {
      taskId: 'task-ipc',
      turnId: 'turn-ipc',
      toolCallId: 'tool-ipc',
      terminalSessionId: 'terminal-ipc',
      approved: false
    }
    const abort = { taskId: 'task-ipc', turnId: 'turn-ipc' }

    await handlers.get('cline-agent:approval:respond')?.(event, approval)
    await handlers.get('cline-agent:task:abort')?.(event, abort)

    expect(respondApproval).toHaveBeenCalledWith(approval, 41)
    expect(abortTask).toHaveBeenCalledWith(abort, 41)
    expect(handlers.get('cline-agent:approval:respond')?.(event, null)).toEqual({
      ok: false,
      errorCode: 'CLINE_AGENT_APPROVAL_INVALID',
      errorMessage: 'Cline Agent approval input is invalid.'
    })
    expect([...handlers.keys()]).toEqual(['cline-agent:approval:respond', 'cline-agent:task:abort'])
  })

  it('rejects terminal bindings that are not owned by the invoking renderer', async () => {
    const { registerAiChatIpc } = await loadAiChatIpc()
    const handlers = new Map<string, (event: any, input: any) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, input: any) => unknown) => handlers.set(channel, handler))
    } as any
    registerAiChatIpc(ipcMain, {
      isTrustedTerminalSession: (event: any, terminalSessionId: string) =>
        event.sender.id === 41 && terminalSessionId === 'terminal-owned'
    })
    const event = { sender: { id: 41 } }

    expect(handlers.get('ai:chat-response')?.(event, {
      prompt: 'inspect host',
      terminalSessionId: 'terminal-other',
      mode: 'agent'
    })).toEqual({
      ok: false,
      errorCode: 'AI_CHAT_TERMINAL_SESSION_INVALID',
      errorMessage: 'The selected terminal session is unavailable for this window.'
    })
    expect(aiChatBackendMocks.generateAiChatResponse).not.toHaveBeenCalled()

    await handlers.get('ai:chat-response')?.(event, {
      prompt: 'inspect host',
      terminalSessionId: 'terminal-owned',
      mode: 'agent'
    })
    expect(aiChatBackendMocks.generateAiChatResponse).toHaveBeenCalledWith(expect.objectContaining({ terminalSessionId: 'terminal-owned' }))
  })
})
