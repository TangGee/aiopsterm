import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLINE_AGENT_PROTOCOL_VERSION,
  type ClineAgentSessionStartInput,
  type ClineAgentSidecarMessage
} from '../src/shared/contracts/clineAgent'

const sdkMocks = vi.hoisted(() => {
  const state: { coreOptions?: { fetch?: typeof fetch } } = {}
  const manager = {
    subscribe: vi.fn(() => vi.fn()),
    readMessages: vi.fn(async () => []),
    start: vi.fn(async () => ({})),
    updateSessionConnection: vi.fn(async () => {
      const response = await state.coreOptions?.fetch?.('https://provider.example/v1/models', { method: 'GET' })
      await response?.arrayBuffer()
    }),
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

  it('updates an active session connection inside the current provider fetch context', async () => {
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
})
