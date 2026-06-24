import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron'
import {
  appendCodexTerminalBridgeData,
  appendCodexTerminalBridgeDisplayData,
  filterCodexTerminalBridgeDisplayData,
  registerCodexTerminalBridgeSession,
  unregisterCodexTerminalBridgeSession
} from './backend/codex/codexTerminalBridge'
import { logRuntimeEvent } from './backend/app/runtimeLog'
import { createTerminalDataCoalescer, type TerminalDataCoalescerFlush } from './backend/terminal/terminalDataCoalescer'
import { createLocalTerminalSession, type LocalTerminalSession } from './backend/terminal/localTerminal'
import { createTerminalDataLogSummary, type TerminalDataLogSummary } from './backend/terminal/terminalDataLogSummary'
import { createSshTerminalSession, type SshTerminalSession } from './backend/ssh/sshTerminal'
import { getAsset, saveAsset } from './backend/assets/assets'
import { recordTerminalCommandHistory } from './backend/terminal/terminalSuggestions'
import { sendWindowEvent } from '@shared/windowEvents'
import {
  createTerminalDataEvent,
  createTerminalKillResult,
  createTerminalWriteResult
} from './backend/terminal/terminal'
import { terminalHistoryLinesFromWrite, type TerminalSession } from './ipc/terminalSessions'
import type { CodexSessionCreateOptions, CodexSessionLifecycleEvent } from '@shared/contracts/codexSessions'
import type {
  TerminalCreateOptions,
  TerminalKeyboardInteractiveRequest,
  TerminalKeyboardInteractiveResponse,
  TerminalKeyboardInteractiveResult,
  TerminalLifecycleEvent
} from '@shared/contracts/terminalSessions'

type TerminalRuntimeInput = {
  focusWindow: (window?: BrowserWindow) => BrowserWindow | null
}

