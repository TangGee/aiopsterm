import { EventEmitter } from 'events'
import { readFileSync, statSync } from 'fs'
import { basename, delimiter, join } from 'path'
import { PassThrough } from 'stream'
import { beforeEach, describe, expect, it } from 'vitest'

type TerminalLifecycleEvent = {
  id: string
  kind: 'local' | 'ssh'
  stage: 'starting' | 'connecting' | 'proxy-opening' | 'connected' | 'shell-ready' | 'error' | 'closed'
  at: number
  shell?: string
  cwd?: string
  processId?: number
  processGroupId?: number
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
    getAgentSocketPath?: () => string
    getAgentHookScriptPath?: () => string
    getControlSocketPath?: () => string
    getJsRuntimeExecutable?: () => string
    getControlHelperScriptPath?: () => string
    getPlatform?: () => NodeJS.Platform
    loadPty?: () => { spawn: (shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }) => MockPtyProcess } | null
    processRuntime?: {
      spawn: (shell: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; shell: false }) => MockChildProcess
    }
  }) => void
  managedLocalTerminalEnvironment: (id: string, options: { panelId?: string; workspaceId?: string }, baseEnv?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
  createLocalTerminalSession: (
    id: string,
    options: { kind?: 'local'; shell?: string; cwd?: string; cols?: number; rows?: number; terminalType?: string; panelId?: string; workspaceId?: string },
    sink: ReturnType<typeof createSink>
  ) => {
    shell: string
    cwd: string
    runtimeKind: 'pty' | 'process'
    lifecycle: TerminalLifecycleEvent
    session: {
      write: (data: string | Buffer) => void
      writeBinary: (data: Buffer) => boolean
      runBackgroundCommand: (options: { command: string; cwd?: string; timeoutMs: number }) => Promise<{ output: string; exitCode: number | null; timedOut: boolean }>
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
  pid = 2222
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
  pid = 3333
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
  const modulePath = '../src/main/backend/terminal/localTerminal'
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
      getAgentSocketPath: () => '/tmp/aiopsterm-agent.sock',
      getAgentHookScriptPath: () => '/opt/aiopsterm/aiopsterm-agent-hook.js',
      getControlSocketPath: () => '/tmp/aiopsterm-control.sock',
      getPlatform: () => 'linux',
      loadPty: () => ({
        spawn: (shell, args, options) => {
          spawnCalls.push({ shell, args, options })
          return pty
        }
      })
    })

    const result = backend.createLocalTerminalSession(
      'local-pty-1',
      { kind: 'local', cols: 120, rows: 40, terminalType: 'vt220', panelId: 'panel-1', workspaceId: 'workspace' },
      createSink(events)
    )
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
        options: expect.objectContaining({
          cwd: '/home/ops',
          cols: 120,
          rows: 40,
          name: 'vt220',
          env: expect.objectContaining({
            PATH: '/usr/bin',
            TERM: 'vt220',
            AIOPSTERM_TERMINAL_SESSION_ID: 'local-pty-1',
            AIOPSTERM_PANEL_ID: 'panel-1',
            AIOPSTERM_SURFACE_ID: 'panel-1',
            AIOPSTERM_WORKSPACE_ID: 'workspace',
            AIOPSTERM_MANAGED_TERMINAL: '1',
            AIOPSTERM_AGENT_SOCKET_PATH: '/tmp/aiopsterm-agent.sock',
            AIOPSTERM_AGENT_HOOK_PATH: '/opt/aiopsterm/aiopsterm-agent-hook.js',
            AIOPSTERM_CONTROL_SOCKET: '/tmp/aiopsterm-control.sock'
          })
        })
      })
    ])
    expect(pty.writes).toEqual(['uptime\n'])
    expect(pty.resizes).toEqual([{ cols: 132, rows: 44 }])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'shell-ready', 'closed'])
    expect(events.lifecycle[1]).toEqual(expect.objectContaining({ processId: 2222 }))
    expect(events.data.map((chunk) => chunk.toString())).toEqual(['shell output\n'])
    expect(events.data.map((chunk) => chunk.toString()).join('')).not.toContain('[aiopsterm]')
    expect(events.exit).toEqual([expect.objectContaining({ code: 0 })])
    expect(events.closed).toEqual(['local-pty-1'])
    expect(result.session.writeBinary(Buffer.from([0x2a]))).toBe(false)
  })

  it('protects managed local terminal identity over inherited environment values', async () => {
    const backend = await loadBackend()

    expect(
      backend.managedLocalTerminalEnvironment(
        'local-managed-1',
        { panelId: 'panel-managed', workspaceId: 'workspace-managed' },
        {
          AIOPSTERM_TERMINAL_SESSION_ID: 'stale-session',
          AIOPSTERM_PANEL_ID: 'stale-panel',
          AIOPSTERM_SURFACE_ID: 'stale-surface',
          AIOPSTERM_WORKSPACE_ID: 'stale-workspace',
          AIOPSTERM_MANAGED_TERMINAL: '0',
          PATH: '/usr/bin'
        }
      )
    ).toEqual(
      expect.objectContaining({
        AIOPSTERM_TERMINAL_SESSION_ID: 'local-managed-1',
        AIOPSTERM_PANEL_ID: 'panel-managed',
        AIOPSTERM_SURFACE_ID: 'panel-managed',
        AIOPSTERM_WORKSPACE_ID: 'workspace-managed',
        AIOPSTERM_MANAGED_TERMINAL: '1',
        PATH: '/usr/bin'
      })
    )
  })

  it('adds short control command shims to managed local terminal PATH', async () => {
    const backend = await loadBackend()
    backend.configureLocalTerminalBackendRuntime({
      getJsRuntimeExecutable: () => '/opt/aiopsterm/aiopsterm',
      getControlHelperScriptPath: () => '/opt/aiopsterm/resources/aiopsterm-control.js',
      getPlatform: () => 'linux'
    })

    const env = backend.managedLocalTerminalEnvironment('local-managed-2', { panelId: 'panel-2', workspaceId: 'workspace' }, { PATH: '/usr/bin' })
    const controlBinDir = String(env.PATH || '').split(delimiter)[0]

    expect(env.AIOPSTERM_CONTROL_COMMAND).toBe('aio')
    expect(env.PATH).toBe(`${controlBinDir}${delimiter}/usr/bin`)
    expect(env.AIOPSTERM_CONTROL_BIN_DIR).toBe(controlBinDir)
    expect(basename(controlBinDir)).toMatch(/^aiopsterm-control-bin-/)
    for (const commandName of ['aio', 'aictl', 'aiopsterm-control']) {
      const commandPath = join(controlBinDir, commandName)
      expect(readFileSync(commandPath, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_CONTROL_HELPER_PATH" "$@"')
      expect(statSync(commandPath).mode & 0o111).not.toBe(0)
    }
    const aiopenPath = join(controlBinDir, 'aiopen')
    expect(readFileSync(aiopenPath, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_CONTROL_HELPER_PATH" \'aiopen\' "$@"')
    expect(statSync(aiopenPath).mode & 0o111).not.toBe(0)
    const aiosshPath = join(controlBinDir, 'aiossh')
    expect(readFileSync(aiosshPath, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_CONTROL_HELPER_PATH" \'ssh\' "$@"')
    expect(statSync(aiosshPath).mode & 0o111).not.toBe(0)
    const aiswitchPath = join(controlBinDir, 'aiswitch')
    expect(readFileSync(aiswitchPath, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_CONTROL_HELPER_PATH" \'host\' \'switch\' "$@"')
    expect(statSync(aiswitchPath).mode & 0o111).not.toBe(0)
    const aioicPath = join(controlBinDir, 'aioic')
    expect(readFileSync(aioicPath, 'utf8')).toContain('ELECTRON_RUN_AS_NODE=1 exec "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_CONTROL_HELPER_PATH" \'workspace\' \'close-idle\' "$@"')
    expect(statSync(aioicPath).mode & 0o111).not.toBe(0)

    const completionPath = String(env.AIOPSTERM_CONTROL_COMPLETION_BASH || '')
    expect(completionPath).toBe(join(controlBinDir, 'aiopsterm-control-completion.bash'))
    expect(readFileSync(completionPath, 'utf8')).toContain('eval "$(aio completion bash 2>/dev/null)"')

    const bashRcPath = String(env.AIOPSTERM_CONTROL_BASH_RC || '')
    expect(bashRcPath).toBe(join(controlBinDir, 'aiopsterm-control-bashrc'))
    expect(readFileSync(bashRcPath, 'utf8')).toContain('. /etc/profile')
    expect(readFileSync(bashRcPath, 'utf8')).toContain('PATH="$AIOPSTERM_CONTROL_BIN_DIR:$PATH"; export PATH')
    expect(readFileSync(bashRcPath, 'utf8')).toContain('. "$AIOPSTERM_CONTROL_COMPLETION_BASH"')
    expect(readFileSync(bashRcPath, 'utf8')).toContain('__aiopsterm_report_cwd')
    expect(readFileSync(bashRcPath, 'utf8')).toContain(']7;file://%s%s')
  })

  it('starts managed bash with the generated rcfile so aio completion is loaded after user startup files', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const pty = new MockPtyProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    backend.configureLocalTerminalBackendRuntime({
      getDefaultShell: () => '/bin/bash',
      getDefaultCwd: () => '/home/ops',
      getEnv: () => ({ PATH: '/usr/bin', PROMPT_COMMAND: 'user_prompt' }),
      getJsRuntimeExecutable: () => '/opt/aiopsterm/aiopsterm',
      getControlHelperScriptPath: () => '/opt/aiopsterm/resources/aiopsterm-control.js',
      getPlatform: () => 'linux',
      loadPty: () => ({
        spawn: (shell, args, options) => {
          spawnCalls.push({ shell, args, options })
          return pty
        }
      })
    })

    backend.createLocalTerminalSession('local-managed-bash', { kind: 'local', panelId: 'panel-managed' }, createSink(events))

    const env = spawnCalls[0]?.options as { env?: NodeJS.ProcessEnv } | undefined
    const bashRcPath = String(env?.env?.AIOPSTERM_CONTROL_BASH_RC || '')
    expect(spawnCalls[0]).toEqual(
      expect.objectContaining({
        shell: '/bin/bash',
        args: ['--rcfile', bashRcPath]
      })
    )
    expect(readFileSync(bashRcPath, 'utf8')).toContain('. "$AIOPSTERM_CONTROL_COMPLETION_BASH"')
    expect(String(env?.env?.PROMPT_COMMAND || '')).toContain('user_prompt')
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

    const result = backend.createLocalTerminalSession('local-process-1', { kind: 'local', terminalType: 'ansi' }, createSink(events))
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
        options: expect.objectContaining({
          cwd: '/tmp',
          shell: false,
          env: expect.objectContaining({ PATH: '/bin', TERM: 'ansi' })
        })
      })
    ])
    expect(child.writes).toEqual(['date\n', Buffer.from([0x00, 0xff])])
    expect(events.lifecycle.map((event) => event.stage)).toEqual(['starting', 'shell-ready', 'closed'])
    expect(events.lifecycle[1]).toEqual(expect.objectContaining({ processId: 3333 }))
    expect(events.data.map((chunk) => chunk.toString())).toEqual(['process stdout\n', 'process stderr\n'])
    expect(events.data.map((chunk) => chunk.toString()).join('')).not.toContain('[aiopsterm]')
    expect(events.exit).toEqual([expect.objectContaining({ code: 7 })])
    expect(events.closed).toEqual(['local-process-1'])
  })

  it('runs background commands in a separate local shell without writing to the visible terminal process', async () => {
    const backend = await loadBackend()
    const events = createRecorder()
    const visibleChild = new MockChildProcess()
    const backgroundChild = new MockChildProcess()
    const spawnCalls: Array<Record<string, unknown>> = []
    backend.configureLocalTerminalBackendRuntime({
      getDefaultShell: () => '/bin/bash',
      getDefaultCwd: () => '/home/ops',
      getEnv: () => ({ PATH: '/usr/bin' }),
      getPlatform: () => 'linux',
      loadPty: () => null,
      processRuntime: {
        spawn: (shell, args, options) => {
          spawnCalls.push({ shell, args, options })
          return (spawnCalls.length === 1 ? visibleChild : backgroundChild) as never
        }
      }
    })

    const result = backend.createLocalTerminalSession('local-background-1', { kind: 'local', panelId: 'panel-bg' }, createSink(events))
    const backgroundPromise = result.session.runBackgroundCommand({ command: 'pwd && hostname', cwd: '/srv/app', timeoutMs: 5000 })
    backgroundChild.stdout.write('/srv/app\n')
    backgroundChild.stderr.write('host-a\n')
    backgroundChild.emit('exit', 0)
    const background = await backgroundPromise

    expect(visibleChild.writes).toEqual([])
    expect(spawnCalls).toEqual([
      expect.objectContaining({
        shell: '/bin/bash',
        args: ['--login'],
        options: expect.objectContaining({ cwd: '/home/ops' })
      }),
      expect.objectContaining({
        shell: '/bin/bash',
        args: ['-lc', 'pwd && hostname'],
        options: expect.objectContaining({
          cwd: '/srv/app',
          shell: false,
          env: expect.objectContaining({
            AIOPSTERM_TERMINAL_SESSION_ID: 'local-background-1-background',
            AIOPSTERM_PANEL_ID: 'panel-bg'
          })
        })
      })
    ])
    expect(background).toEqual(
      expect.objectContaining({
        output: '/srv/app\nhost-a\n',
        exitCode: 0,
        timedOut: false
      })
    )
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
