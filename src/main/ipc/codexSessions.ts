import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type {
  CodexSessionCreateOptions,
  CodexSessionInfo,
  CodexSessionKillResult,
  CodexSessionLifecycleEvent,
  CodexSessionPendingContextResult,
  CodexSessionTargetContext,
  CodexSessionTargetUpdateResult,
  CodexSessionWriteResult,
  RuntimeLogLevel
} from '@shared/preload'

type CodexTerminalBridgeTargetUpdateResult = {
  sessionId?: string
  target?: CodexSessionTargetContext
  registered: boolean
}

type CodexSessionEventSink = {
  lifecycle: (event: CodexSessionLifecycleEvent) => void
  exit: (event: CodexSessionLifecycleEvent, code?: number | null) => void
  data: (id: string, chunk: string | Buffer) => void
  closed?: (id: string) => void
}

type RegisterCodexSessionsIpcInput = {
  getOwnerWindow: (event: IpcMainInvokeEvent) => BrowserWindow | null
  createId: () => string
  getUserDataPath: () => string
  logRuntimeEvent: (level: RuntimeLogLevel, event: string, details?: Record<string, unknown>) => void
  ensureCodexTerminalBridgeServer: (userDataPath: string) => Promise<unknown>
  updateCodexTerminalBridgeSessionTarget: (target?: CodexSessionTargetContext | null) => CodexTerminalBridgeTargetUpdateResult
  createCodexSession: (id: string, options: CodexSessionCreateOptions, sink: CodexSessionEventSink) => Promise<CodexSessionInfo>
  setCodexSessionPendingContext: (id: string, text?: string) => Promise<CodexSessionPendingContextResult>
  writeCodexSession: (id: string, data: string) => CodexSessionWriteResult
  resizeCodexSession: (id: string, cols: number, rows: number) => boolean
  killCodexSession: (id: string) => CodexSessionKillResult
  sendCodexLifecycle: (owner: BrowserWindow, lifecycle: CodexSessionLifecycleEvent) => void
  sendCodexExit: (owner: BrowserWindow, lifecycle: CodexSessionLifecycleEvent, code?: number | null) => void
  sendCodexData: (owner: BrowserWindow, id: string, chunk: string | Buffer) => void
}

const normalizeCodexTargetContext = (target: CodexSessionTargetContext | null | undefined) => {
  return target && typeof target === 'object' && !Array.isArray(target) ? target : undefined
}

const logTargetUpdate = (
  input: RegisterCodexSessionsIpcInput,
  event: string,
  missingEvent: string,
  result: CodexTerminalBridgeTargetUpdateResult,
  target?: CodexSessionTargetContext,
  details: Record<string, unknown> = {}
) => {
  input.logRuntimeEvent(result.registered ? 'info' : 'warn', result.registered ? event : missingEvent, {
    ...details,
    sessionId: result.sessionId || target?.sessionId,
    targetKind: result.target?.kind || target?.kind,
    targetLabel: result.target?.label || target?.label,
    registered: result.registered
  })
}

