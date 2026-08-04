import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

type Listener = (...args: any[]) => void

const cleanupDirs: string[] = []

const loadRuntime = async () => {
  const modulePath = '../src/main/backend/app/crashDiagnosticsRuntime'
  return await import(modulePath)
}

const createHarness = async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), 'aiopsterm-crash-diagnostics-'))
  cleanupDirs.push(userDataPath)
  const listeners = new Map<string, Listener[]>()
  const app = {
    commandLine: { appendSwitch: vi.fn() },
    disableHardwareAcceleration: vi.fn(),
    getName: vi.fn(() => 'aiopsterm'),
    getPath: vi.fn((name: string) => name === 'userData' ? userDataPath : join(userDataPath, name)),
    getVersion: vi.fn(() => '0.1.0'),
    isReady: vi.fn(() => false),
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) || []), listener])
      return app
    }),
    setPath: vi.fn()
  }
  const crashReporter = {
    addExtraParameter: vi.fn(),
    start: vi.fn()
  }
  const log = vi.fn()
  const emit = (event: string, ...args: any[]) => {
    for (const listener of listeners.get(event) || []) listener({}, ...args)
  }
  return { userDataPath, app, crashReporter, log, emit }
}

describe('crash diagnostics runtime', () => {
  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
    vi.restoreAllMocks()
  })

  it('is disabled unless explicitly enabled by environment', async () => {
    const { shouldEnableCrashDiagnostics } = await loadRuntime()
    expect(shouldEnableCrashDiagnostics({} as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldEnableCrashDiagnostics({ AIOPSTERM_CRASH_DIAGNOSTICS: 'true' } as NodeJS.ProcessEnv)).toBe(false)
    expect(shouldEnableCrashDiagnostics({ AIOPSTERM_CRASH_DIAGNOSTICS: '1' } as NodeJS.ProcessEnv)).toBe(true)
  })

  it('starts local Crashpad diagnostics on a clean first run', async () => {
    const { configureCrashDiagnosticsRuntime } = await loadRuntime()
    const harness = await createHarness()
    const snapshot = configureCrashDiagnosticsRuntime({
      app: harness.app as any,
      crashReporter: harness.crashReporter,
      pid: 123,
      onProcess: vi.fn() as any,
      log: harness.log
    })

    expect(harness.app.setPath).toHaveBeenCalledWith('crashDumps', join(harness.userDataPath, 'crashes'))
    expect(harness.crashReporter.start).toHaveBeenCalledWith(expect.objectContaining({
      uploadToServer: false
    }))
    expect(harness.app.disableHardwareAcceleration).not.toHaveBeenCalled()

    harness.emit('will-quit')
    const state = JSON.parse(await readFile(join(harness.userDataPath, 'crash-diagnostics', 'last-run.json'), 'utf-8'))
    expect(state.status).toBe('clean-exit')
  })

  it('records a previous abnormal exit without changing the terminal renderer', async () => {
    const { configureCrashDiagnosticsRuntime } = await loadRuntime()
    const harness = await createHarness()
    const statePath = join(harness.userDataPath, 'crash-diagnostics', 'last-run.json')
    await mkdir(join(harness.userDataPath, 'crash-diagnostics'), { recursive: true })
    await writeFile(statePath, JSON.stringify({
      pid: 456,
      startedAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:01.000Z',
      status: 'ready',
      version: '0.1.0',
      platform: process.platform,
      arch: process.arch
    }), 'utf-8')
    const snapshot = configureCrashDiagnosticsRuntime({
      app: harness.app as any,
      crashReporter: harness.crashReporter,
      pid: 789,
      isProcessAlive: vi.fn(() => false),
      onProcess: vi.fn() as any,
      log: harness.log
    })

    expect(snapshot.previousAbnormalExit).toBe(true)
    expect(harness.app.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(harness.app.commandLine.appendSwitch).not.toHaveBeenCalled()
  })

  it('does not enter safe mode for build-start expected restarts', async () => {
    const { configureCrashDiagnosticsRuntime } = await loadRuntime()
    const harness = await createHarness()
    const diagnosticsDir = join(harness.userDataPath, 'crash-diagnostics')
    await mkdir(diagnosticsDir, { recursive: true })
    await writeFile(join(diagnosticsDir, 'last-run.json'), JSON.stringify({
      pid: 456,
      startedAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-05T00:00:01.000Z',
      status: 'ready',
      version: '0.1.0',
      platform: process.platform,
      arch: process.arch
    }), 'utf-8')
    await writeFile(join(diagnosticsDir, 'expected-restart.json'), JSON.stringify({
      createdAt: '2026-07-05T00:00:02.000Z',
      pids: [456]
    }), 'utf-8')
    const snapshot = configureCrashDiagnosticsRuntime({
      app: harness.app as any,
      crashReporter: harness.crashReporter,
      pid: 789,
      isProcessAlive: vi.fn(() => false),
      onProcess: vi.fn() as any,
      log: harness.log
    })

    expect(snapshot.previousAbnormalExit).toBe(false)
    expect(harness.app.disableHardwareAcceleration).not.toHaveBeenCalled()
    await expect(readFile(join(diagnosticsDir, 'expected-restart.json'), 'utf-8')).rejects.toThrow()
  })

  it('logs Electron process gone events with window context', async () => {
    const { configureCrashDiagnosticsRuntime } = await loadRuntime()
    const harness = await createHarness()
    const focusedWindow = { id: 88, isFocused: vi.fn(() => true) }
    configureCrashDiagnosticsRuntime({
      app: harness.app as any,
      crashReporter: harness.crashReporter,
      pid: 123,
      onProcess: vi.fn() as any,
      getWindows: () => [focusedWindow as any],
      browserWindowFromWebContents: () => focusedWindow as any,
      log: harness.log
    })

    harness.emit('render-process-gone', { id: 7, getURL: () => 'app://renderer/workspace' }, { reason: 'crashed', exitCode: 139 })
    harness.emit('child-process-gone', { type: 'GPU', reason: 'crashed', exitCode: 139, serviceName: 'gpu-process' })

    expect(harness.log).toHaveBeenCalledWith('error', 'electron.render-process-gone', expect.objectContaining({
      webContentsId: 7,
      windowId: 88,
      focusedWindowId: 88,
      reason: 'crashed',
      exitCode: 139
    }))
    expect(harness.log).toHaveBeenCalledWith('error', 'electron.child-process-gone', expect.objectContaining({
      type: 'GPU',
      serviceName: 'gpu-process',
      focusedWindowId: 88
    }))
  })
})
