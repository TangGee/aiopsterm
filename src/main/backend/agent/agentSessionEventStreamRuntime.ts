import { randomUUID } from 'crypto'
import type { Socket } from 'net'
import type { AiAgentSessionEvent, AiAgentSessionEventName, ManagedAiSessionEvent, ManagedAiSessionRecord, ManagedAiSessionState } from '@shared/contracts/managedAiSessions'

export type AgentSessionEventStreamCategory = 'agent' | 'managed-ai'

export type AgentSessionEventStreamFrame = {
  type: 'event'
  protocol: 'aiopsterm-agent-events'
  version: 1
  boot_id: string
  seq: number
  id: string
  name: string
  category: AgentSessionEventStreamCategory
  source: string
  occurred_at: string
  workspace_id?: string
  surface_id?: string
  terminal_session_id?: string
  payload: Record<string, unknown>
}

export type AgentSessionEventStreamListResult = {
  ok: boolean
  data?: {
    protocol: 'aiopsterm-agent-events'
    version: 1
    bootId: string
    afterSeq: number
    oldestSeq: number
    latestSeq: number
    nextSeq: number
    gap: boolean
    events: AgentSessionEventStreamFrame[]
    count: number
  }
  errorCode?: string
  errorMessage?: string
}

type AgentSessionEventStreamFilters = {
  names: Set<string>
  categories: Set<AgentSessionEventStreamCategory>
  includeHeartbeats: boolean
}

type AgentSessionEventStreamSubscriber = {
  id: string
  socket: Socket
  filters: AgentSessionEventStreamFilters
  heartbeat: NodeJS.Timeout | null
}

type AgentSessionEventStreamRuntimeOptions = {
  compactRawValue: (value: unknown, depth?: number) => unknown
  cleanText: (value: unknown) => string
  cleanOptionalText: (value: unknown) => string | undefined
  emitManagedAiSessionEvent?: (event: ManagedAiSessionEvent) => void
}

const maxStreamEvents = 2000
const streamHeartbeatIntervalMs = 15_000
const streamBootId = randomUUID()

