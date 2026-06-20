import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { basename } from 'path'
import type { TerminalCreateOptions, TerminalDisconnectReason, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'
import { createTerminalErrorLifecycleEvent, createTerminalLifecycleEvent } from './terminal'

export type LocalPtyProcess = {
  pid?: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
}

export type LocalPtyRuntime = {
  spawn(shell: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): LocalPtyProcess
}

export type LocalProcessRuntime = Pick<typeof import('child_process'), 'spawn'>

export type LocalTerminalSession = {
  write(data: string | Buffer): void
  writeBinary(data: Buffer): boolean
  resize(cols: number, rows: number): void
  kill(reason?: TerminalDisconnectReason): void
}

type LocalTerminalRuntimeConfig = {
  getDefaultShell?: () => string
  getDefaultCwd?: () => string
  getEnv?: () => NodeJS.ProcessEnv
  getAgentSocketPath?: () => string
  getAgentHookScriptPath?: () => string
  getControlSocketPath?: () => string
  getPlatform?: () => NodeJS.Platform
  loadPty?: () => LocalPtyRuntime | null
  processRuntime?: LocalProcessRuntime
}

type LocalTerminalEventSink = {
  lifecycle: (event: TerminalLifecycleEvent) => void
  exit: (event: TerminalLifecycleEvent, code?: number | null) => void
  data: (chunk: string | Buffer) => void
  closed?: (id: string) => void
}

export type LocalTerminalCreateResult = {
  shell: string
  cwd: string
  session: LocalTerminalSession
  lifecycle: TerminalLifecycleEvent
  runtimeKind: 'pty' | 'process'
}

const runtimeConfig: LocalTerminalRuntimeConfig = {}

const defaultShell = () => {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

const defaultCwd = () => process.env.HOME || process.cwd()

const defaultLoadPty = (): LocalPtyRuntime | null => {
  try {
    return require('node-pty') as LocalPtyRuntime
  } catch {
    return null
  }
}

export const configureLocalTerminalBackendRuntime = (config: LocalTerminalRuntimeConfig = {}) => {
  runtimeConfig.getDefaultShell = config.getDefaultShell
  runtimeConfig.getDefaultCwd = config.getDefaultCwd
  runtimeConfig.getEnv = config.getEnv
  runtimeConfig.getAgentSocketPath = config.getAgentSocketPath
  runtimeConfig.getAgentHookScriptPath = config.getAgentHookScriptPath
  runtimeConfig.getControlSocketPath = config.getControlSocketPath
  runtimeConfig.getPlatform = config.getPlatform
  runtimeConfig.loadPty = config.loadPty
  runtimeConfig.processRuntime = config.processRuntime
}

const getShell = (options: TerminalCreateOptions) => options.shell || runtimeConfig.getDefaultShell?.() || defaultShell()

const getCwd = (options: TerminalCreateOptions) => options.cwd || runtimeConfig.getDefaultCwd?.() || defaultCwd()

const getEnv = () => runtimeConfig.getEnv?.() || process.env

const getTerminalType = (options: TerminalCreateOptions) => {
  const terminalType = typeof options.terminalType === 'string' ? options.terminalType.trim() : ''
  return terminalType || 'xterm-256color'
}

const cleanManagedContextValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const managedLocalTerminalEnvironment = (id: string, options: TerminalCreateOptions, baseEnv: NodeJS.ProcessEnv = getEnv()) => {
  const panelId = cleanManagedContextValue(options.panelId)
  const workspaceId = cleanManagedContextValue(options.workspaceId) || 'local'
  const agentSocketPath = cleanManagedContextValue(runtimeConfig.getAgentSocketPath?.())
  const agentHookScriptPath = cleanManagedContextValue(runtimeConfig.getAgentHookScriptPath?.())
  const controlSocketPath = cleanManagedContextValue(runtimeConfig.getControlSocketPath?.())
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    AIOPSTERM_TERMINAL_SESSION_ID: id,
    AIOPSTERM_WORKSPACE_ID: workspaceId,
    AIOPSTERM_MANAGED_TERMINAL: '1'
  }
  if (panelId) {
    env.AIOPSTERM_PANEL_ID = panelId
    env.AIOPSTERM_SURFACE_ID = panelId
  }
  if (agentSocketPath) env.AIOPSTERM_AGENT_SOCKET_PATH = agentSocketPath
  if (agentHookScriptPath) env.AIOPSTERM_AGENT_HOOK_PATH = agentHookScriptPath
  if (controlSocketPath) env.AIOPSTERM_CONTROL_SOCKET = controlSocketPath
  return env
}

const getPlatform = () => runtimeConfig.getPlatform?.() || process.platform

const getPtyRuntime = () => (runtimeConfig.loadPty || defaultLoadPty)()

const getProcessRuntime = () => runtimeConfig.processRuntime || { spawn }

const loginShellNames = new Set(['zsh', 'bash', 'fish', 'sh'])

const localShellArgs = (shell: string) => {
  if (getPlatform() === 'win32') return []
  const shellName = basename(shell).toLowerCase()
  return loginShellNames.has(shellName) ? ['--login'] : []
}

const sendLifecycle = (id: string, sink: LocalTerminalEventSink, event: Omit<TerminalLifecycleEvent, 'id' | 'at'> & { at?: number }) => {
  const payload = createTerminalLifecycleEvent(id, event)
  sink.lifecycle(payload)
  return payload
}

const sendErrorLifecycle = (
  id: string,
  sink: LocalTerminalEventSink,
  error: unknown,
  event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at' | 'reason' | 'isNetworkDisconnect' | 'errorCode' | 'errorMessage'>>
) => {
  const payload = createTerminalErrorLifecycleEvent(id, 'local', error, event)
  sink.lifecycle(payload)
  return payload
}

const cleanProcessId = (value: unknown) => (Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : undefined)

export const createLocalTerminalSession = (id: string, options: TerminalCreateOptions, sink: LocalTerminalEventSink): LocalTerminalCreateResult => {
  const terminalShell = getShell(options)
  const terminalArgs = localShellArgs(terminalShell)
  const cwd = getCwd(options)
  const terminalType = getTerminalType(options)
  const env = { ...managedLocalTerminalEnvironment(id, options), TERM: terminalType }
  const lifecycleBase = {
    kind: 'local' as const,
    shell: terminalShell,
    cwd
  }
  let lifecycle = sendLifecycle(id, sink, {
    ...lifecycleBase,
    stage: 'starting',
    message: `Starting local shell ${terminalShell}`
  })
  let closed = false

  const finish = (code: number | null, reason: TerminalDisconnectReason, message: string) => {
    if (closed) return
    closed = true
    sink.closed?.(id)
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'closed',
      code,
      reason,
      isNetworkDisconnect: false,
      message
    })
    sink.exit(lifecycle, code)
  }

  const fail = (error: unknown, message: string, code = 1) => {
    if (closed) return
    closed = true
    sink.closed?.(id)
    lifecycle = sendErrorLifecycle(id, sink, error, {
      ...lifecycleBase,
      code,
      message
    })
    sink.exit(lifecycle, code)
  }

  const ptyRuntime = getPtyRuntime()
  if (ptyRuntime) {
    const ptyProcess = ptyRuntime.spawn(terminalShell, terminalArgs, {
      name: terminalType,
      cols: options.cols || 100,
      rows: options.rows || 30,
      cwd,
      env
    })
    const processId = cleanProcessId(ptyProcess.pid)
    const session: LocalTerminalSession = {
      write(data: string | Buffer) {
        ptyProcess.write(typeof data === 'string' ? data : data.toString('utf8'))
      },
      writeBinary() {
        return false
      },
      resize(cols: number, rows: number) {
        ptyProcess.resize(cols, rows)
      },
      kill(reason: TerminalDisconnectReason = 'manual') {
        try {
          ptyProcess.kill()
        } finally {
          finish(0, reason, reason === 'manual' ? 'Terminal closed by user.' : 'Local shell exited.')
        }
      }
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'shell-ready',
      ...(processId ? { processId } : {}),
      message: `Local shell ready ${terminalShell}`
    })
    ptyProcess.onData((data) => sink.data(data))
    ptyProcess.onExit((event) => {
      finish(event.exitCode, 'process', 'Local shell exited.')
    })
    return { shell: terminalShell, cwd, session, lifecycle, runtimeKind: 'pty' }
  }

  const child = getProcessRuntime().spawn(terminalShell, terminalArgs, {
    cwd,
    env,
    shell: false
  }) as ChildProcessWithoutNullStreams
  const processId = cleanProcessId(child.pid)
  const session: LocalTerminalSession = {
    write(data: string | Buffer) {
      child.stdin.write(data)
    },
    writeBinary(data: Buffer) {
      child.stdin.write(data)
      return true
    },
    resize() {
      /* Subprocess fallback has no terminal window to resize. */
    },
    kill(reason: TerminalDisconnectReason = 'manual') {
      try {
        child.kill()
      } finally {
        finish(0, reason, reason === 'manual' ? 'Terminal closed by user.' : 'Local shell exited.')
      }
    }
  }
  lifecycle = sendLifecycle(id, sink, {
    ...lifecycleBase,
    stage: 'shell-ready',
    ...(processId ? { processId } : {}),
    message: `Local shell ready ${terminalShell}`
  })
  child.stdout.on('data', (chunk: Buffer) => sink.data(chunk))
  child.stderr.on('data', (chunk: Buffer) => sink.data(chunk))
  child.on('exit', (code) => {
    finish(code, 'process', 'Local shell exited.')
  })
  child.on('error', (error) => {
    fail(error, 'Local shell failed to start.')
  })
  return { shell: terminalShell, cwd, session, lifecycle, runtimeKind: 'process' }
}
