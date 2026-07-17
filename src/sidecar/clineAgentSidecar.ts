import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  ClineCore,
  createTool,
  setClineDir,
  type AgentTool,
  type ClineCoreStartInput,
  type CoreSessionEvent,
  type ToolApprovalRequest
} from '@cline/sdk'
import {
  CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES,
  CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES,
  CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES,
  CLINE_AGENT_PROTOCOL_VERSION,
  CLINE_AGENT_SDK_VERSION,
  type ClineAgentProviderFetchInput,
  type ClineAgentProviderFetchResult,
  type ClineAgentSessionStartInput,
  type ClineAgentSidecarCallback,
  type ClineAgentSidecarCallbackResult,
  type ClineAgentSidecarEvent,
  type ClineAgentSidecarMessage,
  type ClineAgentSidecarRequest,
  type ClineAgentSidecarResponse,
  type ClineAgentTaskEvent,
  type ClineAgentTaskEventData,
  type ClineAgentTurnInput,
  type ClineAgentTurnResult
} from '../shared/contracts/clineAgent'

const MAX_PENDING_CALLBACKS = 128
const DEFAULT_CALLBACK_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_ITERATIONS = 8

type ActiveTurn = {
  taskId: string
  turnId: string
  seq: number
  abortReason?: string
  terminalEventType?: 'done' | 'cancelled' | 'error'
  settled: Promise<void>
  resolveSettled: () => void
}

type ProviderFetchContext = Pick<ActiveTurn, 'taskId' | 'turnId' | 'seq'> & {
  sessionId: string
}

type PendingCallback = {
  sessionId?: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
  cleanup?: () => void
}

type CallbackOptions = {
  signal?: AbortSignal
  timeoutMs?: number | null
}

const stderrLog = (...values: unknown[]) => {
  const line = values
    .map((value) => (value instanceof Error ? value.message : typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ')
  process.stderr.write(`[cline-agent-sidecar] ${line}\n`)
}

// Keep stdout protocol-only even when a dependency uses console.log.
console.log = stderrLog
console.info = stderrLog
console.warn = stderrLog

const writeMessage = (message: ClineAgentSidecarMessage) => {
  const encoded = JSON.stringify(message)
  if (Buffer.byteLength(encoded, 'utf8') > CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES) {
    throw new Error('Cline Agent protocol frame exceeded the size limit')
  }
  process.stdout.write(`${encoded}\n`)
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error || 'Unknown sidecar error'))

const abortError = (reason: string) => Object.assign(new Error(reason), { name: 'AbortError' })

const isAbortError = (error: unknown) =>
  error instanceof Error && (error.name === 'AbortError' || /\babort(?:ed|ing)?\b|\bcancell?ed\b/i.test(error.message))

const createActiveTurn = (taskId: string, turnId: string): ActiveTurn => {
  let resolveSettled: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve
  })
  return { taskId, turnId, seq: 0, settled, resolveSettled }
}

const responseError = (request: ClineAgentSidecarRequest, code: string, message: string): ClineAgentSidecarResponse => ({
  version: CLINE_AGENT_PROTOCOL_VERSION,
  kind: 'response',
  id: request.id,
  ok: false,
  error: { code, message }
})

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const cleanText = (value: unknown) => String(value || '').trim()

const isCallbackResult = (value: ClineAgentSidecarMessage): value is ClineAgentSidecarCallbackResult => value.kind === 'callback-result'

const isRequest = (value: ClineAgentSidecarMessage): value is ClineAgentSidecarRequest => value.kind === 'request'

