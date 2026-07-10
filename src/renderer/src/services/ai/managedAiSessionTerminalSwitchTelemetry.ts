import { nextTick } from 'vue'
import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'

export type ManagedAiSessionTerminalSwitchTrigger = 'row-double-click' | 'context-menu' | 'runtime-locate'

type SwitchLog = (level: RuntimeLogLevel, event: string, fields?: Record<string, unknown>) => void

export type ManagedAiSessionTerminalSwitchTrace = {
  interactionId: string
  startedAt: number
  fields: Record<string, unknown>
  targetResolvedAt?: number
  panelActivatedAt?: number
  uiFrameReadyAt?: number
  terminalFrameResult?: {
    at: number
    event: 'ready' | 'timeout'
    fields: Record<string, unknown>
  }
  resumeFinished?: boolean
  closed: boolean
}

type SwitchTelemetryOptions = {
  log?: SwitchLog
  now?: () => number
  afterDomUpdate?: () => void | Promise<void>
  requestFrame?: (callback: FrameRequestCallback) => number | void
}

const roundedDuration = (duration: number) => Math.max(0, Math.round(duration * 10) / 10)

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const defaultRequestFrame = (callback: FrameRequestCallback) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback)
  }
  return setTimeout(() => callback(defaultNow()), 0) as unknown as number
}

