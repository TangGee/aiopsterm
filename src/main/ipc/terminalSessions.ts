import { createHash } from 'crypto'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { UserConfig } from '@shared/contracts/userConfig'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'
import type { AiopsAssetRecord } from '@shared/contracts/assets'
import type {
  TerminalBinaryWriteResult,
  TerminalCreateOptions,
  TerminalDisconnectReason,
  TerminalKillResult,
  TerminalLifecycleEvent,
  TerminalSshConnectionInfo,
  TerminalWriteResult
} from '@shared/contracts/terminalSessions'
import type { CodexSessionCreateOptions } from '@shared/contracts/codexSessions'
import type { ClineAgentHostTarget } from '@shared/contracts/clineAgent'
import { shouldUseTerminalDebugLogs } from '@shared/runtimeSwitches'

type TerminalRuntimeProcess = {
  write: (data: string | Buffer) => void
  resize: (cols: number, rows: number) => void
  kill: (reason?: TerminalDisconnectReason) => void
  writeBinary?: (buffer: Buffer) => boolean
}

export type TerminalSession = {
  id: string
  process: TerminalRuntimeProcess
  shell: string
  cwd: string
  window: BrowserWindow
  kind: 'local' | 'ssh'
  host?: string
  classicTarget?: ClineAgentHostTarget
}

type LocalTerminalCreateResult = {
  shell: string
  cwd: string
  session: TerminalRuntimeProcess & { writeBinary: (buffer: Buffer) => boolean }
  lifecycle: TerminalLifecycleEvent
  runtimeKind: 'pty' | 'process'
}

type SshTerminalConnectionTarget = {
  host: string
  port: number
  username: string
  title?: string
  asset?: Partial<Pick<AiopsAssetRecord, 'id' | 'name' | 'title' | 'asset_type' | 'organizationId' | 'group_name' | 'auth_type' | 'needProxy' | 'proxyName'>> | null
}

type SshTerminalCreateResult = {
  shell: 'ssh'
  cwd: string
  session: TerminalRuntimeProcess | null
  connection: SshTerminalConnectionTarget
  lifecycle: TerminalLifecycleEvent
}

type TerminalCommandHistoryContext = {
  host?: string
}

type RegisterTerminalSessionsIpcInput = {
  sessions: Map<string, TerminalSession>
  getConfig: () => UserConfig
  defaultTerminalType: unknown
  normalizeTerminalType: (value: unknown, fallback: string) => string
  getOwnerWindow: (event: IpcMainInvokeEvent) => BrowserWindow | null
  createId: () => string
  logRuntimeEvent: (level: RuntimeLogLevel, event: string, details?: Record<string, unknown>) => void
  createSshTerminal: (owner: BrowserWindow, id: string, options: TerminalCreateOptions) => SshTerminalCreateResult
  createLocalTerminal: (owner: BrowserWindow, id: string, options: TerminalCreateOptions) => LocalTerminalCreateResult
  createSshTerminalConnectionInfo: (terminalId: string, target: SshTerminalConnectionTarget, options?: TerminalCreateOptions) => TerminalSshConnectionInfo
  createTerminalWriteResult: (id: string, data: string, exists: boolean) => TerminalWriteResult
  createTerminalBinaryWriteResult: (id: string, bytes: number, exists: boolean) => TerminalBinaryWriteResult
  createTerminalKillResult: (id: string, exists: boolean) => TerminalKillResult
  registerTerminalForCodexBridge: (session: TerminalSession, target?: CodexSessionCreateOptions['target']) => void
  recordTerminalCommandHistory: (command: string, context?: TerminalCommandHistoryContext) => void
  ackTerminalData: (id: string, bytes: number) => void
}

export const terminalHistoryLinesFromWrite = (data: string) => {
  const text = String(data || '')
  if (!/[\r\n]/.test(text)) return []
  const lines = text.split(/[\r\n]+/)
  if (!/[\r\n]$/.test(text)) lines.pop()
  return lines.map((line) => line.trim()).filter(Boolean)
}

const terminalBinaryPayload = (payload: unknown): Buffer => {
  if (payload instanceof ArrayBuffer) return Buffer.from(payload)
  if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  if (Array.isArray(payload)) return Buffer.from(payload)
  return Buffer.alloc(0)
}

