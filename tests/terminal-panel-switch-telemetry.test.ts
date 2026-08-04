import { describe, expect, it, vi } from 'vitest'
import { createTerminalPanelSwitchTelemetry } from '@/services/terminal/terminalPanelSwitchTelemetry'

describe('terminalPanelSwitchTelemetry', () => {
  it('records panel switch stages and total duration', () => {
    let currentTime = 10
    const log = vi.fn()
    const telemetry = createTerminalPanelSwitchTelemetry({ log, now: () => currentTime })
    const trace = telemetry.requested('history-back', 'panel-b', 'panel-a')

    currentTime = 14.25
    expect(telemetry.activeTraceForSource('panel-b')).toBe(trace)
    expect(telemetry.stage(trace, 'renderer.terminal-panel-switch.surface-detached', { detachMs: 1.5 })).toBe(true)
    currentTime = 31.8
    expect(telemetry.completed(trace, { frameSeq: 12 })).toBe(true)

    expect(log).toHaveBeenNthCalledWith(1, 'info', 'renderer.terminal-panel-switch.requested', expect.objectContaining({
      trigger: 'history-back',
      sourcePanelId: 'panel-b',
      targetPanelId: 'panel-a',
      elapsedMs: 0
    }))
    expect(log).toHaveBeenLastCalledWith('info', 'renderer.terminal-panel-switch.completed', expect.objectContaining({
      frameSeq: 12,
      durationMs: 21.8
    }))
  })

  it('records recent panel picker readiness separately from activation', () => {
    let currentTime = 100
    const log = vi.fn()
    const telemetry = createTerminalPanelSwitchTelemetry({ log, now: () => currentTime })
    const sequence = telemetry.pickerRequested({ panelCount: 4 })

    currentTime = 112.4
    expect(telemetry.pickerReady(sequence, { searchFocused: true })).toBe(true)
    expect(log).toHaveBeenLastCalledWith('info', 'renderer.terminal-panel-picker.ready', expect.objectContaining({
      panelCount: 4,
      searchFocused: true,
      durationMs: 12.4
    }))
  })
})
