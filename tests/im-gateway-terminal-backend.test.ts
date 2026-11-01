import { describe, expect, it, vi } from 'vitest'
import { createGatewayTerminalPort } from '../src/main/backend/imGateway/gatewayTerminalPort'

describe('gateway terminal control boundary', () => {
  it('writes to the exact bound backend session without focusing another terminal', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: {} }))
    const port = createGatewayTerminalPort(invoke)
    await port.write({ panelId: 'old-panel', sessionId: 'stable-session' }, 'pwd\r')
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenCalledWith('terminal.send_text', { sessionId: 'stable-session', text: 'pwd\r' })
  })
  it('rejects a read whose renderer panel now belongs to a different session', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: { terminal: { sessionId: 'new' }, text: 'private output' } }))
    const port = createGatewayTerminalPort(invoke)
    await expect(port.read({ panelId: 'panel', sessionId: 'old' })).rejects.toThrow('READ_FAILED')
    expect(invoke).toHaveBeenCalledWith('terminal.read_screen', { panelId: 'panel', sessionId: 'old', tailLines: 40 })
  })
  it('fails when a terminal is unavailable and never substitutes an active session', async () => {
    const invoke = vi.fn(async () => ({ ok: false }))
    const port = createGatewayTerminalPort(invoke)
    await expect(port.list()).rejects.toThrow('TERMINALS_UNAVAILABLE')
    await expect(port.write({ panelId: 'p', sessionId: 's' }, 'x')).rejects.toThrow('WRITE_FAILED')
  })
})
