import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

type RuntimeLogBackend = {
  configureRuntimeLog: (config?: {
    getLogDir?: () => string
    mkdir?: (...args: any[]) => Promise<unknown>
    appendFile?: (...args: any[]) => Promise<unknown>
    stat?: (...args: any[]) => Promise<{ size: number }>
    rename?: (...args: any[]) => Promise<unknown>
    rm?: (...args: any[]) => Promise<unknown>
    now?: () => Date
    isDebugEnabled?: () => boolean
    maxFileBytes?: number
    maxBackupFiles?: number
  }) => void
  runtimeLogPath: () => string
  writeRuntimeLog: (level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => Promise<void>
}

const loadRuntimeLogBackend = async () => {
  const modulePath = '../src/main/backend/app/runtimeLog'
  return (await import(modulePath)) as RuntimeLogBackend
}

describe('runtime log backend', () => {
  afterEach(async () => {
    const runtimeLog = await loadRuntimeLogBackend()
    runtimeLog.configureRuntimeLog()
    vi.restoreAllMocks()
  })

  it('writes JSON lines with metadata and redacts terminal command-like fields', async () => {
    vi.resetModules()
    const runtimeLog = await loadRuntimeLogBackend()
    const appended: string[] = []
    const mkdir = vi.fn(async () => undefined)
    const appendFile = vi.fn(async (_path: string, content: string) => {
      appended.push(content)
    })
    const logDir = '/tmp/aiopsterm/logs'

    runtimeLog.configureRuntimeLog({
      getLogDir: () => logDir,
      mkdir: mkdir as any,
      appendFile: appendFile as any,
      now: () => new Date('2026-06-13T01:02:03.000Z')
    })

    await runtimeLog.writeRuntimeLog('info', 'terminal.write.request', {
      id: 'session-1',
      bytes: 7,
      command: 'whoami',
      nested: {
        password: 'secret-value',
        safe: 'visible'
      },
      skipped: undefined
    })

    expect(mkdir).toHaveBeenCalledWith(logDir, { recursive: true })
    expect(appendFile).toHaveBeenCalledWith(join(logDir, 'aiopsterm-runtime.log'), expect.any(String), 'utf-8')
    const line = JSON.parse(appended[0])
    expect(line).toEqual({
      at: '2026-06-13T01:02:03.000Z',
      level: 'info',
      event: 'terminal.write.request',
      id: 'session-1',
      bytes: 7,
      command: '[redacted]',
      nested: {
        password: '[redacted]',
        safe: 'visible'
      }
    })
    expect(appended[0]).not.toContain('whoami')
    expect(appended[0]).not.toContain('secret-value')
  })

  it('does nothing when no log directory is configured', async () => {
    vi.resetModules()
    const runtimeLog = await loadRuntimeLogBackend()
    const appendFile = vi.fn(async () => undefined)

    runtimeLog.configureRuntimeLog({ appendFile: appendFile as any })

    await runtimeLog.writeRuntimeLog('debug', 'renderer.event', { id: 'session-2' })

    expect(runtimeLog.runtimeLogPath()).toBe('')
    expect(appendFile).not.toHaveBeenCalled()
  })

  it('filters debug entries unless diagnostics are enabled', async () => {
    vi.resetModules()
    const runtimeLog = await loadRuntimeLogBackend()
    const appendFile = vi.fn(async () => undefined)
    runtimeLog.configureRuntimeLog({
      getLogDir: () => '/tmp/aiopsterm/logs',
      mkdir: vi.fn(async () => undefined) as any,
      appendFile: appendFile as any,
      isDebugEnabled: () => false
    })

    await runtimeLog.writeRuntimeLog('debug', 'terminal.data.summary', { bytes: 10 })
    expect(appendFile).not.toHaveBeenCalled()

    runtimeLog.configureRuntimeLog({
      getLogDir: () => '/tmp/aiopsterm/logs',
      mkdir: vi.fn(async () => undefined) as any,
      appendFile: appendFile as any,
      isDebugEnabled: () => true
    })
    await runtimeLog.writeRuntimeLog('debug', 'terminal.data.summary', { bytes: 10 })
    expect(appendFile).toHaveBeenCalledTimes(1)
  })

  it('rotates an oversized log before appending', async () => {
    vi.resetModules()
    const runtimeLog = await loadRuntimeLogBackend()
    const appendFile = vi.fn(async () => undefined)
    const renamed: string[][] = []
    const removed: string[] = []
    const logDir = '/tmp/aiopsterm/logs'
    runtimeLog.configureRuntimeLog({
      getLogDir: () => logDir,
      mkdir: vi.fn(async () => undefined) as any,
      appendFile: appendFile as any,
      stat: vi.fn(async () => ({ size: 101 })) as any,
      rename: vi.fn(async (from: string, to: string) => renamed.push([from, to])) as any,
      rm: vi.fn(async (path: string) => removed.push(path)) as any,
      maxFileBytes: 100,
      maxBackupFiles: 2
    })

    await runtimeLog.writeRuntimeLog('info', 'terminal.lifecycle', { stage: 'connected' })
    expect(removed).toEqual([
      join(logDir, 'aiopsterm-runtime.log.2'),
      join(logDir, 'aiopsterm-runtime.log.1')
    ])
    expect(renamed).toEqual([
      [join(logDir, 'aiopsterm-runtime.log.1'), join(logDir, 'aiopsterm-runtime.log.2')],
      [join(logDir, 'aiopsterm-runtime.log'), join(logDir, 'aiopsterm-runtime.log.1')]
    ])
    expect(appendFile).toHaveBeenCalledTimes(1)
  })
})
