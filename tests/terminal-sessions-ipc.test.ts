import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import {
  type TerminalCreateOptions,
  type TerminalLifecycleEvent,
  type TerminalSshConnectionInfo
} from '../src/shared/contracts/terminalSessions'
import type { UserConfig } from '../src/shared/contracts/userConfig'

type IpcHandler = (event: unknown, ...args: any[]) => unknown

type TerminalSessionsIpcBackend = {
  registerTerminalSessionsIpc: (ipcMain: IpcMain, input: any) => void
  stableClassicSshTargetId: (input: { host: string; port: number; username: string }) => string
}

type TestTerminalProcess = {
  write: ReturnType<typeof vi.fn>
  writeBinary: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}

type TestTerminalSession = {
  id: string
  process: TestTerminalProcess | Omit<TestTerminalProcess, 'writeBinary'>
  shell: string
  cwd: string
  window: any
  kind: 'local' | 'ssh'
  host?: string
  classicTarget?: {
    targetId: string
    terminalSessionId: string
    label: string
    kind: 'local' | 'ssh'
    cwd?: string
  }
}

const loadBackend = async () => {
  const modulePath = '../src/main/ipc/terminalSessions'
  return (await import(modulePath)) as TerminalSessionsIpcBackend
}

const createIpcHarness = () => {
  const handlers = new Map<string, IpcHandler>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

const lifecycle = (id: string, kind: 'local' | 'ssh', overrides: Partial<TerminalLifecycleEvent> = {}): TerminalLifecycleEvent => ({
  id,
  kind,
  stage: 'shell-ready',
  at: 1780490000000,
  ...overrides
})

const createLocalProcess = (writeBinaryResult = true): TestTerminalProcess => ({
  write: vi.fn(),
  writeBinary: vi.fn(() => writeBinaryResult),
  resize: vi.fn(),
  kill: vi.fn()
})

const createSshProcess = (): Omit<TestTerminalProcess, 'writeBinary'> => ({
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn()
})

const cleanOptional = (value: unknown): string | undefined => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

const createSshConnectionInfo = (terminalId: string, target: any, options: TerminalCreateOptions = {}, createdAt = 1780490000000): TerminalSshConnectionInfo => {
  const asset = target.asset || null
  const title = cleanOptional(asset?.title) || cleanOptional(asset?.name) || cleanOptional(target.title)
  const host = cleanOptional(target.host) || cleanOptional(options.ssh?.host) || 'ssh'
  const username = cleanOptional(target.username) || cleanOptional(options.ssh?.username) || 'user'
  return {
    connectionId: `ssh-${terminalId}`,
    host,
    port: Number.isFinite(target.port) ? Math.max(1, Math.min(65535, Math.floor(Number(target.port)))) : 22,
    username,
    ...(cleanOptional(asset?.id) || cleanOptional(options.assetId) ? { assetId: cleanOptional(asset?.id) || cleanOptional(options.assetId) } : {}),
    assetName: title || host || username || 'ssh',
    ...(title ? { title } : {}),
    createdAt
  }
}

const createRegistrationInput = (overrides: Record<string, unknown> = {}) => {
  const ownerWindow = { id: 17 }
  const sessions = new Map<string, TestTerminalSession>()
  let idIndex = 0
  const ids = ['terminal-ipc-local', 'terminal-ipc-ssh', 'terminal-ipc-extra']
  const config = {
    terminal: {
      terminalType: 'vt100'
    }
  } as UserConfig

  return {
    sessions,
    getConfig: vi.fn(() => config),
    defaultTerminalType: 'xterm-256color',
    normalizeTerminalType: vi.fn((value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback)),
    getOwnerWindow: vi.fn(() => ownerWindow),
    createId: vi.fn(() => ids[idIndex++] || `terminal-ipc-${idIndex}`),
    logRuntimeEvent: vi.fn(),
    createSshTerminal: vi.fn((_owner: unknown, id: string, options: TerminalCreateOptions) => {
      const host = options.ssh?.host || '10.8.0.6'
      return {
        shell: 'ssh' as const,
        cwd: '/home/ops',
        session: createSshProcess(),
        connection: {
          host,
          port: options.ssh?.port || 22,
          username: options.ssh?.username || 'ops',
          title: options.title,
          asset: options.assetId ? { id: options.assetId, name: 'prod-db', title: 'prod-db' } : null
        },
        lifecycle: lifecycle(id, 'ssh', { shell: 'ssh', cwd: '/home/ops', host })
      }
    }),
    createLocalTerminal: vi.fn((_owner: unknown, id: string) => ({
      shell: '/bin/bash',
      cwd: '/workspace',
      session: createLocalProcess(),
      lifecycle: lifecycle(id, 'local', { shell: '/bin/bash', cwd: '/workspace' }),
      runtimeKind: 'pty' as const
    })),
    createSshTerminalConnectionInfo: vi.fn(createSshConnectionInfo),
    createTerminalWriteResult: vi.fn((id: string, data: string, exists: boolean) =>
      !id || !exists
        ? {
            ok: false,
            errorCode: 'TERMINAL_SESSION_NOT_FOUND',
            errorMessage: 'Terminal session is not available.'
          }
        : {
            ok: true,
            data: {
              id,
              bytes: Buffer.byteLength(String(data || ''), 'utf8')
            }
          }
    ),
    createTerminalBinaryWriteResult: vi.fn((id: string, bytes: number, exists: boolean) =>
      !id || !exists
        ? {
            ok: false,
            errorCode: 'TERMINAL_SESSION_NOT_FOUND',
            errorMessage: 'Terminal session is not available.'
          }
        : {
            ok: true,
            data: {
              id,
              bytes
            }
          }
    ),
    createTerminalKillResult: vi.fn((id: string, exists: boolean) =>
      !id || !exists
        ? {
            ok: false,
            errorCode: 'TERMINAL_SESSION_NOT_FOUND',
            errorMessage: 'Terminal session is not available.'
          }
        : {
            ok: true,
            data: {
              id
            }
          }
    ),
    registerTerminalForCodexBridge: vi.fn(),
    recordTerminalCommandHistory: vi.fn(),
    ackTerminalData: vi.fn(),
    ownerWindow,
    ...overrides
  }
}

describe('terminal sessions IPC registrar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers stable terminal session channels', async () => {
    const { registerTerminalSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()

    registerTerminalSessionsIpc(ipcMain, createRegistrationInput())

    expect([...handlers.keys()]).toEqual(['terminal:create', 'terminal:ack-data', 'terminal:write', 'terminal:write-binary', 'terminal:resize', 'terminal:kill'])
  })

  it('rejects terminal creation when no owner window is available', async () => {
    const { registerTerminalSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput({ getOwnerWindow: vi.fn(() => null) })

    registerTerminalSessionsIpc(ipcMain, input)

    expect(() => handlers.get('terminal:create')?.({ sender: {} }, { kind: 'local' })).toThrow('No owner window for terminal session')
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('error', 'terminal.create.no-owner', { kind: 'local' })
  })

  it('creates local terminal sessions with normalized options, session storage, and Codex bridge registration', async () => {
    const { registerTerminalSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerTerminalSessionsIpc(ipcMain, input)

    const result = handlers.get('terminal:create')?.({ sender: {} }, { kind: 'local', panelId: 'panel-a' })

    expect(result).toEqual({
      id: 'terminal-ipc-local',
      shell: '/bin/bash',
      cwd: '/workspace',
      kind: 'local',
      classicTarget: {
        targetId: 'opened-local',
        terminalSessionId: 'terminal-ipc-local',
        label: 'Local terminal',
        kind: 'local',
        cwd: '/workspace'
      },
      lifecycle: lifecycle('terminal-ipc-local', 'local', { shell: '/bin/bash', cwd: '/workspace' })
    })
    expect(input.createLocalTerminal).toHaveBeenCalledWith(input.ownerWindow, 'terminal-ipc-local', {
      kind: 'local',
      panelId: 'panel-a',
      terminalType: 'vt100'
    })
    expect(input.sessions.get('terminal-ipc-local')).toMatchObject({
      id: 'terminal-ipc-local',
      shell: '/bin/bash',
      cwd: '/workspace',
      kind: 'local',
      host: 'local',
      classicTarget: {
        targetId: 'opened-local',
        terminalSessionId: 'terminal-ipc-local',
        label: 'Local terminal',
        kind: 'local',
        cwd: '/workspace'
      }
    })
    expect(input.registerTerminalForCodexBridge).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal-ipc-local', kind: 'local' }), {
      kind: 'local',
      panelId: 'panel-a',
      sessionId: 'terminal-ipc-local',
      label: 'Local terminal',
      cwd: '/workspace'
    })
  })

  it('creates SSH terminal sessions only when the backend returns a live session', async () => {
    const { registerTerminalSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()

    registerTerminalSessionsIpc(ipcMain, input)

    const result = handlers.get('terminal:create')?.(
      { sender: {} },
      {
        kind: 'ssh',
        assetId: 'asset-prod-db',
        ssh: { host: '10.8.0.6', port: 2222, username: 'ops' }
      }
    )

    expect(result).toMatchObject({
      id: 'terminal-ipc-local',
      shell: 'ssh',
      cwd: '/home/ops',
      kind: 'ssh',
      classicTarget: {
        targetId: 'asset-prod-db',
        terminalSessionId: 'terminal-ipc-local',
        label: 'prod-db',
        kind: 'ssh',
        cwd: '/home/ops'
      },
      connection: {
        connectionId: 'ssh-terminal-ipc-local',
        host: '10.8.0.6',
        port: 2222,
        username: 'ops',
        assetId: 'asset-prod-db',
        assetName: 'prod-db'
      },
      lifecycle: lifecycle('terminal-ipc-local', 'ssh', { shell: 'ssh', cwd: '/home/ops', host: '10.8.0.6' })
    })
    expect(input.sessions.get('terminal-ipc-local')).toMatchObject({
      id: 'terminal-ipc-local',
      shell: 'ssh',
      cwd: '/home/ops',
      kind: 'ssh',
      host: '10.8.0.6',
      classicTarget: {
        targetId: 'asset-prod-db',
        terminalSessionId: 'terminal-ipc-local',
        label: 'prod-db',
        kind: 'ssh',
        cwd: '/home/ops'
      }
    })
    expect(input.registerTerminalForCodexBridge).toHaveBeenCalledWith(expect.objectContaining({ id: 'terminal-ipc-local', kind: 'ssh' }), {
      kind: 'ssh',
      sessionId: 'terminal-ipc-local',
      label: 'prod-db',
      host: '10.8.0.6',
      port: 2222,
      username: 'ops',
      assetId: 'asset-prod-db',
      assetName: 'prod-db',
      cwd: '/home/ops'
    })

    const noSessionInput = createRegistrationInput({
      createSshTerminal: vi.fn((_owner: unknown, id: string, options: TerminalCreateOptions) => ({
        shell: 'ssh' as const,
        cwd: '/home/ops',
        session: null,
        connection: {
          host: options.ssh?.host || '10.8.0.7',
          port: options.ssh?.port || 22,
          username: options.ssh?.username || 'ops',
          title: 'missing-session'
        },
        lifecycle: lifecycle(id, 'ssh', { stage: 'error', errorCode: 'SSH_TARGET_INVALID' })
      }))
    })
    const noSessionHarness = createIpcHarness()
    registerTerminalSessionsIpc(noSessionHarness.ipcMain, noSessionInput)

    await expect(noSessionHarness.handlers.get('terminal:create')?.({ sender: {} }, { kind: 'ssh', ssh: { host: '10.8.0.7', username: 'ops' } })).toEqual(
      expect.objectContaining({
        id: 'terminal-ipc-local',
        kind: 'ssh',
        lifecycle: expect.objectContaining({ stage: 'error' })
      })
    )
    expect(noSessionInput.sessions.size).toBe(0)
    expect(noSessionInput.registerTerminalForCodexBridge).not.toHaveBeenCalled()
  })

  it('derives a stable opaque Classic targetId for ad-hoc SSH terminals without an asset', async () => {
    const { registerTerminalSessionsIpc, stableClassicSshTargetId } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()
    registerTerminalSessionsIpc(ipcMain, input)
    const options = {
      kind: 'ssh' as const,
      ssh: { host: 'adhoc.internal', port: 2222, username: 'deploy' }
    }

    const first = handlers.get('terminal:create')?.({ sender: {} }, options) as any
    const second = handlers.get('terminal:create')?.({ sender: {} }, options) as any
    const expectedTargetId = stableClassicSshTargetId({ host: 'adhoc.internal', port: 2222, username: 'deploy' })

    expect(first.classicTarget).toMatchObject({
      targetId: expectedTargetId,
      terminalSessionId: 'terminal-ipc-local',
      kind: 'ssh'
    })
    expect(second.classicTarget).toMatchObject({
      targetId: expectedTargetId,
      terminalSessionId: 'terminal-ipc-ssh',
      kind: 'ssh'
    })
    expect(expectedTargetId).toMatch(/^ssh-[a-f0-9]{32}$/)
  })

  it('writes text to local and SSH sessions and records completed command lines', async () => {
    const { registerTerminalSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()
    const localProcess = createLocalProcess()
    const sshProcess = createSshProcess()
    input.sessions.set('local-1', {
      id: 'local-1',
      process: localProcess,
      shell: '/bin/bash',
      cwd: '/workspace',
      window: input.ownerWindow as any,
      kind: 'local',
      host: 'local'
    })
    input.sessions.set('ssh-1', {
      id: 'ssh-1',
      process: sshProcess,
      shell: 'ssh',
      cwd: '/home/ops',
      window: input.ownerWindow as any,
      kind: 'ssh',
      host: '10.8.0.6'
    })

    registerTerminalSessionsIpc(ipcMain, input)

    expect(handlers.get('terminal:write')?.({}, 'missing', 'uptime\n')).toEqual({
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    })
    expect(handlers.get('terminal:write')?.({}, 'local-1', 'pwd\nnext-part')).toEqual({ ok: true, data: { id: 'local-1', bytes: 13 } })
    expect(localProcess.write).toHaveBeenCalledWith('pwd\nnext-part')
    expect(input.recordTerminalCommandHistory).toHaveBeenCalledWith('pwd', { host: 'local' })

    expect(handlers.get('terminal:write')?.({}, 'ssh-1', 'whoami\r')).toEqual({ ok: true, data: { id: 'ssh-1', bytes: 7 } })
    expect(sshProcess.write).toHaveBeenCalledWith('whoami\r')
    expect(input.recordTerminalCommandHistory).toHaveBeenCalledWith('whoami', { host: '10.8.0.6' })
  })

  it('writes binary payloads and reports empty, missing, and unsupported cases', async () => {
    const { registerTerminalSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()
    const localProcess = createLocalProcess(false)
    const binaryLocalProcess = createLocalProcess(true)
    const sshProcess = createSshProcess()
    input.sessions.set('local-no-binary', {
      id: 'local-no-binary',
      process: localProcess,
      shell: '/bin/bash',
      cwd: '/workspace',
      window: input.ownerWindow as any,
      kind: 'local',
      host: 'local'
    })
    input.sessions.set('local-binary', {
      id: 'local-binary',
      process: binaryLocalProcess,
      shell: '/bin/bash',
      cwd: '/workspace',
      window: input.ownerWindow as any,
      kind: 'local',
      host: 'local'
    })
    input.sessions.set('ssh-binary', {
      id: 'ssh-binary',
      process: sshProcess,
      shell: 'ssh',
      cwd: '/home/ops',
      window: input.ownerWindow as any,
      kind: 'ssh',
      host: '10.8.0.6'
    })

    registerTerminalSessionsIpc(ipcMain, input)

    expect(handlers.get('terminal:write-binary')?.({}, 'missing', [1, 2, 3])).toEqual({
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    })
    expect(handlers.get('terminal:write-binary')?.({}, 'local-no-binary', [])).toEqual({
      ok: false,
      errorCode: 'TERMINAL_BINARY_EMPTY',
      errorMessage: 'Terminal binary payload is empty.'
    })
    expect(handlers.get('terminal:write-binary')?.({}, 'local-no-binary', [1])).toEqual({
      ok: false,
      errorCode: 'TERMINAL_BINARY_UNSUPPORTED',
      errorMessage: 'This terminal runtime does not support binary writes.'
    })

    expect(handlers.get('terminal:write-binary')?.({}, 'local-binary', Uint8Array.from([4, 5]))).toEqual({ ok: true, data: { id: 'local-binary', bytes: 2 } })
    expect(binaryLocalProcess.writeBinary).toHaveBeenCalledWith(Buffer.from([4, 5]))

    expect(handlers.get('terminal:write-binary')?.({}, 'ssh-binary', new Uint8Array([6, 7]).buffer)).toEqual({ ok: true, data: { id: 'ssh-binary', bytes: 2 } })
    expect(sshProcess.write).toHaveBeenCalledWith(Buffer.from([6, 7]))
  })

  it('resizes and kills existing sessions while keeping missing-session results stable', async () => {
    const { registerTerminalSessionsIpc } = await loadBackend()
    const { ipcMain, handlers } = createIpcHarness()
    const input = createRegistrationInput()
    const localProcess = createLocalProcess()
    const sshProcess = createSshProcess()
    input.sessions.set('local-1', {
      id: 'local-1',
      process: localProcess,
      shell: '/bin/bash',
      cwd: '/workspace',
      window: input.ownerWindow as any,
      kind: 'local',
      host: 'local'
    })
    input.sessions.set('ssh-1', {
      id: 'ssh-1',
      process: sshProcess,
      shell: 'ssh',
      cwd: '/home/ops',
      window: input.ownerWindow as any,
      kind: 'ssh',
      host: '10.8.0.6'
    })

    registerTerminalSessionsIpc(ipcMain, input)

    expect(handlers.get('terminal:resize')?.({}, 'missing', 120, 40)).toBeUndefined()
    expect(input.logRuntimeEvent).toHaveBeenCalledWith('warn', 'terminal.resize.missing-session', { id: 'missing', cols: 120, rows: 40 })

    expect(handlers.get('terminal:resize')?.({}, 'local-1', 100, 30)).toBeUndefined()
    expect(localProcess.resize).toHaveBeenCalledWith(100, 30)
    expect(handlers.get('terminal:resize')?.({}, 'ssh-1', 110, 32)).toBeUndefined()
    expect(sshProcess.resize).toHaveBeenCalledWith(110, 32)

    expect(handlers.get('terminal:kill')?.({}, 'missing')).toEqual({
      ok: false,
      errorCode: 'TERMINAL_SESSION_NOT_FOUND',
      errorMessage: 'Terminal session is not available.'
    })
    expect(handlers.get('terminal:kill')?.({}, 'local-1')).toEqual({ ok: true, data: { id: 'local-1' } })
    expect(localProcess.kill).toHaveBeenCalledWith('manual')
    expect(handlers.get('terminal:kill')?.({}, 'ssh-1')).toEqual({ ok: true, data: { id: 'ssh-1' } })
    expect(sshProcess.kill).toHaveBeenCalledWith('manual')
  })
})