export const createManagedAiSessionTerminalSwitchTelemetry = (options: SwitchTelemetryOptions = {}) => {
  const log = options.log || writeRendererRuntimeLog
  const now = options.now || defaultNow
  const afterDomUpdate = options.afterDomUpdate || (() => nextTick())
  const requestFrame = options.requestFrame || defaultRequestFrame
  let sequence = 0
  let activeTrace: ManagedAiSessionTerminalSwitchTrace | null = null

  const traceIsActive = (trace: ManagedAiSessionTerminalSwitchTrace) => activeTrace === trace && !trace.closed
  const traceFields = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown> = {}) => ({
    ...trace.fields,
    ...fields,
    interactionId: trace.interactionId
  })
  const nextFrame = () => new Promise<void>((resolve) => requestFrame(() => resolve()))

  const finalizeTerminalFrame = (trace: ManagedAiSessionTerminalSwitchTrace) => {
    if (!traceIsActive(trace) || !trace.uiFrameReadyAt || !trace.terminalFrameResult) return false
    const result = trace.terminalFrameResult
    const completedAt = Math.max(trace.uiFrameReadyAt, result.at)
    trace.closed = true
    activeTrace = null
    const event = result.event === 'ready'
      ? 'renderer.managed-ai-session.terminal-switch.terminal-frame-ready'
      : 'renderer.managed-ai-session.terminal-switch.terminal-frame-timeout'
    log(result.event === 'ready' ? 'info' : 'warn', event, traceFields(trace, {
      ...result.fields,
      phaseIndex: 5,
      elapsedMs: roundedDuration(completedAt - trace.startedAt),
      terminalFrameWaitMs: roundedDuration(result.at - (trace.panelActivatedAt || trace.startedAt)),
      durationMs: roundedDuration(completedAt - trace.startedAt)
    }))
    return true
  }

  const requested = (fields: Record<string, unknown>) => {
    const startedAt = now()
    const interactionId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `ai-terminal-switch-${crypto.randomUUID()}`
      : `ai-terminal-switch-${Date.now().toString(36)}-${++sequence}`
    if (activeTrace && !activeTrace.closed) {
      const supersededAt = now()
      activeTrace.closed = true
      log('info', 'renderer.managed-ai-session.terminal-switch.superseded', traceFields(activeTrace, {
        elapsedMs: roundedDuration(supersededAt - activeTrace.startedAt),
        durationMs: roundedDuration(supersededAt - activeTrace.startedAt),
        outcome: 'superseded',
        supersededByInteractionId: interactionId
      }))
    }
    const trace: ManagedAiSessionTerminalSwitchTrace = { interactionId, startedAt, fields: { ...fields }, closed: false }
    activeTrace = trace
    log('info', 'renderer.managed-ai-session.terminal-switch.requested', traceFields(trace, {
      phaseIndex: 1,
      elapsedMs: 0
    }))
    return trace
  }

  const targetResolved = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown>) => {
    if (!traceIsActive(trace)) return false
    const resolvedAt = now()
    trace.targetResolvedAt = resolvedAt
    trace.fields = { ...trace.fields, ...fields }
    log('info', 'renderer.managed-ai-session.terminal-switch.target-resolved', traceFields(trace, {
      phaseIndex: 2,
      elapsedMs: roundedDuration(resolvedAt - trace.startedAt),
      targetResolveMs: roundedDuration(resolvedAt - trace.startedAt)
    }))
    return true
  }

  const panelActivated = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown>) => {
    if (!traceIsActive(trace)) return false
    const activatedAt = now()
    trace.panelActivatedAt = activatedAt
    trace.fields = { ...trace.fields, ...fields }
    log('info', 'renderer.managed-ai-session.terminal-switch.panel-activated', traceFields(trace, {
      phaseIndex: 3,
      elapsedMs: roundedDuration(activatedAt - trace.startedAt),
      targetResolveMs: roundedDuration((trace.targetResolvedAt || activatedAt) - trace.startedAt),
      panelActivateMs: roundedDuration(activatedAt - (trace.targetResolvedAt || activatedAt))
    }))
    return true
  }

  const uiFrameReady = (trace: ManagedAiSessionTerminalSwitchTrace, finalFields: () => Record<string, unknown>) => {
    if (!traceIsActive(trace)) return false
    const activatedAt = trace.panelActivatedAt || now()
    void (async () => {
      await afterDomUpdate()
      const vueCommittedAt = now()
      await nextFrame()
      await nextFrame()
      const frameReadyAt = now()
      if (!traceIsActive(trace)) return
      const final = finalFields()
      if (final.targetActive === false) {
        trace.closed = true
        activeTrace = null
        log('info', 'renderer.managed-ai-session.terminal-switch.superseded', traceFields(trace, {
          ...final,
          elapsedMs: roundedDuration(frameReadyAt - trace.startedAt),
          durationMs: roundedDuration(frameReadyAt - trace.startedAt),
          outcome: 'target-changed-before-frame'
        }))
        return
      }
      trace.fields = { ...trace.fields, ...final }
      trace.uiFrameReadyAt = frameReadyAt
      log('info', 'renderer.managed-ai-session.terminal-switch.ui-frame-ready', traceFields(trace, {
        ...final,
        phaseIndex: 4,
        elapsedMs: roundedDuration(frameReadyAt - trace.startedAt),
        targetResolveMs: roundedDuration((trace.targetResolvedAt || activatedAt) - trace.startedAt),
        panelActivateMs: roundedDuration(activatedAt - (trace.targetResolvedAt || activatedAt)),
        vueCommitMs: roundedDuration(vueCommittedAt - activatedAt),
        frameWaitMs: roundedDuration(frameReadyAt - vueCommittedAt),
        uiDurationMs: roundedDuration(frameReadyAt - trace.startedAt)
      }))
      if (trace.fields.samePanel === true && !trace.terminalFrameResult) {
        trace.terminalFrameResult = {
          at: frameReadyAt,
          event: 'ready',
          fields: {
            terminalRenderer: 'unchanged',
            terminalFrameReused: true,
            outcome: trace.fields.outcome || 'already-active'
          }
        }
      }
      finalizeTerminalFrame(trace)
    })().catch((error) => {
      if (!traceIsActive(trace)) return
      trace.closed = true
      activeTrace = null
      log('warn', 'renderer.managed-ai-session.terminal-switch.failed', traceFields(trace, {
        elapsedMs: roundedDuration(now() - trace.startedAt),
        outcome: 'telemetry-failed',
        message: error instanceof Error ? error.message : String(error)
      }))
    })
    return true
  }

  const resumeRequested = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace)) return false
    const requestedAt = now()
    trace.closed = true
    activeTrace = null
    log('info', 'renderer.managed-ai-session.terminal-switch.resume-requested', traceFields(trace, {
      ...fields,
      phaseIndex: 2,
      elapsedMs: roundedDuration(requestedAt - trace.startedAt),
      durationMs: roundedDuration(requestedAt - trace.startedAt),
      outcome: 'resume-requested'
    }))
    return true
  }

  const resumeFinished = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown> = {}, error?: unknown) => {
    if (trace.resumeFinished) return false
    trace.resumeFinished = true
    const finishedAt = now()
    log(error ? 'warn' : 'info', error
      ? 'renderer.managed-ai-session.terminal-switch.resume-failed'
      : 'renderer.managed-ai-session.terminal-switch.resume-finished', traceFields(trace, {
      ...fields,
      elapsedMs: roundedDuration(finishedAt - trace.startedAt),
      durationMs: roundedDuration(finishedAt - trace.startedAt),
      outcome: fields.outcome || (error ? 'resume-failed' : 'resume-finished'),
      ...(error ? { message: error instanceof Error ? error.message : String(error) } : {})
    }))
    return true
  }

  const activeTraceForPanel = (panelId: string) => {
    if (!activeTrace || activeTrace.closed || activeTrace.fields.targetPanelId !== panelId) return null
    return activeTrace
  }

  const terminalFrameReady = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace) || trace.terminalFrameResult) return false
    trace.terminalFrameResult = { at: now(), event: 'ready', fields: { ...fields } }
    finalizeTerminalFrame(trace)
    return true
  }

  const terminalFrameTimeout = (trace: ManagedAiSessionTerminalSwitchTrace, error: unknown, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace) || trace.terminalFrameResult) return false
    trace.terminalFrameResult = {
      at: now(),
      event: 'timeout',
      fields: {
        ...fields,
        outcome: fields.outcome || 'terminal-frame-timeout',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    finalizeTerminalFrame(trace)
    return true
  }

  const superseded = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace)) return false
    const supersededAt = now()
    trace.closed = true
    activeTrace = null
    log('info', 'renderer.managed-ai-session.terminal-switch.superseded', traceFields(trace, {
      ...fields,
      elapsedMs: roundedDuration(supersededAt - trace.startedAt),
      durationMs: roundedDuration(supersededAt - trace.startedAt),
      outcome: fields.outcome || 'superseded'
    }))
    return true
  }

  const unavailable = (trace: ManagedAiSessionTerminalSwitchTrace, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace)) return false
    const failedAt = now()
    trace.closed = true
    activeTrace = null
    log('warn', 'renderer.managed-ai-session.terminal-switch.unavailable', traceFields(trace, {
      ...fields,
      phaseIndex: 2,
      elapsedMs: roundedDuration(failedAt - trace.startedAt),
      durationMs: roundedDuration(failedAt - trace.startedAt),
      outcome: fields.outcome || 'target-unavailable'
    }))
    return true
  }

  const failed = (trace: ManagedAiSessionTerminalSwitchTrace, error: unknown, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace)) return false
    const failedAt = now()
    trace.closed = true
    activeTrace = null
    log('warn', 'renderer.managed-ai-session.terminal-switch.failed', traceFields(trace, {
      ...fields,
      elapsedMs: roundedDuration(failedAt - trace.startedAt),
      durationMs: roundedDuration(failedAt - trace.startedAt),
      outcome: fields.outcome || 'switch-failed',
      message: error instanceof Error ? error.message : String(error)
    }))
    return true
  }

  return {
    requested,
    targetResolved,
    panelActivated,
    uiFrameReady,
    resumeRequested,
    resumeFinished,
    unavailable,
    failed,
    traceIsActive,
    activeTraceForPanel,
    terminalFrameReady,
    terminalFrameTimeout,
    superseded
  }
}

export type ManagedAiSessionTerminalSwitchTelemetry = ReturnType<typeof createManagedAiSessionTerminalSwitchTelemetry>

export const managedAiSessionTerminalSwitchTelemetry = createManagedAiSessionTerminalSwitchTelemetry()
