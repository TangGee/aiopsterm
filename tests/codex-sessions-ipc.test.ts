import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type {
  CodexSessionCreateOptions,
  CodexSessionInfo,
  CodexSessionLifecycleEvent,
  CodexSessionTargetContext
} from '../src/shared/preload'

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type CodexSessionsIpcBackend = {
  registerCodexSessionsIpc: (ipcMain: IpcMain, input: any) => void
}

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/codexSessions'
  return (await import(modulePath)) as CodexSessionsIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const lifecycle = (id: string, overrides: Partial<CodexSessionLifecycleEvent> = {}): CodexSessionLifecycleEvent => ({
  id,
  stage: 'ready',
  at: 1780490000000,
  binaryPath: '/repo/codex/bin/codex',
  codexHome: '/tmp/aiopsterm-user-data/codex-agent',
  cwd: '/tmp/aiopsterm-user-data/codex-agent',
  runtimeKind: 'pty',
  ...overrides
})

const sessionInfo = (id: string): CodexSessionInfo => ({
  id,
  binaryPath: '/repo/codex/bin/codex',
  codexHome: '/tmp/aiopsterm-user-data/codex-agent',
  cwd: '/tmp/aiopsterm-user-data/codex-agent',
  runtimeKind: 'pty',
  lifecycle: lifecycle(id)
})

const createRegistrationInput = (overrides: Record<string, unknown> = {}) => {
  const ownerWindow = { id: 17 }
  let idIndex = 0
  const ids = ['codex-ipc-1', 'codex-ipc-2', 'codex-ipc-3']

  return {
    getOwnerWindow: vi.fn(() => ownerWindow),
    createId: vi.fn(() => ids[idIndex++] || `codex-ipc-${idIndex}`),
    getUserDataPath: vi.fn(() => '/tmp/aiopsterm-user-data'),
    logRuntimeEvent: vi.fn(),
    ensureCodexTerminalBridgeServer: vi.fn(async () => undefined),
    updateCodexTerminalBridgeSessionTarget: vi.fn((target?: CodexSessionTargetContext | null) => ({
      sessionId: target?.sessionId,
      target: target ? { ...target, label: target.label || 'prod-web' } : undefined,
      registered: Boolean(target?.sessionId && target.sessionId !== 'missing-terminal')
    })),
    createCodexSession: vi.fn(async (id: string, _options: CodexSessionCreateOptions, sink: any) => {
      sink.lifecycle(lifecycle(id, { stage: 'starting', runtimeKind: 'pty' }))
      sink.data(id, 'codex tui\n')
      sink.exit(lifecycle(id, { stage: 'closed', code: 0 }), 0)
      sink.closed(id)
      return sessionInfo(id)
    }),
    setCodexSessionPendingContext: vi.fn(async (id: string, text?: string) => ({
      ok: true,
      data: {
        id,
        bytes: Buffer.byteLength(String(text || ''), 'utf8'),
        cleared: !String(text || '').trim()
      }
    })),
    writeCodexSession: vi.fn((id: string, data: string) => ({
      ok: true,
      data: {
        id,
        bytes: Buffer.byteLength(String(data || ''), 'utf8')
      }
    })),
    resizeCodexSession: vi.fn((_id: string) => true),
    killCodexSession: vi.fn((id: string) => ({
      ok: true,
      data: { id }
    })),
    sendCodexLifecycle: vi.fn(),
    sendCodexExit: vi.fn(),
    sendCodexData: vi.fn(),
    ownerWindow,
    ...overrides
  }
}

