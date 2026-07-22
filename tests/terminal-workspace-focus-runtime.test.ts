import { describe, expect, it } from 'vitest'
import { shouldFocusNewActiveTerminal } from '@/services/terminal/terminalWorkspaceRuntimeController'

describe('terminal workspace focus runtime', () => {
  it('requests focus only when the active terminal is newly added', () => {
    expect(shouldFocusNewActiveTerminal('panel-1', 'panel-1|panel-2', 'panel-2')).toBe(true)
    expect(shouldFocusNewActiveTerminal('panel-1|panel-2', 'panel-1|panel-2', 'panel-2')).toBe(false)
    expect(shouldFocusNewActiveTerminal('panel-1', 'panel-1|panel-2', 'panel-1')).toBe(false)
  })
})