export const createClineAgentSidecarRuntime = () => {
  let core: ClineCore | null = null
  let unsubscribe: (() => void) | null = null
  let shuttingDown = false
  const activeSessions = new Set<string>()
  const activeSessionSignatures = new Map<string, string>()
  const activeTurns = new Map<string, ActiveTurn>()
  const pendingCallbacks = new Map<string, PendingCallback>()
  const providerFetchContext = new AsyncLocalStorage<ProviderFetchContext>()
  const hostProxySessions = new Map<string, boolean>()
  const directFetch = globalThis.fetch.bind(globalThis)

  const turnEvent = (
    sessionId: string,
    event: ClineAgentTaskEventData
  ) => {
    const turn = activeTurns.get(sessionId)
    if (!turn) return
    if (turn.terminalEventType) return
    if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
      turn.terminalEventType = event.type
    }
    turn.seq += 1
    const payload = {
      protocolVersion: CLINE_AGENT_PROTOCOL_VERSION,
      sessionId,
      taskId: turn.taskId,
      turnId: turn.turnId,
      seq: turn.seq,
      at: new Date().toISOString(),
      ...event
    } as ClineAgentTaskEvent
    const envelope: ClineAgentSidecarEvent = {
      version: CLINE_AGENT_PROTOCOL_VERSION,
      kind: 'event',
      event: 'agent.task',
      payload
    }
    writeMessage(envelope)
  }

  const handleCoreEvent = (event: CoreSessionEvent) => {
    if (event.type === 'status') {
      const status = event.payload.status === 'pending' ? 'waiting-approval' : event.payload.status === 'idle' ? 'idle' : 'running'
      turnEvent(event.payload.sessionId, { type: 'status', status })
      return
    }
    if (event.type !== 'agent_event') return
    const sessionId = event.payload.sessionId
    const agentEvent = event.payload.event
    if (agentEvent.type === 'content_start' && agentEvent.contentType === 'text' && agentEvent.text) {
      turnEvent(sessionId, { type: 'text-delta', text: agentEvent.text, accumulated: agentEvent.accumulated })
      return
    }
    if (agentEvent.type === 'content_start' && agentEvent.contentType === 'reasoning' && agentEvent.reasoning) {
      turnEvent(sessionId, { type: 'reasoning-delta', text: agentEvent.reasoning, redacted: agentEvent.redacted })
      return
    }
    if (agentEvent.type === 'content_start' && agentEvent.contentType === 'tool' && agentEvent.toolCallId && agentEvent.toolName) {
      turnEvent(sessionId, {
        type: 'tool-call',
        toolCallId: agentEvent.toolCallId,
        toolName: agentEvent.toolName,
        input: agentEvent.input,
        iteration: undefined
      })
      return
    }
    if (agentEvent.type === 'content_update' && agentEvent.toolCallId && agentEvent.toolName) {
      turnEvent(sessionId, {
        type: 'tool-update',
        toolCallId: agentEvent.toolCallId,
        toolName: agentEvent.toolName,
        update: agentEvent.update
      })
      return
    }
    if (agentEvent.type === 'content_end' && agentEvent.contentType === 'tool' && agentEvent.toolCallId && agentEvent.toolName) {
      turnEvent(sessionId, {
        type: 'tool-result',
        toolCallId: agentEvent.toolCallId,
        toolName: agentEvent.toolName,
        output: agentEvent.output,
        error: agentEvent.error,
        durationMs: agentEvent.durationMs
      })
      return
    }
    if (agentEvent.type === 'usage') {
      turnEvent(sessionId, {
        type: 'usage',
        inputTokens: agentEvent.inputTokens,
        outputTokens: agentEvent.outputTokens,
        cacheReadTokens: agentEvent.cacheReadTokens,
        cacheWriteTokens: agentEvent.cacheWriteTokens,
        totalInputTokens: agentEvent.totalInputTokens,
        totalOutputTokens: agentEvent.totalOutputTokens,
        totalCost: agentEvent.totalCost
      })
      return
    }
    if (agentEvent.type === 'error') {
      if (agentEvent.recoverable) {
        turnEvent(sessionId, {
          type: 'status',
          status: 'running',
          message: errorMessage(agentEvent.error)
        })
        return
      }
      const turn = activeTurns.get(sessionId)
      if (turn?.abortReason) {
        turnEvent(sessionId, { type: 'cancelled', reason: turn.abortReason })
        return
      }
      turnEvent(sessionId, {
        type: 'error',
        errorCode: 'CLINE_AGENT_RUNTIME_ERROR',
        errorMessage: errorMessage(agentEvent.error),
        recoverable: agentEvent.recoverable
      })
    }
  }

  const callback = (
    name: ClineAgentSidecarCallback['callback'],
    payload: unknown,
    options: CallbackOptions = {}
  ) =>
    new Promise<unknown>((resolve, reject) => {
      if (pendingCallbacks.size >= MAX_PENDING_CALLBACKS) {
        reject(new Error('Too many pending aiopsterm callbacks'))
        return
      }
      const id = randomUUID()
      const sessionId = isRecord(payload) ? cleanText(payload.sessionId) : ''
      const timeoutMs = options.timeoutMs === undefined ? DEFAULT_CALLBACK_TIMEOUT_MS : options.timeoutMs
      const timer = timeoutMs === null
        ? undefined
        : setTimeout(() => {
            const pending = pendingCallbacks.get(id)
            pendingCallbacks.delete(id)
            pending?.cleanup?.()
            reject(new Error(`${name} callback timed out`))
          }, timeoutMs)
      timer?.unref?.()
      const abort = () => {
        const pending = pendingCallbacks.get(id)
        if (!pending) return
        pendingCallbacks.delete(id)
        if (timer) clearTimeout(timer)
        pending.cleanup?.()
        reject(Object.assign(new Error(`${name} callback was cancelled`), { name: 'AbortError' }))
      }
      const cleanup = options.signal ? () => options.signal?.removeEventListener('abort', abort) : undefined
      pendingCallbacks.set(id, { ...(sessionId ? { sessionId } : {}), resolve, reject, timer, cleanup })
      if (options.signal?.aborted) {
        abort()
        return
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      writeMessage({
        version: CLINE_AGENT_PROTOCOL_VERSION,
        kind: 'callback',
        id,
        callback: name,
        payload
      })
    })

  const cancelPendingCallbacks = (sessionId: string, reason: string) => {
    for (const [id, pending] of pendingCallbacks) {
      if (pending.sessionId !== sessionId) continue
      pendingCallbacks.delete(id)
      if (pending.timer) clearTimeout(pending.timer)
      pending.cleanup?.()
      pending.reject(abortError(reason))
    }
  }

  const headersRecord = (headers: Headers) => {
    const result: Record<string, string> = {}
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  const hostProxyFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ): Promise<Response> => {
    const context = providerFetchContext.getStore()
    if (!context || hostProxySessions.get(context.sessionId) !== true) return directFetch(input, init)
    const request = new Request(input, init)
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? Buffer.alloc(0)
      : Buffer.from(await request.clone().arrayBuffer())
    if (body.byteLength > CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES) {
      throw new Error(`Cline Agent provider request body exceeds ${CLINE_AGENT_PROVIDER_FETCH_MAX_REQUEST_BODY_BYTES} bytes`)
    }
    const payload: ClineAgentProviderFetchInput = {
      sessionId: context.sessionId,
      taskId: context.taskId,
      turnId: context.turnId,
      url: request.url,
      method: request.method,
      headers: headersRecord(request.headers),
      ...(body.byteLength ? { bodyBase64: body.toString('base64') } : {})
    }
    const rawResult = await callback('provider.fetch', payload, { signal: request.signal })
    if (!isRecord(rawResult)) throw new Error('Invalid Cline Agent provider fetch response')
    const result = rawResult as ClineAgentProviderFetchResult
    const status = Number(result.status)
    if (!Number.isInteger(status) || status < 200 || status > 599 || !isRecord(result.headers)) {
      throw new Error('Invalid Cline Agent provider fetch response metadata')
    }
    const responseBody = Buffer.from(cleanText(result.bodyBase64), 'base64')
    if (responseBody.byteLength > CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES) {
      throw new Error(`Cline Agent provider response body exceeds ${CLINE_AGENT_PROVIDER_FETCH_MAX_RESPONSE_BODY_BYTES} bytes`)
    }
    return new Response(responseBody.byteLength ? new Uint8Array(responseBody) : null, {
      status,
      statusText: cleanText(result.statusText),
      headers: Object.fromEntries(Object.entries(result.headers).map(([key, value]) => [key, String(value)]))
    })
  }

  const requestAiopstermToolApproval = async (request: ToolApprovalRequest) => {
    const turn = activeTurns.get(request.sessionId)
    if (!turn) return { approved: false, reason: 'No active aiopsterm turn owns this approval.' }
    turnEvent(request.sessionId, { type: 'status', status: 'waiting-approval' })
    const result = await callback('approval.request', {
      ...request,
      taskId: turn.taskId,
      turnId: turn.turnId
    }, { timeoutMs: null })
    return isRecord(result)
      ? { approved: result.approved === true, reason: cleanText(result.reason) || undefined }
      : { approved: false, reason: 'Invalid approval response.' }
  }

  const ensureCore = async () => {
    if (core) return core
    const dataDir = cleanText(process.env.CLINE_DATA_DIR)
    if (dataDir) setClineDir(dataDir)
    core = await ClineCore.create({
      clientName: 'aiopsterm',
      distinctId: 'aiopsterm-local-sidecar',
      backendMode: 'local',
      automation: false,
      fetch: hostProxyFetch as typeof fetch,
      toolPolicies: { '*': { enabled: false, autoApprove: false } },
      capabilities: {
        requestToolApproval: requestAiopstermToolApproval
      }
    })
    unsubscribe = core.subscribe(handleCoreEvent)
    return core
  }

  const proxyTool = (sessionId: string, definition: ClineAgentSessionStartInput['tools'][number]) =>
    createTool<Record<string, unknown>, unknown>({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      lifecycle: definition.completesRun ? { completesRun: true } : undefined,
      timeoutMs: definition.timeoutMs ?? 30_000,
      retryable: false,
      maxRetries: 0,
      execute: async (input, context) => {
        const turn = activeTurns.get(sessionId)
        if (!turn) throw new Error('No active aiopsterm turn owns this tool call.')
        const toolCallId = context.toolCallId || ''
        const payload = {
          sessionId,
          taskId: turn.taskId,
          turnId: turn.turnId,
          toolCallId,
          toolName: definition.name,
          input,
          iteration: context.iteration
        }
        if (!definition.autoApprove) {
          const approval = await requestAiopstermToolApproval({
            sessionId,
            agentId: cleanText(context.agentId) || 'aiopsterm',
            conversationId: cleanText(context.conversationId || context.runId) || sessionId,
            iteration: Math.max(0, Math.round(Number(context.iteration) || 0)),
            toolCallId,
            toolName: definition.name,
            input,
            policy: { enabled: true, autoApprove: false }
          })
          if (!approval.approved) {
            throw new Error(approval.reason || `Tool "${definition.name}" was not approved.`)
          }
        }
        return callback('tool.execute', payload, { signal: context.signal })
      }
    })

  const startSession = async (input: ClineAgentSessionStartInput) => {
    const sessionId = cleanText(input.sessionId)
    if (!sessionId) throw new Error('sessionId is required')
    hostProxySessions.set(sessionId, input.provider.useHostProxy === true)
    const manager = await ensureCore()
    const taskId = cleanText(input.metadata?.taskId)
    const turnId = cleanText(input.metadata?.turnId)
    const sessionSignature = JSON.stringify([
      input.profile,
      input.systemPrompt,
      input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        autoApprove: tool.autoApprove,
        completesRun: tool.completesRun,
        timeoutMs: tool.timeoutMs
      }))
    ])
    const replaceTranscript = input.replaceTranscript === true
    if (replaceTranscript && activeTurns.has(sessionId)) {
      throw new Error('Cannot replace a Cline transcript while its turn is still active. Stop the turn and retry.')
    }
    if (activeSessions.has(sessionId)) {
      if (!replaceTranscript && activeSessionSignatures.get(sessionId) === sessionSignature) {
        const updateConnection = () => manager.updateSessionConnection(sessionId, {
          providerId: input.provider.providerId,
          modelId: input.provider.modelId,
          apiKey: cleanText(input.provider.apiKey),
          baseUrl: cleanText(input.provider.baseUrl),
          providerConfig: input.provider.providerConfig || {
            providerId: input.provider.providerId,
            modelId: input.provider.modelId
          },
          reasoningEffort: input.provider.reasoningEffort,
          thinking: input.provider.thinking,
          thinkingBudgetTokens: input.provider.thinkingBudgetTokens
        })
        await (taskId && turnId
          ? providerFetchContext.run({ sessionId, taskId, turnId, seq: 0 }, updateConnection)
          : updateConnection())
        return { sessionId, resumed: true }
      }
      await manager.stop(sessionId)
      activeSessions.delete(sessionId)
      activeSessionSignatures.delete(sessionId)
    }

    let initialMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
    const persistedSession = await manager.get(sessionId)
    if (replaceTranscript && persistedSession) {
      await manager.delete(sessionId)
    } else if (persistedSession) {
      const persisted = await manager.readMessages(sessionId)
      if (persisted.length) initialMessages = persisted as Array<{ role: 'user' | 'assistant'; content: string }>
    }
    if (replaceTranscript || !initialMessages.length) {
      initialMessages = (input.initialMessages || [])
        .map((message) => ({ role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: cleanText(message.content) }))
        .filter((message) => message.content)
    }

    const tools = input.tools.map((definition) => proxyTool(sessionId, definition))
    const toolPolicies: Record<string, { enabled: boolean; autoApprove: boolean }> = {
      '*': { enabled: false, autoApprove: false }
    }
    for (const definition of input.tools) {
      // Approval is enforced inside proxy execution so each tool reaches a
      // result before the next tool can request approval or execute.
      toolPolicies[definition.name] = { enabled: true, autoApprove: true }
    }
    const workspaceRoot = cleanText(process.env.AIOPSTERM_CLINE_WORKSPACE_ROOT) || process.cwd()
    // Cline 0.0.59 consumes this AgentConfig field but omits it from the
    // exported CoreSessionConfig type used by ClineCore.start().
    const sessionConfig: ClineCoreStartInput['config'] & { maxParallelToolCalls: 1 } = {
      sessionId,
      providerId: input.provider.providerId,
      modelId: input.provider.modelId,
      apiKey: input.provider.apiKey,
      baseUrl: input.provider.baseUrl,
      providerConfig: input.provider.providerConfig,
      knownModels: input.provider.knownModels,
      thinking: input.provider.thinking,
      reasoningEffort: input.provider.reasoningEffort,
      thinkingBudgetTokens: input.provider.thinkingBudgetTokens,
      maxTokensPerTurn: input.provider.maxTokensPerTurn,
      cwd: workspaceRoot,
      workspaceRoot,
      systemPrompt: input.systemPrompt,
      mode: 'act',
      maxIterations: Math.max(1, Math.min(20, Math.round(input.maxIterations || DEFAULT_MAX_ITERATIONS))),
      maxParallelToolCalls: 1,
      enableTools: false,
      enableSpawnAgent: false,
      enableAgentTeams: false,
      disableMcpSettingsTools: true,
      execution: {
        loopDetection: { softThreshold: 3, hardThreshold: 5 }
      },
      compaction: { enabled: true, strategy: 'basic' },
      checkpoint: { enabled: false }
    }
    const start = () => manager.start({
      config: sessionConfig,
      interactive: true,
      sessionMetadata: {
        owner: 'aiopsterm',
        profile: input.profile,
        ...(input.metadata || {})
      },
      initialMessages,
      localRuntime: { extraTools: tools as AgentTool[], configExtensions: [] },
      toolPolicies
    })
    await (taskId && turnId
      ? providerFetchContext.run({ sessionId, taskId, turnId, seq: 0 }, start)
      : start())
    activeSessions.add(sessionId)
    activeSessionSignatures.set(sessionId, sessionSignature)
    return { sessionId, resumed: initialMessages.length > 0 }
  }

  const sendTurn = async (input: ClineAgentTurnInput): Promise<ClineAgentTurnResult> => {
    const manager = await ensureCore()
    const sessionId = cleanText(input.sessionId)
    const taskId = cleanText(input.taskId)
    const turnId = cleanText(input.turnId)
    const prompt = cleanText(input.prompt)
    if (!sessionId || !taskId || !turnId || !prompt) throw new Error('sessionId, taskId, turnId, and prompt are required')
    if (!activeSessions.has(sessionId)) throw new Error(`Session ${sessionId} is not active`)
    if (activeTurns.has(sessionId)) throw new Error(`Session ${sessionId} already has an active turn`)
    const activeTurn = createActiveTurn(taskId, turnId)
    activeTurns.set(sessionId, activeTurn)
    turnEvent(sessionId, { type: 'status', status: 'running' })
    try {
      const result = await providerFetchContext.run(
        { sessionId, taskId, turnId, seq: 0 },
        () => manager.send({ sessionId, prompt, mode: 'act', userImages: input.userImages })
      )
      const normalized: ClineAgentTurnResult = {
        sessionId,
        taskId,
        turnId,
        text: cleanText(result?.text),
        finishReason: cleanText(result?.finishReason) || 'stop',
        iterations: Math.max(0, Math.round(result?.iterations || 0)),
        ...(result?.usage && typeof result.usage === 'object' ? { usage: result.usage as unknown as Record<string, unknown> } : {}),
        ...(result?.toolCalls
          ? {
              toolCalls: result.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
                output: toolCall.output,
                ...(toolCall.error ? { error: toolCall.error } : {}),
                durationMs: toolCall.durationMs
              }))
            }
          : {})
      }
      turnEvent(sessionId, {
        type: normalized.finishReason === 'aborted' ? 'cancelled' : 'done',
        ...(normalized.finishReason === 'aborted'
          ? { reason: 'aborted' }
          : {
              text: normalized.text,
              finishReason: normalized.finishReason,
              iterations: normalized.iterations,
              usage: normalized.usage
            })
      } as ClineAgentTaskEventData)
      return normalized
    } catch (error) {
      const turn = activeTurns.get(sessionId)
      if (turn?.abortReason || isAbortError(error)) {
        const reason = turn?.abortReason || errorMessage(error) || 'aborted'
        turnEvent(sessionId, { type: 'cancelled', reason })
        return {
          sessionId,
          taskId,
          turnId,
          text: '',
          finishReason: 'aborted',
          iterations: 0,
          toolCalls: []
        }
      }
      turnEvent(sessionId, {
        type: 'error',
        errorCode: 'CLINE_AGENT_TURN_FAILED',
        errorMessage: errorMessage(error),
        recoverable: false
      })
      throw error
    } finally {
      activeTurn.resolveSettled()
      if (activeTurns.get(sessionId) === activeTurn) activeTurns.delete(sessionId)
    }
  }

  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    for (const pending of pendingCallbacks.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.cleanup?.()
      pending.reject(new Error('Cline Agent sidecar is shutting down'))
    }
    pendingCallbacks.clear()
    unsubscribe?.()
    unsubscribe = null
    await core?.dispose('aiopsterm_shutdown')
    core = null
    activeSessions.clear()
    activeSessionSignatures.clear()
    for (const turn of activeTurns.values()) turn.resolveSettled()
    activeTurns.clear()
    hostProxySessions.clear()
  }

  const handleRequest = async (request: ClineAgentSidecarRequest): Promise<ClineAgentSidecarResponse> => {
    try {
      let result: unknown
      if (request.method === 'runtime.ping') {
        result = { protocolVersion: CLINE_AGENT_PROTOCOL_VERSION, sdkVersion: CLINE_AGENT_SDK_VERSION, pid: process.pid }
      } else if (request.method === 'runtime.shutdown') {
        await shutdown()
        result = { stopped: true }
      } else if (request.method === 'session.start') {
        result = await startSession(request.payload as ClineAgentSessionStartInput)
      } else if (request.method === 'session.send') {
        result = await sendTurn(request.payload as ClineAgentTurnInput)
      } else if (request.method === 'session.abort') {
        const payload = isRecord(request.payload) ? request.payload : {}
        const sessionId = cleanText(payload.sessionId)
        if (!sessionId) throw new Error('sessionId is required')
        const reason = cleanText(payload.reason) || 'aiopsterm_abort'
        const activeTurn = activeTurns.get(sessionId)
        if (activeTurn) activeTurn.abortReason ||= reason
        cancelPendingCallbacks(sessionId, reason)
        await (await ensureCore()).abort(sessionId, reason)
        await activeTurn?.settled
        result = { sessionId, aborted: true }
      } else if (request.method === 'session.stop') {
        const payload = isRecord(request.payload) ? request.payload : {}
        const sessionId = cleanText(payload.sessionId)
        if (!sessionId) throw new Error('sessionId is required')
        const activeTurn = activeTurns.get(sessionId)
        if (activeTurn) activeTurn.abortReason ||= 'aiopsterm_stop'
        cancelPendingCallbacks(sessionId, activeTurn?.abortReason || 'aiopsterm_stop')
        await (await ensureCore()).stop(sessionId)
        await activeTurn?.settled
        activeSessions.delete(sessionId)
        activeSessionSignatures.delete(sessionId)
        hostProxySessions.delete(sessionId)
        result = { sessionId, stopped: true }
      } else if (request.method === 'session.delete') {
        const payload = isRecord(request.payload) ? request.payload : {}
        const sessionId = cleanText(payload.sessionId)
        if (!sessionId) throw new Error('sessionId is required')
        const manager = await ensureCore()
        const activeTurn = activeTurns.get(sessionId)
        if (activeTurn) {
          activeTurn.abortReason ||= 'aiopsterm_delete'
          cancelPendingCallbacks(sessionId, activeTurn.abortReason)
          try {
            await manager.abort(sessionId, 'aiopsterm_delete')
          } catch {
            // ClineCore.delete is authoritative and also handles inactive persisted sessions.
          }
        }
        const deleted = await manager.delete(sessionId)
        activeSessions.delete(sessionId)
        activeSessionSignatures.delete(sessionId)
        if (activeTurn) {
          activeTurn.resolveSettled()
          if (activeTurns.get(sessionId) === activeTurn) activeTurns.delete(sessionId)
        }
        hostProxySessions.delete(sessionId)
        result = { sessionId, deleted }
      } else {
        return responseError(request, 'CLINE_AGENT_METHOD_UNKNOWN', `Unknown sidecar method: ${request.method}`)
      }
      return { version: CLINE_AGENT_PROTOCOL_VERSION, kind: 'response', id: request.id, ok: true, result }
    } catch (error) {
      return responseError(request, 'CLINE_AGENT_SIDECAR_REQUEST_FAILED', errorMessage(error))
    }
  }

  const handleMessage = async (message: ClineAgentSidecarMessage) => {
    if (message.version !== CLINE_AGENT_PROTOCOL_VERSION) return
    if (isCallbackResult(message)) {
      const pending = pendingCallbacks.get(message.id)
      if (!pending) return
      pendingCallbacks.delete(message.id)
      if (pending.timer) clearTimeout(pending.timer)
      pending.cleanup?.()
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error?.message || 'Sidecar callback failed'))
      return
    }
    if (!isRequest(message)) return
    const response = await handleRequest(message)
    writeMessage(response)
    if (message.method === 'runtime.shutdown') setImmediate(() => process.exit(0))
  }

  return { handleMessage, shutdown }
}

