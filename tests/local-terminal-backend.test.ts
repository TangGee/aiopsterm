import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it } from 'vitest'

type TerminalLifecycleEvent = {
  id: string
  kind: 'local' | 'ssh'
  stage: 'starting' | 'connecting' | 'proxy-opening' | 'connected' | 'shell-ready' | 'error' | 'closed'
  at: number
  shell?: string
  cwd?: string
  code?: number | null
  reason?: 'manual' | 'network' | 'process' | 'error' | 'unknown'
  isNetworkDisconnect?: boolean
  errorCode?: string
  errorMessage?: string
  message?: string
}

type LocalTerminalBackend = {
  configureLocalTerminalBackendRuntime: (config?: {
    getDefaultShell?: () => string
    getDefaultCwd?: () => string
    getEnv?: () => NodeJS.ProcessEnv
    getPlatform?: () => NodeJS.Platform
    loadPty?: () => { spawn: (shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) => MockPtyProcess } | null
    processRuntime?: {
      spawn: (shell: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; shell: false }) => MockChildProcess
    }
  }) => void
  createLocalTerminalSession: (
    id: string,
    options: { kind?: 'local'; shell?: string; cwd?: string; cols?: number; rows?: number },
    sink: ReturnType<typeof createSink>
  ) => {
    shell: string
    cwd: string
    runtimeKind: 'pty' | 'process'
    lifecycle: TerminalLifecycleEvent
    session: {
      write: (data: string | Buffer) => void
      writeBinary: (data: Buffer) => boolean
      resize: (cols: number, rows: number) => void
      kill: () => void
    }
  }
}

type RecordedEvents = {
  lifecycle: TerminalLifecycleEvent[]
  data: Array<string | Buffer>
  exit: Array<{ event: TerminalLifecycleEvent; code?: number | null }>
  closed: string[]
}

class MockPtyProcess {
  writes: string[] = []
  resizes: Array<{ cols: number; rows: number }> = []
  killed = false
  private dataListeners: Array<(data: string) => void> = []
  private exitListeners: Array<(event: { exitCode: number }) => void> = []

  write(data: string) {
    this.writes.push(data)
  }

  resize(cols: number, rows: number) {
    this.resizes.push({ cols, rows })
  }

  kill() {
    this.killed = true
  }

  onData(callback: (data: string) => void) {
    this.dataListeners.push(callback)
  }

  onExit(callback: (event: { exitCode: number }) => void) {
    this.exitListeners.push(callback)
  }

  emitData(data: string) {
    this.dataListeners.forEach((listener) => listener(data))
  }

  emitExit(exitCode: number) {
    this.exitListeners.forEach((listener) => listener({ exitCode }))
  }
}

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  writes: Array<string | Buffer> = []
  killed = false

  constructor() {
    super()
    this.stdin.write = ((chunk: string | Buffer | Uint8Array, _encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
      this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk))
      const done = typeof _encoding === 'function' ? _encoding : callback
      done?.()
      return true
    }) as typeof this.stdin.write
  }

  kill() {
    this.killed = true
    this.emit('exit', 0)
    return true
  }
}

const createRecorder = (): RecordedEvents => ({
  lifecycle: [],
  data: [],
  exit: [],
  closed: []
})

const createSink = (events: RecordedEvents) => ({
  lifecycle: (event: TerminalLifecycleEvent) => events.lifecycle.push(event),
  data: (chunk: string | Buffer) => events.data.push(chunk),
  exit: (event: TerminalLifecycleEvent, code?: number | null) => events.exit.push({ event, code }),
  closed: (id: string) => events.closed.push(id)
})

const loadBackend = async () => {
  const modulePath = '../src/main/backend/localTerminal'
  return (await import(modulePath)) as LocalTerminalBackend
}

