import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', async () => {
  const { tmpdir } = await import('node:os')
  return { app: { getPath: tmpdir }, BrowserWindow: {}, ipcMain: {} }
})

const localModule = '../src/main/backend/terminal/localTerminal'
const mainModule = '../src/main/terminalRuntime'
afterEach(async () => (await import(localModule)).configureLocalTerminalBackendRuntime())

const harness = async () => {
  const { createMainTerminalRuntime } = await import(mainModule)
  const { configureLocalTerminalBackendRuntime } = await import(localModule)
  let exit: (event: { exitCode: number }) => void = () => undefined
  const process = {
    pid: 12345, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn((_listener: (data: string) => void) => {}),
    onExit: (listener: typeof exit) => { exit = listener }
  }
  configureLocalTerminalBackendRuntime({
    getDefaultShell: () => '/bin/sh', getDefaultCwd: () => '/', getEnv: () => ({}),
    loadPty: () => ({ spawn: () => process })
  })
  const send = vi.fn()
  const owner = { webContents: { send } } as unknown as BrowserWindow
  const runtime = createMainTerminalRuntime({ focusWindow: () => owner })
  const open = (id: string) => {
    const created = runtime.createLocalTerminal(owner, id, {})
    runtime.sessions.set(id, { id, kind: 'local', process: created.session, shell: created.shell, cwd: created.cwd, window: owner })
    send.mockClear()
    return created.session
  }
  return { runtime, open, send, process, exit: () => exit({ exitCode: 0 }) }
}

describe('terminal process cleanup during application shutdown', () => {
  it('publishes coalesced PTY output to subscribers without interfering with renderer delivery', async () => {
    const outputModule = '../src/main/backend/terminal/terminalOutputEvents'
    const { subscribeTerminalOutput } = await import(outputModule)
    const { runtime, open, process, send } = await harness()
    const receive = vi.fn()
    const unsubscribe = subscribeTerminalOutput('gateway-output', receive)
    const unsubscribeThrowing = subscribeTerminalOutput('gateway-output', () => { throw new Error('consumer failed') })
    try {
      open('gateway-output')
      process.onData.mock.calls[0][0]('terminal output')
      await vi.waitFor(() => expect(receive).toHaveBeenCalledWith('terminal output'))
      expect(send).toHaveBeenCalledWith('terminal:data', expect.objectContaining({ id: 'gateway-output', data: 'terminal output' }))
      unsubscribe()
      process.onData.mock.calls[0][0]('later output')
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith('terminal:data', expect.objectContaining({ data: 'later output' })))
      expect(receive).toHaveBeenCalledOnce()
    } finally { unsubscribe(); unsubscribeThrowing(); runtime.killAllSessions() }
  })

  it('kills owned processes without telling the renderer that the user closed recoverable tabs', async () => {
    const { runtime, open, send, process } = await harness()
    open('recover-after-restart')
    runtime.killAllSessions()
    expect(process.kill).toHaveBeenCalledOnce()
    expect(runtime.sessions.size).toBe(0)
    expect(send.mock.calls.filter(([channel]) => channel === 'terminal:exit' || channel === 'terminal:lifecycle')).toEqual([])
  })

  it('still reports explicit terminal closure after a window is reopened', async () => {
    const { runtime, open, send } = await harness()
    open('first-window')
    runtime.killAllSessions()
    open('second-window').kill()
    expect(send).toHaveBeenCalledWith('terminal:exit', expect.objectContaining({ id: 'second-window', reason: 'manual' }))
  })

  it('reports a real shell exit so it will not be resumed on restart', async () => {
    const { open, send, exit } = await harness()
    open('completed-shell')
    exit()
    expect(send).toHaveBeenCalledWith('terminal:exit', expect.objectContaining({ id: 'completed-shell', reason: 'process' }))
  })
})