export const createMainTerminalRuntime = (input: TerminalRuntimeInput) => {
  const sessions = new Map<string, TerminalSession>()
  const terminalDataSummary = createTerminalDataLogSummary()
  const terminalDataCoalescer = createTerminalDataCoalescer({
    onFlush: (flush) => flushTerminalData(flush)
  })

  const chunkBytes = (chunk: string | Buffer) => (Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk || ''), 'utf8'))

  const logDataSummary = (event: string, id: string, summary: TerminalDataLogSummary, reason: string) => {
    logRuntimeEvent('debug', event, {
      id,
      reason,
      chunks: summary.chunks,
      bytes: summary.bytes,
      durationMs: Math.max(0, summary.lastAt - summary.firstAt),
      maxChunkBytes: summary.maxChunkBytes
    })
  }

  const recordDataSummary = (id: string, bytes: number) => {
    const flushed = terminalDataSummary.record(id, bytes)
    if (flushed) logDataSummary('terminal.data.summary', flushed.id, flushed.summary, flushed.reason)
  }

  const flushDataSummary = (id: string, reason: string) => {
    const flushed = terminalDataSummary.flush(id, reason)
    if (flushed) logDataSummary('terminal.data.summary', flushed.id, flushed.summary, flushed.reason)
  }

  const registerTerminalForCodexBridge = (session: TerminalSession, target?: CodexSessionCreateOptions['target']) => {
    registerCodexTerminalBridgeSession({
      id: session.id,
      kind: session.kind,
      host: session.host,
      cwd: session.cwd,
      window: session.window,
      target,
      write: (data) => {
        if (session.kind === 'ssh') {
          ;(session.process as SshTerminalSession).write(data)
        } else {
          ;(session.process as LocalTerminalSession).write(data)
        }
      },
      runBackgroundCommand: (options) => {
        if (session.kind === 'ssh') {
          return (session.process as SshTerminalSession).runBackgroundCommand?.(options) ?? Promise.reject(new Error('SSH terminal does not support background execution.'))
        }
        return (
          (session.process as LocalTerminalSession).runBackgroundCommand?.(options) ??
          Promise.reject(new Error('Local terminal does not support background execution.'))
        )
      }
    })
  }

  const writeTerminalBySessionId = async (id: string, data: string) => {
    const session = sessions.get(id)
    const bytes = Buffer.byteLength(String(data || ''), 'utf8')
    if (!session) {
      logRuntimeEvent('warn', 'control.terminal-write.missing-session', { id, bytes })
      return {
        ok: false,
        errorCode: 'TERMINAL_SESSION_NOT_FOUND',
        errorMessage: `Terminal session not found: ${id}`
      }
    }
    logRuntimeEvent('debug', 'control.terminal-write.request', { id, kind: session.kind, bytes })
    if (session.kind === 'ssh') {
      ;(session.process as SshTerminalSession).write(data)
    } else {
      ;(session.process as LocalTerminalSession).write(data)
    }
    terminalHistoryLinesFromWrite(data).forEach((command) => recordTerminalCommandHistory(command, { host: session.host }))
    return {
      ok: true,
      data: { id, bytes }
    }
  }

  const sendTerminalExit = (owner: BrowserWindow, lifecycle: TerminalLifecycleEvent, code = lifecycle.code ?? null) => {
    sendWindowEvent(owner, 'terminal:exit', {
      id: lifecycle.id,
      code,
      kind: lifecycle.kind,
      reason: lifecycle.reason,
      isNetworkDisconnect: lifecycle.isNetworkDisconnect,
      errorCode: lifecycle.errorCode,
      errorMessage: lifecycle.errorMessage
    })
  }

  const terminalDataPayload = (id: string, chunk: string | Buffer) => {
    return createTerminalDataEvent(id, chunk)
  }

  const flushTerminalData = (flush: TerminalDataCoalescerFlush) => {
    const session = sessions.get(flush.id)
    if (!session) return
    appendCodexTerminalBridgeDisplayData(flush.id, flush.chunk)
    sendWindowEvent(session.window, 'terminal:data', terminalDataPayload(flush.id, flush.chunk))
    if (flush.chunks > 1) {
      logRuntimeEvent('debug', 'terminal.data.coalesced', {
        id: flush.id,
        kind: session.kind,
        chunks: flush.chunks,
        bytes: flush.bytes,
        durationMs: flush.durationMs,
        maxChunkBytes: flush.maxChunkBytes
      })
    }
  }

  const flushTerminalDataForSession = (id: string, reason: string) => {
    terminalDataCoalescer.flush(id, reason)
  }

  const sendTerminalData = (owner: BrowserWindow, id: string, chunk: string | Buffer) => {
    recordDataSummary(id, chunkBytes(chunk))
    const displayChunk = filterCodexTerminalBridgeDisplayData(id, chunk)
    appendCodexTerminalBridgeData(id, chunk)
    if (Buffer.isBuffer(displayChunk) ? displayChunk.byteLength > 0 : displayChunk.length > 0) {
      const session = sessions.get(id)
      if (session?.window !== owner) {
        appendCodexTerminalBridgeDisplayData(id, displayChunk)
        sendWindowEvent(owner, 'terminal:data', terminalDataPayload(id, displayChunk))
        return
      }
      terminalDataCoalescer.push(id, displayChunk)
    }
  }

  const sendCodexExit = (owner: BrowserWindow, lifecycle: CodexSessionLifecycleEvent, code = lifecycle.code ?? null) => {
    sendWindowEvent(owner, 'codex:exit', {
      id: lifecycle.id,
      code,
      errorCode: lifecycle.errorCode,
      errorMessage: lifecycle.errorMessage
    })
  }

  const sendCodexData = (owner: BrowserWindow, id: string, chunk: string | Buffer) => {
    logRuntimeEvent('debug', 'codex.data', {
      id,
      bytes: Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk || ''), 'utf8')
    })
    sendWindowEvent(owner, 'codex:data', createTerminalDataEvent(id, chunk))
  }

  const sanitizeKeyboardInteractiveResponses = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return value.map((item) => String(item ?? '')).slice(0, 8)
  }

  const sanitizeKeyboardInteractiveResponse = (value: unknown): TerminalKeyboardInteractiveResponse => {
    if (Array.isArray(value)) return { responses: sanitizeKeyboardInteractiveResponses(value) }
    if (typeof value === 'object' && value) {
      const record = value as Record<string, unknown>
      return {
        responses: sanitizeKeyboardInteractiveResponses(record.responses),
        ...(record.rememberPassword === true ? { rememberPassword: true } : {})
      }
    }
    return { responses: [] }
  }

  const rememberTerminalPassword = (assetId: string, password: string) => {
    if (!password) return
    const asset = getAsset(assetId)
    if (!asset || asset.isLocalShell) return
    const result = saveAsset({
      ...asset,
      id: asset.id,
      name: asset.name,
      title: asset.title,
      host: asset.host,
      ip: asset.ip,
      group: asset.group,
      group_name: asset.group_name,
      username: asset.username,
      port: asset.port,
      asset_type: asset.asset_type,
      auth_type: asset.auth_type,
      password
    })
    logRuntimeEvent(result.ok ? 'info' : 'warn', 'terminal.password.remember', {
      assetId,
      host: asset.host,
      port: asset.port,
      username: asset.username,
      ok: result.ok,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage
    })
  }

  const sendTerminalKeyboardInteractiveResult = (owner: BrowserWindow, result: TerminalKeyboardInteractiveResult) => {
    logRuntimeEvent(result.status === 'success' ? 'info' : 'warn', 'terminal.keyboard-interactive.result', {
      id: result.id,
      status: result.status,
      authScope: result.authScope,
      attempts: result.attempts,
      final: result.final,
      errorMessage: result.errorMessage
    })
    sendWindowEvent(owner, 'terminal:keyboard-interactive:result', result)
  }

  const requestTerminalKeyboardInteractive = (owner: BrowserWindow, request: TerminalKeyboardInteractiveRequest) =>
    new Promise<TerminalKeyboardInteractiveResponse>((resolve, reject) => {
      let settled = false
      const responseChannel = `terminal:keyboard-interactive:response:${request.id}`
      const cancelChannel = `terminal:keyboard-interactive:cancel:${request.id}`
      const cleanup = () => {
        ipcMain.off(responseChannel, handleResponse)
        ipcMain.off(cancelChannel, handleCancel)
        clearTimeout(timer)
      }
      const settle = (callback: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }
      const handleResponse = (event: IpcMainEvent, payload: unknown) => {
        if (event.sender !== owner.webContents) return
        settle(() => resolve(sanitizeKeyboardInteractiveResponse(payload)))
      }
      const handleCancel = (event: IpcMainEvent) => {
        if (event.sender !== owner.webContents) return
        settle(() => reject(new Error('Two-factor authentication canceled by user.')))
      }
      const timer = setTimeout(() => {
        sendTerminalKeyboardInteractiveResult(owner, {
          id: request.id,
          status: 'timeout',
          attempts: request.attempts,
          final: true,
          errorMessage: 'Two-factor authentication timed out.'
        })
        settle(() => reject(new Error('Two-factor authentication timed out.')))
      }, request.timeoutMs)

      ipcMain.on(responseChannel, handleResponse)
      ipcMain.on(cancelChannel, handleCancel)
      logRuntimeEvent('info', 'terminal.keyboard-interactive.request', {
        id: request.id,
        connectionId: request.connectionId,
        host: request.host,
        port: request.port,
        username: request.username,
        purpose: request.purpose,
        authScope: request.authScope,
        assetId: request.assetId,
        title: request.title,
        name: request.name,
        hasInstructions: Boolean(request.instructions),
        canRememberPassword: request.canRememberPassword,
        promptLabels: request.prompts.map((prompt) => prompt.prompt.slice(0, 120)),
        prompts: request.prompts.length,
        attempts: request.attempts,
        maxAttempts: request.maxAttempts
      })
      sendWindowEvent(owner, 'terminal:keyboard-interactive:request', request)
    })

  const createSshTerminal = (owner: BrowserWindow, id: string, options: TerminalCreateOptions) => {
    return createSshTerminalSession(id, options, {
      lifecycle: (event) => {
        logRuntimeEvent(event.stage === 'error' ? 'error' : 'info', 'terminal.lifecycle', {
          id: event.id,
          kind: event.kind,
          stage: event.stage,
          reason: event.reason,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage,
          message: event.message,
          host: event.host,
          port: event.port,
          username: event.username,
          targetHost: event.targetHost,
          targetPort: event.targetPort,
          targetUsername: event.targetUsername,
          jumpHost: event.jumpHost,
          jumpPort: event.jumpPort,
          jumpUsername: event.jumpUsername,
          authScope: event.authScope,
          authPurpose: event.authPurpose,
          sshTransport: event.sshTransport,
          sshAuthMethods: event.sshAuthMethods,
          connectionReuse: event.connectionReuse,
          remoteHop: event.remoteHop,
          expectedHost: event.expectedHost,
          actualHost: event.actualHost,
          actualUsername: event.actualUsername,
          endpointConfidence: event.endpointConfidence,
          proxyName: event.proxyName
        })
        sendWindowEvent(owner, 'terminal:lifecycle', event)
      },
      exit: (event, code) => {
        flushTerminalDataForSession(event.id, 'terminal-exit')
        logRuntimeEvent('info', 'terminal.exit', {
          id: event.id,
          kind: event.kind,
          code: code ?? event.code ?? null,
          reason: event.reason,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage
        })
        sendTerminalExit(owner, event, code ?? event.code ?? null)
      },
      data: (chunk) => sendTerminalData(owner, id, chunk),
      keyboardInteractive: (request) => requestTerminalKeyboardInteractive(owner, request),
      keyboardInteractiveResult: (result) => sendTerminalKeyboardInteractiveResult(owner, result),
      closed: () => {
        flushTerminalDataForSession(id, 'session-closed')
        flushDataSummary(id, 'session-closed')
        unregisterCodexTerminalBridgeSession(id)
        sessions.delete(id)
        logRuntimeEvent('info', 'terminal.session-removed', { id, kind: 'ssh' })
      }
    })
  }

  const createLocalTerminal = (owner: BrowserWindow, id: string, options: TerminalCreateOptions) =>
    createLocalTerminalSession(id, options, {
      lifecycle: (event) => {
        logRuntimeEvent(event.stage === 'error' ? 'error' : 'info', 'terminal.lifecycle', {
          id: event.id,
          kind: event.kind,
          stage: event.stage,
          shell: event.shell,
          cwd: event.cwd,
          reason: event.reason,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage
        })
        sendWindowEvent(owner, 'terminal:lifecycle', event)
      },
      exit: (event, code) => {
        flushTerminalDataForSession(event.id, 'terminal-exit')
        logRuntimeEvent('info', 'terminal.exit', {
          id: event.id,
          kind: event.kind,
          code: code ?? event.code ?? null,
          reason: event.reason,
          errorCode: event.errorCode,
          errorMessage: event.errorMessage
        })
        sendTerminalExit(owner, event, code ?? event.code ?? null)
      },
      data: (chunk) => sendTerminalData(owner, id, chunk),
      closed: () => {
        flushTerminalDataForSession(id, 'session-closed')
        flushDataSummary(id, 'session-closed')
        unregisterCodexTerminalBridgeSession(id)
        sessions.delete(id)
        logRuntimeEvent('info', 'terminal.session-removed', { id, kind: 'local' })
      }
    })

  const killAllSessions = () => {
    sessions.forEach((session) => {
      flushTerminalDataForSession(session.id, 'kill-all')
      flushDataSummary(session.id, 'kill-all')
      if (session.kind === 'ssh') {
        ;(session.process as SshTerminalSession).kill()
      } else {
        ;(session.process as LocalTerminalSession).kill()
      }
    })
    sessions.clear()
  }

  return {
    sessions,
    registerTerminalForCodexBridge,
    writeTerminalBySessionId,
    rememberTerminalPassword,
    createSshTerminal,
    createLocalTerminal,
    sendCodexExit,
    sendCodexData,
    killAllSessions,
    createTerminalWriteResult,
    createTerminalKillResult,
    focusWindow: input.focusWindow
  }
}