export const createAgentSessionEventStreamRuntime = (options: AgentSessionEventStreamRuntimeOptions) => {
  let streamSeq = 0
  let streamEvents: AgentSessionEventStreamFrame[] = []
  let streamSubscribers = new Map<string, AgentSessionEventStreamSubscriber>()

  const socketWriteJsonLine = (socket: Socket, value: unknown) => {
    socket.write(`${JSON.stringify(value)}\n`)
  }

  const normalizeStreamName = (event: AiAgentSessionEventName) =>
    event
      .split('_')
      .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
      .join('')

  const compactStreamPayload = (value: Record<string, unknown>) => options.compactRawValue(value, 0) as Record<string, unknown>

  const eventStreamFrame = (
    input: Omit<AgentSessionEventStreamFrame, 'type' | 'protocol' | 'version' | 'boot_id' | 'seq' | 'id' | 'occurred_at'>
  ): AgentSessionEventStreamFrame => {
    streamSeq += 1
    return {
      type: 'event',
      protocol: 'aiopsterm-agent-events',
      version: 1,
      boot_id: streamBootId,
      seq: streamSeq,
      id: `${streamBootId}-${streamSeq}`,
      occurred_at: new Date().toISOString(),
      ...input,
      payload: compactStreamPayload(input.payload)
    }
  }

  const streamMatches = (frame: AgentSessionEventStreamFrame, filters: AgentSessionEventStreamFilters) =>
    (!filters.names.size || filters.names.has(frame.name)) && (!filters.categories.size || filters.categories.has(frame.category))

  const publishStreamFrame = (frame: AgentSessionEventStreamFrame) => {
    streamEvents.push(frame)
    if (streamEvents.length > maxStreamEvents) streamEvents = streamEvents.slice(-maxStreamEvents)
    streamSubscribers.forEach((subscriber) => {
      if (!streamMatches(frame, subscriber.filters)) return
      socketWriteJsonLine(subscriber.socket, frame)
    })
  }

  const publishAgentEventStreamFrame = (event: AiAgentSessionEvent, session: ManagedAiSessionRecord) => {
    publishStreamFrame(
      eventStreamFrame({
        name: `agent.hook.${normalizeStreamName(event.event)}`,
        category: 'agent',
        source: event.source,
        workspace_id: event.workspaceId,
        surface_id: event.panelId,
        terminal_session_id: event.terminalSessionId,
        payload: {
          source: event.source,
          event: event.event,
          sessionId: event.sessionId,
          title: session.title,
          summary: event.summary,
          state: session.state,
          requestId: event.requestId,
          requestKind: event.requestKind,
          decisionMode: event.decisionMode,
          waitTimeoutMs: event.waitTimeoutMs,
          toolName: event.toolName,
          actionable: event.actionable,
          cwd: event.cwd,
          transcriptPath: event.transcriptPath,
          processId: event.processId,
          agentLifecycle: event.agentLifecycle
        }
      })
    )
  }

  const publishManagedAiStreamFrame = (name: string, session: ManagedAiSessionRecord | null, payload: Record<string, unknown>) => {
    const frame = eventStreamFrame({
      name,
      category: 'managed-ai',
      source: session?.source || 'aiopsterm',
      workspace_id: session?.workspaceId,
      surface_id: session?.panelId,
      terminal_session_id: session?.terminalSessionId,
      payload: {
        ...(session
          ? {
              source: session.source,
              sessionId: session.id,
              title: session.title,
              state: session.state,
              lastEvent: session.lastEvent,
              requestKind: session.requestKind,
              decisionMode: session.decisionMode,
              waitTimeoutMs: session.waitTimeoutMs,
              toolName: session.toolName
            }
          : {}),
        ...payload
      }
    })
    publishStreamFrame(frame)
    options.emitManagedAiSessionEvent?.({
      name: frame.name,
      category: 'managed-ai',
      source: frame.source,
      sessionId: options.cleanOptionalText(frame.payload.sessionId),
      title: options.cleanOptionalText(frame.payload.title),
      state:
        frame.payload.state === 'idle' ||
        frame.payload.state === 'working' ||
        frame.payload.state === 'needsInput' ||
        frame.payload.state === 'ended' ||
        frame.payload.state === 'unknown'
          ? (frame.payload.state as ManagedAiSessionState)
          : undefined,
      payload: frame.payload,
      seq: frame.seq
    })
  }

  const cleanStringSet = (value: unknown) => {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    return new Set(values.map(options.cleanText).filter(Boolean))
  }

  const normalizeStreamLimit = (value: unknown) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return 100
    return Math.max(1, Math.min(500, Math.floor(number)))
  }

  const normalizeStreamCategories = (value: unknown) => {
    const raw = cleanStringSet(value)
    const categories = new Set<AgentSessionEventStreamCategory>()
    raw.forEach((item) => {
      if (item === 'agent' || item === 'managed-ai') categories.add(item)
    })
    return categories
  }

  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

  const streamParamsFrom = (record: Record<string, unknown>) => {
    const params = isRecord(record.params) ? record.params : record
    const after =
      typeof params.after_seq === 'number'
        ? params.after_seq
        : typeof params.afterSeq === 'number'
          ? params.afterSeq
          : typeof params.after === 'number'
            ? params.after
            : 0
    return {
      afterSeq: Number.isFinite(after) ? Math.max(0, Math.floor(after)) : 0,
      filters: {
        names: cleanStringSet(params.names || params.name),
        categories: normalizeStreamCategories(params.categories || params.category),
        includeHeartbeats: params.include_heartbeats === false || params.includeHeartbeats === false ? false : true
      } satisfies AgentSessionEventStreamFilters
    }
  }

  const closeStreamSubscriber = (id: string) => {
    const subscriber = streamSubscribers.get(id)
    if (!subscriber) return
    if (subscriber.heartbeat) clearInterval(subscriber.heartbeat)
    streamSubscribers.delete(id)
  }

  const startEventStream = (socket: Socket, request: Record<string, unknown>) => {
    const { afterSeq, filters } = streamParamsFrom(request)
    const subscriberId = randomUUID()
    const oldestSeq = streamEvents[0]?.seq || streamSeq + 1
    const replay = streamEvents.filter((frame) => frame.seq > afterSeq && streamMatches(frame, filters))
    const subscriber: AgentSessionEventStreamSubscriber = {
      id: subscriberId,
      socket,
      filters,
      heartbeat: null
    }
    streamSubscribers.set(subscriberId, subscriber)
    socketWriteJsonLine(socket, {
      type: 'ack',
      protocol: 'aiopsterm-agent-events',
      version: 1,
      boot_id: streamBootId,
      subscription_id: subscriberId,
      heartbeat_interval_seconds: streamHeartbeatIntervalMs / 1000,
      replay_count: replay.length,
      resume: {
        after_seq: afterSeq,
        requested_after_seq: afterSeq,
        oldest_seq: oldestSeq,
        latest_seq: streamSeq,
        next_seq: streamSeq + 1,
        gap: afterSeq > 0 && afterSeq < oldestSeq
      },
      filters: {
        names: [...filters.names],
        categories: [...filters.categories]
      }
    })
    replay.forEach((frame) => socketWriteJsonLine(socket, frame))
    if (filters.includeHeartbeats) {
      subscriber.heartbeat = setInterval(() => {
        if (socket.destroyed) {
          closeStreamSubscriber(subscriberId)
          return
        }
        socketWriteJsonLine(socket, {
          type: 'heartbeat',
          protocol: 'aiopsterm-agent-events',
          version: 1,
          boot_id: streamBootId,
          subscription_id: subscriberId,
          latest_seq: streamSeq,
          occurred_at: new Date().toISOString()
        })
      }, streamHeartbeatIntervalMs)
      subscriber.heartbeat.unref()
    }
    socket.on('close', () => closeStreamSubscriber(subscriberId))
    socket.on('error', () => closeStreamSubscriber(subscriberId))
  }

  const listManagedAiSessionEvents = (input: Record<string, unknown> = {}): AgentSessionEventStreamListResult => {
    const { afterSeq, filters } = streamParamsFrom(input)
    const limit = normalizeStreamLimit(input.limit)
    const sourceFilter = cleanStringSet(input.sources || input.source)
    const sessionFilter = cleanStringSet(input.sessionIds || input.session_ids || input.sessionId || input.session_id)
    const oldestSeq = streamEvents[0]?.seq || streamSeq + 1
    const events = streamEvents
      .filter((frame) => {
        if (frame.seq <= afterSeq || !streamMatches(frame, filters)) return false
        const source = options.cleanText(frame.payload.source || frame.source)
        const sessionId = options.cleanText(frame.payload.sessionId || frame.payload.session_id)
        if (sourceFilter.size && !sourceFilter.has(source)) return false
        if (sessionFilter.size && !sessionFilter.has(sessionId)) return false
        return true
      })
      .slice(0, limit)
    return {
      ok: true,
      data: {
        protocol: 'aiopsterm-agent-events',
        version: 1,
        bootId: streamBootId,
        afterSeq,
        oldestSeq,
        latestSeq: streamSeq,
        nextSeq: streamSeq + 1,
        gap: afterSeq > 0 && afterSeq < oldestSeq,
        events,
        count: events.length
      }
    }
  }

  const closeEventStreams = () => {
    streamSubscribers.forEach((subscriber) => {
      if (subscriber.heartbeat) clearInterval(subscriber.heartbeat)
      subscriber.socket.destroy()
    })
    streamSubscribers = new Map()
  }

  return {
    streamBootId,
    streamEventCount: () => streamEvents.length,
    streamLatestSeq: () => streamSeq,
    publishAgentEventStreamFrame,
    publishManagedAiStreamFrame,
    startEventStream,
    listManagedAiSessionEvents,
    closeEventStreams
  }
}
