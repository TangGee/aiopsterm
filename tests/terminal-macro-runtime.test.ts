import { describe, expect, it } from 'vitest'
import { createMacroSnippetName, normalizeMacroSleepThreshold, parseMacroTerminalInput } from '@/services/terminal/terminalMacroRuntime'

describe('terminalMacroRuntime', () => {
  it('creates stable macro snippet names and normalizes sleep thresholds', () => {
    expect(createMacroSnippetName(new Date(2026, 5, 21, 9, 8, 7))).toBe('macro-20260621-090807')
    expect(normalizeMacroSleepThreshold(399.6)).toBe(400)
    expect(normalizeMacroSleepThreshold(-50)).toBe(0)
  })

  it('parses line editing, returns, arrow keys, and target command buffers', () => {
    const parsed = parseMacroTerminalInput(
      { lineBuffer: '', commands: [] },
      'date\be\n\x1b[A',
      { recordControlKeys: true, timestamp: 1200 }
    )

    expect(parsed.lineBuffer).toBe('')
    expect(parsed.commands).toEqual([
      { command: 'date', timestamp: 1200 },
      { command: 'up', timestamp: 1200 }
    ])
  })

  it('records control keys only when enabled and clears buffered ctrl+c input', () => {
    const recordingControls = parseMacroTerminalInput(
      { lineBuffer: 'tail -f app.log', commands: [] },
      '\x03\t',
      { recordControlKeys: true, timestamp: 2000 }
    )
    expect(recordingControls).toEqual({
      lineBuffer: '',
      commands: [
        { command: 'tail -f app.log', timestamp: 2000 },
        { command: 'ctrl+c', timestamp: 2000 },
        { command: 'tab', timestamp: 2000 }
      ]
    })

    const ignoringControls = parseMacroTerminalInput(
      { lineBuffer: 'tail -f app.log', commands: [] },
      '\x03\twhoami',
      { recordControlKeys: false, timestamp: 2100 }
    )
    expect(ignoringControls).toEqual({
      lineBuffer: 'whoami',
      commands: []
    })
  })

  it('preserves pending line buffers across parse calls', () => {
    const first = parseMacroTerminalInput(
      { lineBuffer: '', commands: [] },
      'kubectl get',
      { recordControlKeys: true, timestamp: 3000 }
    )
    const second = parseMacroTerminalInput(first, ' pods\r', { recordControlKeys: true, timestamp: 3500 })

    expect(second).toEqual({
      lineBuffer: '',
      commands: [{ command: 'kubectl get pods', timestamp: 3500 }]
    })
    expect(first).toEqual({
      lineBuffer: 'kubectl get',
      commands: []
    })
  })
})
