import type { ConnectConfig } from 'ssh2'
import type { SshProxyConfig } from '@shared/contracts/appRuntime'
import type {
  TerminalCreateOptions,
  TerminalDisconnectReason,
  TerminalLifecycleEvent
} from '@shared/contracts/terminalSessions'
import { applyConfiguredSshAgentAuth } from './sshAgent'
import { resolveSshProxyConfigForAsset, type SshProxySocket } from './sshProxy'
import { diagnoseSshConnectionError } from '../terminal/terminal'
import {
  authenticatedTargetPoolKey,
  getPooledClient,
  getPooledClientByKeys,
  isPooledClientByKeys,
  jumpForwardUnsupportedKeys,
  jumpPoolKey,
  pooledJumpClients,
  pooledTargetClients,
  rememberPooledClient,
  rememberPooledClientAliases,
  removePooledClient,
  removePooledClientAliases,
  targetPoolKey
} from './sshTerminalConnectionPool'
import { createBackendDoubleSession } from './sshTerminalBackendDouble'
import { terminalAuthLabel } from './sshTerminalAuthRuntime'
import { createSshTerminalSessionAuthRuntime } from './sshTerminalSessionAuthRuntime'
import {
  cleanText,
  createLifecycleBase,
  failBeforeSession,
  getEnv,
  getProxySocketForAsset,
  getPtyRuntime,
  getRuntimeConfig,
  getSsh2Runtime,
  getSshKeepaliveIntervalMs,
  getSshReadyTimeoutMs,
  getTerminalType,
  isValidTarget,
  resolveKeychainSecret,
  resolveSshTerminalTarget,
  runtimeConfig,
  sendErrorLifecycle,
  sendLifecycle,
  shouldUseBackendDouble
} from './sshTerminalRuntimeConfig'
import {
  createHiddenTextFilter,
  getLocalSshSpawnCwd,
  inferRelayTargetReady,
  pathExists,
  relayControlPath,
  relayShellCommand,
  relayShellSshArgs,
  shellSingleQuote,
  shouldBootstrapRelayShell
} from './sshTerminalRelayShell'
import type {
  SshTerminalChannel,
  SshTerminalClient,
  SshTerminalCreateResult,
  SshTerminalEventSink,
  SshTerminalPtyProcess,
  SshTerminalSession,
  SshTerminalTarget,
  SshTerminalWritable
} from './sshTerminalTypes'
import { SshJumpForwardError } from './sshTerminalTypes'
import type { TerminalBackgroundCommandOptions, TerminalBackgroundCommandResult } from '../terminal/terminal'

const backgroundOutputMaxBytes = 1024 * 1024

const boundedAppend = (value: string, chunk: string | Buffer, maxBytes = backgroundOutputMaxBytes) => {
  const currentBytes = Buffer.byteLength(value, 'utf8')
  if (currentBytes >= maxBytes) return { value, truncated: true }
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
  const next = Buffer.from(text, 'utf8')
  const remaining = maxBytes - currentBytes
  if (next.byteLength <= remaining) return { value: `${value}${text}`, truncated: false }
  return { value: `${value}${next.subarray(0, remaining).toString('utf8')}`, truncated: true }
}

const stripControlForBackground = (value: string) =>
  value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '')

const buildMarkedBackgroundCommand = (command: string, commandId: string) => {
  const markerStart = `__AIOPSTERM_BACKGROUND_START_${commandId}__`
  const markerEnd = `__AIOPSTERM_BACKGROUND_END_${commandId}__`
  const markerEndPrefix = `${markerEnd}:`
  return {
    markerStart,
    markerEndPrefix,
    input: ['echo ', shellSingleQuote(markerStart), '; ', command, '; __aiopsterm_status=$?; echo ', shellSingleQuote(markerEnd), ':$__aiopsterm_status', '\n'].join('')
  }
}

const extractBackgroundMarkedOutput = (value: string, markerStart: string, markerEndPrefix: string) => {
  const cleaned = stripControlForBackground(value)
  const lines = cleaned.split('\n')
  let endLineIndex = -1
  let exitCode: number | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith(markerEndPrefix)) continue
    const rawCode = line.slice(markerEndPrefix.length).trim()
    if (!/^-?\d+$/.test(rawCode)) continue
    endLineIndex = index
    exitCode = Number(rawCode)
    break
  }
  if (endLineIndex < 0) return null
  const beforeEnd = lines.slice(0, endLineIndex).join('\n')
  const startLines = beforeEnd.split('\n')
  let startLineIndex = -1
  for (let index = 0; index < startLines.length; index += 1) {
    if (startLines[index].trim() === markerStart) startLineIndex = index
  }
  const output = startLineIndex >= 0 ? startLines.slice(startLineIndex + 1).join('\n') : beforeEnd
  return { output: output.trim(), exitCode }
}

const commandWithCwd = (command: string, cwd?: string) => {
  const cleanCwd = cleanText(cwd)
  return cleanCwd ? `cd ${shellSingleQuote(cleanCwd)} && ${command}` : command
}