const writeTerminal = (session: TerminalSession, data: string) => {
  session.process.write(data)
}

const writeTerminalBinary = (session: TerminalSession, buffer: Buffer) => {
  if (session.kind === 'ssh') {
    session.process.write(buffer)
    return true
  }
  return Boolean(session.process.writeBinary?.(buffer))
}

const resizeTerminal = (session: TerminalSession, cols: number, rows: number) => {
  session.process.resize(cols, rows)
}

const killTerminal = (session: TerminalSession) => {
  session.process.kill('manual')
}

const normalizeTerminalCreateOptions = (inputOptions: TerminalCreateOptions, input: RegisterTerminalSessionsIpcInput): TerminalCreateOptions => {
  const savedConfig = input.getConfig()
  const defaultTerminalType = input.normalizeTerminalType(input.defaultTerminalType, 'xterm-256color')
  const savedTerminalType = input.normalizeTerminalType(savedConfig.terminal?.terminalType, defaultTerminalType)
  return {
    ...inputOptions,
    terminalType: input.normalizeTerminalType(inputOptions.terminalType, savedTerminalType)
  }
}

const cleanTargetText = (value: unknown) => String(value || '').trim()

export const stableClassicSshTargetId = (input: { host: string; port: number; username: string }) => {
  const identity = [cleanTargetText(input.host).toLowerCase(), Math.round(Number(input.port) || 22), cleanTargetText(input.username)].join('\u0000')
  const digest = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 32)
  return `ssh-${digest}`
}

const classicSshTarget = (
  terminalSessionId: string,
  connection: TerminalSshConnectionInfo,
  cwd: string
): ClineAgentHostTarget => ({
  targetId: cleanTargetText(connection.assetId) || stableClassicSshTargetId(connection),
  terminalSessionId,
  label: cleanTargetText(connection.assetName || connection.title) || `${connection.username}@${connection.host}`,
  kind: 'ssh',
  ...(cleanTargetText(cwd) ? { cwd: cleanTargetText(cwd) } : {})
})

const classicLocalTarget = (terminalSessionId: string, cwd: string): ClineAgentHostTarget => ({
  targetId: 'opened-local',
  terminalSessionId,
  label: 'Local terminal',
  kind: 'local',
  ...(cleanTargetText(cwd) ? { cwd: cleanTargetText(cwd) } : {})
})

