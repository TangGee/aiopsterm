import { aiChatClient } from '@/services/ai/aiChatClient'
import type { ClineAgentTaskEvent } from '@shared/contracts/clineAgent'
import {
  clineAgentTaskIdentityKey,
  isTerminalClineAgentTaskEvent,
  type ClineAgentTaskIdentity
} from '@shared/clineAgentTaskIdentity'

type ClineTaskEventLifecycleOptions<T> = {
  resolveTarget: (event: ClineAgentTaskEvent) => T | null
  isTargetReady: (target: T, event: ClineAgentTaskEvent) => boolean
  applyEvent: (target: T, event: ClineAgentTaskEvent) => boolean
  afterEvent?: (target: T, event: ClineAgentTaskEvent, applied: boolean) => void
  maxBufferedEvents?: number
}

export const createClineTaskEventLifecycle = <T>(options: ClineTaskEventLifecycleOptions<T>) => {
  const pendingEvents = new Map<string, ClineAgentTaskEvent[]>()
  const maxBufferedEvents = Math.max(1, options.maxBufferedEvents || 128)

  const losslessEventTypes = new Set<ClineAgentTaskEvent['type']>([
    'text-delta',
    'tool-call',
    'tool-result',
    'approval-requested',
    'done',
    'cancelled',
    'error'
  ])

  const isLosslessEvent = (event: ClineAgentTaskEvent) =>
    losslessEventTypes.has(event.type) || (event.type === 'status' && event.status === 'interrupted')

  const mergeBufferedTextDelta = (pending: ClineAgentTaskEvent[], event: Extract<ClineAgentTaskEvent, { type: 'text-delta' }>) => {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const previous = pending[index]
      if (previous.type === 'text-delta') {
        const accumulated = typeof event.accumulated === 'string'
          ? event.accumulated
          : `${typeof previous.accumulated === 'string' ? previous.accumulated : previous.text}${event.text}`
        pending[index] = { ...event, accumulated }
        return true
      }
      // Reasoning, usage, status, and tool progress do not create Classic/DB
      // transcript blocks, so text on either side still belongs to one block.
      if (isLosslessEvent(previous)) return false
    }
    return false
  }

  const trimBufferedEvents = (pending: ClineAgentTaskEvent[]) => {
    let overflow = pending.length - maxBufferedEvents
    if (overflow <= 0) return pending
    const trimmed = [...pending]
    for (let index = 0; index < trimmed.length && overflow > 0;) {
      if (isLosslessEvent(trimmed[index])) {
        index += 1
        continue
      }
      trimmed.splice(index, 1)
      overflow -= 1
    }
    // A task with more transcript/protocol events than the soft limit stays
    // lossless. Ephemeral status and progress events remain bounded.
    return trimmed
  }

  const bufferEvent = (event: ClineAgentTaskEvent) => {
    const key = clineAgentTaskIdentityKey(event)
    const pending = pendingEvents.get(key) || []
    if (event.type !== 'text-delta' || !mergeBufferedTextDelta(pending, event)) pending.push(event)
    pendingEvents.set(key, trimBufferedEvents(pending))
  }

  const applyResolvedEvent = (target: T, event: ClineAgentTaskEvent) => {
    const applied = options.applyEvent(target, event)
    options.afterEvent?.(target, event, applied)
    if (isTerminalClineAgentTaskEvent(event)) pendingEvents.delete(clineAgentTaskIdentityKey(event))
    return applied
  }

  const receiveEvent = (event: ClineAgentTaskEvent) => {
    const target = options.resolveTarget(event)
    if (!target) return false
    if (!options.isTargetReady(target, event)) {
      bufferEvent(event)
      return false
    }
    return applyResolvedEvent(target, event)
  }

  const replay = (identity: ClineAgentTaskIdentity) => {
    const key = clineAgentTaskIdentityKey(identity)
    const pending = [...(pendingEvents.get(key) || [])].sort((left, right) => left.seq - right.seq)
    pendingEvents.delete(key)
    let applied = 0
    for (const event of pending) {
      const target = options.resolveTarget(event)
      if (!target || !options.isTargetReady(target, event)) {
        bufferEvent(event)
        continue
      }
      if (applyResolvedEvent(target, event)) applied += 1
    }
    return applied
  }

  const forget = (identity: ClineAgentTaskIdentity) => {
    pendingEvents.delete(clineAgentTaskIdentityKey(identity))
  }

  const forgetTurn = (turnIdInput: string) => {
    const turnId = String(turnIdInput || '').trim()
    if (!turnId) return
    for (const [key, events] of pendingEvents) {
      if (events[0]?.turnId === turnId) pendingEvents.delete(key)
    }
  }

  const stopListening = aiChatClient.onClineAgentTaskEvent()?.(receiveEvent)

  return {
    receiveEvent,
    replay,
    forget,
    forgetTurn,
    dispose: () => {
      stopListening?.()
      pendingEvents.clear()
    }
  }
}
