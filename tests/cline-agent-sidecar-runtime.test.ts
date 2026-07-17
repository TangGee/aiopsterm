import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES,
  CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES,
  CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES,
  CLINE_AGENT_PROTOCOL_VERSION,
  type ClineAgentSessionStartInput,
  type ClineAgentSidecarMessage
} from '../src/shared/contracts/clineAgent'

const sdkMocks = vi.hoisted(() => {
  const state: {
    coreOptions?: {
      fetch?: typeof fetch
      capabilities?: {
        requestToolApproval?: (request: Record<string, unknown>) => Promise<{ approved: boolean; reason?: string }>
      }
    }
    subscriber?: (event: any) => void
    updateConnectionFetchInit?: RequestInit
  } = {}
  const manager = {
    subscribe: vi.fn((listener: (event: any) => void) => {
      state.subscriber = listener
      return () => {
        if (state.subscriber === listener) state.subscriber = undefined
      }
    }),
    get: vi.fn(async () => undefined),
    readMessages: vi.fn(async (): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> => []),
    start: vi.fn(async (_input: unknown) => ({})),
    abort: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    delete: vi.fn(async () => true),
    updateSessionConnection: vi.fn(async () => {
      const response = await state.coreOptions?.fetch?.(
        'https://provider.example/v1/models',
        state.updateConnectionFetchInit || { method: 'GET' }
      )
      await response?.arrayBuffer()
    }),
    send: vi.fn(async (_input: { sessionId: string }): Promise<any> => ({ text: 'done', finishReason: 'stop', iterations: 1, toolCalls: [] })),
    dispose: vi.fn(async () => undefined)
  }
  return {
    state,
    manager,
    create: vi.fn(async (options: { fetch?: typeof fetch }) => {
      state.coreOptions = options
      return manager
    }),
    createTool: vi.fn((definition) => definition),
    setClineDir: vi.fn()
  }
})

vi.mock('@cline/sdk', () => ({
  ClineCore: { create: sdkMocks.create },
  createTool: sdkMocks.createTool,
  setClineDir: sdkMocks.setClineDir
}))

const startRequest = (
  id: string,
  provider: ClineAgentSessionStartInput['provider'],
  taskId: string,
  turnId: string
): ClineAgentSidecarMessage => ({
  version: CLINE_AGENT_PROTOCOL_VERSION,
  kind: 'request',
  id,
  method: 'session.start',
  payload: {
    sessionId: 'session-1',
    profile: 'classic-chat',
    systemPrompt: 'You are a host assistant.',
    provider,
    tools: [],
    metadata: { taskId, turnId }
  } satisfies ClineAgentSessionStartInput
})