export const runClineAgentSidecar = () => {
  const runtime = createClineAgentSidecarRuntime()
  let inputBuffer = ''
  let inputBufferBytes = 0
  let closing = false

  const close = async (reason: string) => {
    if (closing) return
    closing = true
    stderrLog(`shutdown: ${reason}`)
    await runtime.shutdown().catch(stderrLog)
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    inputBuffer += chunk
    inputBufferBytes += Buffer.byteLength(chunk, 'utf8')
    for (;;) {
      const newlineIndex = inputBuffer.indexOf('\n')
      if (newlineIndex < 0) {
        if (inputBufferBytes > CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES) {
          void close('protocol_frame_too_large').finally(() => process.exit(1))
        }
        break
      }
      const rawLine = inputBuffer.slice(0, newlineIndex)
      inputBuffer = inputBuffer.slice(newlineIndex + 1)
      const rawLineBytes = Buffer.byteLength(rawLine, 'utf8')
      inputBufferBytes -= rawLineBytes + 1
      if (rawLineBytes > CLINE_AGENT_MAX_PROTOCOL_FRAME_BYTES) {
        void close('protocol_frame_too_large').finally(() => process.exit(1))
        return
      }
      const line = rawLine.trim()
      if (!line) continue
      let message: ClineAgentSidecarMessage
      try {
        message = JSON.parse(line) as ClineAgentSidecarMessage
      } catch {
        stderrLog('ignored invalid JSON protocol frame')
        continue
      }
      void runtime.handleMessage(message).catch(stderrLog)
    }
  })
  process.stdin.on('end', () => void close('stdin_eof').finally(() => process.exit(0)))
  process.on('SIGTERM', () => void close('sigterm').finally(() => process.exit(0)))
  process.on('SIGINT', () => void close('sigint').finally(() => process.exit(0)))
  process.on('uncaughtException', (error) => void close(errorMessage(error)).finally(() => process.exit(1)))
  process.on('unhandledRejection', (error) => void close(errorMessage(error)).finally(() => process.exit(1)))

  writeMessage({
    version: CLINE_AGENT_PROTOCOL_VERSION,
    kind: 'event',
    event: 'runtime.ready',
    payload: { protocolVersion: CLINE_AGENT_PROTOCOL_VERSION, sdkVersion: CLINE_AGENT_SDK_VERSION, pid: process.pid }
  })
}

if ((import.meta as ImportMeta & { main?: boolean }).main) runClineAgentSidecar()
