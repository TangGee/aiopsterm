import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClineTaskEventLifecycle } from '@/services/ai/clineTaskEventLifecycleRuntime'
import type { ClineAgentTaskEvent, ClineAgentTaskEventData } from '@shared/contracts/clineAgent'

const event = <T extends ClineAgentTaskEventData>(payload: T, seq: number): ClineAgentTaskEvent => ({
  protocolVersion: 1,
  sessionId: 'cline-session',
  taskId: 'task-1',
  turnId: 'turn-1',
  seq,
  at: '2026-07-15T00:00:00.000Z',
  ...payload
}) as ClineAgentTaskEvent

describe('shared Cline task event lifecycle', () => {
  beforeEach(() => (globalThis as any).__resetClineAgentTaskEventMock?.())
  afterEach(() => (globalThis as any).__resetClineAgentTaskEventMock?.())

  it('buffers an unready target and replays its protocol sequence without reordering projected messages', () => {
    const target = { ready: false, seq: [] as number[] }
    const lifecycle = createClineTaskEventLifecycle({
      resolveTarget: (taskEvent) => taskEvent.taskId === 'task-1' && taskEvent.turnId === 'turn-1' ? target : null,
      isTargetReady: (resolved) => resolved.ready,
      applyEvent: (resolved, taskEvent) => {
        resolved.seq.push(taskEvent.seq)
        return true
      }
    })
    const emit = (globalThis as any).__emitClineAgentTaskEventMock as (taskEvent: ClineAgentTaskEvent) => void

    emit(event({ type: 'tool-result', toolCallId: 'tool-1', toolName: 'run_host_command', output: {} }, 3))
    emit(event({ type: 'text-delta', text: 'Checking.' }, 1))
    emit(event({ type: 'tool-call', toolCallId: 'tool-1', toolName: 'run_host_command', input: { command: 'uptime' } }, 2))
    expect(target.seq).toEqual([])

    target.ready = true
    expect(lifecycle.replay({ taskId: 'task-1', turnId: 'turn-1' })).toBe(3)
    expect(target.seq).toEqual([1, 2, 3])
    lifecycle.dispose()
  })

  it('does not evict tool lifecycle events when buffered deltas exceed the soft limit', () => {
    const target = { ready: false, events: [] as ClineAgentTaskEvent[] }
    const lifecycle = createClineTaskEventLifecycle({
      resolveTarget: (taskEvent) => taskEvent.taskId === 'task-1' && taskEvent.turnId === 'turn-1' ? target : null,
      isTargetReady: (resolved) => resolved.ready,
      applyEvent: (resolved, taskEvent) => {
        resolved.events.push(taskEvent)
        return true
      }
    })
    const emit = (globalThis as any).__emitClineAgentTaskEventMock as (taskEvent: ClineAgentTaskEvent) => void

    emit(event({ type: 'tool-call', toolCallId: 'host-a', toolName: 'run_host_command', input: { command: 'uptime' } }, 1))
    emit(event({ type: 'tool-result', toolCallId: 'host-a', toolName: 'run_host_command', output: { stdout: 'up' } }, 2))
    for (let seq = 3; seq <= 322; seq += 1) {
      emit(seq % 2
        ? event({ type: 'text-delta', text: `chunk-${seq}` }, seq)
        : event({ type: 'reasoning-delta', text: `reasoning-${seq}` }, seq))
    }
    emit(event({ type: 'done', text: 'complete', finishReason: 'stop', iterations: 1 }, 323))

    target.ready = true
    lifecycle.replay({ taskId: 'task-1', turnId: 'turn-1' })

    expect(target.events.filter((taskEvent) => taskEvent.type === 'tool-call' || taskEvent.type === 'tool-result')).toEqual([
      expect.objectContaining({ type: 'tool-call', toolCallId: 'host-a', seq: 1 }),
      expect.objectContaining({ type: 'tool-result', toolCallId: 'host-a', seq: 2 })
    ])
    expect(target.events.at(-1)).toMatchObject({ type: 'done', seq: 323, text: 'complete' })
    lifecycle.dispose()
  })

  it('bounds ephemeral progress while retaining transcript and terminal events', () => {
    const target = { ready: false, events: [] as ClineAgentTaskEvent[] }
    const lifecycle = createClineTaskEventLifecycle({
      resolveTarget: () => target,
      isTargetReady: (resolved) => resolved.ready,
      applyEvent: (resolved, taskEvent) => {
        resolved.events.push(taskEvent)
        return true
      },
      maxBufferedEvents: 4
    })
    const emit = (globalThis as any).__emitClineAgentTaskEventMock as (taskEvent: ClineAgentTaskEvent) => void

    emit(event({ type: 'text-delta', text: 'Retained answer.' }, 1))
    for (let seq = 2; seq <= 200; seq += 1) {
      emit(seq % 3 === 0
        ? event({ type: 'status', status: 'running' }, seq)
        : seq % 3 === 1
          ? event({ type: 'reasoning-delta', text: `reasoning-${seq}` }, seq)
          : event({ type: 'tool-update', toolCallId: 'tool-1', toolName: 'run_host_command', update: { seq } }, seq))
    }
    emit(event({ type: 'done', text: 'Retained answer.', finishReason: 'stop', iterations: 1 }, 201))

    target.ready = true
    lifecycle.replay({ taskId: 'task-1', turnId: 'turn-1' })

    expect(target.events.length).toBeLessThanOrEqual(4)
    expect(target.events.some((taskEvent) => taskEvent.type === 'text-delta' && taskEvent.text === 'Retained answer.')).toBe(true)
    expect(target.events.at(-1)).toMatchObject({ type: 'done', seq: 201, text: 'Retained answer.' })
    lifecycle.dispose()
  })

  it('merges buffered text deltas without requiring an accumulated field', () => {
    const target = { ready: false, text: '' }
    const lifecycle = createClineTaskEventLifecycle({
      resolveTarget: () => target,
      isTargetReady: (resolved) => resolved.ready,
      applyEvent: (resolved, taskEvent) => {
        if (taskEvent.type === 'text-delta') {
          resolved.text = typeof taskEvent.accumulated === 'string'
            ? taskEvent.accumulated
            : `${resolved.text}${taskEvent.text}`
        }
        return true
      },
      maxBufferedEvents: 2
    })
    const emit = (globalThis as any).__emitClineAgentTaskEventMock as (taskEvent: ClineAgentTaskEvent) => void

    emit(event({ type: 'text-delta', text: 'one ' }, 1))
    emit(event({ type: 'text-delta', text: 'two ' }, 2))
    emit(event({ type: 'text-delta', text: 'three' }, 3))
    target.ready = true
    lifecycle.replay({ taskId: 'task-1', turnId: 'turn-1' })

    expect(target.text).toBe('one two three')
    lifecycle.dispose()
  })

  it('delivers one preload event channel to independent Classic and DB surface lifecycles', () => {
    const classicEvents: string[] = []
    const databaseEvents: string[] = []
    const classic = createClineTaskEventLifecycle({
      resolveTarget: (taskEvent) => taskEvent.taskId === 'classic-task' ? classicEvents : null,
      isTargetReady: () => true,
      applyEvent: (target, taskEvent) => {
        target.push(taskEvent.type)
        return true
      }
    })
    const database = createClineTaskEventLifecycle({
      resolveTarget: (taskEvent) => taskEvent.taskId === 'dbai-db-request' ? databaseEvents : null,
      isTargetReady: () => true,
      applyEvent: (target, taskEvent) => {
        target.push(taskEvent.type)
        return true
      }
    })
    const emit = (globalThis as any).__emitClineAgentTaskEventMock as (taskEvent: ClineAgentTaskEvent) => void

    emit({ ...event({ type: 'status', status: 'running' }, 1), taskId: 'classic-task' })
    emit({ ...event({ type: 'tool-call', toolCallId: 'db-tool', toolName: 'describe_database_table', input: {} }, 2), taskId: 'dbai-db-request', turnId: 'db-request' })

    expect(classicEvents).toEqual(['status'])
    expect(databaseEvents).toEqual(['tool-call'])
    classic.dispose()
    database.dispose()
  })
})