describe('Cline Agent sidecar runtime', () => {
  let runtime: ReturnType<typeof import('../src/sidecar/clineAgentSidecar').createClineAgentSidecarRuntime>
  const createStdoutWriteSpy = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  let stdoutWrite: ReturnType<typeof createStdoutWriteSpy>

  beforeEach(async () => {
    vi.clearAllMocks()
    sdkMocks.state.coreOptions = undefined
    sdkMocks.state.subscriber = undefined
    sdkMocks.state.updateConnectionFetchInit = undefined
    sdkMocks.manager.send.mockReset()
    sdkMocks.manager.send.mockResolvedValue({ text: 'done', finishReason: 'stop', iterations: 1, toolCalls: [] })
    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn
    }
    const sidecar = await import('../src/sidecar/clineAgentSidecar')
    console.log = originalConsole.log
    console.info = originalConsole.info
    console.warn = originalConsole.warn
    stdoutWrite = createStdoutWriteSpy()
    runtime = sidecar.createClineAgentSidecarRuntime()
  })

  afterEach(async () => {
    await runtime.shutdown()
    stdoutWrite.mockRestore()
  })

  it('keeps protocol, provider request, and provider response limits directional', () => {
    expect(CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES).toBe(64 * 1024 * 1024)
    expect(CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES).toBe(40 * 1024 * 1024)
    expect(CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES).toBe(2 * 1024 * 1024)
  })

  it('updates an active session connection inside the current provider fetch context', async () => {
    const requestBody = 'r'.repeat(CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES + 1)
    sdkMocks.state.updateConnectionFetchInit = { method: 'POST', body: requestBody }
    await runtime.handleMessage(startRequest(
      'start-1',
      { providerId: 'openai-compatible', modelId: 'old-model', apiKey: 'old-key' },
      'task-1',
      'turn-1'
    ))

    const update = runtime.handleMessage(startRequest(
      'start-2',
      {
        providerId: 'anthropic',
        modelId: 'new-model',
        apiKey: 'new-key',
        reasoningEffort: 'high',
        useHostProxy: true
      },
      'task-2',
      'turn-2'
    ))

    const frames = () => stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    await vi.waitFor(() => expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'callback',
      callback: 'provider.fetch',
      payload: expect.objectContaining({
        sessionId: 'session-1',
        taskId: 'task-2',
        turnId: 'turn-2',
        url: 'https://provider.example/v1/models'
      })
    })))
    const fetchCallback = frames().find((frame) => frame.kind === 'callback' && frame.callback === 'provider.fetch')
    if (!fetchCallback || fetchCallback.kind !== 'callback') throw new Error('Missing provider.fetch callback.')
    expect(Buffer.from(String((fetchCallback.payload as Record<string, unknown>).bodyBase64), 'base64').byteLength)
      .toBe(requestBody.length)
    await runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'callback-result',
      id: fetchCallback.id,
      ok: true,
      result: { status: 200, statusText: 'OK', headers: {}, bodyBase64: '' }
    })
    await update

    expect(sdkMocks.manager.start).toHaveBeenCalledTimes(1)
    expect(sdkMocks.manager.updateSessionConnection).toHaveBeenCalledWith('session-1', {
      providerId: 'anthropic',
      modelId: 'new-model',
      apiKey: 'new-key',
      baseUrl: '',
      providerConfig: { providerId: 'anthropic', modelId: 'new-model' },
      reasoningEffort: 'high',
      thinking: undefined,
      thinkingBudgetTokens: undefined
    })
  })

  it('rejects provider responses above the independent response-body limit', async () => {
    await runtime.handleMessage(startRequest(
      'start-response-limit-1',
      { providerId: 'openai-compatible', modelId: 'old-model', apiKey: 'old-key' },
      'task-response-limit-1',
      'turn-response-limit-1'
    ))

    const update = runtime.handleMessage(startRequest(
      'start-response-limit-2',
      {
        providerId: 'openai-compatible',
        modelId: 'new-model',
        apiKey: 'new-key',
        useHostProxy: true
      },
      'task-response-limit-2',
      'turn-response-limit-2'
    ))
    const frames = () => stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    await vi.waitFor(() => expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'callback',
      callback: 'provider.fetch'
    })))
    const fetchCallback = frames().find((frame) => frame.kind === 'callback' && frame.callback === 'provider.fetch')
    if (!fetchCallback || fetchCallback.kind !== 'callback') throw new Error('Missing provider.fetch callback.')
    await runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'callback-result',
      id: fetchCallback.id,
      ok: true,
      result: {
        status: 200,
        statusText: 'OK',
        headers: {},
        bodyBase64: Buffer.alloc(CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES + 1).toString('base64')
      }
    })
    await update

    expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'response',
      id: 'start-response-limit-2',
      ok: false,
      error: expect.objectContaining({
        message: `Cline Agent provider response body exceeds ${CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES} bytes`
      })
    }))
  })

  it('restarts an active session when the tool input schema changes', async () => {
    const toolRequest = (id: string, taskId: string, turnId: string, required: string[]) => {
      const request = startRequest(
        id,
        { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
        taskId,
        turnId
      )
      if (request.kind !== 'request') throw new Error('Expected request frame.')
      const payload = request.payload as ClineAgentSessionStartInput
      payload.profile = 'classic-agent'
      payload.tools = [{
        name: 'run_host_command',
        description: 'Run one host command.',
        inputSchema: {
          type: 'object',
          properties: {
            targetId: { type: 'string' },
            command: { type: 'string' }
          },
          required
        },
        autoApprove: false
      }]
      return request
    }

    await runtime.handleMessage(toolRequest('start-schema-1', 'task-schema-1', 'turn-schema-1', ['command']))
    await runtime.handleMessage(toolRequest('start-schema-2', 'task-schema-2', 'turn-schema-2', ['targetId', 'command']))

    expect(sdkMocks.manager.stop).toHaveBeenCalledWith('session-1')
    expect(sdkMocks.manager.start).toHaveBeenCalledTimes(2)
    expect(sdkMocks.manager.updateSessionConnection).not.toHaveBeenCalled()
    expect(sdkMocks.createTool).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'run_host_command',
      inputSchema: expect.objectContaining({ required: ['targetId', 'command'] })
    }))
  })

  it('keeps serial operator approvals pending past the former callback deadline and then completes the turn', async () => {
    const request = startRequest(
      'start-approval-turn',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-approval',
      'turn-approval'
    )
    if (request.kind !== 'request') throw new Error('Expected request frame.')
    ;(request.payload as ClineAgentSessionStartInput).profile = 'classic-agent'
    ;(request.payload as ClineAgentSessionStartInput).tools = [{
      name: 'run_host_command',
      description: 'Run one host command.',
      inputSchema: { type: 'object' },
      autoApprove: false
    }]
    await runtime.handleMessage(request)

    const startOptions = sdkMocks.manager.start.mock.calls[0]?.[0] as any
    const proxyTool = startOptions?.localRuntime?.extraTools?.[0]
    expect(proxyTool?.name).toBe('run_host_command')

    sdkMocks.manager.send.mockImplementationOnce(async () => {
      const signal = new AbortController().signal
      const first = await proxyTool.execute(
        { command: 'uptime' },
        { toolCallId: 'tool-call-1', iteration: 1, signal }
      )
      const second = await proxyTool.execute(
        { command: 'free -h' },
        { toolCallId: 'tool-call-2', iteration: 1, signal }
      )
      return {
        text: 'completed',
        finishReason: 'stop',
        iterations: 1,
        toolCalls: [
          { id: 'tool-call-1', name: 'run_host_command', input: { command: 'uptime' }, output: first },
          { id: 'tool-call-2', name: 'run_host_command', input: { command: 'free -h' }, output: second }
        ]
      }
    })
    const frames = () => stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    const approvalCallbacks = () => frames().filter(
      (frame): frame is Extract<ClineAgentSidecarMessage, { kind: 'callback' }> =>
        frame.kind === 'callback' && frame.callback === 'approval.request'
    )
    const toolCallbacks = () => frames().filter(
      (frame): frame is Extract<ClineAgentSidecarMessage, { kind: 'callback' }> =>
        frame.kind === 'callback' && frame.callback === 'tool.execute'
    )
    const respond = (id: string, result: unknown) => runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'callback-result',
      id,
      ok: true,
      result
    })

    vi.useFakeTimers()
    try {
      const pendingSend = runtime.handleMessage({
        version: CLINE_AGENT_PROTOCOL_VERSION,
        kind: 'request',
        id: 'send-approval-turn',
        method: 'session.send',
        payload: {
          sessionId: 'session-1',
          taskId: 'task-approval',
          turnId: 'turn-approval',
          prompt: 'Inspect memory and uptime.'
        }
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(approvalCallbacks()).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(31 * 60_000)
      expect(approvalCallbacks()).toHaveLength(1)
      expect(frames()).not.toContainEqual(expect.objectContaining({ kind: 'response', id: 'send-approval-turn' }))

      await respond(approvalCallbacks()[0].id, { approved: true })
      await Promise.resolve()
      await Promise.resolve()
      expect(toolCallbacks()).toHaveLength(1)
      expect(approvalCallbacks()).toHaveLength(1)
      await respond(toolCallbacks()[0].id, { output: 'up 10 days', exitCode: 0 })
      await Promise.resolve()
      await Promise.resolve()
      expect(approvalCallbacks()).toHaveLength(2)

      await vi.advanceTimersByTimeAsync(31 * 60_000)
      expect(approvalCallbacks()).toHaveLength(2)
      expect(toolCallbacks()).toHaveLength(1)
      await respond(approvalCallbacks()[1].id, { approved: true })
      await Promise.resolve()
      await Promise.resolve()
      expect(toolCallbacks()).toHaveLength(2)
      await respond(toolCallbacks()[1].id, { output: 'memory output', exitCode: 0 })
      await pendingSend

      expect(frames()).toContainEqual(expect.objectContaining({
        kind: 'event',
        event: 'agent.task',
        payload: expect.objectContaining({ type: 'done', taskId: 'task-approval', turnId: 'turn-approval' })
      }))
      expect(frames()).toContainEqual(expect.objectContaining({
        kind: 'response',
        id: 'send-approval-turn',
        ok: true
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a pending approval and reports cancelled when the session is aborted', async () => {
    const request = startRequest(
      'start-aborted-approval',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-aborted-approval',
      'turn-aborted-approval'
    )
    if (request.kind !== 'request') throw new Error('Expected request frame.')
    ;(request.payload as ClineAgentSessionStartInput).profile = 'classic-agent'
    ;(request.payload as ClineAgentSessionStartInput).tools = [{
      name: 'run_host_command',
      description: 'Run one host command.',
      inputSchema: { type: 'object' },
      autoApprove: false
    }]
    await runtime.handleMessage(request)

    const startOptions = sdkMocks.manager.start.mock.calls[0]?.[0] as any
    const proxyTool = startOptions?.localRuntime?.extraTools?.[0]
    sdkMocks.manager.send.mockImplementationOnce(async () => {
      await proxyTool.execute(
        { command: 'uptime' },
        { toolCallId: 'tool-call-aborted-approval', iteration: 1, signal: new AbortController().signal }
      )
      return { text: 'unreachable', finishReason: 'stop', iterations: 1, toolCalls: [] }
    })
    const frames = () => stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)

    const pendingSend = runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'request',
      id: 'send-aborted-approval',
      method: 'session.send',
      payload: {
        sessionId: 'session-1',
        taskId: 'task-aborted-approval',
        turnId: 'turn-aborted-approval',
        prompt: 'Inspect uptime.'
      }
    })
    await vi.waitFor(() => expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'callback',
      callback: 'approval.request',
      payload: expect.objectContaining({ toolCallId: 'tool-call-aborted-approval' })
    })))

    await runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'request',
      id: 'abort-pending-approval',
      method: 'session.abort',
      payload: { sessionId: 'session-1', reason: 'operator_cancelled' }
    })
    await runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'request',
      id: 'send-after-abort',
      method: 'session.send',
      payload: {
        sessionId: 'session-1',
        taskId: 'task-after-abort',
        turnId: 'turn-after-abort',
        prompt: 'Continue after interruption.'
      }
    })
    await pendingSend

    expect(sdkMocks.manager.abort).toHaveBeenCalledWith('session-1', 'operator_cancelled')
    expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'event',
      event: 'agent.task',
      payload: expect.objectContaining({
        type: 'cancelled',
        taskId: 'task-aborted-approval',
        turnId: 'turn-aborted-approval',
        reason: 'operator_cancelled'
      })
    }))
    expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'response',
      id: 'send-aborted-approval',
      ok: true,
      result: expect.objectContaining({ finishReason: 'aborted' })
    }))
    expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'response',
      id: 'send-after-abort',
      ok: true,
      result: expect.objectContaining({ taskId: 'task-after-abort', turnId: 'turn-after-abort' })
    }))
  })

  it('approves, executes, and finishes each Classic host tool before requesting approval for the next call', async () => {
    const request = startRequest(
      'start-ordered-host-tools',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-ordered',
      'turn-ordered'
    )
    if (request.kind !== 'request') throw new Error('Expected request frame.')
    ;(request.payload as ClineAgentSessionStartInput).profile = 'classic-agent'
    ;(request.payload as ClineAgentSessionStartInput).tools = [{
      name: 'run_host_command',
      description: 'Run one host command.',
      inputSchema: { type: 'object' },
      autoApprove: false
    }]
    await runtime.handleMessage(request)

    const startOptions = sdkMocks.manager.start.mock.calls[0]?.[0] as any
    const proxyTool = startOptions?.localRuntime?.extraTools?.[0]
    expect(startOptions).toMatchObject({
      config: { maxParallelToolCalls: 1 },
      toolPolicies: { run_host_command: { enabled: true, autoApprove: true } }
    })
    expect(proxyTool?.name).toBe('run_host_command')

    sdkMocks.manager.send.mockImplementationOnce(async () => {
      const signal = new AbortController().signal
      const first = await proxyTool.execute(
        { command: 'uptime' },
        { toolCallId: 'tool-call-1', iteration: 1, signal }
      )
      const second = await proxyTool.execute(
        { command: 'top -bn1 | head -n 20' },
        { toolCallId: 'tool-call-2', iteration: 1, signal }
      )
      return {
        text: 'completed',
        finishReason: 'stop',
        iterations: 1,
        toolCalls: [
          { id: 'tool-call-1', name: 'run_host_command', input: { command: 'uptime' }, output: first },
          { id: 'tool-call-2', name: 'run_host_command', input: { command: 'top -bn1 | head -n 20' }, output: second }
        ]
      }
    })

    const frames = () => stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    const callbacks = () => frames().filter(
      (frame): frame is Extract<ClineAgentSidecarMessage, { kind: 'callback' }> => frame.kind === 'callback'
    )
    const respond = (id: string, result: unknown) => runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'callback-result',
      id,
      ok: true,
      result
    })

    const pendingSend = runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'request',
      id: 'send-ordered-host-tools',
      method: 'session.send',
      payload: {
        sessionId: 'session-1',
        taskId: 'task-ordered',
        turnId: 'turn-ordered',
        prompt: 'Inspect uptime and CPU usage.'
      }
    })

    await vi.waitFor(() => expect(callbacks()).toHaveLength(1))
    expect(callbacks()[0]).toMatchObject({
      callback: 'approval.request',
      payload: { toolCallId: 'tool-call-1', input: { command: 'uptime' } }
    })
    await respond(callbacks()[0].id, { approved: true })

    await vi.waitFor(() => expect(callbacks()).toHaveLength(2))
    expect(callbacks()[1]).toMatchObject({
      callback: 'tool.execute',
      payload: { toolCallId: 'tool-call-1', input: { command: 'uptime' } }
    })
    expect(callbacks()).not.toContainEqual(expect.objectContaining({
      callback: 'approval.request',
      payload: expect.objectContaining({ toolCallId: 'tool-call-2' })
    }))
    await respond(callbacks()[1].id, { output: 'up 10 days', exitCode: 0 })

    await vi.waitFor(() => expect(callbacks()).toHaveLength(3))
    expect(callbacks()[2]).toMatchObject({
      callback: 'approval.request',
      payload: { toolCallId: 'tool-call-2', input: { command: 'top -bn1 | head -n 20' } }
    })
    await respond(callbacks()[2].id, { approved: true })

    await vi.waitFor(() => expect(callbacks()).toHaveLength(4))
    expect(callbacks()[3]).toMatchObject({
      callback: 'tool.execute',
      payload: { toolCallId: 'tool-call-2', input: { command: 'top -bn1 | head -n 20' } }
    })
    await respond(callbacks()[3].id, { output: 'top output', exitCode: 0 })
    await pendingSend

    expect(callbacks().map((frame) => [frame.callback, (frame.payload as any).toolCallId])).toEqual([
      ['approval.request', 'tool-call-1'],
      ['tool.execute', 'tool-call-1'],
      ['approval.request', 'tool-call-2'],
      ['tool.execute', 'tool-call-2']
    ])
    expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'event',
      event: 'agent.task',
      payload: expect.objectContaining({ type: 'done', taskId: 'task-ordered', turnId: 'turn-ordered' })
    }))
  })

  it('executes automatically approved database tools one at a time without approval callbacks', async () => {
    const request = startRequest(
      'start-ordered-database-tools',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-database-ordered',
      'turn-database-ordered'
    )
    if (request.kind !== 'request') throw new Error('Expected request frame.')
    ;(request.payload as ClineAgentSessionStartInput).profile = 'database'
    ;(request.payload as ClineAgentSessionStartInput).tools = [
      {
        name: 'describe_table',
        description: 'Read one table definition.',
        inputSchema: { type: 'object' },
        autoApprove: true
      },
      {
        name: 'execute_readonly_query',
        description: 'Execute one read-only database query.',
        inputSchema: { type: 'object' },
        autoApprove: true
      }
    ]
    await runtime.handleMessage(request)

    const startOptions = sdkMocks.manager.start.mock.calls[0]?.[0] as any
    const [describeTable, executeReadonlyQuery] = startOptions?.localRuntime?.extraTools || []
    expect(startOptions).toMatchObject({
      config: { maxParallelToolCalls: 1 },
      toolPolicies: {
        describe_table: { enabled: true, autoApprove: true },
        execute_readonly_query: { enabled: true, autoApprove: true }
      }
    })
    expect(describeTable?.name).toBe('describe_table')
    expect(executeReadonlyQuery?.name).toBe('execute_readonly_query')

    sdkMocks.manager.send.mockImplementationOnce(async () => {
      const signal = new AbortController().signal
      const first = await describeTable.execute(
        { table: 'chart_demo_metrics' },
        { toolCallId: 'database-tool-call-1', iteration: 1, signal }
      )
      const second = await executeReadonlyQuery.execute(
        { sql: 'SELECT * FROM chart_demo_metrics LIMIT 10' },
        { toolCallId: 'database-tool-call-2', iteration: 1, signal }
      )
      return {
        text: 'completed',
        finishReason: 'stop',
        iterations: 1,
        toolCalls: [
          { id: 'database-tool-call-1', name: 'describe_table', input: { table: 'chart_demo_metrics' }, output: first },
          {
            id: 'database-tool-call-2',
            name: 'execute_readonly_query',
            input: { sql: 'SELECT * FROM chart_demo_metrics LIMIT 10' },
            output: second
          }
        ]
      }
    })

    const frames = () => stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    const callbacks = () => frames().filter(
      (frame): frame is Extract<ClineAgentSidecarMessage, { kind: 'callback' }> => frame.kind === 'callback'
    )
    const respond = (id: string, result: unknown) => runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'callback-result',
      id,
      ok: true,
      result
    })

    const pendingSend = runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'request',
      id: 'send-ordered-database-tools',
      method: 'session.send',
      payload: {
        sessionId: 'session-1',
        taskId: 'task-database-ordered',
        turnId: 'turn-database-ordered',
        prompt: 'Inspect the table and then query it.'
      }
    })

    await vi.waitFor(() => expect(callbacks()).toHaveLength(1))
    expect(callbacks()[0]).toMatchObject({
      callback: 'tool.execute',
      payload: { toolCallId: 'database-tool-call-1', toolName: 'describe_table' }
    })
    expect(callbacks()).not.toContainEqual(expect.objectContaining({ callback: 'approval.request' }))
    expect(callbacks()).not.toContainEqual(expect.objectContaining({
      callback: 'tool.execute',
      payload: expect.objectContaining({ toolCallId: 'database-tool-call-2' })
    }))
    await respond(callbacks()[0].id, { columns: [{ name: 'metric_name', type: 'text' }] })

    await vi.waitFor(() => expect(callbacks()).toHaveLength(2))
    expect(callbacks()[1]).toMatchObject({
      callback: 'tool.execute',
      payload: { toolCallId: 'database-tool-call-2', toolName: 'execute_readonly_query' }
    })
    expect(callbacks()).not.toContainEqual(expect.objectContaining({ callback: 'approval.request' }))
    await respond(callbacks()[1].id, { rows: [{ metric_name: 'cpu' }] })
    await pendingSend

    expect(callbacks().map((frame) => [frame.callback, (frame.payload as any).toolCallId])).toEqual([
      ['tool.execute', 'database-tool-call-1'],
      ['tool.execute', 'database-tool-call-2']
    ])
    expect(frames()).toContainEqual(expect.objectContaining({
      kind: 'event',
      event: 'agent.task',
      payload: expect.objectContaining({
        type: 'done',
        taskId: 'task-database-ordered',
        turnId: 'turn-database-ordered'
      })
    }))
  })

  it('keeps a recoverable SDK error non-terminal and still emits the final done event', async () => {
    await runtime.handleMessage(startRequest(
      'start-recoverable',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-recoverable',
      'turn-recoverable'
    ))
    sdkMocks.manager.send.mockImplementationOnce(async ({ sessionId }: { sessionId: string }) => {
      sdkMocks.state.subscriber?.({
        type: 'agent_event',
        payload: {
          sessionId,
          event: {
            type: 'error',
            error: new Error('temporary provider retry'),
            recoverable: true,
            iteration: 1
          }
        }
      })
      return { text: 'recovered', finishReason: 'stop', iterations: 2, toolCalls: [] }
    })

    await runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'request',
      id: 'send-recoverable',
      method: 'session.send',
      payload: {
        sessionId: 'session-1',
        taskId: 'task-recoverable',
        turnId: 'turn-recoverable',
        prompt: 'Recover and finish.'
      }
    })

    const frames = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    const taskEvents = frames
      .filter((frame): frame is Extract<ClineAgentSidecarMessage, { kind: 'event' }> =>
        frame.kind === 'event' && frame.event === 'agent.task')
      .map((frame) => frame.payload)
    expect(taskEvents).toContainEqual(expect.objectContaining({
      type: 'status',
      status: 'running',
      message: 'temporary provider retry'
    }))
    expect(taskEvents).toContainEqual(expect.objectContaining({
      type: 'done',
      text: 'recovered',
      iterations: 2
    }))
    expect(taskEvents).not.toContainEqual(expect.objectContaining({ type: 'error' }))
  })

  it('recreates a missing deterministic session from the UI transcript seed', async () => {
    const request = startRequest(
      'start-seeded',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-seeded',
      'turn-seeded'
    )
    if (request.kind !== 'request') throw new Error('Expected request frame.')
    ;(request.payload as ClineAgentSessionStartInput).initialMessages = [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' }
    ]
    await runtime.handleMessage(request)

    expect(sdkMocks.manager.get).toHaveBeenCalledWith('session-1')
    expect(sdkMocks.manager.readMessages).not.toHaveBeenCalled()
    expect(sdkMocks.manager.start).toHaveBeenCalledWith(expect.objectContaining({
      initialMessages: [
        { role: 'user', content: 'previous question' },
        { role: 'assistant', content: 'previous answer' }
      ]
    }))
  })

  it('prefers the Cline-owned transcript over a duplicate UI seed', async () => {
    const request = startRequest(
      'start-persisted',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-persisted',
      'turn-persisted'
    )
    if (request.kind !== 'request') throw new Error('Expected request frame.')
    ;(request.payload as ClineAgentSessionStartInput).initialMessages = [
      { role: 'user', content: 'duplicate projection' }
    ]
    sdkMocks.manager.get.mockResolvedValueOnce({ sessionId: 'session-1' } as never)
    sdkMocks.manager.readMessages.mockResolvedValueOnce([
      { role: 'user', content: 'canonical question' },
      { role: 'assistant', content: 'canonical answer' }
    ])

    await runtime.handleMessage(request)

    expect(sdkMocks.manager.start).toHaveBeenCalledWith(expect.objectContaining({
      initialMessages: [
        { role: 'user', content: 'canonical question' },
        { role: 'assistant', content: 'canonical answer' }
      ]
    }))
  })

  it('replaces a persisted deterministic transcript from the revised UI seed', async () => {
    await runtime.handleMessage(startRequest(
      'start-before-revision',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-before-revision',
      'turn-before-revision'
    ))
    sdkMocks.manager.get.mockResolvedValueOnce({ sessionId: 'session-1' } as never)
    const request = startRequest(
      'start-revised',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-revised',
      'turn-revised'
    )
    if (request.kind !== 'request') throw new Error('Expected request frame.')
    Object.assign(request.payload as ClineAgentSessionStartInput, {
      replaceTranscript: true,
      initialMessages: [
        { role: 'user', content: 'kept question' },
        { role: 'assistant', content: 'kept answer' }
      ]
    })

    await runtime.handleMessage(request)

    expect(sdkMocks.manager.stop).toHaveBeenCalledWith('session-1')
    expect(sdkMocks.manager.delete).toHaveBeenCalledWith('session-1')
    expect(sdkMocks.manager.readMessages).not.toHaveBeenCalled()
    expect(sdkMocks.manager.start).toHaveBeenLastCalledWith(expect.objectContaining({
      initialMessages: [
        { role: 'user', content: 'kept question' },
        { role: 'assistant', content: 'kept answer' }
      ]
    }))
  })

  it('does not replace an unreadable persisted Cline session with a new seed', async () => {
    const request = startRequest(
      'start-unreadable',
      { providerId: 'openai-compatible', modelId: 'model', apiKey: 'key' },
      'task-unreadable',
      'turn-unreadable'
    )
    const storageError = Object.assign(new Error('Cline session storage is unreadable'), { code: 'EACCES' })
    sdkMocks.manager.get.mockRejectedValueOnce(storageError)

    await runtime.handleMessage(request)

    expect(sdkMocks.manager.start).not.toHaveBeenCalled()
    const frames = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    expect(frames).toContainEqual(expect.objectContaining({
      kind: 'response',
      id: 'start-unreadable',
      ok: false,
      error: expect.objectContaining({
        code: 'CLINE_AGENT_SIDECAR_REQUEST_FAILED',
        message: 'Cline session storage is unreadable'
      })
    }))
  })

  it('permanently deletes a persisted Cline session through ClineCore.delete', async () => {
    await runtime.handleMessage({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'request',
      id: 'delete-session',
      method: 'session.delete',
      payload: { sessionId: 'session-1' }
    })

    expect(sdkMocks.manager.delete).toHaveBeenCalledTimes(1)
    expect(sdkMocks.manager.delete).toHaveBeenCalledWith('session-1')
    const frames = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClineAgentSidecarMessage)
    expect(frames).toContainEqual({
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'response',
      id: 'delete-session',
      ok: true,
      result: { sessionId: 'session-1', deleted: true }
    })
  })
})
