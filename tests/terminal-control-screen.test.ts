import { describe, expect, it, vi } from 'vitest'
import { createTerminalControlSurfaceMobileHandlers } from '@/services/terminal/terminalControlSurfaceMobile'

const fixture = () => {
  const panel = { id: 'bound-panel', sessionId: 'bound-session' }
  const getLine = vi.fn((index: number) => index < 24 ? { translateToString: (): string => 'cached viewport' } : undefined)
  const readScreen = vi.fn(async () => ({ text: '/home/user/work/test\nfile.txt\n$' }))
  const captureScreen = vi.fn(async () => 'data:image/png;base64,aW1hZ2U=')
  const view = { terminal: { rows: 24, cols: 80, readScreen, captureScreen, buffer: { active: { length: 500, getLine } }, focus: vi.fn(), clear: vi.fn() }, lastOutput: '' }
  const workspace = { panels: [panel], activePanelId: 'another-panel', terminalSettings: { scrollBack: 1000 } }
  const handlers = createTerminalControlSurfaceMobileHandlers({ workspace: workspace as any, terminalViews: new Map([[panel.id, view]]), terminalSummaryForControl: p => ({ panelId: p.id, sessionId: p.sessionId } as any) })
  const target = { panelId: panel.id, sessionId: panel.sessionId }
  return { handlers, panel, view, target, readScreen, captureScreen, getLine }
}

describe('terminal control authoritative screen', () => {
  it('reads shell output after scrollback and from an inactive panel', async () => {
    const f = fixture()
    const result = await f.handlers.handleTerminalReadScreenControlRequest(f.target)
    expect(result).toMatchObject({ ok: true, data: { text: '/home/user/work/test\nfile.txt\n$' } })
    expect(f.readScreen).toHaveBeenCalledWith(24, false, false, true)
    expect(f.getLine).not.toHaveBeenCalled()
    expect(await f.handlers.handleMobileTerminalReplayControlRequest(f.target)).toMatchObject({ ok: true, data: { snapshot_text: '/home/user/work/test\nfile.txt\n$' } })
  })
  it('retains classic terminal buffer support', async () => {
    const f = fixture()
    delete (f.view.terminal as any).readScreen
    f.getLine.mockImplementation(index => index === 499 ? { translateToString: () => 'last line' } : undefined)
    expect(await f.handlers.handleTerminalReadScreenControlRequest({ ...f.target, tailLines: 1 })).toMatchObject({ ok: true, data: { text: 'last line' } })
  })
  it('rejects conflicting identities and a session replaced while reading', async () => {
    const f = fixture()
    expect(await f.handlers.handleTerminalReadScreenControlRequest({ ...f.target, sessionId: 'other' })).toMatchObject({ ok: false })
    expect(f.readScreen).not.toHaveBeenCalled()
    f.readScreen.mockImplementation(async () => { f.panel.sessionId = 'replacement'; return { text: 'private' } })
    expect(await f.handlers.handleTerminalReadScreenControlRequest(f.target)).toMatchObject({ ok: false, errorCode: 'TERMINAL_SESSION_CHANGED' })
  })
  it('returns only the bound terminal image and rejects replacement during capture', async () => {
    const f = fixture()
    expect(await f.handlers.handleTerminalScreenshotControlRequest(f.target)).toMatchObject({ ok: true, data: { image: 'data:image/png;base64,aW1hZ2U=' } })
    expect(f.view.terminal.focus).not.toHaveBeenCalled()
    f.captureScreen.mockImplementation(async () => { f.panel.sessionId = 'other'; return 'private' })
    expect(await f.handlers.handleTerminalScreenshotControlRequest(f.target)).toMatchObject({ ok: false })
  })
  it('propagates worker failure instead of treating stale data as an empty screen', async () => {
    const f = fixture()
    f.readScreen.mockRejectedValue(new Error('timeout'))
    await expect(f.handlers.handleTerminalReadScreenControlRequest(f.target)).rejects.toThrow('timeout')
  })
})