describe('Codex sessions IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers stable Codex session channels', async () => {
    const { registerCodexSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerCodexSessionsIpc(ipcMain, createRegistrationInput())

    expect([...handlers.keys()]).toEqual([
      'codex:create',
      'codex:set-target',
      'codex:set-pending-context',
      'codex:write',
      'codex:resize',
      'codex:kill'
    ])
  })

  it('rejects Codex creation when no owner window is available', async () => {
    const { registerCodexSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput({ getOwnerWindow: vi.fn(() => null) })

    registerCodexSessionsIpc(ipcMain, input)

    await expect(handlers.get('codex:create')?.({ sender: {} }, {})).rejects.toThrow('No owner window for Codex session')
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('error', 'codex.create.no-owner')
  })

  it('creates Codex sessions through injected runtime and forwards lifecycle, data, and exit events', async () => {
    const { registerCodexSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()
    const options: CodexSessionCreateOptions = {
      cols: 120,
      rows: 40,
      target: {
        kind: 'ssh',
        sessionId: 'terminal-1',
        label: 'prod-web',
        host: '10.0.0.8',
        port: 22,
        username: 'root'
      }
    }

    registerCodexSessionsIpc(ipcMain, input)

    await expect(handlers.get('codex:create')?.({ sender: {} }, options)).resolves.toEqual(sessionInfo('codex-ipc-1'))
    expect(input.ensureCodexTerminalBridgeServer).toHaveBeenCalledWith('/tmp/aiopsterm-user-data')
    expect(input.updateCodexTerminalBridgeSessionTarget).toHaveBeenCalledWith(options.target)
    expect(input.createCodexSession).toHaveBeenCalledWith('codex-ipc-1', options, {
      lifecycle: expect.any(Function),
      exit: expect.any(Function),
      data: expect.any(Function),
      closed: expect.any(Function)
    })
    expect(input.sendCodexLifecycle).toHaveBeenCalledWith(input.ownerWindow, lifecycle('codex-ipc-1', { stage: 'starting', runtimeKind: 'pty' }))
    expect(input.sendCodexData).toHaveBeenCalledWith(input.ownerWindow, 'codex-ipc-1', 'codex tui\n')
    expect(input.sendCodexExit).toHaveBeenCalledWith(input.ownerWindow, lifecycle('codex-ipc-1', { stage: 'closed', code: 0 }), 0)
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('info', 'codex.create.ready', {
      id: 'codex-ipc-1',
      binaryPath: '/repo/codex/bin/codex',
      codexHome: '/tmp/aiopsterm-user-data/codex-agent',
      cwd: '/tmp/aiopsterm-user-data/codex-agent',
      runtimeKind: 'pty'
    })
  })

  it('logs and rethrows Codex creation failures after bridge initialization', async () => {
    const { registerCodexSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const error = new Error('codex boot failed')
    const input = createRegistrationInput({
      createCodexSession: vi.fn(async () => {
        throw error
      })
    })

    registerCodexSessionsIpc(ipcMain, input)

    await expect(handlers.get('codex:create')?.({ sender: {} }, { target: { sessionId: 'terminal-1', kind: 'local' } })).rejects.toThrow(error)
    expect(input.ensureCodexTerminalBridgeServer).toHaveBeenCalledWith('/tmp/aiopsterm-user-data')
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('error', 'codex.create.failed', { id: 'codex-ipc-1', error })
  })

  it('updates Codex terminal bridge target and normalizes invalid target payloads', async () => {
    const { registerCodexSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()
    const target: CodexSessionTargetContext = {
      sessionId: 'terminal-1',
      kind: 'ssh',
      label: 'prod-web',
      host: '10.0.0.8'
    }

    registerCodexSessionsIpc(ipcMain, input)

    expect(handlers.get('codex:set-target')?.({}, target)).toEqual({
      ok: true,
      data: {
        sessionId: 'terminal-1',
        target,
        registered: true
      }
    })
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('info', 'codex.target.updated', {
      sessionId: 'terminal-1',
      targetKind: 'ssh',
      targetLabel: 'prod-web',
      registered: true
    })

    expect(handlers.get('codex:set-target')?.({}, [] as unknown as CodexSessionTargetContext)).toEqual({
      ok: true,
      data: {
        sessionId: undefined,
        target: undefined,
        registered: false
      }
    })
    expect(input.updateCodexTerminalBridgeSessionTarget).toHaveBeenLastCalledWith(undefined)
  })

  it('sets pending context, writes, resizes, and kills through injected Codex backend operations', async () => {
    const { registerCodexSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput({
      setCodexSessionPendingContext: vi.fn(async (id: string) => ({
        ok: false,
        errorCode: 'CODEX_SESSION_NOT_FOUND',
        errorMessage: `Missing ${id}`
      })),
      writeCodexSession: vi.fn((id: string, data: string) =>
        id === 'missing'
          ? {
              ok: false,
              errorCode: 'CODEX_SESSION_NOT_FOUND',
              errorMessage: 'Codex session was not found.'
            }
          : {
              ok: true,
              data: { id, bytes: Buffer.byteLength(String(data || ''), 'utf8') }
            }
      ),
      resizeCodexSession: vi.fn((id: string) => id !== 'missing'),
      killCodexSession: vi.fn((id: string) =>
        id === 'missing'
          ? {
              ok: false,
              errorCode: 'CODEX_SESSION_NOT_FOUND',
              errorMessage: 'Codex session was not found.'
            }
          : {
              ok: true,
              data: { id }
            }
      )
    })

    registerCodexSessionsIpc(ipcMain, input)

    await expect(handlers.get('codex:set-pending-context')?.({}, '', 'target context')).resolves.toEqual({
      ok: false,
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Missing '
    })
    expect(input.setCodexSessionPendingContext).toHaveBeenCalledWith('', 'target context')
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('warn', 'codex.pending-context.rejected', {
      id: '',
      bytes: undefined,
      cleared: undefined,
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Missing '
    })

    expect(handlers.get('codex:write')?.({}, 'codex-1', 'hello\n')).toEqual({ ok: true, data: { id: 'codex-1', bytes: 6 } })
    expect(input.writeCodexSession).toHaveBeenCalledWith('codex-1', 'hello\n')
    expect(handlers.get('codex:write')?.({}, 'missing', 'hello\n')).toEqual({
      ok: false,
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Codex session was not found.'
    })

    expect(handlers.get('codex:resize')?.({}, 'codex-1', 132, 44)).toBeUndefined()
    expect(input.resizeCodexSession).toHaveBeenCalledWith('codex-1', 132, 44)
    expect(handlers.get('codex:resize')?.({}, 'missing', 120, 40)).toBeUndefined()
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('warn', 'codex.resize.missing-session', { id: 'missing', cols: 120, rows: 40 })

    expect(handlers.get('codex:kill')?.({}, 'codex-1')).toEqual({ ok: true, data: { id: 'codex-1' } })
    expect(handlers.get('codex:kill')?.({}, 'missing')).toEqual({
      ok: false,
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Codex session was not found.'
    })
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('warn', 'codex.kill.rejected', {
      id: 'missing',
      errorCode: 'CODEX_SESSION_NOT_FOUND',
      errorMessage: 'Codex session was not found.'
    })
  })
})
