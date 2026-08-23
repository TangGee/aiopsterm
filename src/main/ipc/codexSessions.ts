import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type {
  CodexSessionCreateOptions,
  CodexSessionInfo,
  CodexSessionKillResult,
  CodexSessionLifecycleEvent,
  CodexSessionPendingContextResult,
  CodexSessionThreadEvent,
  CodexSessionTargetContext,
  CodexSessionTargetUpdateResult,
  CodexSessionWriteResult
} from '@shared/contracts/codexSessions'
import type { RuntimeLogLevel } from '@shared/contracts/appRuntime'
import { shouldUseTerminalDebugLogs } from '@shared/runtimeSwitches'
import type { ProductSessionNativeBindingResult } from '../backend/agent/productSessionBindingLifecycle'

type CodexTerminalBridgeTargetUpdateResult = {
  sessionId?: string
  target?: CodexSessionTargetContext
  registered: boolean
}

type CodexSessionEventSink = {
  lifecycle: (event: CodexSessionLifecycleEvent) => void
  exit: (event: CodexSessionLifecycleEvent, code?: number | null) => void
  data: (id: string, chunk: string | Buffer) => void
  thread?: (event: CodexSessionThreadEvent) => Promise<void> | void
  closed?: (id: string) => void
}

type RegisterCodexSessionsIpcInput = {
  getOwnerWindow: (event: IpcMainInvokeEvent) => BrowserWindow | null
  createId: () => string
  getUserDataPath: () => string
  logRuntimeEvent: (level: RuntimeLogLevel, event: string, details?: Record<string, unknown>) => void
  ensureCodexTerminalBridgeServer: (userDataPath: string) => Promise<unknown>
  updateCodexTerminalBridgeSessionTarget: (runtimeId: string, target?: CodexSessionTargetContext | null) => CodexTerminalBridgeTargetUpdateResult
  clearCodexTerminalBridgeSessionTarget?: (runtimeId: string) => void
  createCodexSession: (id: string, options: CodexSessionCreateOptions, sink: CodexSessionEventSink) => Promise<CodexSessionInfo>
  prepareCodexSessionLaunch?: (options: CodexSessionCreateOptions) => Promise<{
    options: CodexSessionCreateOptions
    recoveredFromThreadId?: string
  }>
  setCodexSessionPendingContext: (id: string, text?: string) => Promise<CodexSessionPendingContextResult>
  writeCodexSession: (id: string, data: string) => CodexSessionWriteResult
  resizeCodexSession: (id: string, cols: number, rows: number) => boolean
  killCodexSession: (id: string) => CodexSessionKillResult
  sendCodexLifecycle: (owner: BrowserWindow, lifecycle: CodexSessionLifecycleEvent) => void
  sendCodexExit: (owner: BrowserWindow, lifecycle: CodexSessionLifecycleEvent, code?: number | null) => void
  sendCodexData: (owner: BrowserWindow, id: string, chunk: string | Buffer) => void
  sendCodexThread: (owner: BrowserWindow, event: CodexSessionThreadEvent) => void
  bindCodexThread?: (
    productSessionId: string,
    event: CodexSessionThreadEvent,
    options: CodexSessionCreateOptions
  ) => Promise<ProductSessionNativeBindingResult> | ProductSessionNativeBindingResult
  closeCodexDataSession?: (id: string, reason?: string) => void
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
  input.logRuntimeEvent(result.registered ? 'debug' : 'warn', result.registered ? event : missingEvent, {
    ...details,
    sessionId: result.sessionId || target?.sessionId,
    targetKind: result.target?.kind || target?.kind,
    targetLabel: result.target?.label || target?.label,
    registered: result.registered
  })
}

