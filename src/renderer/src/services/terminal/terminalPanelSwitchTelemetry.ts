import { writeRendererRuntimeLog } from '@/services/app/runtimeLogClient'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'

export type TerminalPanelSwitchTrigger = 'history-back' | 'history-forward' | 'recent-panel'

type TelemetryLog = (level: RuntimeLogLevel, event: string, fields?: Record<string, unknown>) => void

export type TerminalPanelSwitchTrace = {
  interactionId: string
  trigger: TerminalPanelSwitchTrigger
  sourcePanelId: string
  targetPanelId: string
  startedAt: number
  closed: boolean
}

type TerminalPanelSwitchTelemetryOptions = {
  log?: TelemetryLog
  now?: () => number
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const roundedDuration = (value: number) => Math.max(0, Math.round(value * 10) / 10)

export const createTerminalPanelSwitchTelemetry = (options: TerminalPanelSwitchTelemetryOptions = {}) => {
  const log = options.log || writeRendererRuntimeLog
  const now = options.now || defaultNow
  let sequence = 0
  let activeTrace: TerminalPanelSwitchTrace | null = null
  let pickerRequestedAt = 0
  let pickerSequence = 0
  let pickerFields: Record<string, unknown> = {}

  const traceFields = (trace: TerminalPanelSwitchTrace, fields: Record<string, unknown> = {}) => ({
    trigger: trace.trigger,
    sourcePanelId: trace.sourcePanelId,
    targetPanelId: trace.targetPanelId,
    interactionId: trace.interactionId,
    ...fields
  })

  const traceIsActive = (trace: TerminalPanelSwitchTrace) => activeTrace === trace && !trace.closed

  const requested = (trigger: TerminalPanelSwitchTrigger, sourcePanelId: string, targetPanelId: string) => {
    const startedAt = now()
    const interactionId = `terminal-panel-switch-${Date.now().toString(36)}-${++sequence}`
    if (activeTrace && !activeTrace.closed) {
      activeTrace.closed = true
      log('info', 'renderer.terminal-panel-switch.superseded', traceFields(activeTrace, {
        elapsedMs: roundedDuration(startedAt - activeTrace.startedAt),
        supersededByInteractionId: interactionId
      }))
    }
    const trace: TerminalPanelSwitchTrace = {
      interactionId,
      trigger,
      sourcePanelId,
      targetPanelId,
      startedAt,
      closed: false
    }
    activeTrace = trace
    log('info', 'renderer.terminal-panel-switch.requested', traceFields(trace, { elapsedMs: 0 }))
    return trace
  }

  const activeTraceForPanel = (panelId: string) => {
    if (!activeTrace || activeTrace.closed || activeTrace.targetPanelId !== panelId) return null
    return activeTrace
  }

  const activeTraceForSource = (panelId: string) => {
    if (!activeTrace || activeTrace.closed || activeTrace.sourcePanelId !== panelId) return null
    return activeTrace
  }

  const stage = (trace: TerminalPanelSwitchTrace, event: string, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace)) return false
    log('info', event, traceFields(trace, {
      ...fields,
      elapsedMs: roundedDuration(now() - trace.startedAt)
    }))
    return true
  }

  const completed = (trace: TerminalPanelSwitchTrace, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace)) return false
    const completedAt = now()
    trace.closed = true
    activeTrace = null
    log('info', 'renderer.terminal-panel-switch.completed', traceFields(trace, {
      ...fields,
      elapsedMs: roundedDuration(completedAt - trace.startedAt),
      durationMs: roundedDuration(completedAt - trace.startedAt)
    }))
    return true
  }

  const failed = (trace: TerminalPanelSwitchTrace, error: unknown, fields: Record<string, unknown> = {}) => {
    if (!traceIsActive(trace)) return false
    const failedAt = now()
    trace.closed = true
    activeTrace = null
    log('warn', 'renderer.terminal-panel-switch.failed', traceFields(trace, {
      ...fields,
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: roundedDuration(failedAt - trace.startedAt),
      durationMs: roundedDuration(failedAt - trace.startedAt)
    }))
    return true
  }

  const pickerRequested = (fields: Record<string, unknown> = {}) => {
    pickerRequestedAt = now()
    pickerSequence += 1
    pickerFields = { ...fields }
    log('info', 'renderer.terminal-panel-picker.requested', {
      ...fields,
      pickerSequence,
      elapsedMs: 0
    })
    return pickerSequence
  }

  const pickerReady = (sequence: number, fields: Record<string, unknown> = {}) => {
    if (!pickerRequestedAt || sequence !== pickerSequence) return false
    const readyAt = now()
    const durationMs = roundedDuration(readyAt - pickerRequestedAt)
    pickerRequestedAt = 0
    log('info', 'renderer.terminal-panel-picker.ready', {
      ...pickerFields,
      ...fields,
      pickerSequence: sequence,
      elapsedMs: durationMs,
      durationMs
    })
    pickerFields = {}
    return true
  }

  return {
    requested,
    activeTraceForPanel,
    activeTraceForSource,
    stage,
    completed,
    failed,
    pickerRequested,
    pickerReady,
    activePickerSequence: () => pickerRequestedAt ? pickerSequence : 0
  }
}

export const terminalPanelSwitchTelemetry = createTerminalPanelSwitchTelemetry()