export const registerCodexSessionsIpc = (ipcMain: IpcMain, input: RegisterCodexSessionsIpcInput) => {
  ipcMain.handle('codex:create', async (event, options: CodexSessionCreateOptions = {}) => {
    const owner = input.getOwnerWindow(event)
    if (!owner) {
      input.logRuntimeEvent('error', 'codex.create.no-owner')
      throw new Error('No owner window for Codex session')
    }
    const id = input.createId()
    input.logRuntimeEvent('info', 'codex.create.request', {
      id,
      cols: options.cols,
      rows: options.rows,
      targetSessionId: options.target?.sessionId,
      targetKind: options.target?.kind,
      targetLabel: options.target?.label
    })
    try {
      await input.ensureCodexTerminalBridgeServer(input.getUserDataPath())
      const targetUpdate = input.updateCodexTerminalBridgeSessionTarget(options.target)
      logTargetUpdate(input, 'codex.target.initialized', 'codex.target.initial-missing', targetUpdate, options.target, { id })
      const session = await input.createCodexSession(id, options, {
        lifecycle: (lifecycle) => {
          input.logRuntimeEvent(lifecycle.stage === 'error' ? 'error' : 'info', 'codex.lifecycle', {
            id: lifecycle.id,
            stage: lifecycle.stage,
            binaryPath: lifecycle.binaryPath,
            codexHome: lifecycle.codexHome,
            cwd: lifecycle.cwd,
            runtimeKind: lifecycle.runtimeKind,
            code: lifecycle.code,
            errorCode: lifecycle.errorCode,
            errorMessage: lifecycle.errorMessage
          })
          input.sendCodexLifecycle(owner, lifecycle)
        },
        exit: (lifecycle, code) => {
          input.logRuntimeEvent('info', 'codex.exit', {
            id: lifecycle.id,
            code: code ?? lifecycle.code ?? null,
            errorCode: lifecycle.errorCode,
            errorMessage: lifecycle.errorMessage
          })
          input.sendCodexExit(owner, lifecycle, code ?? lifecycle.code ?? null)
        },
        data: (sessionId, chunk) => input.sendCodexData(owner, sessionId, chunk),
        closed: (sessionId) => {
          input.logRuntimeEvent('info', 'codex.session-removed', { id: sessionId })
        }
      })
      input.logRuntimeEvent('info', 'codex.create.ready', {
        id,
        binaryPath: session.binaryPath,
        codexHome: session.codexHome,
        cwd: session.cwd,
        runtimeKind: session.runtimeKind
      })
      return session
    } catch (error) {
      input.logRuntimeEvent('error', 'codex.create.failed', {
        id,
        error
      })
      throw error
    }
  })

  ipcMain.handle('codex:set-target', (_event, target: CodexSessionTargetContext | null | undefined): CodexSessionTargetUpdateResult => {
    const targetContext = normalizeCodexTargetContext(target)
    const result = input.updateCodexTerminalBridgeSessionTarget(targetContext)
    logTargetUpdate(input, 'codex.target.updated', 'codex.target.unavailable', result, targetContext)
    return { ok: true, data: result }
  })

  ipcMain.handle('codex:set-pending-context', async (_event, id: string, text?: string) => {
    const result = await input.setCodexSessionPendingContext(String(id || ''), text)
    input.logRuntimeEvent(result.ok ? 'debug' : 'warn', result.ok ? 'codex.pending-context.updated' : 'codex.pending-context.rejected', {
      id,
      bytes: result.data?.bytes,
      cleared: result.data?.cleared,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage
    })
    return result
  })

  ipcMain.handle('codex:write', (_event, id: string, data: string) => {
    const bytes = Buffer.byteLength(String(data || ''), 'utf8')
    input.logRuntimeEvent('debug', 'codex.write.request', { id, bytes })
    const result = input.writeCodexSession(id, data)
    input.logRuntimeEvent(result.ok ? 'debug' : 'warn', result.ok ? 'codex.write.accepted' : 'codex.write.rejected', {
      id,
      bytes,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage
    })
    return result
  })

  ipcMain.handle('codex:resize', (_event, id: string, cols: number, rows: number) => {
    const resized = input.resizeCodexSession(id, cols, rows)
    input.logRuntimeEvent(resized ? 'debug' : 'warn', resized ? 'codex.resize' : 'codex.resize.missing-session', { id, cols, rows })
  })

  ipcMain.handle('codex:kill', (_event, id: string) => {
    input.logRuntimeEvent('info', 'codex.kill.request', { id })
    const result = input.killCodexSession(id)
    if (!result.ok) {
      input.logRuntimeEvent('warn', 'codex.kill.rejected', { id, errorCode: result.errorCode, errorMessage: result.errorMessage })
    }
    return result
  })
}