export const registerCodexSessionsIpc = (ipcMain: IpcMain, input: RegisterCodexSessionsIpcInput) => {
  const logCodexDebug = (event: string, details?: Record<string, unknown>) => {
    if (shouldUseTerminalDebugLogs()) input.logRuntimeEvent('debug', event, details)
  }

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
      targetLabel: options.target?.label,
      launchMode: options.launch?.mode || 'new',
      threadId: options.launch && options.launch.mode !== 'new' ? options.launch.threadId : undefined
    })
    try {
      const preparation = input.prepareCodexSessionLaunch
        ? await input.prepareCodexSessionLaunch(options)
        : null
      const effectiveOptions = preparation?.options || options
      if (preparation?.recoveredFromThreadId) {
        input.logRuntimeEvent('warn', 'codex.resume.missing-session-recovered', {
          id,
          productSessionId: effectiveOptions.productSessionId,
          threadId: preparation.recoveredFromThreadId,
          launchMode: effectiveOptions.launch?.mode || 'new'
        })
      }
      await input.ensureCodexTerminalBridgeServer(input.getUserDataPath())
      const targetUpdate = input.updateCodexTerminalBridgeSessionTarget(id, effectiveOptions.target)
      logTargetUpdate(input, 'codex.target.initialized', 'codex.target.initial-missing', targetUpdate, effectiveOptions.target, { id })
      const session = await input.createCodexSession(id, effectiveOptions, {
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
        thread: async (threadEvent) => {
          let bindingResult: ProductSessionNativeBindingResult = { status: 'bound' }
          if (effectiveOptions.productSessionId) {
            if (!input.bindCodexThread) {
              bindingResult = { status: 'failed', errorMessage: 'Codex product session binding is unavailable.' }
            } else {
              try {
                bindingResult = await input.bindCodexThread(effectiveOptions.productSessionId, threadEvent, effectiveOptions)
              } catch (error) {
                bindingResult = {
                  status: 'failed',
                  errorMessage: error instanceof Error ? error.message : String(error)
                }
              }
            }
          }
          input.logRuntimeEvent(bindingResult.status === 'bound' ? 'info' : 'warn', 'codex.thread.bound', {
            id: threadEvent.id,
            threadId: threadEvent.threadId,
            reason: threadEvent.reason,
            productSessionId: effectiveOptions.productSessionId,
            bindingStatus: bindingResult.status,
            ...(bindingResult.status === 'failed' ? { errorMessage: bindingResult.errorMessage } : {})
          })
          if (bindingResult.status === 'bound') {
            input.sendCodexThread(owner, threadEvent)
            return
          }
          if (bindingResult.status === 'failed') {
            input.sendCodexLifecycle(owner, {
              id: threadEvent.id,
              stage: 'error',
              at: Date.now(),
              errorCode: 'CODEX_PRODUCT_SESSION_BIND_FAILED',
              errorMessage: bindingResult.errorMessage
            })
          }
        },
        closed: (sessionId) => {
          input.clearCodexTerminalBridgeSessionTarget?.(sessionId)
          input.closeCodexDataSession?.(sessionId, 'codex-session-closed')
          input.logRuntimeEvent('info', 'codex.session-removed', { id: sessionId })
        }
      })
      input.logRuntimeEvent('info', 'codex.create.ready', {
        id,
        binaryPath: session.binaryPath,
        codexHome: session.codexHome,
        cwd: session.cwd,
        runtimeKind: session.runtimeKind,
        launchMode: effectiveOptions.launch?.mode || 'new',
        recoveredFromThreadId: preparation?.recoveredFromThreadId
      })
      return preparation
        ? {
            ...session,
            launch: effectiveOptions.launch || { mode: 'new' as const },
            ...(preparation.recoveredFromThreadId
              ? { recoveredFromThreadId: preparation.recoveredFromThreadId }
              : {})
          }
        : session
    } catch (error) {
      input.logRuntimeEvent('error', 'codex.create.failed', {
        id,
        error
      })
      throw error
    }
  })

  ipcMain.handle('codex:set-target', (_event, id: string, target: CodexSessionTargetContext | null | undefined): CodexSessionTargetUpdateResult => {
    const targetContext = normalizeCodexTargetContext(target)
    const runtimeId = String(id || '').trim()
    const result = input.updateCodexTerminalBridgeSessionTarget(runtimeId, targetContext)
    logTargetUpdate(input, 'codex.target.updated', 'codex.target.unavailable', result, targetContext, { id: runtimeId })
    return { ok: true, data: { codexRuntimeId: runtimeId || undefined, ...result } }
  })

  ipcMain.handle('codex:set-pending-context', async (_event, id: string, text?: string) => {
    const result = await input.setCodexSessionPendingContext(String(id || ''), text)
    if (result.ok) {
      logCodexDebug('codex.pending-context.updated', {
        id,
        bytes: result.data?.bytes,
        cleared: result.data?.cleared
      })
    } else {
      input.logRuntimeEvent('warn', 'codex.pending-context.rejected', {
        id,
        bytes: result.data?.bytes,
        cleared: result.data?.cleared,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage
      })
    }
    return result
  })

  ipcMain.handle('codex:write', (_event, id: string, data: string) => {
    const bytes = Buffer.byteLength(String(data || ''), 'utf8')
    logCodexDebug('codex.write.request', { id, bytes })
    const result = input.writeCodexSession(id, data)
    if (result.ok) logCodexDebug('codex.write.accepted', { id, bytes })
    else {
      input.logRuntimeEvent('warn', 'codex.write.rejected', {
        id,
        bytes,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage
      })
    }
    return result
  })

  ipcMain.handle('codex:resize', (_event, id: string, cols: number, rows: number) => {
    const resized = input.resizeCodexSession(id, cols, rows)
    if (resized) logCodexDebug('codex.resize', { id, cols, rows })
    else input.logRuntimeEvent('warn', 'codex.resize.missing-session', { id, cols, rows })
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
