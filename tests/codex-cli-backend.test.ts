import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it } from 'vitest'

type CodexLifecycleEvent = {
  id: string
  stage: 'starting' | 'ready' | 'error' | 'closed'
  at: number
  binaryPath?: string
  codexHome?: string
  cwd?: string
  runtimeKind?: 'pty' | 'process'
  code?: number | null
  errorCode?: string
  errorMessage?: string
  message?: string
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

const createRecorder = () => ({
  lifecycle: [] as CodexLifecycleEvent[],
  data: [] as Array<{ id: string; chunk: string | Buffer }>,
  exit: [] as Array<{ event: CodexLifecycleEvent; code?: number | null }>,
  closed: [] as string[]
})

const createSink = (events: ReturnType<typeof createRecorder>) => ({
  lifecycle: (event: CodexLifecycleEvent) => events.lifecycle.push(event),
  data: (id: string, chunk: string | Buffer) => events.data.push({ id, chunk }),
  exit: (event: CodexLifecycleEvent, code?: number | null) => events.exit.push({ event, code }),
  closed: (id: string) => events.closed.push(id)
})

const loadBackend = async () => {
  const modulePath = '../src/main/backend/codexCli'
  return import(modulePath)
}

describe('Codex CLI backend runtime', () => {
  beforeEach(async () => {
    const backend = await loadBackend()
    backend.configureCodexCliRuntime()
  })

  it('starts Codex in a PTY with aiopsterm-owned CODEX_HOME', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    const mkdirCalls: Array<string> = []

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getDefaultCwd: () => '/home/ops',
      getEnv: () => ({ PATH: '/usr/bin', CODEX_HOME: '/should/not/reuse' }),
      binaryPath: '/repo/codex/codex-rs/target/release/codex',
      existsSync: (path: string) => path === '/repo/codex/codex-rs/target/release/codex',
      mkdir: async (path: string) => {
        mkdirCalls.push(String(path))
        return undefined
      },
      loadPty: () => ({
        spawn: (file: string, args: string[], options: Record<string, unknown>) => {
          spawnCalls.push({ file, args, options })
          return pty
        }
      })
    })

    const session = await backend.createCodexSession('codex-test-1', { cols: 120, rows: 40 }, createSink(events))
    const write = backend.writeCodexSession(session.id, 'hello\n')
    backend.resizeCodexSession(session.id, 132, 44)
    pty.emitData('codex tui\n')
    pty.emitExit(0)

    expect(session).toEqual(
      expect.objectContaining({
        id: 'codex-test-1',
        binaryPath: '/repo/codex/codex-rs/target/release/codex',
        cwd: '/home/ops',
        codexHome: '/tmp/aiopsterm-user-data/codex-agent',
        runtimeKind: 'pty'
      })
    )
    expect(mkdirCalls).toEqual(['/tmp/aiopsterm-user-data/codex-agent'])
    expect(spawnCalls).toEqual([
      expect.objectContaining({
        file: '/repo/codex/codex-rs/target/release/codex',
        args: [],
        options: expect.objectContaining({
          cwd: '/home/ops',
          cols: 120,
          rows: 40,
          env: expect.objectContaining({
            CODEX_HOME: '/tmp/aiopsterm-user-data/codex-agent',
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor'
          })
        })
      })
    ])
    expect(write).toEqual({ ok: true, data: { id: 'codex-test-1', bytes: 6 } })
    expect(pty.writes).toEqual(['hello\n'])
    expect(pty.resizes).toEqual([{ cols: 132, rows: 44 }])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'ready', 'closed'])
    expect(events.data.map((entry) => entry.chunk.toString())).toEqual(['codex tui\n'])
    expect(events.exit).toEqual([expect.objectContaining({ code: 0 })])
    expect(events.closed).toEqual(['codex-test-1'])
    expect(backend.__getCodexSessionCountForTests()).toBe(0)
  })

  it('reports missing binary before spawning', async () => {
    const backend = await loadBackend()
    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      existsSync: () => false,
      loadPty: () => null
    })

    await expect(backend.createCodexSession('missing-codex', {}, createSink(createRecorder()))).rejects.toMatchObject({
      code: 'CODEX_BINARY_NOT_FOUND'
    })
  })

  it('falls back to subprocess when node-pty is unavailable', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const child = new MockChildProcess()

    backend.configureCodexCliRuntime({
      getUserDataPath: () => '/tmp/aiopsterm-user-data',
      getAppPath: () => '/repo',
      getResourcesPath: () => '/resources',
      getDefaultCwd: () => '/home/ops',
      binaryPath: '/repo/codex/codex-rs/target/release/codex',
      existsSync: (path: string) => path === '/repo/codex/codex-rs/target/release/codex',
      mkdir: async () => undefined,
      loadPty: () => null,
      processRuntime: {
        spawn: () => child as never
      }
    })

    const session = await backend.createCodexSession('codex-process-1', {}, createSink(events))
    backend.writeCodexSession(session.id, 'status\n')
    child.stdout.write('stdout\n')
    child.stderr.write('stderr\n')
    child.emit('exit', 3)

    expect(session.runtimeKind).toBe('process')
    expect(child.writes).toEqual(['status\n'])
    expect(events.data.map((entry) => entry.chunk.toString())).toEqual(['stdout\n', 'stderr\n'])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'ready', 'closed'])
    expect(events.exit).toEqual([expect.objectContaining({ code: 3 })])
  })
})
