import type { App, BrowserWindow, CrashReporter, WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { logRuntimeEvent } from './runtimeLog'

type CrashDiagnosticsState = {
  pid: number
  startedAt: string
  updatedAt: string
  status: 'starting' | 'ready' | 'closing' | 'clean-exit'
  version: string
  platform: NodeJS.Platform
  arch: string
  safeModeActive?: boolean
  safeModeReason?: string
}

type CrashDiagnosticsRuntimeInput = {
  app: Pick<App, 'commandLine' | 'disableHardwareAcceleration' | 'getName' | 'getPath' | 'getVersion' | 'isReady' | 'on' | 'setPath'>
  crashReporter: Pick<CrashReporter, 'addExtraParameter' | 'start'>
  env?: NodeJS.ProcessEnv
  now?: () => Date
  pid?: number
  isProcessAlive?: (pid: number) => boolean
  onProcess?: typeof process.on
  getWindows?: () => BrowserWindow[]
  browserWindowFromWebContents?: (webContents: WebContents) => BrowserWindow | null
  log?: typeof logRuntimeEvent
}

export type CrashDiagnosticsSnapshot = {
  crashDumpsDir: string
  stateFilePath: string
  previousAbnormalExit: boolean
  safeModeActive: boolean
  safeModeReason: string
}

const stateDirName = 'crash-diagnostics'
const stateFileName = 'last-run.json'
const expectedRestartFileName = 'expected-restart.json'
const crashDumpsDirName = 'crashes'

export const shouldEnableCrashDiagnostics = (env: NodeJS.ProcessEnv = process.env) =>
  cleanShortText(env.AIOPSTERM_CRASH_DIAGNOSTICS) === '1'

const readState = (stateFilePath: string): CrashDiagnosticsState | null => {
  try {
    if (!existsSync(stateFilePath)) return null
    const parsed = JSON.parse(readFileSync(stateFilePath, 'utf-8')) as Partial<CrashDiagnosticsState>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.pid !== 'number' || !parsed.status) return null
    return parsed as CrashDiagnosticsState
  } catch {
    return null
  }
}