export const registerTerminalSessionsIpc = (ipcMain: IpcMain, input: RegisterTerminalSessionsIpcInput) => {
  const terminalDebugLogs = shouldUseTerminalDebugLogs()
  const logTerminalDebug = (event: string, details?: Record<string, unknown>) => {
    if (terminalDebugLogs) input.logRuntimeEvent('debug', event, details)
  }

  ipcMain.handle('terminal:create', (event, inputOptions: TerminalCreateOptions = {}) => {
    const options = normalizeTerminalCreateOptions(inputOptions, input)
    const owner = input.getOwnerWindow(event)
    if (!owner) {
      input.logRuntimeEvent('error', 'terminal.create.no-owner', { kind: options.kind || (options.ssh || options.assetId ? 'ssh' : 'local') })
      throw new Error('No owner window for terminal session')
    }

    const id = input.createId()
    const requestedKind = options.kind || (options.ssh || options.assetId ? 'ssh' : 'local')
    input.logRuntimeEvent('info', 'terminal.create.request', {
      id,
      kind: requestedKind,
      cols: options.cols,
      rows: options.rows,
      terminalType: options.terminalType,
      panelId: options.panelId,
      workspaceId: options.workspaceId,
      hasAssetId: Boolean(options.assetId),
      hasSshOptions: Boolean(options.ssh)
    })

    if (options.kind === 'ssh' || options.ssh || options.assetId) {
      const result = input.createSshTerminal(owner, id, options)
      const connection = input.createSshTerminalConnectionInfo(id, result.connection, options)
      const classicTarget = result.session ? classicSshTarget(id, connection, result.cwd) : undefined
      if (result.session) {
        const terminalRecord: TerminalSession = {
          id,
          process: result.session,
          shell: result.shell,
          cwd: result.cwd,
          window: owner,
          kind: 'ssh',
          host: result.connection.host,
          classicTarget
        }
        input.sessions.set(id, terminalRecord)
        input.registerTerminalForCodexBridge(terminalRecord, {
          kind: 'ssh',
          sessionId: id,
          label: connection.assetName || connection.title || `${connection.username}@${connection.host}`,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          ...(connection.assetId ? { assetId: connection.assetId } : {}),
          assetName: connection.assetName,
          cwd: result.cwd
        })
        input.logRuntimeEvent('info', 'terminal.create.ready', {
          id,
          kind: 'ssh',
          shell: result.shell,
          cwd: result.cwd,
          host: result.connection.host,
          username: result.connection.username
        })
      }
      return {
        id,
        shell: result.shell,
        cwd: result.cwd,
        kind: 'ssh' as const,
        ...(classicTarget ? { classicTarget } : {}),
        connection,
        lifecycle: result.lifecycle
      }
    }

    const result = input.createLocalTerminal(owner, id, options)
    const classicTarget = classicLocalTarget(id, result.cwd)
    const terminalRecord: TerminalSession = {
      id,
      process: result.session,
      shell: result.shell,
      cwd: result.cwd,
      window: owner,
      kind: 'local',
      host: 'local',
      classicTarget
    }
    input.sessions.set(id, terminalRecord)
    input.registerTerminalForCodexBridge(terminalRecord, {
      kind: 'local',
      panelId: options.panelId,
      sessionId: id,
      label: 'Local terminal',
      cwd: result.cwd
    })
    input.logRuntimeEvent('info', 'terminal.create.ready', {
      id,
      kind: 'local',
      shell: result.shell,
      cwd: result.cwd,
      runtimeKind: result.runtimeKind
    })

    return { id, shell: result.shell, cwd: result.cwd, kind: 'local' as const, classicTarget, lifecycle: result.lifecycle }
  })

  ipcMain.on('terminal:ack-data', (_event, id: string, bytes: number) => {
    input.ackTerminalData(String(id || ''), Math.max(0, Math.floor(Number(bytes) || 0)))
  })

  ipcMain.handle('terminal:write', (_event, id: string, data: string): TerminalWriteResult => {
    const session = input.sessions.get(id)
    const bytes = Buffer.byteLength(String(data || ''), 'utf8')
    if (!session) {
      input.logRuntimeEvent('warn', 'terminal.write.missing-session', { id, bytes })
      return input.createTerminalWriteResult(id, data, false)
    }
    logTerminalDebug('terminal.write.request', { id, kind: session.kind, bytes })
    writeTerminal(session, data)
    terminalHistoryLinesFromWrite(data).forEach((command) => input.recordTerminalCommandHistory(command, { host: session.host }))
    logTerminalDebug('terminal.write.accepted', { id, kind: session.kind, bytes })
    return input.createTerminalWriteResult(id, data, true)
  })

  ipcMain.handle('terminal:write-binary', (_event, id: string, payload: unknown) => {
    const session = input.sessions.get(id)
    const buffer = terminalBinaryPayload(payload)
    if (!session) return input.createTerminalBinaryWriteResult(id, buffer.byteLength, false)
    if (!buffer.byteLength) {
      return {
        ok: false,
        errorCode: 'TERMINAL_BINARY_EMPTY',
        errorMessage: 'Terminal binary payload is empty.'
      }
    }
    if (!writeTerminalBinary(session, buffer)) {
      return {
        ok: false,
        errorCode: 'TERMINAL_BINARY_UNSUPPORTED',
        errorMessage: 'This terminal runtime does not support binary writes.'
      }
    }
    return input.createTerminalBinaryWriteResult(id, buffer.byteLength, true)
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    const session = input.sessions.get(id)
    if (!session) {
      input.logRuntimeEvent('warn', 'terminal.resize.missing-session', { id, cols, rows })
      return
    }
    logTerminalDebug('terminal.resize', { id, kind: session.kind, cols, rows })
    resizeTerminal(session, cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, id: string): TerminalKillResult => {
    const session = input.sessions.get(id)
    if (!session) {
      input.logRuntimeEvent('warn', 'terminal.kill.missing-session', { id })
      return input.createTerminalKillResult(id, false)
    }
    input.logRuntimeEvent('info', 'terminal.kill.request', { id, kind: session.kind })
    killTerminal(session)
    return input.createTerminalKillResult(id, true)
  })
}
