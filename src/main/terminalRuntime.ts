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
import {
  acknowledgeTerminalFlow,
  createTerminalFlowState,
  resetTerminalFlowAfterSafetyResume,
  terminalFlowMaximumBudgetBytes,
  trackTerminalFlowSend as trackTerminalFlowSendState,
  type TerminalFlowState
} from './backend/terminal/terminalFlowControl'
import { createLocalTerminalSession, type LocalTerminalSession } from './backend/terminal/localTerminal'
import { createTerminalDataLogSummary, type TerminalDataLogSummary } from './backend/terminal/terminalDataLogSummary'
import { createSshTerminalSession, type SshTerminalSession } from './backend/ssh/sshTerminal'
import { getAsset, saveAsset } from './backend/assets/assets'
import { recordTerminalCommandHistory } from './backend/terminal/terminalSuggestions'
import { sendWindowEvent } from '@shared/windowEvents'
import { shouldUseTerminalDebugLogs } from '@shared/runtimeSwitches'
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
  const terminalDebugLogs = shouldUseTerminalDebugLogs()
  const terminalDataSummary = createTerminalDataLogSummary(
    terminalDebugLogs
      ? { intervalMs: 1000, chunkThreshold: 50, byteThreshold: 1024 * 1024 }
      : { intervalMs: 10_000, chunkThreshold: 1000, byteThreshold: 8 * 1024 * 1024 }
  )
  const codexDataSummary = createTerminalDataLogSummary(
    terminalDebugLogs
      ? { intervalMs: 1000, chunkThreshold: 50, byteThreshold: 1024 * 1024 }
      : { intervalMs: 10_000, chunkThreshold: 1000, byteThreshold: 8 * 1024 * 1024 }
  )
  const terminalDataCoalescer = createTerminalDataCoalescer({
    onFlush: (flush) => flushTerminalData(flush)
  })
  const codexDataOwners = new Map<string, BrowserWindow>()
  const keyboardInteractiveOwners = new Map<string, BrowserWindow>()
  const keyboardInteractivePending = new Map<string, { dismiss: (message?: string) => void }>()
  const codexDataCoalescer = createTerminalDataCoalescer({
    onFlush: (flush) => flushCodexData(flush)
  })

  const chunkBytes = (chunk: string | Buffer) => (Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk || ''), 'utf8'))
  const shouldLogCoalescedTerminalData = (flush: TerminalDataCoalescerFlush) =>
    terminalDebugLogs ? flush.chunks > 1 : flush.chunks >= 100 || flush.bytes >= 1024 * 1024

  const logDataSummary = (event: string, id: string, summary: TerminalDataLogSummary, reason: string) => {
    if (!terminalDebugLogs) return
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

  const recordCodexDataSummary = (id: string, bytes: number) => {
    const flushed = codexDataSummary.record(id, bytes)
    if (flushed) logDataSummary('codex.data.summary', flushed.id, flushed.summary, flushed.reason)
  }

  const flushCodexDataSummary = (id: string, reason: string) => {
    const flushed = codexDataSummary.flush(id, reason)
    if (flushed) logDataSummary('codex.data.summary', flushed.id, flushed.summary, flushed.reason)
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
    if (terminalDebugLogs) logRuntimeEvent('debug', 'control.terminal-write.request', { id, kind: session.kind, bytes })
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

  // 输出链路背压:主进程按渲染端实际消费速度调整读取预算。
  // pty 和 SSH 共用同一套预算,字节计量双方统一用 data 字符串的 UTF-8 长度。
  const terminalFlowPauseSafetyMs = 15_000
  type RuntimeTerminalFlowState = TerminalFlowState & {
    safetyTimer: NodeJS.Timeout | null
  }
  const terminalFlows = new Map<string, RuntimeTerminalFlowState>()

  const setTerminalSourcePaused = (id: string, paused: boolean) => {
    const session = sessions.get(id)
    if (!session) return
    const process = session.process as { pause?: () => void; resume?: () => void }
    try {
      if (paused) process.pause?.()
      else process.resume?.()
    } catch {}
  }

  const clearTerminalFlowSafetyTimer = (flow: RuntimeTerminalFlowState) => {
    if (!flow.safetyTimer) return
    clearTimeout(flow.safetyTimer)
    flow.safetyTimer = null
  }

  const releaseTerminalFlow = (id: string) => {
    const flow = terminalFlows.get(id)
    if (!flow) return
    clearTerminalFlowSafetyTimer(flow)
    terminalFlows.delete(id)
  }

  // 暂停后数据源不再产生 send,ack 又可能因渲染端崩溃/重载永久丢失,
  // 所以安全恢复必须是真实定时器,不能依赖下一次 send 时的内联检查。
  const forceResumeTerminalFlow = (id: string) => {
    const flow = terminalFlows.get(id)
    if (!flow) return
    flow.safetyTimer = null
    if (!flow.paused) return
    const pausedMs = flow.pausedAt ? Math.max(0, Date.now() - flow.pausedAt) : 0
    const unacked = flow.unacked
    const budgetBytes = flow.budgetBytes
    resetTerminalFlowAfterSafetyResume(flow)
    if (!sessions.has(id)) {
      terminalFlows.delete(id)
      return
    }
    setTerminalSourcePaused(id, false)
    logRuntimeEvent('warn', 'terminal.flow.safety-resume', {
      id,
      pausedMs,
      unacked,
      budgetBytes,
      resetBudgetBytes: flow.budgetBytes,
      sentBytes: flow.sentBytes,
      ackedBytes: flow.ackedBytes,
      pauseCount: flow.pauseCount
    })
  }

  const trackTerminalFlowSend = (id: string, bytes: number) => {
    if (!id || bytes <= 0) return
    const flow = terminalFlows.get(id) || { ...createTerminalFlowState(), safetyTimer: null }
    terminalFlows.set(id, flow)
    if (trackTerminalFlowSendState(flow, bytes, Date.now())) {
      setTerminalSourcePaused(id, true)
      clearTerminalFlowSafetyTimer(flow)
      flow.safetyTimer = setTimeout(() => forceResumeTerminalFlow(id), terminalFlowPauseSafetyMs)
      flow.safetyTimer.unref?.()
      logRuntimeEvent('info', 'terminal.flow.paused', {
        id,
        unacked: flow.unacked,
        budgetBytes: flow.budgetBytes,
        maximumBudgetBytes: terminalFlowMaximumBudgetBytes,
        sentBytes: flow.sentBytes,
        ackedBytes: flow.ackedBytes,
        pauseCount: flow.pauseCount
      })
    }
  }

  const ackTerminalData = (id: string, bytes: number) => {
    const flow = terminalFlows.get(id)
    if (!flow) return
    const pausedAt = flow.pausedAt
    const acknowledgement = acknowledgeTerminalFlow(flow, bytes, Date.now())
    if (acknowledgement.shouldResume) {
      const pausedMs = pausedAt ? Math.max(0, Date.now() - pausedAt) : 0
      clearTerminalFlowSafetyTimer(flow)
      setTerminalSourcePaused(id, false)
      logRuntimeEvent('info', 'terminal.flow.resumed', {
        id,
        pausedMs,
        unacked: flow.unacked,
        epochBytes: acknowledgement.epochBytes,
        epochDurationMs: acknowledgement.epochDurationMs,
        previousBudgetBytes: acknowledgement.previousBudgetBytes,
        budgetBytes: acknowledgement.budgetBytes,
        sentBytes: flow.sentBytes,
        ackedBytes: flow.ackedBytes,
        pauseCount: flow.pauseCount
      })
    }
  }

  const terminalDataPayload = (id: string, chunk: string | Buffer) => {
    return createTerminalDataEvent(id, chunk, { includeRaw: true })
  }

  const flushTerminalData = (flush: TerminalDataCoalescerFlush) => {
    const session = sessions.get(flush.id)
    if (!session) return
    appendCodexTerminalBridgeDisplayData(flush.id, flush.chunk)
    const payload = terminalDataPayload(flush.id, flush.chunk)
    // 投递失败(窗口已销毁)时不计入未确认字节,避免给不到 ack 的数据触发暂停。
    const delivered = sendWindowEvent(session.window, 'terminal:data', payload)
    if (delivered) trackTerminalFlowSend(flush.id, Buffer.byteLength(payload.data, 'utf8'))
    if (terminalDebugLogs && shouldLogCoalescedTerminalData(flush)) {
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

  const flushCodexDataForSession = (id: string, reason: string) => {
    codexDataCoalescer.flush(id, reason)
  }

  const sendTerminalData = (owner: BrowserWindow, id: string, chunk: string | Buffer) => {
    recordDataSummary(id, chunkBytes(chunk))
    const displayChunk = filterCodexTerminalBridgeDisplayData(id, chunk)
    appendCodexTerminalBridgeData(id, chunk)
    if (Buffer.isBuffer(displayChunk) ? displayChunk.byteLength > 0 : displayChunk.length > 0) {
      const session = sessions.get(id)
      if (session?.window !== owner) {
        appendCodexTerminalBridgeDisplayData(id, displayChunk)
        const payload = terminalDataPayload(id, displayChunk)
        const delivered = sendWindowEvent(owner, 'terminal:data', payload)
        if (delivered) trackTerminalFlowSend(id, Buffer.byteLength(payload.data, 'utf8'))
        return
      }
      terminalDataCoalescer.push(id, displayChunk)
    }
  }

  const sendCodexExit = (owner: BrowserWindow, lifecycle: CodexSessionLifecycleEvent, code = lifecycle.code ?? null) => {
    flushCodexDataForSession(lifecycle.id, 'codex-exit')
    flushCodexDataSummary(lifecycle.id, 'codex-exit')
    sendWindowEvent(owner, 'codex:exit', {
      id: lifecycle.id,
      code,
      errorCode: lifecycle.errorCode,
      errorMessage: lifecycle.errorMessage
    })
    codexDataOwners.delete(lifecycle.id)
  }

  const flushCodexData = (flush: TerminalDataCoalescerFlush) => {
    const owner = codexDataOwners.get(flush.id)
    if (!owner || owner.isDestroyed()) return
    sendWindowEvent(owner, 'codex:data', createTerminalDataEvent(flush.id, flush.chunk))
    if (terminalDebugLogs && shouldLogCoalescedTerminalData(flush)) {
      logRuntimeEvent('debug', 'codex.data.coalesced', {
        id: flush.id,
        chunks: flush.chunks,
        bytes: flush.bytes,
        durationMs: flush.durationMs,
        maxChunkBytes: flush.maxChunkBytes
      })
    }
  }

  const sendCodexData = (owner: BrowserWindow, id: string, chunk: string | Buffer) => {
    recordCodexDataSummary(id, chunkBytes(chunk))
    codexDataOwners.set(id, owner)
    codexDataCoalescer.push(id, chunk)
  }

  const closeCodexDataSession = (id: string, reason = 'codex-session-closed') => {
    flushCodexDataForSession(id, reason)
    flushCodexDataSummary(id, reason)
    codexDataOwners.delete(id)
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
    if (result.status === 'success' || result.final) keyboardInteractiveOwners.delete(result.id)
  }

  const requestTerminalKeyboardInteractive = (owner: BrowserWindow, request: TerminalKeyboardInteractiveRequest) =>
    new Promise<TerminalKeyboardInteractiveResponse>((resolve, reject) => {
      let settled = false
      keyboardInteractiveOwners.set(request.id, owner)
      const responseChannel = `terminal:keyboard-interactive:response:${request.id}`
      const cancelChannel = `terminal:keyboard-interactive:cancel:${request.id}`
      const cleanup = () => {
        ipcMain.off(responseChannel, handleResponse)
        ipcMain.off(cancelChannel, handleCancel)
        keyboardInteractivePending.delete(request.id)
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
      keyboardInteractivePending.set(request.id, {
        dismiss: (message = 'SSH authentication prompt was closed.') => {
          settle(() => reject(new Error(message)))
        }
      })
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

  const resolveKeyboardInteractiveOwner = (requestId?: string) => {
    const existing = requestId ? keyboardInteractiveOwners.get(requestId) : null
    if (existing) return existing
    const focused = BrowserWindow.getFocusedWindow()
    return input.focusWindow(focused || undefined) || BrowserWindow.getAllWindows()[0] || null
  }

  const requestKeyboardInteractiveFromFocusedWindow = (request: TerminalKeyboardInteractiveRequest) => {
    const owner = resolveKeyboardInteractiveOwner(request.id)
    if (!owner) return Promise.reject(new Error('No aiopsterm window is available for SSH authentication.'))
    input.focusWindow(owner)
    return requestTerminalKeyboardInteractive(owner, request)
  }

  const focusKeyboardInteractiveRequest = (request: TerminalKeyboardInteractiveRequest) => {
    const owner = resolveKeyboardInteractiveOwner(request.id)
    if (!owner) return false
    input.focusWindow(owner)
    keyboardInteractiveOwners.set(request.id, owner)
    sendWindowEvent(owner, 'terminal:keyboard-interactive:request', request)
    return true
  }

  const sendKeyboardInteractiveResult = (result: TerminalKeyboardInteractiveResult) => {
    const owner = resolveKeyboardInteractiveOwner(result.id)
    if (!owner) return
    sendTerminalKeyboardInteractiveResult(owner, result)
  }

  const dismissKeyboardInteractiveRequest = (id: string, message?: string) => {
    keyboardInteractivePending.get(id)?.dismiss(message)
  }

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
        releaseTerminalFlow(id)
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
        releaseTerminalFlow(id)
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
    requestKeyboardInteractiveFromFocusedWindow,
    focusKeyboardInteractiveRequest,
    sendKeyboardInteractiveResult,
    dismissKeyboardInteractiveRequest,
    createSshTerminal,
    createLocalTerminal,
    sendCodexExit,
    sendCodexData,
    closeCodexDataSession,
    killAllSessions,
    createTerminalWriteResult,
    createTerminalKillResult,
    ackTerminalData,
    focusWindow: input.focusWindow
  }
}
