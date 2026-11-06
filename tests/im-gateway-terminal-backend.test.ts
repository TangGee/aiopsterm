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
  it('lists saved hosts without exposing credentials and creates a fresh SSH terminal', async () => {
    const terminal = { panelId: 'new-panel', sessionId: 'new-session', title: 'Host', connected: true, kind: 'ssh', assetId: 'asset' }
    const invoke = vi.fn(async (method: string) => method === 'asset.list' ? { ok: true, data: { assets: [{ id: 'asset', name: 'Host', host: 'server' }] } } : method === 'asset.ssh.connect' ? { ok: true, data: { surfaceId: 'new-panel' } } : { ok: true, data: { terminals: [terminal] } })
    const port = createGatewayTerminalPort(invoke)
    expect(await port.hosts!()).toEqual([{ id: 'asset', name: 'Host', host: 'server' }])
    expect(await port.create!('asset')).toEqual(terminal)
    expect(invoke).toHaveBeenCalledWith('asset.ssh.connect', { assetId: 'asset', exactAssetId: true, reuse: false })
    await expect(port.create!('missing')).rejects.toThrow('HOST_UNAVAILABLE')
  })
  it('creates a local panel and binds its session, not the previously active session', async () => {
    const target = { panelId: 'new-panel', sessionId: 'new-session', title: 'Local', connected: true, kind: 'local' }
    const invoke = vi.fn(async (method: string) => method === 'surface.create' ? { ok: true, data: { surfaceId: 'new-panel' } } : { ok: true, data: { terminals: [{ ...target, panelId: 'old-panel', sessionId: 'old', active: true }, target] } })
    expect(await createGatewayTerminalPort(invoke).create!()).toEqual(target)
    expect(invoke).toHaveBeenCalledWith('surface.create', { type: 'local', focus: true, autoConnect: true })
  })
  it('cancels pending creation after authorization changes without opening a tab', async () => {
    let release!: (response: any) => void
    let active = true
    const invoke = vi.fn(() => new Promise<any>(resolve => { release = resolve }))
    const created = createGatewayTerminalPort(invoke).create!('asset', () => active)
    active = false
    release({ ok: true, data: { assets: [{ id: 'asset' }] } })
    await expect(created).rejects.toThrow('STOPPED')
    expect(invoke).toHaveBeenCalledOnce()
  })
  it('times out an unconnected new panel without binding a different session or cleaning up the tab', async () => {
    vi.useFakeTimers()
    try {
      const invoke = vi.fn(async (method: string) => method === 'surface.create' ? { ok: true, data: { surfaceId: 'new-panel' } } : { ok: true, data: { terminals: [{ panelId: 'other', connected: true, sessionId: 'other', kind: 'local' }] } })
      const failed = expect(createGatewayTerminalPort(invoke).create!()).rejects.toThrow('NOT_CONNECTED')
      await vi.advanceTimersByTimeAsync(10000)
      await failed
      expect(invoke).not.toHaveBeenCalledWith('surface.close', expect.anything())
    } finally { vi.useRealTimers() }
  })
  it('does not close a new tab if creation reports a connection error', async () => {
    const invoke = vi.fn(async () => ({ ok: false, data: { surfaceId: 'failed-panel' } }))
    await expect(createGatewayTerminalPort(invoke).create!()).rejects.toThrow('CREATE_FAILED')
    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalledWith('surface.close', expect.anything())
  })
  it('fails when a terminal is unavailable and never substitutes an active session', async () => {
    const invoke = vi.fn(async () => ({ ok: false }))
    const port = createGatewayTerminalPort(invoke)
    await expect(port.list()).rejects.toThrow('TERMINALS_UNAVAILABLE')
    await expect(port.write({ panelId: 'p', sessionId: 's' }, 'x')).rejects.toThrow('WRITE_FAILED')
  })
})