const writeState = (stateFilePath: string, state: CrashDiagnosticsState) => {
  try {
    mkdirSync(dirname(stateFilePath), { recursive: true })
    writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  } catch (error) {
    logRuntimeEvent('warn', 'crash-diagnostics.state-write-failed', {
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  }
}

const isProcessAlive = (pid: number) => {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const previousRunEndedAbnormally = (state: CrashDiagnosticsState | null, checkProcessAlive = isProcessAlive) => {
  if (!state) return false
  if (state.status === 'clean-exit') return false
  return !checkProcessAlive(state.pid)
}

const consumeExpectedRestartMarker = (markerPath: string, previousPid?: number) => {
  try {
    if (!existsSync(markerPath)) return false
    const parsed = JSON.parse(readFileSync(markerPath, 'utf-8')) as { pids?: unknown }
    unlinkSync(markerPath)
    const pids = Array.isArray(parsed.pids)
      ? parsed.pids.map((pid) => Number(pid)).filter((pid) => Number.isFinite(pid) && pid > 0)
      : []
    return Boolean(previousPid && pids.includes(previousPid))
  } catch {
    try {
      unlinkSync(markerPath)
    } catch {
      // Ignore marker cleanup errors; diagnostics should stay best effort.
    }
    return false
  }
}

const cleanShortText = (value: unknown, fallback = '') => {
  const text = String(value ?? '').trim()
  return (text || fallback).slice(0, 120)
}

const shouldForceSafeMode = (env: NodeJS.ProcessEnv) => cleanShortText(env.AIOPSTERM_CRASH_SAFE_MODE) === '1'
const shouldDisableSafeMode = (env: NodeJS.ProcessEnv) => cleanShortText(env.AIOPSTERM_CRASH_SAFE_MODE) === '0'

const setEnv = (env: NodeJS.ProcessEnv, name: string, value: string) => {
  env[name] = value
}

const applySafeMode = (input: CrashDiagnosticsRuntimeInput, reason: string) => {
  const env = input.env || process.env
  setEnv(env, 'AIOPSTERM_CRASH_SAFE_MODE_ACTIVE', '1')
  setEnv(env, 'AIOPSTERM_CRASH_SAFE_MODE_REASON', reason)
  setEnv(env, 'AIOPSTERM_THREADED_TERMINAL', '0')
  setEnv(env, 'AIOPSTERM_TERMINAL_RENDER_BACKEND', '2d')
  try {
    if (!input.app.isReady?.()) {
      input.app.disableHardwareAcceleration()
      input.app.commandLine?.appendSwitch?.('disable-gpu')
    }
  } catch {
    // Safe mode must not block startup if Electron rejects a platform switch.
  }
}

const windowContext = (input: CrashDiagnosticsRuntimeInput) => {
  const windows = input.getWindows?.() || []
  return {
    windowCount: windows.length,
    focusedWindowId: windows.find((window) => {
      try {
        return window.isFocused()
      } catch {
        return false
      }
    })?.id
  }
}

const webContentsContext = (input: CrashDiagnosticsRuntimeInput, webContents: WebContents) => {
  let windowId: number | undefined
  try {
    windowId = input.browserWindowFromWebContents?.(webContents)?.id
  } catch {
    windowId = undefined
  }
  return {
    webContentsId: webContents.id,
    webContentsUrl: cleanShortText(webContents.getURL?.()),
    ...(windowId ? { windowId } : {})
  }
}

export const configureCrashDiagnosticsRuntime = (input: CrashDiagnosticsRuntimeInput): CrashDiagnosticsSnapshot => {
  const env = input.env || process.env
  const now = () => (input.now?.() || new Date()).toISOString()
  const log = input.log || logRuntimeEvent
  const userDataPath = input.app.getPath('userData')
  const crashDumpsDir = join(userDataPath, crashDumpsDirName)
  const stateFilePath = join(userDataPath, stateDirName, stateFileName)
  const expectedRestartFilePath = join(userDataPath, stateDirName, expectedRestartFileName)
  const previousState = readState(stateFilePath)
  const rawPreviousAbnormalExit = previousRunEndedAbnormally(previousState, input.isProcessAlive)
  const expectedRestart = rawPreviousAbnormalExit && consumeExpectedRestartMarker(expectedRestartFilePath, previousState?.pid)
  const previousAbnormalExit = rawPreviousAbnormalExit && !expectedRestart
  const safeModeReason = shouldForceSafeMode(env)
    ? 'forced'
    : previousAbnormalExit && !shouldDisableSafeMode(env)
      ? 'previous-abnormal-exit'
      : ''
  const safeModeActive = Boolean(safeModeReason)

  try {
    mkdirSync(crashDumpsDir, { recursive: true })
    input.app.setPath('crashDumps', crashDumpsDir)
  } catch (error) {
    log('warn', 'crash-diagnostics.crash-dump-dir-failed', {
      crashDumpsDir,
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  }

  if (safeModeActive) applySafeMode(input, safeModeReason)

  const currentState: CrashDiagnosticsState = {
    pid: input.pid || process.pid,
    startedAt: now(),
    updatedAt: now(),
    status: 'starting',
    version: input.app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    ...(safeModeActive ? { safeModeActive, safeModeReason } : {})
  }
  writeState(stateFilePath, currentState)

  try {
    input.crashReporter.start({
      productName: input.app.getName(),
      uploadToServer: false,
      compress: true,
      ignoreSystemCrashHandler: false,
      globalExtra: {
        app: input.app.getName(),
        version: input.app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        safe_mode: safeModeActive ? '1' : '0',
        safe_reason: safeModeReason || 'none'
      }
    })
    input.crashReporter.addExtraParameter('pid', String(currentState.pid))
  } catch (error) {
    log('warn', 'crash-diagnostics.crash-reporter-start-failed', {
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  }

  const updateStatus = (status: CrashDiagnosticsState['status']) => {
    currentState.status = status
    currentState.updatedAt = now()
    writeState(stateFilePath, currentState)
  }

  input.app.on('ready', () => {
    updateStatus('ready')
    log('info', 'crash-diagnostics.ready', {
      crashDumpsDir,
      stateFilePath,
      previousAbnormalExit,
      expectedRestart,
      safeModeActive,
      safeModeReason: safeModeReason || undefined
    })
  })

  input.app.on('before-quit', () => {
    updateStatus('closing')
  })

  input.app.on('will-quit', () => {
    updateStatus('clean-exit')
  })

  input.app.on('render-process-gone', (_event, webContents, details) => {
    log('error', 'electron.render-process-gone', {
      ...webContentsContext(input, webContents),
      ...windowContext(input),
      reason: cleanShortText(details?.reason),
      exitCode: details?.exitCode,
      safeModeActive
    })
  })

  input.app.on('child-process-gone', (_event, details) => {
    log('error', 'electron.child-process-gone', {
      ...windowContext(input),
      type: cleanShortText(details?.type),
      reason: cleanShortText(details?.reason),
      exitCode: details?.exitCode,
      serviceName: cleanShortText(details?.serviceName),
      name: cleanShortText(details?.name),
      safeModeActive
    })
  })

  const onProcess = input.onProcess || process.on.bind(process)

  onProcess('uncaughtExceptionMonitor', (error, origin) => {
    log('error', 'process.uncaught-exception', {
      origin,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack
    })
  })

  onProcess('unhandledRejection', (reason) => {
    log('error', 'process.unhandled-rejection', {
      reason: reason instanceof Error
        ? {
            name: reason.name,
            message: reason.message,
            stack: reason.stack
          }
        : cleanShortText(reason)
    })
  })

  return {
    crashDumpsDir,
    stateFilePath,
    previousAbnormalExit,
    safeModeActive,
    safeModeReason
  }
}
