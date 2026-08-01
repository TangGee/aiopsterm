import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, delimiter, join } from 'path'
import type { TerminalCreateOptions, TerminalDisconnectReason, TerminalLifecycleEvent } from '@shared/contracts/terminalSessions'
import { defaultShellForPlatform, localShellArgsForPlatform } from '../app/platformRuntime'
import { createTerminalErrorLifecycleEvent, createTerminalLifecycleEvent } from './terminal'
import type { TerminalBackgroundCommandOptions, TerminalBackgroundCommandResult } from './terminal'

export type LocalPtyProcess = {
  pid?: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  pause?(): void
  resume?(): void
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
  pause?(): void
  resume?(): void
}

type LocalTerminalRuntimeConfig = {
  getDefaultShell?: () => string
  getDefaultCwd?: () => string
  getEnv?: () => NodeJS.ProcessEnv
  getAgentSocketPath?: () => string
  getAgentHookScriptPath?: () => string
  getControlSocketPath?: () => string
  getJsRuntimeExecutable?: () => string
  getControlHelperScriptPath?: () => string
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
  runtimeConfig.getJsRuntimeExecutable = config.getJsRuntimeExecutable
  runtimeConfig.getControlHelperScriptPath = config.getControlHelperScriptPath
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

const controlCommandShims = [
  { name: 'aio', helperArgs: [] },
  { name: 'aictl', helperArgs: [] },
  { name: 'aiopsterm-control', helperArgs: [] },
  { name: 'aiopen', helperArgs: ['aiopen'] },
  { name: 'aiossh', helperArgs: ['ssh'] },
  { name: 'aiswitch', helperArgs: ['host', 'switch'] },
  { name: 'aioic', helperArgs: ['workspace', 'close-idle'] }
]

const controlCommandShimDirectory = () => join(tmpdir(), `aiopsterm-control-bin-${process.pid}`)

const controlCompletionScriptName = 'aiopsterm-control-completion.bash'
const controlBashInitScriptName = 'aiopsterm-control-bashrc'

const controlCommandShimContent = (platform: NodeJS.Platform, helperArgs: string[] = []) => {
  const prefix = helperArgs.map((arg) => (platform === 'win32' ? arg : `'${arg.replace(/'/g, "'\\''")}'`)).join(platform === 'win32' ? ' ' : ' ')
  if (platform === 'win32') {
    return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%AIOPSTERM_JS_RUNTIME%" "%AIOPSTERM_CONTROL_HELPER_PATH%"${prefix ? ` ${prefix}` : ''} %*\r\n`
  }
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$AIOPSTERM_JS_RUNTIME" "$AIOPSTERM_CONTROL_HELPER_PATH"${prefix ? ` ${prefix}` : ''} "$@"\n`
}

const controlCompletionShimContent = () =>
  [
    '# aiopsterm managed terminal completion bootstrap',
    'if type complete >/dev/null 2>&1 && command -v aio >/dev/null 2>&1; then',
    '  eval "$(aio completion bash 2>/dev/null)"',
    'fi',
    ''
  ].join('\n')

const controlBashInitContent = () =>
  [
    '# aiopsterm managed bash startup',
    'if [ -r /etc/profile ]; then',
    '  . /etc/profile',
    'fi',
    'if [ -r "$HOME/.bash_profile" ]; then',
    '  . "$HOME/.bash_profile"',
    'elif [ -r "$HOME/.bash_login" ]; then',
    '  . "$HOME/.bash_login"',
    'elif [ -r "$HOME/.profile" ]; then',
    '  . "$HOME/.profile"',
    'elif [ -r "$HOME/.bashrc" ]; then',
    '  . "$HOME/.bashrc"',
    'fi',
    'if [ -n "$AIOPSTERM_CONTROL_BIN_DIR" ]; then',
    '  case ":$PATH:" in',
    '    *":$AIOPSTERM_CONTROL_BIN_DIR:"*) ;;',
    '    *) PATH="$AIOPSTERM_CONTROL_BIN_DIR:$PATH"; export PATH ;;',
    '  esac',
    'fi',
    'if [ -n "$AIOPSTERM_CONTROL_COMPLETION_BASH" ] && [ -r "$AIOPSTERM_CONTROL_COMPLETION_BASH" ]; then',
    '  . "$AIOPSTERM_CONTROL_COMPLETION_BASH"',
    '  unset AIOPSTERM_CONTROL_COMPLETION_BASH',
    'fi',
    '__aiopsterm_report_cwd() {',
    '  local status=$? encoded_pwd=$PWD',
    "  encoded_pwd=${encoded_pwd//'%'/'%25'}",
    "  encoded_pwd=${encoded_pwd//' '/'%20'}",
    "  encoded_pwd=${encoded_pwd//'#'/'%23'}",
    "  encoded_pwd=${encoded_pwd//'?'/'%3F'}",
    "  printf '\\033]7;file://%s%s\\033\\\\' \"${HOSTNAME:-localhost}\" \"$encoded_pwd\"",
    '  return "$status"',
    '}',
    'case ";${PROMPT_COMMAND[*]-};" in',
    '  *";__aiopsterm_report_cwd;"*) ;;',
    '  *)',
    '    if declare -p PROMPT_COMMAND 2>/dev/null | grep -q "declare -a"; then',
    '      PROMPT_COMMAND+=(__aiopsterm_report_cwd)',
    '    else',
    '      PROMPT_COMMAND="__aiopsterm_report_cwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
    '    fi',
    '    ;;',
    'esac',
    ''
  ].join('\n')

const ensureControlCommandShims = (platform: NodeJS.Platform) => {
  const directory = controlCommandShimDirectory()
  try {
    mkdirSync(directory, { recursive: true })
    const extension = platform === 'win32' ? '.cmd' : ''
    for (const shim of controlCommandShims) {
      const commandPath = join(directory, `${shim.name}${extension}`)
      writeFileSync(commandPath, controlCommandShimContent(platform, shim.helperArgs))
      if (platform !== 'win32') chmodSync(commandPath, 0o755)
    }
    if (platform !== 'win32') {
      const completionPath = join(directory, controlCompletionScriptName)
      writeFileSync(completionPath, controlCompletionShimContent())
      chmodSync(completionPath, 0o644)
      const bashInitPath = join(directory, controlBashInitScriptName)
      writeFileSync(bashInitPath, controlBashInitContent())
      chmodSync(bashInitPath, 0o644)
    }
    return directory
  } catch {
    return ''
  }
}

const prependPathEntry = (pathValue: string | undefined, entry: string) => {
  if (!entry) return pathValue
  const currentPath = pathValue || ''
  return currentPath ? `${entry}${delimiter}${currentPath}` : entry
}

const completionBootstrapPromptCommand = () =>
  '[ -n "$AIOPSTERM_CONTROL_COMPLETION_BASH" ] && [ -r "$AIOPSTERM_CONTROL_COMPLETION_BASH" ] && . "$AIOPSTERM_CONTROL_COMPLETION_BASH" && unset AIOPSTERM_CONTROL_COMPLETION_BASH;'

const prependPromptCommand = (current: string | undefined, command: string) => {
  const trimmed = current?.trim()
  return trimmed ? `${command} ${trimmed}` : command
}

export const managedLocalTerminalEnvironment = (id: string, options: TerminalCreateOptions, baseEnv: NodeJS.ProcessEnv = getEnv()) => {
  const panelId = cleanManagedContextValue(options.panelId)
  const workspaceId = cleanManagedContextValue(options.workspaceId) || 'local'
  const agentSocketPath = cleanManagedContextValue(runtimeConfig.getAgentSocketPath?.())
  const agentHookScriptPath = cleanManagedContextValue(runtimeConfig.getAgentHookScriptPath?.())
  const controlSocketPath = cleanManagedContextValue(runtimeConfig.getControlSocketPath?.())
  const jsRuntimeExecutable = cleanManagedContextValue(runtimeConfig.getJsRuntimeExecutable?.())
  const controlHelperScriptPath = cleanManagedContextValue(runtimeConfig.getControlHelperScriptPath?.())
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
  if (jsRuntimeExecutable) env.AIOPSTERM_JS_RUNTIME = jsRuntimeExecutable
  if (controlHelperScriptPath) env.AIOPSTERM_CONTROL_HELPER_PATH = controlHelperScriptPath
  if (jsRuntimeExecutable && controlHelperScriptPath) {
    const controlCommandDirectory = ensureControlCommandShims(getPlatform())
    if (controlCommandDirectory) {
      env.AIOPSTERM_CONTROL_COMMAND = 'aio'
      if (getPlatform() !== 'win32') {
        env.AIOPSTERM_CONTROL_BIN_DIR = controlCommandDirectory
        env.AIOPSTERM_CONTROL_COMPLETION_BASH = join(controlCommandDirectory, controlCompletionScriptName)
        env.AIOPSTERM_CONTROL_BASH_RC = join(controlCommandDirectory, controlBashInitScriptName)
        env.PROMPT_COMMAND = prependPromptCommand(env.PROMPT_COMMAND, completionBootstrapPromptCommand())
      }
      env.PATH = prependPathEntry(env.PATH, controlCommandDirectory)
    }
  }
  return env
}

const getPlatform = () => runtimeConfig.getPlatform?.() || process.platform

const getPtyRuntime = () => (runtimeConfig.loadPty || defaultLoadPty)()

const getProcessRuntime = () => runtimeConfig.processRuntime || { spawn }

const localShellArgs = (shell: string, env?: NodeJS.ProcessEnv) => {
  const shellName = basename(shell).toLowerCase()
  const bashInit = typeof env?.AIOPSTERM_CONTROL_BASH_RC === 'string' ? env.AIOPSTERM_CONTROL_BASH_RC : ''
  if (getPlatform() !== 'win32' && shellName === 'bash' && bashInit) return ['--rcfile', bashInit]
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
  const cwd = getCwd(options)
  const terminalType = getTerminalType(options)
  const env = { ...managedLocalTerminalEnvironment(id, options), TERM: terminalType }
  const terminalArgs = localShellArgs(terminalShell, env)
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
      pause() {
        ptyProcess.pause?.()
      },
      resume() {
        ptyProcess.resume?.()
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
    pause() {
      child.stdout.pause()
      child.stderr.pause()
    },
    resume() {
      child.stdout.resume()
      child.stderr.resume()
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
