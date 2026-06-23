import { afterEach, describe, expect, it, vi } from 'vitest'

type RuntimeLogBackend = {
  configureRuntimeLog: (config?: {
    getLogDir?: () => string
    mkdir?: (...args: any[]) => Promise<unknown>
    appendFile?: (...args: any[]) => Promise<unknown>
    now?: () => Date
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

    runtimeLog.configureRuntimeLog({
      getLogDir: () => '/tmp/aiopsterm/logs',
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

    expect(mkdir).toHaveBeenCalledWith('/tmp/aiopsterm/logs', { recursive: true })
    expect(appendFile).toHaveBeenCalledWith('/tmp/aiopsterm/logs/aiopsterm-runtime.log', expect.any(String), 'utf-8')
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
})