const runSshExecBackgroundCommand = (
  authClient: SshTerminalClient,
  commandOptions: TerminalBackgroundCommandOptions
): Promise<TerminalBackgroundCommandResult> => {
  if (typeof authClient.exec !== 'function') {
    return Promise.reject(new Error('The active SSH runtime does not support exec channels.'))
  }
  const exec = authClient.exec.bind(authClient)
  const startedAt = Date.now()
  const maxOutputBytes = Math.max(1024, Math.min(commandOptions.maxOutputBytes || backgroundOutputMaxBytes, 4 * backgroundOutputMaxBytes))
  return new Promise<TerminalBackgroundCommandResult>((resolve, reject) => {
    let output = ''
    let outputTruncated = false
    let settled = false
    let timedOut = false
    let activeChannel: SshTerminalChannel | null = null
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const append = (chunk: string | Buffer) => {
      const next = boundedAppend(output, chunk, maxOutputBytes)
      output = next.value
      outputTruncated = outputTruncated || next.truncated
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        activeChannel?.close?.()
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
    try {
      exec(commandWithCwd(commandOptions.command, commandOptions.cwd), (error, channel) => {
        if (error) {
          settle(() => reject(error))
          return
        }
        activeChannel = channel
        channel.on('data', append)
        channel.stderr.on('data', append)
        channel.on('close', (code?: number | null) =>
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
    } catch (error) {
      settle(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  })
}

const runRelayShellBackgroundCommand = (
  target: SshTerminalTarget,
  jumpTarget: SshTerminalTarget,
  terminalType: string,
  cols: number,
  rows: number,
  commandOptions: TerminalBackgroundCommandOptions
): Promise<TerminalBackgroundCommandResult> => {
  const ptyRuntime = getPtyRuntime()
  if (!ptyRuntime) return Promise.reject(new Error('Relay-shell background execution requires a PTY runtime.'))
  const startedAt = Date.now()
  const maxOutputBytes = Math.max(1024, Math.min(commandOptions.maxOutputBytes || backgroundOutputMaxBytes, 4 * backgroundOutputMaxBytes))
  const relayProcess = ptyRuntime.spawn('ssh', relayShellSshArgs(jumpTarget), {
    name: terminalType,
    cols,
    rows,
    cwd: getLocalSshSpawnCwd(),
    env: {
      ...getEnv(),
      TERM: terminalType,
      AIOPSTERM_TRANSPORT: 'relay-shell-background',
      AIOPSTERM_RELAY_HOST: jumpTarget.host,
      AIOPSTERM_TARGET_HOST: target.host
    }
  })

  return new Promise<TerminalBackgroundCommandResult>((resolve, reject) => {
    let settled = false
    let timedOut = false
    let output = ''
    let outputTruncated = false
    let probeBuffer = ''
    let commandBuffer = ''
    let nestedSent = false
    let commandSent = false
    const commandId = `bg_${Date.now()}_${Math.random().toString(16).slice(2)}`.replace(/[^a-zA-Z0-9_-]/g, '_')
    const marked = buildMarkedBackgroundCommand(commandWithCwd(commandOptions.command, commandOptions.cwd), commandId)
    const nestedInput = `${relayShellCommand(target)}\n`
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        relayProcess.kill()
      } catch {}
      callback()
    }
    const appendCommandOutput = (chunk: string | Buffer) => {
      const next = boundedAppend(commandBuffer, chunk, maxOutputBytes)
      commandBuffer = next.value
      outputTruncated = outputTruncated || next.truncated
      const completed = extractBackgroundMarkedOutput(commandBuffer, marked.markerStart, marked.markerEndPrefix)
      if (!completed) return
      output = completed.output
      settle(() =>
        resolve({
          output,
          exitCode: completed.exitCode,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          ...(outputTruncated ? { outputTruncated } : {})
        })
      )
    }
    const timer = setTimeout(() => {
      timedOut = true
      settle(() =>
        resolve({
          output: commandSent ? stripControlForBackground(commandBuffer).trim() : stripControlForBackground(probeBuffer).trim(),
          exitCode: null,
          durationMs: Date.now() - startedAt,
          timedOut,
          ...(outputTruncated ? { outputTruncated } : {})
        })
      )
    }, commandOptions.timeoutMs)

    relayProcess.onData((chunk) => {
      if (settled) return
      if (commandSent) {
        appendCommandOutput(chunk)
        return
      }
      probeBuffer = `${probeBuffer}${chunk}`.slice(-8192)
      if (!nestedSent) {
        if (!shouldBootstrapRelayShell(probeBuffer)) return
        nestedSent = true
        relayProcess.write(nestedInput)
        probeBuffer = ''
        return
      }
      const endpoint = inferRelayTargetReady(probeBuffer, jumpTarget, target)
      if (!endpoint) return
      commandSent = true
      commandBuffer = ''
      relayProcess.write(marked.input)
    })
    relayProcess.onExit((event) => {
      if (settled) return
      const exitCode = Number.isFinite(event.exitCode) ? Number(event.exitCode) : null
      settle(() => {
        if (commandSent) {
          resolve({
            output: stripControlForBackground(commandBuffer).trim(),
            exitCode,
            durationMs: Date.now() - startedAt,
            timedOut: false,
            ...(outputTruncated ? { outputTruncated } : {})
          })
          return
        }
        reject(new Error('Relay-shell background execution exited before the target shell became ready.'))
      })
    })
  })
}

export const createSshTerminalSession = (
  id: string,
  options: TerminalCreateOptions,
  sink: SshTerminalEventSink
): SshTerminalCreateResult => {
  const target = resolveSshTerminalTarget(options)
  const { cwd, lifecycleBase } = createLifecycleBase(id, target)

  if (!isValidTarget(target)) {
    return failBeforeSession(id, target, sink, new Error('SSH target requires host, username, and a valid port.'), 'SSH target is invalid.')
  }

  if (shouldUseBackendDouble()) {
    return createBackendDoubleSession(id, target, sink)
  }

  const ssh2 = getSsh2Runtime()
  if (!ssh2) {
    return failBeforeSession(
      id,
      target,
      sink,
      new Error('ssh2 runtime is not available. Run npm install and rebuild native modules if needed.'),
      'SSH runtime is not available.'
    )
  }

  let client: SshTerminalClient | null = null
  let stream: SshTerminalWritable | null = null
  let proxySocket: SshProxySocket | null = null
  let relayPty: SshTerminalPtyProcess | null = null
  let closed = false
  let cols = options.cols || 100
  let rows = options.rows || 30
  const terminalType = getTerminalType(options)
  const pendingWrites: Array<string | Buffer> = []
  let hasConfiguredAgentAuth = false
  let targetPasswordRetryUsed = false
  let jumpClient: SshTerminalClient | null = null
  let jumpClientIsPooled = false
  let jumpStream: SshTerminalChannel | null = null
  let targetClientIsPooled = false
  let targetClientPoolable = false
  let targetClientPoolKey = ''
  let targetClientAuthenticatedPoolKey = ''
  let targetConnectionReuse: TerminalLifecycleEvent['connectionReuse'] = 'created'
  let targetConnectionTransport: TerminalLifecycleEvent['sshTransport'] = 'direct'
  let targetConnectionJump: SshTerminalTarget | null = null
  let relayShellJumpTarget: SshTerminalTarget | null = null
  const staleTargetClients = new Set<SshTerminalClient>()

  let lifecycle = sendLifecycle(id, sink, {
    ...lifecycleBase,
    stage: 'connecting',
    message: `Connecting ${target.username}@${target.host}:${target.port}`
  })

  const cleanupJumpTransport = () => {
    try {
      jumpStream?.close?.()
    } catch {}
    if (!jumpClientIsPooled) {
      try {
        jumpClient?.end()
      } catch {}
    }
    jumpStream = null
    jumpClient = null
    jumpClientIsPooled = false
  }

  const cleanupProxyTransport = () => {
    try {
      proxySocket?.destroy()
    } catch {}
    proxySocket = null
  }

  const cleanupRelayShell = () => {
    const activePty = relayPty
    relayPty = null
    if (activePty) stream = null
    try {
      activePty?.kill()
    } catch {}
  }

  const cleanupTransports = () => {
    cleanupJumpTransport()
    cleanupProxyTransport()
    cleanupRelayShell()
  }

  const finish = (
    code: number | null,
    reason: TerminalDisconnectReason,
    event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> = {}
  ) => {
    if (closed) return
    closed = true
    cleanupTransports()
    sink.closed?.(id)
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...event,
      stage: reason === 'error' || reason === 'network' ? 'error' : 'closed',
      code,
      reason,
      isNetworkDisconnect: reason === 'network' || event.isNetworkDisconnect === true,
      message:
        event.message ||
        (reason === 'manual'
          ? 'Terminal closed by user.'
          : reason === 'process'
            ? 'Terminal process exited.'
            : reason === 'network'
              ? 'SSH connection closed by network.'
              : 'SSH terminal closed.')
    })
    sink.exit(lifecycle, code)
  }

  const fail = (
    error: unknown,
    message: string,
    code = 1,
    event: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> = {}
  ) => {
    if (closed) return
    closed = true
    cleanupTransports()
    sink.closed?.(id)
    lifecycle = sendErrorLifecycle(id, sink, error, {
      ...lifecycleBase,
      ...event,
      code,
      message
    })
    sink.exit(lifecycle, code)
  }

  const sshConnectionErrorEvent = (error: unknown): Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>> => {
    const diagnosis = diagnoseSshConnectionError(error, {
      authType: target.asset?.auth_type,
      hasPassword: Boolean(target.password),
      hasPrivateKey: Boolean(target.privateKey),
      hasAgent: hasConfiguredAgentAuth,
      tryKeyboard: Boolean(sink.keyboardInteractive),
      username: target.username,
      host: target.host,
      port: target.port
    })
    return {
      reason: diagnosis.reason,
      isNetworkDisconnect: diagnosis.isNetworkDisconnect,
      errorCode: diagnosis.errorCode,
      errorMessage: diagnosis.errorMessage
    }
  }

  const session: SshTerminalSession = {
    write(data: string | Buffer) {
      if (closed) return
      if (stream) {
        stream.write(data)
      } else {
        pendingWrites.push(data)
      }
    },
    runBackgroundCommand(commandOptions) {
      if (closed) return Promise.reject(new Error('SSH terminal session is closed.'))
      if (relayShellJumpTarget) {
        return runRelayShellBackgroundCommand(target, relayShellJumpTarget, terminalType, cols, rows, commandOptions)
      }
      if (!client) return Promise.reject(new Error('SSH target connection is not ready for background execution.'))
      return runSshExecBackgroundCommand(client, commandOptions)
    },
    resize(nextCols: number, nextRows: number) {
      cols = nextCols
      rows = nextRows
      stream?.setWindow?.(rows, cols, 0, 0)
    },
    kill(reason: TerminalDisconnectReason = 'manual') {
      finish(0, reason)
      try {
        if (stream?.close) stream.close()
      } catch {}
      if (!targetClientIsPooled) {
        try {
          client?.end()
        } catch {}
      }
    }
  }

  const authRuntime = createSshTerminalSessionAuthRuntime({
    id,
    target,
    sink,
    lifecycleBase,
    sendLifecycle: (event) => {
      lifecycle = sendLifecycle(id, sink, event)
      return lifecycle
    },
    rememberPassword: runtimeConfig.rememberAssetPassword
  })

  const authMethodsLabel = (connectConfig: ConnectConfig, hasAgentAuth: boolean) => {
    const methods = [
      connectConfig.password ? 'password' : '',
      connectConfig.privateKey ? 'privateKey' : '',
      hasAgentAuth ? 'agent' : '',
      connectConfig.tryKeyboard ? 'keyboard-interactive' : ''
    ].filter(Boolean)
    return methods.length ? methods.join(',') : 'none'
  }

  const openShellOnClient = (authClient: SshTerminalClient) => {
    if (closed) return
    authRuntime.sendActiveKeyboardResult('target', { status: 'success' })
    authRuntime.commitRememberedPassword('target')
    if (targetClientPoolable) {
      const disposeProxySocket = targetConnectionTransport === 'proxy' && proxySocket ? proxySocket : null
      rememberPooledClientAliases(
        pooledTargetClients,
        [targetClientPoolKey, targetClientAuthenticatedPoolKey],
        authClient,
        disposeProxySocket ? () => disposeProxySocket.destroy() : undefined
      )
      if (targetConnectionTransport === 'jump') jumpStream = null
      if (targetConnectionTransport === 'proxy') proxySocket = null
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connected',
      sshTransport: targetConnectionTransport,
      connectionReuse: targetConnectionReuse,
      ...(targetConnectionJump
        ? {
            jumpHost: targetConnectionJump.host,
            jumpPort: targetConnectionJump.port,
            jumpUsername: targetConnectionJump.username
          }
        : {}),
      targetHost: target.host,
      targetPort: target.port,
      targetUsername: target.username,
      message:
        targetConnectionReuse === 'reused'
          ? `SSH connection reused ${target.username}@${target.host}:${target.port}`
          : `SSH connected ${target.username}@${target.host}:${target.port}`
    })
    authClient.shell({ term: terminalType, cols, rows }, (error, channel) => {
      if (error) {
        fail(error, 'SSH shell failed.', 1)
        return
      }
      stream = channel
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'shell-ready',
        sshTransport: targetConnectionTransport,
        connectionReuse: targetConnectionReuse,
        ...(targetConnectionJump
          ? {
              jumpHost: targetConnectionJump.host,
              jumpPort: targetConnectionJump.port,
              jumpUsername: targetConnectionJump.username
            }
          : {}),
        targetHost: target.host,
        targetPort: target.port,
        targetUsername: target.username,
        message: `SSH shell ready ${target.username}@${target.host}:${target.port}`
      })
      while (pendingWrites.length) {
        stream.write(pendingWrites.shift() || '')
      }
      channel.on('data', (chunk: Buffer | string) => sink.data(chunk))
      channel.stderr.on('data', (chunk: Buffer | string) => sink.data(chunk))
      channel.on('close', () => finish(0, 'process'))
    })
  }

  const createConnectConfig = (authTarget: SshTerminalTarget) => {
    const connectConfig: ConnectConfig = {
      host: authTarget.host,
      port: authTarget.port,
      username: authTarget.username,
      tryKeyboard: Boolean(sink.keyboardInteractive),
      readyTimeout: getSshReadyTimeoutMs(),
      keepaliveInterval: getSshKeepaliveIntervalMs()
    }
    if (authTarget.password) connectConfig.password = authTarget.password
    if (authTarget.privateKey) connectConfig.privateKey = authTarget.privateKey
    if (authTarget.passphrase) connectConfig.passphrase = authTarget.passphrase
    const configuredAgentAuth = applyConfiguredSshAgentAuth(connectConfig, getRuntimeConfig(), (keyChainId) => resolveKeychainSecret(keyChainId), {
      enableForward: true,
      overrideExistingAgent: false
    })
    let hasAgentAuth = Boolean(configuredAgentAuth)
    const env = getEnv()
    if (!configuredAgentAuth && !authTarget.password && !authTarget.privateKey && env.SSH_AUTH_SOCK) {
      connectConfig.agent = env.SSH_AUTH_SOCK
      hasAgentAuth = true
    }
    return { connectConfig, hasAgentAuth }
  }

  const resolveJumpHostTarget = () => {
    const jumpHostId = cleanText(target.asset?.jumpHostId)
    if (!jumpHostId) return null
    const jumpTarget = resolveSshTerminalTarget({ kind: 'ssh', assetId: jumpHostId })
    if (!isValidTarget(jumpTarget)) {
      throw new Error('Jump host target requires host, username, and a valid port.')
    }
    return jumpTarget
  }

  const openJumpHostTunnel = async (jumpTarget: SshTerminalTarget): Promise<SshTerminalChannel> => {
    const poolKey = jumpPoolKey(jumpTarget)
    if (jumpForwardUnsupportedKeys.has(poolKey)) {
      throw new SshJumpForwardError('SSH jump host TCP forwarding is disabled for this relay in the current app session.')
    }
    const pooledJump = getPooledClient(pooledJumpClients, poolKey)
    if (pooledJump) {
      jumpClient = pooledJump
      jumpClientIsPooled = true
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'proxy-opening',
        authScope: 'jump',
        sshTransport: 'jump',
        connectionReuse: 'reused',
        jumpHost: jumpTarget.host,
        jumpPort: jumpTarget.port,
        jumpUsername: jumpTarget.username,
        targetHost: target.host,
        targetPort: target.port,
        targetUsername: target.username,
        message: `Reusing SSH jump host ${terminalAuthLabel(jumpTarget)}`
      })
      return new Promise<SshTerminalChannel>((resolve, reject) => {
        if (typeof pooledJump.forwardOut !== 'function') {
          jumpForwardUnsupportedKeys.add(poolKey)
          removePooledClient(pooledJumpClients, poolKey, pooledJump)
          reject(new SshJumpForwardError('SSH jump host runtime does not support forwardOut.'))
          return
        }
        pooledJump.forwardOut('127.0.0.1', 0, target.host, target.port, (error, channel) => {
          if (error) {
            jumpForwardUnsupportedKeys.add(poolKey)
            removePooledClient(pooledJumpClients, poolKey, pooledJump)
            try {
              pooledJump.end()
            } catch {}
            reject(new SshJumpForwardError(`SSH jump host forward failed: ${error.message}`))
            return
          }
          jumpStream = channel
          resolve(channel)
        })
      })
    }

    const jump = new ssh2.Client()
    authRuntime.attachKeyboardInteractive(jump, jumpTarget, 'jump')
    const { connectConfig, hasAgentAuth } = createConnectConfig(jumpTarget)
    const jumpProxy = await getProxySocketForAsset()(jumpTarget.asset, getRuntimeConfig().sshProxyConfigs, jumpTarget.host, jumpTarget.port)
    if (jumpProxy) {
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        stage: 'proxy-opening',
        authScope: 'jump',
        sshTransport: 'proxy',
        targetHost: jumpTarget.host,
        targetPort: jumpTarget.port,
        targetUsername: jumpTarget.username,
        proxyName: jumpProxy.config.name,
        message: `Opening SSH proxy ${jumpProxy.config.name} for jump host`
      })
      proxySocket = jumpProxy.socket
      connectConfig.sock = jumpProxy.socket
      delete connectConfig.host
      delete connectConfig.port
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'proxy-opening',
      authScope: 'jump',
      sshTransport: 'jump',
      connectionReuse: 'created',
      jumpHost: jumpTarget.host,
      jumpPort: jumpTarget.port,
      jumpUsername: jumpTarget.username,
      targetHost: target.host,
      targetPort: target.port,
      targetUsername: target.username,
      sshAuthMethods: authMethodsLabel(connectConfig, hasAgentAuth),
      message: `Opening SSH jump host ${terminalAuthLabel(jumpTarget)}`
    })

    return new Promise<SshTerminalChannel>((resolve, reject) => {
      let settled = false
      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        authRuntime.sendActiveKeyboardResult('jump', {
          status: 'failed',
          final: true,
          errorMessage: error.message
        })
        try {
          jump.end()
        } catch {}
        reject(error)
      }
      jump
        .on('ready', () => {
          if (closed) {
            rejectOnce(new Error('SSH session closed before jump host was ready.'))
            return
          }
          authRuntime.sendActiveKeyboardResult('jump', { status: 'success' })
          authRuntime.commitRememberedPassword('jump')
          if (typeof jump.forwardOut !== 'function') {
            jumpForwardUnsupportedKeys.add(poolKey)
            rejectOnce(new SshJumpForwardError('SSH jump host runtime does not support forwardOut.'))
            return
          }
          lifecycle = sendLifecycle(id, sink, {
            ...lifecycleBase,
            stage: 'proxy-opening',
            authScope: 'jump',
            sshTransport: 'jump',
            connectionReuse: 'created',
            jumpHost: jumpTarget.host,
            jumpPort: jumpTarget.port,
            jumpUsername: jumpTarget.username,
            targetHost: target.host,
            targetPort: target.port,
            targetUsername: target.username,
            message: `Opening SSH jump tunnel to ${terminalAuthLabel(target)}`
          })
          jump.forwardOut('127.0.0.1', 0, target.host, target.port, (error, channel) => {
            if (error) {
              jumpForwardUnsupportedKeys.add(poolKey)
              rejectOnce(new SshJumpForwardError(`SSH jump host forward failed: ${error.message}`))
              return
            }
            if (settled) {
              try {
                channel.close?.()
              } catch {}
              return
            }
            settled = true
            rememberPooledClient(pooledJumpClients, poolKey, jump)
            jumpClient = jump
            jumpClientIsPooled = true
            jumpStream = channel
            resolve(channel)
          })
        })
        .on('error', (error) => rejectOnce(new Error(`SSH jump host connection failed: ${error.message}`)))
        .on('close', () => rejectOnce(new Error('SSH jump host connection closed before tunnel was ready.')))
      try {
        jump.connect(connectConfig)
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  const relayShellLifecycleFields = (jumpTarget: SshTerminalTarget) => ({
    sshTransport: 'relay-shell' as const,
    jumpHost: jumpTarget.host,
    jumpPort: jumpTarget.port,
    jumpUsername: jumpTarget.username,
    targetHost: target.host,
    targetPort: target.port,
    targetUsername: target.username
  })

  const openRelayShellFallback = (jumpTarget: SshTerminalTarget, fallbackReason: unknown) => {
    if (closed) return
    relayShellJumpTarget = jumpTarget
    const ptyRuntime = getPtyRuntime()
    const fallbackMessage = fallbackReason instanceof Error ? fallbackReason.message : String(fallbackReason || 'SSH jump host forward failed.')
    if (!ptyRuntime) {
      throw new Error(`SSH jump TCP forwarding failed and relay shell runtime is unavailable. ${fallbackMessage}`)
    }
    cleanupJumpTransport()
    cleanupProxyTransport()

    const relayShell = relayShellCommand(target)
    const lifecycleFields = relayShellLifecycleFields(jumpTarget)
    let remoteHop: TerminalLifecycleEvent['remoteHop'] = 'unknown'
    let endpointConfidence: TerminalLifecycleEvent['endpointConfidence'] = 'unknown'
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...lifecycleFields,
      stage: 'proxy-opening',
      authScope: 'jump',
      connectionReuse: 'created',
      remoteHop,
      endpointConfidence,
      errorCode: 'SSH_JUMP_FORWARD_FAILED',
      errorMessage: fallbackMessage,
      message: 'SSH jump TCP forwarding failed; starting relay shell fallback.'
    })

    const relayDelayedWrites = pendingWrites.splice(0)
    let ptyProcess: SshTerminalPtyProcess | null = null
    const hiddenTextFilter = createHiddenTextFilter((chunk) => sink.data(chunk))
    const writeRelayPty = (data: string) => {
      ptyProcess?.write(data)
    }
    const flushRelayDelayedWrites = () => {
      while (relayDelayedWrites.length) {
        writeRelayPty(String(relayDelayedWrites.shift() || ''))
      }
    }

    const relayEnv = {
      ...getEnv(),
      TERM: terminalType,
      AIOPSTERM_TRANSPORT: 'relay-shell',
      AIOPSTERM_RELAY_HOST: jumpTarget.host,
      AIOPSTERM_TARGET_HOST: target.host
    }
    let bootstrapSent = false
    let bootstrapProbeBuffer = ''
    let targetProbeBuffer = ''
    let targetReadyLogged = false
    let relayConnectionReuse: TerminalLifecycleEvent['connectionReuse'] = 'created'
    const markTargetReady = (endpoint: { actualUsername: string; actualHost: string }) => {
      if (targetReadyLogged || closed) return
      targetReadyLogged = true
      remoteHop = 'target'
      endpointConfidence = 'inferred'
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        ...lifecycleFields,
        stage: 'shell-ready',
        authScope: 'target',
        remoteHop,
        expectedHost: target.host,
        actualHost: cleanText(endpoint.actualHost),
        actualUsername: cleanText(endpoint.actualUsername),
        endpointConfidence,
        message: `SSH target shell inferred via relay ${terminalAuthLabel(target)}`
      })
      flushRelayDelayedWrites()
    }
    const sendBootstrap = () => {
      if (bootstrapSent || closed) return
      bootstrapSent = true
      remoteHop = 'relay'
      endpointConfidence = 'inferred'
      const bootstrapInput = `${relayShell}\n`
      hiddenTextFilter.addHiddenText(bootstrapInput)
      lifecycle = sendLifecycle(id, sink, {
        ...lifecycleBase,
        ...lifecycleFields,
        stage: 'connected',
        authScope: 'jump',
        connectionReuse: relayConnectionReuse,
        remoteHop,
        expectedHost: jumpTarget.host,
        endpointConfidence,
        message: `SSH relay shell connected; starting nested SSH ${terminalAuthLabel(target)}`
      })
      writeRelayPty(bootstrapInput)
    }
    const relayMasterPath = relayControlPath(jumpTarget)
    relayConnectionReuse = pathExists(relayMasterPath) ? 'reused' : 'created'
    const args = relayShellSshArgs(jumpTarget)
    const relayProcess = ptyRuntime.spawn('ssh', args, {
      name: terminalType,
      cols,
      rows,
      cwd: getLocalSshSpawnCwd(),
      env: relayEnv
    })
    ptyProcess = relayProcess
    relayPty = relayProcess
    stream = {
      write(data: string | Buffer) {
        relayProcess.write(typeof data === 'string' ? data : data.toString('utf8'))
      },
      setWindow(nextRows: number, nextCols: number) {
        relayProcess.resize(nextCols, nextRows)
      },
      close() {
        relayProcess.kill()
      }
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      ...lifecycleFields,
      stage: 'connecting',
      authScope: 'jump',
      connectionReuse: relayConnectionReuse,
      remoteHop,
      endpointConfidence,
      message: `Opening reusable SSH relay shell ${terminalAuthLabel(jumpTarget)}`
    })
    relayProcess.onData((chunk) => {
      if (!bootstrapSent) {
        bootstrapProbeBuffer = `${bootstrapProbeBuffer}${chunk}`.slice(-4096)
        if (shouldBootstrapRelayShell(bootstrapProbeBuffer)) sendBootstrap()
      } else if (!targetReadyLogged) {
        targetProbeBuffer = `${targetProbeBuffer}${chunk}`.slice(-8192)
        const endpoint = inferRelayTargetReady(targetProbeBuffer, jumpTarget, target)
        if (endpoint) markTargetReady(endpoint)
      }
      hiddenTextFilter.handle(chunk)
    })
    relayProcess.onExit((event) => {
      hiddenTextFilter.flush()
      if (relayPty === relayProcess) relayPty = null
      if (stream?.close) stream = null
      finish(Number.isFinite(event.exitCode) ? event.exitCode : null, 'process', {
        ...lifecycleFields,
        remoteHop,
        endpointConfidence,
        message: 'SSH relay shell exited.'
      })
    })
  }

  const openTargetTransportAndConnect = async (authClient?: SshTerminalClient | null) => {
    const jumpTarget = resolveJumpHostTarget()
    let tunnel: SshTerminalChannel | null = null
    let proxyConfigForPool: SshProxyConfig | null = null
    if (!jumpTarget) {
      proxyConfigForPool = resolveSshProxyConfigForAsset(target.asset, getRuntimeConfig().sshProxyConfigs)
      if (proxyConfigForPool) {
        targetConnectionTransport = 'proxy'
        targetClientPoolable = true
        targetClientPoolKey = targetPoolKey('proxy', target, { proxy: proxyConfigForPool })
        targetClientAuthenticatedPoolKey = authenticatedTargetPoolKey('proxy', target, { proxy: proxyConfigForPool })
        const pooledTarget = getPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey])
        if (pooledTarget) {
          targetConnectionReuse = 'reused'
          targetClientIsPooled = true
          if (authClient && authClient !== pooledTarget) staleTargetClients.add(authClient)
          client = pooledTarget
          lifecycle = sendLifecycle(id, sink, {
            ...lifecycleBase,
            stage: 'connecting',
            authScope: 'target',
            sshTransport: 'proxy',
            connectionReuse: 'reused',
            proxyName: proxyConfigForPool.name,
            targetHost: target.host,
            targetPort: target.port,
            targetUsername: target.username,
            message: `Reusing SSH target connection ${terminalAuthLabel(target)}`
          })
          openShellOnClient(pooledTarget)
          return
        }
      }
    }
    if (jumpTarget) {
      targetConnectionJump = jumpTarget
      targetConnectionTransport = 'jump'
      targetClientPoolable = true
      targetClientPoolKey = targetPoolKey('jump', target, { jump: jumpTarget })
      targetClientAuthenticatedPoolKey = authenticatedTargetPoolKey('jump', target, { jump: jumpTarget })
      const pooledTarget = getPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey])
      if (pooledTarget) {
        targetConnectionReuse = 'reused'
        targetClientIsPooled = true
        if (authClient && authClient !== pooledTarget) staleTargetClients.add(authClient)
        client = pooledTarget
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'connecting',
          authScope: 'target',
          sshTransport: 'jump',
          connectionReuse: 'reused',
          jumpHost: jumpTarget.host,
          jumpPort: jumpTarget.port,
          jumpUsername: jumpTarget.username,
          targetHost: target.host,
          targetPort: target.port,
          targetUsername: target.username,
          message: `Reusing SSH target connection ${terminalAuthLabel(target)}`
        })
        openShellOnClient(pooledTarget)
        return
      }
    }
    if (jumpTarget) {
      try {
        tunnel = await openJumpHostTunnel(jumpTarget)
      } catch (error) {
        if (error instanceof SshJumpForwardError) {
          if (authClient) {
            staleTargetClients.add(authClient)
            try {
              authClient.end()
            } catch {}
          }
          openRelayShellFallback(jumpTarget, error)
          return
        }
        throw error
      }
    }

    const { connectConfig, hasAgentAuth } = createConnectConfig(target)
    hasConfiguredAgentAuth = hasAgentAuth
    targetConnectionJump = jumpTarget
    targetConnectionTransport = jumpTarget ? 'jump' : 'direct'

    if (jumpTarget) {
      connectConfig.sock = tunnel as ConnectConfig['sock']
      delete connectConfig.host
      delete connectConfig.port
    } else {
      if (proxyConfigForPool) {
        const proxy = await getProxySocketForAsset()(target.asset, getRuntimeConfig().sshProxyConfigs, target.host, target.port)
        if (!proxy) throw new Error(`SSH proxy config "${proxyConfigForPool.name}" did not create a socket.`)
        proxyConfigForPool = proxy.config
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'proxy-opening',
          authScope: 'target',
          sshTransport: 'proxy',
          targetHost: target.host,
          targetPort: target.port,
          targetUsername: target.username,
          proxyName: proxy.config.name,
          message: `Opening SSH proxy ${proxy.config.name}`
        })
        proxySocket = proxy.socket
        connectConfig.sock = proxy.socket
        delete connectConfig.host
        delete connectConfig.port
        targetConnectionTransport = 'proxy'
      }
    }
    targetClientPoolable = true
    const targetPoolTransport = jumpTarget ? 'jump' : proxyConfigForPool ? 'proxy' : 'direct'
    targetClientPoolKey = targetClientPoolable ? targetPoolKey(targetPoolTransport, target, { proxy: proxyConfigForPool, jump: jumpTarget }) : ''
    targetClientAuthenticatedPoolKey = targetClientPoolable ? authenticatedTargetPoolKey(targetPoolTransport, target, { proxy: proxyConfigForPool, jump: jumpTarget }) : ''
    if (targetClientPoolable) {
      const pooledTarget = getPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey])
      if (pooledTarget) {
        targetConnectionReuse = 'reused'
        targetClientIsPooled = true
        if (authClient && authClient !== pooledTarget) staleTargetClients.add(authClient)
        client = pooledTarget
        cleanupJumpTransport()
        cleanupProxyTransport()
        lifecycle = sendLifecycle(id, sink, {
          ...lifecycleBase,
          stage: 'connecting',
          authScope: 'target',
          sshTransport: targetConnectionTransport,
          connectionReuse: 'reused',
          targetHost: target.host,
          targetPort: target.port,
          targetUsername: target.username,
          message: `Reusing SSH target connection ${terminalAuthLabel(target)}`
        })
        openShellOnClient(pooledTarget)
        return
      }
    }
    targetConnectionReuse = 'created'
    targetClientIsPooled = targetClientPoolable
    if (closed) {
      cleanupTransports()
      return
    }
    lifecycle = sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connecting',
      authScope: 'target',
      sshTransport: jumpTarget ? 'jump' : connectConfig.sock ? 'proxy' : 'direct',
      connectionReuse: 'created',
      ...(jumpTarget
        ? {
            jumpHost: jumpTarget.host,
            jumpPort: jumpTarget.port,
            jumpUsername: jumpTarget.username
          }
        : {}),
      targetHost: target.host,
      targetPort: target.port,
      targetUsername: target.username,
      sshAuthMethods: authMethodsLabel(connectConfig, hasAgentAuth),
      message: `Connecting SSH target ${terminalAuthLabel(target)}`
    })
    const activeClient = authClient || createTargetClient()
    client = activeClient
    activeClient.connect(connectConfig)
  }

  const retryTargetPassword = async (failedClient: SshTerminalClient, diagnosticEvent: Partial<Omit<TerminalLifecycleEvent, 'id' | 'kind' | 'stage' | 'at'>>) => {
    if (targetPasswordRetryUsed || closed || !sink.keyboardInteractive) return false
    const authType = cleanText(target.asset?.auth_type).toLowerCase()
    const canRetryRejectedPassword = Boolean(target.password) && diagnosticEvent.errorCode === 'SSH_AUTH_PASSWORD_REJECTED'
    const canPromptMissingPassword =
      !target.password &&
      !target.privateKey &&
      authType !== 'keybased' &&
      (diagnosticEvent.errorCode === 'SSH_AUTH_PASSWORD_REJECTED' ||
        diagnosticEvent.errorCode === 'SSH_AUTH_FAILED' ||
        diagnosticEvent.errorCode === 'SSH_AUTH_METHOD_UNAVAILABLE')
    if (!canRetryRejectedPassword && !canPromptMissingPassword) return false
    targetPasswordRetryUsed = true
    staleTargetClients.add(failedClient)
    sendLifecycle(id, sink, {
      ...lifecycleBase,
      stage: 'connecting',
      errorCode: diagnosticEvent.errorCode,
      errorMessage: diagnosticEvent.errorMessage,
      message: canRetryRejectedPassword ? `SSH password rejected for ${terminalAuthLabel(target)}` : `SSH password required for ${terminalAuthLabel(target)}`
    })
    cleanupTransports()
    try {
      await authRuntime.requestPassword(target, 'target', {
        attempt: canRetryRejectedPassword ? 2 : 1,
        rejected: canRetryRejectedPassword
      })
      if (closed) return true
      try {
        failedClient.end()
      } catch {}
      const nextClient = createTargetClient()
      client = nextClient
      await openTargetTransportAndConnect(nextClient)
      return true
    } catch (error) {
      fail(error, 'SSH connection failed.', 1, diagnosticEvent)
      return true
    }
  }

  const attachTargetClient = (authClient: SshTerminalClient) => {
    authRuntime.attachKeyboardInteractive(authClient, target, 'target')

    authClient
      .on('ready', () => {
        openShellOnClient(authClient)
      })
      .on('error', (error) => {
        if (targetClientPoolable) removePooledClientAliases(pooledTargetClients, authClient)
        if (targetClientIsPooled && authClient === client && stream) return
        const diagnosticEvent = sshConnectionErrorEvent(error)
        authRuntime.sendActiveKeyboardResult('target', {
          status: 'failed',
          final: true,
          errorMessage: diagnosticEvent.errorMessage || (error instanceof Error ? error.message : 'SSH authentication failed.')
        })
        void (async () => {
          if (await retryTargetPassword(authClient, diagnosticEvent)) return
          fail(error, 'SSH connection failed.', 1, diagnosticEvent)
        })()
      })
      .on('close', () => {
        if (targetClientPoolable) removePooledClientAliases(pooledTargetClients, authClient)
        if (
          targetClientIsPooled &&
          authClient === client &&
          (stream || isPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey], authClient))
        )
          return
        if (staleTargetClients.has(authClient) || authClient !== client) return
        finish(null, 'unknown')
      })
      .on('end', () => {
        if (targetClientPoolable) removePooledClientAliases(pooledTargetClients, authClient)
        if (
          targetClientIsPooled &&
          authClient === client &&
          (stream || isPooledClientByKeys(pooledTargetClients, [targetClientPoolKey, targetClientAuthenticatedPoolKey], authClient))
        )
          return
        if (staleTargetClients.has(authClient) || authClient !== client) return
        finish(null, 'unknown')
      })
  }

  const createTargetClient = () => {
    const authClient = new ssh2.Client()
    attachTargetClient(authClient)
    return authClient
  }

  void (async () => {
    try {
      await openTargetTransportAndConnect()
    } catch (error) {
      fail(error, 'SSH connection preparation failed.', 1)
    }
  })()

  return {
    shell: 'ssh',
    cwd,
    session,
    connection: target,
    lifecycle
  }
}
