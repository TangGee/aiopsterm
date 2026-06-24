import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { basename } from 'path'
import type { TerminalCreateOptions, TerminalDisconnectReason, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'
import { defaultShellForPlatform, localShellArgsForPlatform } from '../app/platformRuntime'
import { createTerminalErrorLifecycleEvent, createTerminalLifecycleEvent } from './terminal'
import type { TerminalBackgroundCommandOptions, TerminalBackgroundCommandResult } from './terminal'

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
  runBackgroundCommand?(options: TerminalBackgroundCommandOptions): Promise<TerminalBackgroundCommandResult>
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
  return defaultShellForPlatform(process.env, getPlatform())
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

const localShellArgs = (shell: string) => {
  return localShellArgsForPlatform(shell, getPlatform())
}

const localBackgroundShellArgs = (shell: string, command: string) => {
  if (getPlatform() === 'win32') {
    const shellName = basename(shell).toLowerCase()
    if (shellName.includes('powershell') || shellName.includes('pwsh')) return ['-NoLogo', '-NoProfile', '-Command', command]
    return ['/d', '/s', '/c', command]
  }
  return ['-lc', command]
}

const truncateOutput = (output: string, chunk: string | Buffer, maxBytes: number) => {
  const currentBytes = Buffer.byteLength(output, 'utf8')
  if (currentBytes >= maxBytes) return { output, truncated: true }
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
  const remaining = maxBytes - currentBytes
  const chunkBuffer = Buffer.from(text, 'utf8')
  if (chunkBuffer.byteLength <= remaining) return { output: `${output}${text}`, truncated: false }
  return { output: `${output}${chunkBuffer.subarray(0, remaining).toString('utf8')}`, truncated: true }
}

const runLocalBackgroundCommand = (
  id: string,
  command: string,
  options: TerminalCreateOptions,
  terminalShell: string,
  terminalType: string,
  cwd: string,
  commandOptions: TerminalBackgroundCommandOptions
): Promise<TerminalBackgroundCommandResult> => {
  const startedAt = Date.now()
  const maxOutputBytes = Math.max(1024, Math.min(commandOptions.maxOutputBytes || 1024 * 1024, 4 * 1024 * 1024))
  const child = getProcessRuntime().spawn(terminalShell, localBackgroundShellArgs(terminalShell, command), {
    cwd: commandOptions.cwd || cwd,
    env: { ...managedLocalTerminalEnvironment(`${id}-background`, options), TERM: terminalType },
    shell: false
  }) as ChildProcessWithoutNullStreams

  return new Promise<TerminalBackgroundCommandResult>((resolve, reject) => {
    let output = ''
    let outputTruncated = false
    let settled = false
    let timedOut = false
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const append = (chunk: string | Buffer) => {
      if (settled) return
      const next = truncateOutput(output, chunk, maxOutputBytes)
      output = next.output
      outputTruncated = outputTruncated || next.truncated
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {}
      settle(() =>
        resolve({
          output,
          exitCode: null,
          durationMs: Date.now() - startedAt,
          timedOut,
          ...(outputTruncated ? { outputTruncated } : {})
        })
      )
    }, commandOptions.timeoutMs)
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', (error) => settle(() => reject(error)))
    child.on('exit', (code) =>
      settle(() =>
        resolve({
          output,
          exitCode: timedOut ? null : Number.isFinite(code) ? Number(code) : null,
          durationMs: Date.now() - startedAt,
          timedOut,
          ...(outputTruncated ? { outputTruncated } : {})
        })
      )
    )
  })
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
      runBackgroundCommand(commandOptions) {
        return runLocalBackgroundCommand(id, commandOptions.command, options, terminalShell, terminalType, cwd, commandOptions)
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
    runBackgroundCommand(commandOptions) {
      return runLocalBackgroundCommand(id, commandOptions.command, options, terminalShell, terminalType, cwd, commandOptions)
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
