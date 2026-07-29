import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES,
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

const databaseMcpMocks = vi.hoisted(() => ({
  callBoundDatabaseAiMcpTool: vi.fn()
}))

vi.mock('../src/main/backend/ai/aiChat', () => aiChatBackendMocks)
vi.mock('../src/main/backend/ai/aiProviderProxyFetch', () => proxyFetchBackendMocks)
vi.mock('../src/main/backend/codex/codexTerminalBridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callCodexTerminalBridgeTool: terminalBridgeMocks.callCodexTerminalBridgeTool,
  cancelCodexTerminalBridgeCommand: terminalBridgeMocks.cancelCodexTerminalBridgeCommand
}))
vi.mock('../src/main/backend/database/databaseMcp', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callBoundDatabaseAiMcpTool: databaseMcpMocks.callBoundDatabaseAiMcpTool
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

const trustedHostTarget = {
  targetId: 'asset-trusted',
  terminalSessionId: 'terminal-trusted',
  label: 'Trusted host',
  kind: 'ssh' as const,
  cwd: '/srv/app'
}

const trustedHostBinding = {
  hostTargets: [trustedHostTarget]
}

const trustedApprovalTarget = {
  toolName: 'run_host_command',
  targetId: trustedHostTarget.targetId,
  targetLabel: trustedHostTarget.label,
  terminalSessionId: trustedHostTarget.terminalSessionId
}

const trustedHostCommand = (command: string, requiresApproval = false) => ({
  targetId: trustedHostTarget.targetId,
  command,
  requiresApproval
})

const hostCommandTool = () => ({
  name: 'run_host_command',
  description: 'Run a trusted host command.',
  inputSchema: { type: 'object' },
  autoApprove: false
})

const classicAgentAutoTool = (name: string) => ({
  name,
  description: `Test ${name}`,
  inputSchema: { type: 'object' },
  autoApprove: !['access_mcp_resource', 'read_host_file', 'search_host_files'].includes(name)
})

const classicAgentTools = (withHost = true) => [
  ...[
    'search_knowledge_base',
    'todo_read',
    'todo_write',
    'access_mcp_resource',
    'read_host_command_output',
    ...(withHost ? ['read_host_file', 'search_host_files'] : [])
  ].map(classicAgentAutoTool),
  ...(withHost ? [hostCommandTool()] : [])
]

const databaseTools = () => [
  'list_databases',
  'list_schemas',
  'list_tables',
  'search_database_objects',
  'describe_database_table',
  'get_database_table_ddl',
  'query_database_table',
  'sample_rows',
  'count_rows',
  'inspect_indexes',
  'explain_plan'
].map((name) => ({
  name,
  description: `Test ${name}`,
  inputSchema: { type: 'object' },
  autoApprove: true
}))

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
    databaseMcpMocks.callBoundDatabaseAiMcpTool.mockReset()
  })

  it('starts the sidecar on demand to permanently delete a persisted Cline session', async () => {
    const { configureClineAgentRuntime, deleteClineAgentSession } = await loadRuntime()
    const outputStore = {
      write: vi.fn(),
      read: vi.fn(),
      deleteSession: vi.fn(async () => undefined),
      prune: vi.fn(async () => 0)
    }
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method === 'session.delete') return { sessionId: payload.sessionId, deleted: true }
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
      outputStore: outputStore as any,
      createSupervisor: () => supervisor as any
    })

    await expect(deleteClineAgentSession('persisted-session')).resolves.toBe(true)
    expect(supervisor.request).toHaveBeenCalledWith('session.delete', { sessionId: 'persisted-session' })
    expect(outputStore.deleteSession).toHaveBeenCalledWith('persisted-session')
  })

  it('isolates an unresponsive sidecar stop before restarting the same native session', async () => {
    vi.useFakeTimers()
    try {
      const {
        CLINE_AGENT_SESSION_STOP_GRACE_MS,
        clineAgentSessionIdFor,
        configureClineAgentRuntime,
        deleteClineAgentSession,
        runClineAgentTurn,
        stopClineAgentSession
      } = await loadRuntime()
      const conversationKey = 'stuck-session-conversation'
      const sessionId = clineAgentSessionIdFor('classic-chat', conversationKey)
      const supervisor = {
        request: vi.fn((method: string, payload: Record<string, unknown>) => {
          if (method === 'session.delete') return Promise.resolve({ sessionId: payload.sessionId, deleted: true })
          if (method === 'session.stop') return new Promise(() => undefined)
          if (method === 'session.send') return Promise.resolve(turnResult(payload))
          return Promise.resolve({})
        }),
        forceTerminate: vi.fn(async () => undefined),
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
      await deleteClineAgentSession('bootstrap-sidecar')

      const stopping = stopClineAgentSession(sessionId)
      const restarting = runClineAgentTurn(runInput({
        conversationKey,
        taskId: 'task-after-stuck-stop',
        turnId: 'turn-after-stuck-stop'
      }))
      await Promise.resolve()
      expect(supervisor.request).not.toHaveBeenCalledWith('session.start', expect.anything())

      await vi.advanceTimersByTimeAsync(CLINE_AGENT_SESSION_STOP_GRACE_MS)
      await expect(stopping).resolves.toBe(true)
      await expect(restarting).resolves.toMatchObject({ status: 'done' })
      expect(supervisor.request).toHaveBeenCalledWith('session.stop', { sessionId })
      expect(supervisor.forceTerminate).toHaveBeenCalledWith(expect.stringContaining('session.stop exceeded'))
      const forceOrder = supervisor.forceTerminate.mock.invocationCallOrder[0]
      const startCall = supervisor.request.mock.calls.find((call) => call[0] === 'session.start')
      const startOrder = startCall
        ? supervisor.request.mock.invocationCallOrder[supervisor.request.mock.calls.indexOf(startCall)]
        : undefined
      expect(forceOrder).toBeLessThan(startOrder || 0)
    } finally {
      vi.useRealTimers()
    }
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

  it('keeps host-less Agent turns tool-free and rejects malformed host target allowlists', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()

    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) =>
        method === 'session.send' ? turnResult(payload) : {}),
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

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      tools: classicAgentTools(false)
    }))).resolves.toMatchObject({ status: 'done' })

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      taskId: 'task-tool-without-host',
      turnId: 'turn-tool-without-host',
      tools: classicAgentTools()
    }))).rejects.toThrow('requires exactly these tools')

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      hostTargets: Array.from({ length: 6 }, (_, index) => ({
        targetId: `asset-${index}`,
        terminalSessionId: `terminal-${index}`,
        label: `Host ${index}`,
        kind: 'ssh'
      })),
      tools: classicAgentTools()
    }))).rejects.toThrow('at most 5 host targets')

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      hostTargets: [
        trustedHostTarget,
        { ...trustedHostTarget, terminalSessionId: 'terminal-other' }
      ],
      tools: classicAgentTools()
    }))).rejects.toThrow('targetId is duplicated')

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      hostTargets: [
        trustedHostTarget,
        { ...trustedHostTarget, targetId: 'asset-other' }
      ],
      tools: classicAgentTools()
    }))).rejects.toThrow('terminalSessionId is duplicated')
  })

  it('executes a controlled knowledge search only inside a Classic Agent session', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const searchKnowledgeBase = vi.fn(async () => [{
      path: 'Runbooks/API.md',
      startLine: 5,
      endLine: 8,
      score: 1.2,
      matchCount: 1,
      snippet: 'Check the upstream timeout.'
    }])
    let supervisorOptions: any
    let toolResult: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        toolResult = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'classic-knowledge-search',
          callback: 'tool.execute',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-search-kb',
            toolName: 'search_knowledge_base',
            input: { query: 'upstream timeout', maxResults: 3 }
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
      searchKnowledgeBase,
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      tools: classicAgentTools(false)
    }))).resolves.toMatchObject({ status: 'done' })
    expect(searchKnowledgeBase).toHaveBeenCalledWith('upstream timeout', { maxResults: 3, minScore: 0.15 })
    expect(toolResult).toMatchObject({
      count: 1,
      untrusted: true,
      matches: [{ path: 'Runbooks/API.md', snippet: 'Check the upstream timeout.' }]
    })
  })

  it('passes canonical transcript replacement through the sidecar start boundary', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) =>
        method === 'session.send' ? turnResult(payload) : {}),
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

    await runClineAgentTurn(runInput({
      taskId: 'task-revision',
      turnId: 'turn-revision',
      replaceTranscript: true,
      initialMessages: [{ role: 'user', content: 'kept question' }]
    }))

    expect(supervisor.request).toHaveBeenCalledWith('session.start', expect.objectContaining({
      replaceTranscript: true,
      initialMessages: [{ role: 'user', content: 'kept question' }]
    }))
  })

  it('keeps every current DB tool fail-closed to the automatic read-only approval policy', async () => {
    const { runClineAgentTurn } = await loadRuntime()
    const tools = databaseTools()
    tools[0] = { ...tools[0], autoApprove: false }

    await expect(runClineAgentTurn(runInput({
      profile: 'database',
      database: { connectionId: 'connection-1', databaseName: 'metrics', schemaName: 'public' },
      tools
    }))).rejects.toThrow('invalid approval policy for database')
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
        supervisorOptions.onEvent({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'event',
          event: 'agent.task',
          payload: { ...base, seq: 1, type: 'done', text: 'done', finishReason: 'stop', iterations: 1 }
        })
        supervisorOptions.onEvent({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'event',
          event: 'agent.task',
          payload: { ...base, seq: 2, type: 'status', status: 'running' }
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

    expect(ownerSend.mock.calls.map((call) => call[1].seq)).toEqual([1, 2, 3, 4])
    expect(ownerSend.mock.calls.filter((call) => call[1].type === 'done')).toHaveLength(1)
  })

  it('executes each DB toolCallId independently, preserves structured failures, and emits one fallback done event', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const ownerSend = vi.fn()
    let supervisorOptions: any
    databaseMcpMocks.callBoundDatabaseAiMcpTool.mockImplementation(async (
      toolName: string,
      input: Record<string, unknown>,
      binding: Record<string, unknown>
    ) => toolName === 'describe_database_table'
      ? { ok: false, errorCode: 'DB_MCP_TABLE_NOT_FOUND', errorMessage: 'The table was not found.' }
      : { ok: true, data: { toolName, marker: input.marker, binding } })
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const callback = (id: string, toolCallId: string, toolName: string, marker: string) => ({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback' as const,
          id,
          callback: 'tool.execute' as const,
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId,
            toolName,
            input: { marker }
          }
        })
        const first = callback('db-callback-1', 'db-tool-call-1', 'search_database_objects', 'first')
        const second = callback('db-callback-2', 'db-tool-call-2', 'describe_database_table', 'second')
        const [firstResult, duplicateResult, secondResult] = await Promise.all([
          supervisorOptions.onCallback(first),
          supervisorOptions.onCallback({ ...first, id: 'db-callback-1-retry' }),
          supervisorOptions.onCallback(second)
        ])
        expect(firstResult).toEqual(duplicateResult)
        expect(firstResult).toMatchObject({ toolName: 'search_database_objects', marker: 'first' })
        expect(secondResult).toEqual({
          ok: false,
          errorCode: 'DB_MCP_TABLE_NOT_FOUND',
          errorMessage: 'The table was not found.'
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

    await expect(withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput({
      profile: 'database',
      database: { connectionId: 'connection-1', databaseName: 'metrics', schemaName: 'public' },
      tools: databaseTools()
    })))).resolves.toMatchObject({ status: 'done', result: { finishReason: 'stop' } })

    expect(databaseMcpMocks.callBoundDatabaseAiMcpTool).toHaveBeenCalledTimes(2)
    expect(databaseMcpMocks.callBoundDatabaseAiMcpTool).toHaveBeenNthCalledWith(
      1,
      'search_database_objects',
      { marker: 'first' },
      { connectionId: 'connection-1', databaseName: 'metrics', schemaName: 'public' },
      { signal: expect.any(AbortSignal) }
    )
    expect(databaseMcpMocks.callBoundDatabaseAiMcpTool).toHaveBeenNthCalledWith(
      2,
      'describe_database_table',
      { marker: 'second' },
      { connectionId: 'connection-1', databaseName: 'metrics', schemaName: 'public' },
      { signal: expect.any(AbortSignal) }
    )
    const terminalEvents = ownerSend.mock.calls
      .map((call) => call[1])
      .filter((event) => event.type === 'done' || event.type === 'error' || event.type === 'cancelled')
    expect(terminalEvents).toEqual([expect.objectContaining({ type: 'done', finishReason: 'stop' })])
  })

  it('emits an error terminal and aborts the sidecar when a turn request fails without a sidecar terminal event', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const ownerSend = vi.fn()
    const supervisor = {
      request: vi.fn(async (method: string) => {
        if (method === 'session.send') throw new Error('detached sidecar turn failed')
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
      getWindows: () => [
        { webContents: { id: 22, send: ownerSend, isDestroyed: () => false }, isDestroyed: () => false }
      ] as any,
      createSupervisor: () => supervisor as any
    })

    await expect(withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput())))
      .rejects.toThrow('detached sidecar turn failed')
    expect(supervisor.request).toHaveBeenCalledWith('session.abort', expect.objectContaining({ reason: 'main_turn_request_failed' }))
    const terminalEvents = ownerSend.mock.calls
      .map((call) => call[1])
      .filter((event) => event.type === 'done' || event.type === 'error' || event.type === 'cancelled')
    expect(terminalEvents).toEqual([
      expect.objectContaining({
        type: 'error',
        errorCode: 'CLINE_AGENT_TURN_FAILED',
        errorMessage: 'detached sidecar turn failed'
      })
    ])
  })

  it('emits one cancelled terminal when the sidecar returns an aborted turn without an event', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const ownerSend = vi.fn()
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => method === 'session.send'
        ? { ...turnResult(payload), text: '', finishReason: 'aborted' }
        : {}),
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
      createSupervisor: () => supervisor as any
    })

    await expect(withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput())))
      .resolves.toMatchObject({ status: 'done', result: { finishReason: 'aborted' } })
    const terminalEvents = ownerSend.mock.calls
      .map((call) => call[1])
      .filter((event) => event.type === 'done' || event.type === 'error' || event.type === 'cancelled')
    expect(terminalEvents).toEqual([expect.objectContaining({ type: 'cancelled', reason: 'aborted' })])
  })

  it('routes proxy-enabled provider fetch callbacks through the main SSH proxy fetch', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const providerRequestBody = Buffer.alloc(CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES + 1, 0x72)
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
            bodyBase64: providerRequestBody.toString('base64')
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
    expect(Buffer.from(proxyInit.body as Uint8Array).equals(providerRequestBody)).toBe(true)
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

  it('waits for an aborted turn to release the native session before starting the next turn', async () => {
    const { abortClineAgentTask, configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    let firstPayload: Record<string, unknown> = {}
    let finishFirst: ((result: ClineAgentTurnResult) => void) | undefined
    let sendCount = 0
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        sendCount += 1
        if (sendCount > 1) return turnResult(payload)
        firstPayload = payload
        return new Promise<ClineAgentTurnResult>((resolve) => {
          finishFirst = resolve
        })
      }),
      forceTerminate: vi.fn(async () => undefined),
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

    const first = runClineAgentTurn(runInput())
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    await expect(abortClineAgentTask({
      taskId: 'task-1',
      turnId: 'turn-1',
      reason: 'operator interrupted the first turn'
    })).resolves.toMatchObject({ ok: true })

    const second = runClineAgentTurn(runInput({ taskId: 'task-2', turnId: 'turn-2' }))
    await Promise.resolve()
    expect(supervisor.request.mock.calls.filter((call) => call[0] === 'session.start')).toHaveLength(1)

    finishFirst?.(turnResult(firstPayload))
    await expect(first).resolves.toMatchObject({ status: 'done' })
    await expect(second).resolves.toMatchObject({ status: 'done' })
    expect(supervisor.request.mock.calls.filter((call) => call[0] === 'session.start')).toHaveLength(2)
    expect(supervisor.forceTerminate).not.toHaveBeenCalled()
  })

  it('cancels an active DB tool and settles the UI before a stuck sidecar abort responds', async () => {
    const { abortClineAgentTask, configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const ownerSend = vi.fn()
    let supervisorOptions: any
    let databaseSignal: AbortSignal | undefined
    let finishTurn: ((result: ClineAgentTurnResult) => void) | undefined
    let sendPayload: Record<string, unknown> = {}
    databaseMcpMocks.callBoundDatabaseAiMcpTool.mockImplementation((
      _toolName: string,
      _input: Record<string, unknown>,
      _binding: Record<string, unknown>,
      options: { signal?: AbortSignal }
    ) => new Promise((_resolve, reject) => {
      databaseSignal = options.signal
      const rejectAbort = () => reject(Object.assign(new Error('database tool cancelled'), { name: 'AbortError' }))
      if (databaseSignal?.aborted) rejectAbort()
      else databaseSignal?.addEventListener('abort', rejectAbort, { once: true })
    }))
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method === 'session.abort') return new Promise(() => undefined)
        if (method !== 'session.send') return {}
        sendPayload = payload
        const tool = supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'database-tool-cancel',
          callback: 'tool.execute',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'database-tool-call-cancel',
            toolName: 'query_database_table',
            input: { tableName: 'metrics' }
          }
        } satisfies ClineAgentSidecarCallback)
        await expect(tool).rejects.toMatchObject({ name: 'AbortError' })
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
      getConfig: () => ({} as any),
      getWindows: () => [
        { webContents: { id: 22, send: ownerSend, isDestroyed: () => false }, isDestroyed: () => false }
      ] as any,
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const running = withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput({
      profile: 'database',
      database: { connectionId: 'connection-1', databaseName: 'metrics', schemaName: 'public' },
      tools: databaseTools()
    })))
    await vi.waitFor(() => expect(databaseSignal).toBeInstanceOf(AbortSignal))

    await expect(withClineAgentRendererOwner(22, () => abortClineAgentTask({
      taskId: 'task-1',
      turnId: 'turn-1',
      reason: 'operator stopped DB AI'
    }))).resolves.toMatchObject({ ok: true })
    expect(databaseSignal?.aborted).toBe(true)
    expect(ownerSend.mock.calls.map((call) => call[1])).toContainEqual(expect.objectContaining({
      type: 'cancelled',
      reason: 'operator stopped DB AI'
    }))

    await vi.waitFor(() => expect(finishTurn).toBeTypeOf('function'))
    finishTurn?.(turnResult(sendPayload))
    await expect(running).resolves.toMatchObject({ status: 'done' })
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
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const abortable = createAbortableProxyFetch()
    proxyFetchBackendMocks.createAiProviderProxyFetch.mockReturnValue(abortable.fetch)
    const ownerSend = vi.fn()
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
      getWindows: () => [
        { webContents: { id: 22, send: ownerSend, isDestroyed: () => false }, isDestroyed: () => false }
      ] as any,
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const running = withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput({
      provider: { providerId: 'openai-native', modelId: 'ops-model', useHostProxy: true }
    })))
    await vi.waitFor(() => expect(abortable.fetch).toHaveBeenCalledTimes(1))
    supervisorOptions.onExit({ code: 7, signal: null, errorMessage: 'sidecar exited' })

    expect(abortable.getSignal()?.aborted).toBe(true)
    await expect(callback).rejects.toMatchObject({ name: 'AbortError' })
    finishTurn?.(turnResult({ sessionId: 'session', taskId: 'task-1', turnId: 'turn-1' }))
    await expect(running).resolves.toMatchObject({ status: 'done' })
    const terminalEvents = ownerSend.mock.calls
      .map((call) => call[1])
      .filter((event) => event.type === 'done' || event.type === 'error' || event.type === 'cancelled')
    expect(terminalEvents).toEqual([
      expect.objectContaining({
        type: 'error',
        errorCode: 'CLINE_AGENT_SIDECAR_EXITED',
        errorMessage: 'sidecar exited'
      })
    ])
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
            input: trustedHostCommand('uptime'),
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
      ...trustedHostBinding,
      tools: classicAgentTools()
    })))

    expect(outcome).toMatchObject({
      status: 'approval-required',
      event: {
        type: 'approval-requested',
        taskId: 'task-1',
        turnId: 'turn-1',
        toolCallId: 'tool-call-1',
        ...trustedApprovalTarget
      }
    })
    const approval = {
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-1',
      ...trustedApprovalTarget,
      approved: true
    }
    expect(respondClineAgentApproval({ ...approval, terminalSessionId: 'terminal-spoofed' }, 22)).toMatchObject({ ok: false })
    expect(respondClineAgentApproval({ ...approval, targetId: 'asset-spoofed' }, 22)).toMatchObject({ ok: false })
    expect(respondClineAgentApproval({ ...approval, targetLabel: 'Spoofed host' }, 22)).toMatchObject({ ok: false })
    expect(respondClineAgentApproval(approval, 99)).toMatchObject({ ok: false })
    expect(respondClineAgentApproval(approval, 22)).toEqual({
      ok: true,
      data: {
        taskId: 'task-1',
        turnId: 'turn-1',
        toolCallId: 'tool-call-1',
        ...trustedApprovalTarget,
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
            input: trustedHostCommand('uptime')
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
      ...trustedHostBinding,
      tools: classicAgentTools()
    }))).resolves.toMatchObject({ status: 'done' })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).not.toHaveBeenCalled()
  })

  it.each([
    {
      toolName: 'read_host_file',
      input: { targetId: trustedHostTarget.targetId, path: '/var/log/api.log', offset: 0, limit: 20 },
      bridgeMethod: 'read_file',
      bridgeData: { content: 'api ready' }
    },
    {
      toolName: 'search_host_files',
      input: { targetId: trustedHostTarget.targetId, kind: 'name', path: '/var/log', pattern: '*.log', limit: 10 },
      bridgeMethod: 'glob_search',
      bridgeData: { entries: ['/var/log/api.log'] }
    }
  ])('requires an exact operator approval before $toolName can inspect a bound host', async ({
    toolName,
    input: toolInput,
    bridgeMethod,
    bridgeData
  }) => {
    const { configureClineAgentRuntime, respondClineAgentApproval, runClineAgentTurn } = await loadRuntime()
    terminalBridgeMocks.callCodexTerminalBridgeTool.mockResolvedValue({
      ok: true,
      target: { sessionId: trustedHostTarget.terminalSessionId },
      data: bridgeData
    })
    let supervisorOptions: any
    let finishSend: () => void = () => undefined
    const sendFinished = new Promise<void>((resolve) => {
      finishSend = resolve
    })
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const callbackPayload = {
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          turnId: payload.turnId,
          toolCallId: `tool-${toolName}`,
          toolName,
          input: toolInput
        }
        const decision = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: `approval-${toolName}`,
          callback: 'approval.request',
          payload: { ...callbackPayload, iteration: 1 }
        } satisfies ClineAgentSidecarCallback)
        expect(decision).toEqual({ approved: true, reason: undefined })
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: `execute-${toolName}`,
          callback: 'tool.execute',
          payload: callbackPayload
        } satisfies ClineAgentSidecarCallback)).resolves.toMatchObject({
          targetId: trustedHostTarget.targetId,
          targetLabel: trustedHostTarget.label,
          untrusted: true
        })
        finishSend()
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { autoExecuteReadOnlyCommands: true, autoApproval: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await runClineAgentTurn(runInput({
      profile: 'classic-agent',
      ...trustedHostBinding,
      tools: classicAgentTools()
    }))
    expect(outcome).toMatchObject({
      status: 'approval-required',
      event: {
        toolCallId: `tool-${toolName}`,
        toolName,
        autoApprovable: false,
        targetId: trustedHostTarget.targetId,
        targetLabel: trustedHostTarget.label,
        terminalSessionId: trustedHostTarget.terminalSessionId
      }
    })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).not.toHaveBeenCalled()
    expect(respondClineAgentApproval({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: `tool-${toolName}`,
      ...trustedApprovalTarget,
      approved: true
    })).toMatchObject({ ok: false })
    expect(respondClineAgentApproval({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: `tool-${toolName}`,
      toolName,
      targetId: trustedHostTarget.targetId,
      targetLabel: trustedHostTarget.label,
      terminalSessionId: trustedHostTarget.terminalSessionId,
      approved: true
    })).toMatchObject({ ok: true, data: { toolName, status: 'approved' } })
    await sendFinished
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).toHaveBeenCalledWith(
      bridgeMethod,
      expect.objectContaining({ sessionId: trustedHostTarget.terminalSessionId })
    )
  })

  it('binds MCP resource approval to the current task, enabled catalog entry, and renderer owner', async () => {
    const { configureClineAgentRuntime, respondClineAgentApproval, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const config = {
      mcpServers: [{
        name: 'inventory',
        status: 'connected',
        disabled: false,
        command: 'secret-command',
        env: { INVENTORY_TOKEN: 'credential-must-not-leak' },
        headers: { authorization: 'credential-must-not-leak' },
        tools: [],
        resources: [{ name: 'Hosts', description: 'Managed hosts', uri: 'inventory://hosts' }]
      }]
    } as any
    const readMcpResource = vi.fn(async () => ({
      ok: true,
      data: {
        serverName: 'inventory',
        uri: 'inventory://hosts',
        contents: [{ uri: 'inventory://hosts', text: 'api-01' }]
      }
    }))
    let supervisorOptions: any
    let finishSend: () => void = () => undefined
    const sendFinished = new Promise<void>((resolve) => {
      finishSend = resolve
    })
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const callbackPayload = {
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          turnId: payload.turnId,
          toolCallId: 'tool-mcp-resource',
          toolName: 'access_mcp_resource',
          input: { serverName: 'inventory', uri: 'inventory://hosts' }
        }
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'execute-unapproved-resource',
          callback: 'tool.execute',
          payload: { ...callbackPayload, toolCallId: 'tool-unapproved-resource' }
        } satisfies ClineAgentSidecarCallback)).rejects.toThrow('has not been approved')
        const decision = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-mcp-resource',
          callback: 'approval.request',
          payload: { ...callbackPayload, iteration: 1 }
        } satisfies ClineAgentSidecarCallback)
        expect(decision).toEqual({ approved: true, reason: undefined })
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'execute-mcp-resource',
          callback: 'tool.execute',
          payload: callbackPayload
        } satisfies ClineAgentSidecarCallback)).resolves.toMatchObject({
          serverName: 'inventory',
          uri: 'inventory://hosts',
          untrusted: true
        })
        finishSend()
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => config,
      readMcpResource,
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput({
      profile: 'classic-agent',
      tools: classicAgentTools(false)
    })))
    expect(outcome).toMatchObject({
      status: 'approval-required',
      event: {
        toolName: 'access_mcp_resource',
        serverName: 'inventory',
        resourceUri: 'inventory://hosts',
        input: { serverName: 'inventory', uri: 'inventory://hosts' },
        autoApprovable: false
      }
    })
    expect(JSON.stringify(outcome)).not.toContain('credential-must-not-leak')
    const approval = {
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-mcp-resource',
      toolName: 'access_mcp_resource',
      serverName: 'inventory',
      resourceUri: 'inventory://hosts',
      approved: true
    }
    expect(respondClineAgentApproval(approval, 99)).toMatchObject({ ok: false })
    expect(respondClineAgentApproval({ ...approval, resourceUri: 'inventory://secrets' }, 22)).toMatchObject({ ok: false })
    config.mcpServers[0].disabled = true
    expect(respondClineAgentApproval(approval, 22)).toMatchObject({ ok: false })
    config.mcpServers[0].disabled = false
    expect(respondClineAgentApproval(approval, 22)).toMatchObject({
      ok: true,
      data: {
        toolName: 'access_mcp_resource',
        serverName: 'inventory',
        resourceUri: 'inventory://hosts',
        status: 'approved'
      }
    })
    await sendFinished
    expect(readMcpResource).toHaveBeenCalledWith({ serverName: 'inventory', uri: 'inventory://hosts' })
  })

  it('selects one exact terminal from a multi-host allowlist and enriches automatic tool-call events', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    const { withClineAgentRendererOwner } = await loadOwnerRuntime()
    const secondTarget = {
      targetId: 'asset-secondary',
      terminalSessionId: 'terminal-secondary',
      label: 'Secondary host',
      kind: 'ssh' as const,
      cwd: '/srv/secondary'
    }
    terminalBridgeMocks.callCodexTerminalBridgeTool.mockResolvedValue({
      ok: true,
      target: { sessionId: secondTarget.terminalSessionId },
      data: { output: 'secondary-ok', exitCode: 0 }
    })
    const ownerSend = vi.fn()
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const toolInput = { targetId: secondTarget.targetId, command: 'uptime', requiresApproval: false }
        supervisorOptions.onEvent({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'event',
          event: 'agent.task',
          payload: {
            protocolVersion: CLINE_AGENT_PROTOCOL_VERSION,
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            seq: 1,
            at: '2026-07-15T00:00:00.000Z',
            type: 'tool-call',
            toolCallId: 'tool-secondary',
            toolName: 'run_host_command',
            input: toolInput
          }
        })
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-secondary',
          callback: 'approval.request',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-secondary',
            toolName: 'run_host_command',
            input: toolInput,
            iteration: 1
          }
        } satisfies ClineAgentSidecarCallback)).resolves.toEqual({ approved: true })
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'execute-secondary',
          callback: 'tool.execute',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-secondary',
            toolName: 'run_host_command',
            input: toolInput
          }
        } satisfies ClineAgentSidecarCallback)).resolves.toMatchObject({
          targetId: secondTarget.targetId,
          targetLabel: secondTarget.label,
          output: 'secondary-ok'
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
      getConfig: () => ({ aiPreferences: { autoExecuteReadOnlyCommands: true } } as any),
      getWindows: () => [
        { webContents: { id: 22, send: ownerSend, isDestroyed: () => false }, isDestroyed: () => false }
      ] as any,
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await expect(withClineAgentRendererOwner(22, () => runClineAgentTurn(runInput({
      profile: 'classic-agent',
      hostTargets: [trustedHostTarget, secondTarget],
      tools: classicAgentTools()
    })))).resolves.toMatchObject({ status: 'done' })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).toHaveBeenCalledWith('run_command', expect.objectContaining({
      sessionId: secondTarget.terminalSessionId,
      command: 'uptime'
    }))
    expect(ownerSend).toHaveBeenCalledWith('cline-agent:task-event', expect.objectContaining({
      type: 'tool-call',
      targetId: secondTarget.targetId,
      targetLabel: secondTarget.label,
      terminalSessionId: secondTarget.terminalSessionId
    }))
  })

  it('rejects a tool target that is outside the current turn allowlist', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const callbackPayload = {
          sessionId: payload.sessionId,
          taskId: payload.taskId,
          turnId: payload.turnId,
          toolCallId: 'tool-forbidden',
          toolName: 'run_host_command',
          input: { targetId: 'asset-not-allowed', command: 'uptime' }
        }
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-forbidden',
          callback: 'approval.request',
          payload: { ...callbackPayload, iteration: 1 }
        } satisfies ClineAgentSidecarCallback)).resolves.toEqual({
          approved: false,
          reason: 'Invalid host command approval request.'
        })
        await expect(supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'execute-forbidden',
          callback: 'tool.execute',
          payload: callbackPayload
        } satisfies ClineAgentSidecarCallback)).rejects.toThrow('not allowed')
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
      hostTargets: [trustedHostTarget],
      tools: classicAgentTools()
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
    const outputFileRef = 'cline-output:0123456789abcdef01234567:0123456789abcdef0123456789abcdef'
    const outputStore = {
      write: vi.fn(async () => ({
        fileRef: outputFileRef,
        bytes: Buffer.byteLength(output),
        createdAt: new Date().toISOString()
      })),
      read: vi.fn(async () => ({
        fileRef: outputFileRef,
        offset: 0,
        nextOffset: 5,
        totalBytes: Buffer.byteLength(output),
        eof: false,
        content: 'xxxxx'
      })),
      deleteSession: vi.fn(async () => undefined),
      prune: vi.fn(async () => 0)
    }
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
              input: trustedHostCommand('uptime'),
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
              input: trustedHostCommand('uptime')
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
            outputFileRef,
            outputFileBytes: 256 * 1024 + 17,
            outputFileComplete: true,
            exitCode: 0
          })
          expect(Buffer.byteLength(first.output, 'utf8')).toBe(256 * 1024)
          await expect(supervisorOptions.onCallback({
            ...callback,
            id: 'read-idempotent-tool-output',
            payload: {
              ...callback.payload,
              toolCallId: 'tool-call-output-read',
              toolName: 'read_host_command_output',
              input: { fileRef: outputFileRef, offset: 0, maxBytes: 5 }
            }
          })).resolves.toMatchObject({ content: 'xxxxx', nextOffset: 5, eof: false })
          await expect(supervisorOptions.onCallback({
            ...callback,
            id: 'execute-idempotent-tool-mismatch',
            payload: {
              ...callback.payload,
              input: trustedHostCommand('hostname')
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
      outputStore: outputStore as any,
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await runClineAgentTurn(runInput({
      profile: 'classic-agent',
      ...trustedHostBinding,
      tools: classicAgentTools()
    }))
    expect(outcome).toMatchObject({ status: 'approval-required' })
    expect(respondClineAgentApproval({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-idempotent',
      ...trustedApprovalTarget,
      approved: true
    })).toMatchObject({ ok: true })
    await expect(sendCompleted).resolves.toBeUndefined()
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).toHaveBeenCalledTimes(1)
    expect(outputStore.write).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-idempotent',
      content: output
    }))
    expect(outputStore.read).toHaveBeenCalledWith(expect.objectContaining({
      fileRef: outputFileRef,
      offset: 0,
      maxBytes: 5
    }))
  })

  it('auto-approves each model-declared read-only command in one turn without an executable allowlist', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    terminalBridgeMocks.callCodexTerminalBridgeTool.mockResolvedValue({ ok: true, data: { output: 'ok', exitCode: 0 } })
    let supervisorOptions: any
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const commands = [
          "top -bn2 -d 1 -o %CPU -w 512 | awk '/^top - /{n++} n==2' | head -n 25",
          'nproc'
        ]
        for (const [index, command] of commands.entries()) {
          const callbackPayload = {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: `tool-call-auto-approved-${index + 1}`,
            toolName: 'run_host_command',
            input: trustedHostCommand(command)
          }
          await expect(supervisorOptions.onCallback({
            version: CLINE_AGENT_PROTOCOL_VERSION,
            kind: 'callback',
            id: `approval-auto-${index + 1}`,
            callback: 'approval.request',
            payload: { ...callbackPayload, iteration: index + 1 }
          } satisfies ClineAgentSidecarCallback)).resolves.toEqual({ approved: true })
          await expect(supervisorOptions.onCallback({
            version: CLINE_AGENT_PROTOCOL_VERSION,
            kind: 'callback',
            id: `execute-auto-${index + 1}`,
            callback: 'tool.execute',
            payload: callbackPayload
          } satisfies ClineAgentSidecarCallback)).resolves.toMatchObject({ output: 'ok', exitCode: 0 })
        }
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { autoApproval: false, autoExecuteReadOnlyCommands: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    await expect(runClineAgentTurn(runInput({
      profile: 'classic-agent',
      ...trustedHostBinding,
      tools: classicAgentTools()
    }))).resolves.toMatchObject({ status: 'done' })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).toHaveBeenCalledTimes(2)
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool.mock.calls.map((call) => call[1].command)).toEqual([
      "top -bn2 -d 1 -o %CPU -w 512 | awk '/^top - /{n++} n==2' | head -n 25",
      'nproc'
    ])
  })

  it('keeps a model-declared approval requirement gated when read-only command auto-run is enabled', async () => {
    const { configureClineAgentRuntime, respondClineAgentApproval, runClineAgentTurn } = await loadRuntime()
    let supervisorOptions: any
    let finishSend: (decision: unknown) => void = () => undefined
    const sendFinished = new Promise((resolve) => {
      finishSend = resolve
    })
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const decision = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-compound',
          callback: 'approval.request',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-call-compound',
            toolName: 'run_host_command',
            input: trustedHostCommand('uptime && whoami', true),
            iteration: 1
          }
        } satisfies ClineAgentSidecarCallback)
        finishSend(decision)
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { autoExecuteReadOnlyCommands: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await runClineAgentTurn(runInput({
      profile: 'classic-agent',
      ...trustedHostBinding,
      tools: classicAgentTools()
    }))
    expect(outcome).toMatchObject({
      status: 'approval-required',
      event: { toolCallId: 'tool-call-compound', autoApprovable: false }
    })
    expect(respondClineAgentApproval({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-call-compound',
      ...trustedApprovalTarget,
      approved: false
    })).toMatchObject({ ok: true })
    await expect(sendFinished).resolves.toEqual({ approved: false, reason: undefined })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).not.toHaveBeenCalled()
  })

  it('lets Main security override a model that mislabels a dangerous command as read-only', async () => {
    const { configureClineAgentRuntime, runClineAgentTurn } = await loadRuntime()
    let supervisorOptions: any
    let finishSend: (decision: unknown) => void = () => undefined
    const sendFinished = new Promise((resolve) => {
      finishSend = resolve
    })
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const decision = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: 'approval-dangerous-mislabel',
          callback: 'approval.request',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: 'tool-call-dangerous-mislabel',
            toolName: 'run_host_command',
            input: trustedHostCommand('rm -rf /tmp/aiopsterm-fixture', false),
            iteration: 1
          }
        } satisfies ClineAgentSidecarCallback)
        finishSend(decision)
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { autoExecuteReadOnlyCommands: true } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })

    const outcome = await runClineAgentTurn(runInput({
      profile: 'classic-agent',
      ...trustedHostBinding,
      tools: classicAgentTools()
    }))
    expect(outcome).toMatchObject({ status: 'done' })
    await expect(sendFinished).resolves.toEqual({
      approved: false,
      reason: expect.stringContaining('rm')
    })
    expect(terminalBridgeMocks.callCodexTerminalBridgeTool).not.toHaveBeenCalled()
  })

  it('enables model-declared read-only approval for later turns in the same Cline session only', async () => {
    const { configureClineAgentRuntime, respondClineAgentApproval, runClineAgentTurn } = await loadRuntime()
    let supervisorOptions: any
    let firstSendFinished: () => void = () => undefined
    const firstSendCompleted = new Promise<void>((resolve) => {
      firstSendFinished = resolve
    })
    const supervisor = {
      request: vi.fn(async (method: string, payload: Record<string, unknown>) => {
        if (method !== 'session.send') return {}
        const firstTurn = payload.turnId === 'turn-1'
        const decision = await supervisorOptions.onCallback({
          version: CLINE_AGENT_PROTOCOL_VERSION,
          kind: 'callback',
          id: `approval-${String(payload.turnId)}`,
          callback: 'approval.request',
          payload: {
            sessionId: payload.sessionId,
            taskId: payload.taskId,
            turnId: payload.turnId,
            toolCallId: `tool-${String(payload.turnId)}`,
            toolName: 'run_host_command',
            input: trustedHostCommand('uptime'),
            iteration: 1
          }
        } satisfies ClineAgentSidecarCallback)
        if (firstTurn) firstSendFinished()
        expect(decision).toEqual({ approved: true, ...(firstTurn ? { reason: undefined } : {}) })
        return turnResult(payload)
      }),
      shutdown: vi.fn(async () => undefined)
    }
    configureClineAgentRuntime({
      appPath: '/app',
      resourcesPath: '/resources',
      userDataPath: '/user-data',
      isPackaged: false,
      getConfig: () => ({ aiPreferences: { autoApproval: false, autoExecuteReadOnlyCommands: false } } as any),
      getWindows: () => [],
      createSupervisor: (options: any) => {
        supervisorOptions = options
        return supervisor as any
      }
    })
    const agentInput = (taskId: string, turnId: string, conversationKey = 'conversation-1') => runInput({
      taskId,
      turnId,
      conversationKey,
      profile: 'classic-agent',
      ...trustedHostBinding,
      tools: classicAgentTools()
    })

    await expect(runClineAgentTurn(agentInput('task-1', 'turn-1'))).resolves.toMatchObject({
      status: 'approval-required',
      event: { autoApprovable: true }
    })
    expect(respondClineAgentApproval({
      taskId: 'task-1',
      turnId: 'turn-1',
      toolCallId: 'tool-turn-1',
      ...trustedApprovalTarget,
      approved: true,
      enableReadOnlyAutoRun: true
    })).toMatchObject({ ok: true, data: { readOnlyAutoRunEnabled: true } })
    await firstSendCompleted
    await Promise.resolve()
    await Promise.resolve()

    await expect(runClineAgentTurn(agentInput('task-2', 'turn-2'))).resolves.toMatchObject({ status: 'done' })
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
          input: trustedHostCommand('uptime')
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
      ...trustedHostBinding,
      tools: classicAgentTools()
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
            input: trustedHostCommand('uptime'),
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
      ...trustedHostBinding,
      tools: classicAgentTools()
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
      ...trustedApprovalTarget,
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
      toolName: 'run_host_command',
      targetId: 'asset-ipc',
      targetLabel: 'IPC host',
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
    expect(handlers.get('cline-agent:approval:respond')?.(event, { ...approval, enableReadOnlyAutoRun: 'yes' })).toEqual({
      ok: false,
      errorCode: 'CLINE_AGENT_APPROVAL_INVALID',
      errorMessage: 'Cline Agent approval input is invalid.'
    })
    expect([...handlers.keys()]).toEqual(['cline-agent:approval:respond', 'cline-agent:task:abort'])
  })

  it('validates every host target terminal against the invoking renderer', async () => {
    const { registerAiChatIpc } = await loadAiChatIpc()
    const handlers = new Map<string, (event: any, input: any) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: any, input: any) => unknown) => handlers.set(channel, handler))
    } as any
    const canonicalTargets = [
      { targetId: 'asset-a', terminalSessionId: 'terminal-owned-a', label: 'Host A', kind: 'ssh' as const },
      { targetId: 'asset-b', terminalSessionId: 'terminal-owned-b', label: 'Host B', kind: 'ssh' as const }
    ]
    registerAiChatIpc(ipcMain, {
      resolveTrustedHostTarget: (event: any, terminalSessionId: string) =>
        event.sender.id === 41
          ? canonicalTargets.find((target) => target.terminalSessionId === terminalSessionId) || null
          : null
    })
    const event = { sender: { id: 41 } }
    const ownedTargets = canonicalTargets.map((target) => ({ ...target }))

    await expect(handlers.get('ai:chat-response')?.(event, {
      prompt: 'inspect host',
      hostTargets: [...ownedTargets, { targetId: 'asset-other', terminalSessionId: 'terminal-other', label: 'Other', kind: 'ssh' }],
      mode: 'agent'
    })).resolves.toEqual({
      ok: false,
      errorCode: 'AI_CHAT_TERMINAL_SESSION_INVALID',
      errorMessage: 'The selected terminal session is unavailable for this window.'
    })
    expect(aiChatBackendMocks.generateAiChatResponse).not.toHaveBeenCalled()

    await handlers.get('ai:chat-response')?.(event, {
      prompt: 'inspect host',
      hostTargets: ownedTargets,
      mode: 'agent'
    })
    expect(aiChatBackendMocks.generateAiChatResponse).toHaveBeenCalledWith(expect.objectContaining({ hostTargets: ownedTargets }))
  })
})