describe('local terminal backend runtime', () => {
  beforeEach(async () => {
    const backend = await loadBackend()
    backend.configureLocalTerminalBackendRuntime()
  })

  it('forwards only pty output through terminal data while lifecycle owns local shell status', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    backend.configureLocalTerminalBackendRuntime({
      getDefaultShell: () => '/bin/bash',
      getDefaultCwd: () => '/home/ops',
      getEnv: () => ({ PATH: '/usr/bin' }),
      getPlatform: () => 'linux',
      loadPty: () => ({
        spawn: (shell, args, options) => {
          spawnCalls.push({ shell, args, options })
          return pty
        }
      })
    })

    const result = backend.createLocalTerminalSession('local-pty-1', { kind: 'local', cols: 120, rows: 40 }, createSink(events))
    result.session.write('uptime\n')
    result.session.resize(132, 44)
    pty.emitData('shell output\n')
    pty.emitExit(0)

    expect(result).toEqual(
      expect.objectContaining({
        shell: '/bin/bash',
        cwd: '/home/ops',
        runtimeKind: 'pty'
      })
    )
    expect(spawnCalls).toEqual([
      expect.objectContaining({
        shell: '/bin/bash',
        args: ['--login'],
        options: expect.objectContaining({ cwd: '/home/ops', cols: 120, rows: 40 })
      })
    ])
    expect(pty.writes).toEqual(['uptime\n'])
    expect(pty.resizes).toEqual([{ cols: 132, rows: 44 }])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'shell-ready', 'closed'])
    expect(events.data.map((chunk) => chunk.toString())).toEqual(['shell output\n'])
    expect(events.data.map((chunk) => chunk.toString()).join('')).not.toContain('[aiopsterm]')
    expect(events.exit).toEqual([expect.objectContaining({ code: 0 })])
    expect(events.closed).toEqual(['local-pty-1'])
    expect(result.session.writeBinary(Buffer.from([0x2a]))).toBe(false)
  })

  it('uses subprocess fallback without writing fallback status text into terminal data', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const child = new MockChildProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    backend.configureLocalTerminalBackendRuntime({
      getDefaultShell: () => '/bin/sh',
      getDefaultCwd: () => '/tmp',
      getEnv: () => ({ PATH: '/bin' }),
      getPlatform: () => 'linux',
      loadPty: () => null,
      processRuntime: {
        spawn: (shell, args, options) => {
          spawnCalls.push({ shell, args, options })
          return child as never
        }
      }
    })

    const result = backend.createLocalTerminalSession('local-process-1', { kind: 'local' }, createSink(events))
    result.session.write('date\n')
    expect(result.session.writeBinary(Buffer.from([0x00, 0xff]))).toBe(true)
    child.stdout.write('process stdout\n')
    child.stderr.write('process stderr\n')
    child.emit('exit', 7)

    expect(result.runtimeKind).toBe('process')
    expect(spawnCalls).toEqual([
      expect.objectContaining({
        shell: '/bin/sh',
        args: ['--login'],
        options: expect.objectContaining({ cwd: '/tmp', shell: false })
      })
    ])
    expect(child.writes).toEqual(['date\n', Buffer.from([0x00, 0xff])])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'shell-ready', 'closed'])
    expect(events.data.map((chunk) => chunk.toString())).toEqual(['process stdout\n', 'process stderr\n'])
    expect(events.data.map((chunk) => chunk.toString()).join('')).not.toContain('[aiopsterm]')
    expect(events.exit).toEqual([expect.objectContaining({ code: 7 })])
    expect(events.closed).toEqual(['local-process-1'])
  })

  it('reports subprocess startup errors through lifecycle without fabricating terminal output', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const child = new MockChildProcess()
    backend.configureLocalTerminalBackendRuntime({
      getDefaultShell: () => '/missing/shell',
      getDefaultCwd: () => '/tmp',
      getPlatform: () => 'linux',
      loadPty: () => null,
      processRuntime: {
        spawn: () => child as never
      }
    })

    backend.createLocalTerminalSession('local-error-1', { kind: 'local' }, createSink(events))
    child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))

    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'shell-ready', 'error'])
    expect(events.lifecycle.at(-1)).toEqual(
      expect.objectContaining({
        id: 'local-error-1',
        kind: 'local',
        stage: 'error',
        errorCode: 'ENOENT',
        errorMessage: 'spawn ENOENT'
      })
    )
    expect(events.data).toEqual([])
    expect(events.exit).toEqual([expect.objectContaining({ code: 1 })])
    expect(events.closed).toEqual(['local-error-1'])
  })

  it('does not add login-shell arguments for Windows local shells', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const child = new MockChildProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    backend.configureLocalTerminalBackendRuntime({
      getDefaultShell: () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      getDefaultCwd: () => 'C:\\Users\\ops',
      getEnv: () => ({ PATH: 'C:\\Windows\\System32' }),
      getPlatform: () => 'win32',
      loadPty: () => null,
      processRuntime: {
        spawn: (shell, args, options) => {
          spawnCalls.push({ shell, args, options })
          return child as never
        }
      }
    })

    const result = backend.createLocalTerminalSession('local-win-1', { kind: 'local' }, createSink(events))

    expect(result.runtimeKind).toBe('process')
    expect(spawnCalls).toEqual([
      expect.objectContaining({
        shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        args: [],
        options: expect.objectContaining({ cwd: 'C:\\Users\\ops', shell: false })
      })
    ])
  })
})
