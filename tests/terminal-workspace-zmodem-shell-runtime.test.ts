import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalZmodemProgress } from '@/services/terminal/zmodemRuntime'

const zmodemRuntimeState = vi.hoisted(() => ({
  cancel: vi.fn(),
  dispose: vi.fn(),
  handleTerminalData: vi.fn(() => false),
  lastOptions: null as null | {
    appendData: (sessionId: string, data: string) => void
    onNotice?: (message: string) => void
    onProgress: (sessionId: string, progress: TerminalZmodemProgress) => void
  }
}))

vi.mock('@/services/terminal/zmodemRuntime', () => ({
  createTerminalZmodemRuntime: vi.fn((options) => {
    zmodemRuntimeState.lastOptions = options
    return {
      cancel: zmodemRuntimeState.cancel,
      dispose: zmodemRuntimeState.dispose,
      handleTerminalData: zmodemRuntimeState.handleTerminalData
    }
  })
}))

const runningProgress = (overrides: Partial<TerminalZmodemProgress> = {}): TerminalZmodemProgress => ({
  visible: true,
  type: 'download',
  fileName: 'dump.sql',
  transferred: 50,
  total: 200,
  status: 'running',
  message: 'Downloading',
  ...overrides
})

describe('terminalWorkspaceZmodemShellRuntime', () => {
  beforeEach(() => {
    zmodemRuntimeState.cancel.mockClear()
    zmodemRuntimeState.dispose.mockClear()
    zmodemRuntimeState.handleTerminalData.mockClear()
    zmodemRuntimeState.lastOptions = null
  })

  it('tracks progress, percentage, completion hiding, and dispose timer cleanup', async () => {
    const {
      createTerminalWorkspaceZmodemShellRuntime,
      formatTerminalWorkspaceZmodemBytes
    } = await import('@/services/terminal/terminalWorkspaceZmodemShellRuntime')
    const timers = new Map<number, () => void>()
    let timerId = 0
    const cleared: number[] = []
    const runtime = createTerminalWorkspaceZmodemShellRuntime({
      getApi: () => undefined,
      appendData: vi.fn(),
      onNotice: vi.fn(),
      browser: {
        setTimer: (callback) => {
          timerId += 1
          const currentTimerId = timerId
          timers.set(currentTimerId, () => {
            timers.delete(currentTimerId)
            callback()
          })
          return timerId
        },
        clearTimer: (id) => {
          cleared.push(id)
          timers.delete(id)
        }
      }
    })

    zmodemRuntimeState.lastOptions?.onProgress('session-1', runningProgress())
    expect(runtime.zmodemProgress.fileName).toBe('dump.sql')
    expect(runtime.zmodemPercent.value).toBe(25)

    zmodemRuntimeState.lastOptions?.onProgress('session-1', runningProgress({ transferred: 200, status: 'success', message: 'Done' }))
    expect(runtime.zmodemProgress.status).toBe('success')
    expect(timers.size).toBe(1)
    timers.get(1)?.()
    expect(runtime.zmodemProgress.visible).toBe(false)
    expect(runtime.zmodemProgress.fileName).toBe('')

    zmodemRuntimeState.lastOptions?.onProgress('session-2', runningProgress({ status: 'cancelled' }))
    expect(timers.size).toBe(1)
    runtime.dispose()
    expect(zmodemRuntimeState.dispose).toHaveBeenCalled()
    expect(cleared).toContain(2)

    expect(formatTerminalWorkspaceZmodemBytes(512)).toBe('512 B')
    expect(formatTerminalWorkspaceZmodemBytes(1536)).toBe('1.5 KB')
    expect(formatTerminalWorkspaceZmodemBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('delegates terminal data and cancellation to the protocol runtime', async () => {
    const { createTerminalWorkspaceZmodemShellRuntime } = await import('@/services/terminal/terminalWorkspaceZmodemShellRuntime')
    zmodemRuntimeState.handleTerminalData.mockReturnValueOnce(true)
    const runtime = createTerminalWorkspaceZmodemShellRuntime({
      getApi: () => undefined,
      appendData: vi.fn(),
      onNotice: vi.fn(),
      browser: {
        setTimer: vi.fn(() => 1),
        clearTimer: vi.fn()
      }
    })
    const event = { id: 'session-1', data: '**\x18B', raw: new Uint8Array([0x2a, 0x2a, 0x18, 0x42]) }

    expect(runtime.handleTerminalData(event)).toBe(true)
    expect(zmodemRuntimeState.handleTerminalData).toHaveBeenCalledWith(event)

    runtime.cancelZmodemTransfer()
    expect(zmodemRuntimeState.cancel).not.toHaveBeenCalled()

    zmodemRuntimeState.lastOptions?.onProgress('session-1', runningProgress())
    runtime.cancelZmodemTransfer()
    expect(zmodemRuntimeState.cancel).toHaveBeenCalledWith('session-1')
  })
})
